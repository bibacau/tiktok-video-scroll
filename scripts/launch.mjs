#!/usr/bin/env node
// Start / stop the TikTok Research Agent with node.exe only — no .bat, .cmd or PowerShell scripts,
// so Windows Smart App Control has nothing to block (node.exe is signed by the OpenJS Foundation).
//
//   node scripts/launch.mjs                      start (installs dependencies if needed) and open the dashboard
//   node scripts/launch.mjs --background         start without opening the dashboard (used at Windows sign-in)
//   node scripts/launch.mjs --stop               stop the app (same as the dashboard's Stop button)
//   node scripts/launch.mjs --install-shortcuts  create "TikTok Agent" + "Stop TikTok Agent" shortcuts
//                                                (add --autostart to also start it when you sign in)
//   node scripts/launch.mjs --remove-shortcuts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PORT = Number(process.env.PORT || 8004);
const URL_ = `http://localhost:${PORT}`;
const STAMP = path.join(ROOT, 'node_modules', '.deps-v5');
const args = new Set(process.argv.slice(2));
const win = process.platform === 'win32';
const say = (...a) => console.log('[TikTok Agent]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function alive() {
  try { return (await fetch(`http://127.0.0.1:${PORT}/api/info`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

function openDashboard() {
  if (win) spawn('explorer.exe', [URL_], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [URL_], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [URL_], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

function checkNode() {
  const [a, b] = process.versions.node.split('.').map(Number);
  if (a > 22 || (a === 22 && b >= 18)) return;
  say(`Node.js ${process.versions.node} is too old. Install Node.js 24 LTS (.msi) from https://nodejs.org`);
  process.exit(1);
}

/** Remove the "downloaded from the internet" mark (Smart App Control / SmartScreen). */
function unblock() {
  if (!win) return;
  for (const f of walk(ROOT)) { try { fs.rmSync(`${f}:Zone.Identifier`, { force: true }); } catch { /* not marked */ } }
}
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'data') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* walk(p); } else yield p;
  }
}

/** npm install, run through node.exe directly (no npm.cmd → no cmd.exe). */
function installDeps() {
  if (fs.existsSync(STAMP)) return;
  const npmCli = [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(f => fs.existsSync(f));
  if (!npmCli) { say('npm was not found next to node.exe. Reinstall Node.js with the official installer.'); process.exit(1); }
  for (const old of ['esbuild', 'tsx']) fs.rmSync(path.join(ROOT, 'node_modules', old), { recursive: true, force: true });
  say('Installing dependencies (first start or after an update, takes a minute)…');
  const r = spawnSync(process.execPath, [npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) { say('Installing dependencies failed — see the messages above.'); process.exit(1); }
  fs.writeFileSync(STAMP, new Date().toISOString());
}

async function start({ background }) {
  checkNode();
  if (await alive()) { say(`Already running → ${URL_}`); if (!background) openDashboard(); return; }
  unblock();
  installDeps();
  fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true });
  try { fs.rmSync(path.join(DATA, 'stop.flag'), { force: true }); } catch { /* */ }
  const sup = spawn(process.execPath, [path.join(ROOT, 'scripts', 'supervise.mjs')], {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA },
  });
  sup.unref();
  say('Starting…');
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await alive()) {
      say(`Running → ${URL_}  (log: ${path.join(DATA, 'logs', 'app.log')})`);
      if (!background) openDashboard();
      return;
    }
  }
  say(`It did not start within 30 seconds. See ${path.join(DATA, 'logs', 'app.log')}`);
  process.exitCode = 1;
}

async function stop() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'stop.flag'), 'stop');
  if (await alive()) {
    say('Stopping…');
    await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
    for (let i = 0; i < 40 && await alive(); i++) await sleep(250);
  }
  for (const f of ['app.pid', 'supervisor.pid']) {
    try { const pid = Number(fs.readFileSync(path.join(DATA, f), 'utf8')); if (pid) process.kill(pid); } catch { /* not running */ }
    try { fs.rmSync(path.join(DATA, f), { force: true }); } catch { /* */ }
  }
  say('Stopped.');
}

// ------------------------------------------------------------------ shortcuts
function shortcutDirs() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  let desktop = path.join(os.homedir(), 'Desktop');
  try { desktop = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).trim() || desktop; } catch { /* default */ }
  return { desktop, menu: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), startup: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') };
}
const LINKS = [
  { name: 'TikTok Agent', args: '', desc: 'Start the TikTok Research Agent and open its dashboard', icon: 'msedge' },
  { name: 'Stop TikTok Agent', args: '--stop', desc: 'Stop the TikTok Research Agent', icon: 'stop' },
];
function iconFor(kind) {
  const edge = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES].filter(Boolean).map(r => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(f => fs.existsSync(f));
  return kind === 'msedge' && edge ? `${edge},0` : `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\shell32.dll,${kind === 'stop' ? 27 : 137}`;
}

function installShortcuts(autostart) {
  if (!win) { say('Shortcuts are for Windows. Elsewhere run: node scripts/launch.mjs'); return; }
  const { desktop, menu, startup } = shortcutDirs();
  const script = path.join(ROOT, 'scripts', 'launch.mjs');
  const items = [];
  for (const l of LINKS) for (const dir of [desktop, menu]) items.push({ ...l, file: path.join(dir, `${l.name}.lnk`) });
  if (autostart) items.push({ ...LINKS[0], args: '--background', file: path.join(startup, 'TikTok Agent (background).lnk') });
  const ps = items.map(i => `$s = $w.CreateShortcut('${i.file.replace(/'/g, "''")}'); $s.TargetPath = '${process.execPath.replace(/'/g, "''")}'; ` +
    `$s.Arguments = '"${script.replace(/'/g, "''")}" ${i.args}'; $s.WorkingDirectory = '${ROOT.replace(/'/g, "''")}'; $s.Description = '${i.desc}'; ` +
    `$s.IconLocation = '${iconFor(i.icon).replace(/'/g, "''")}'; $s.WindowStyle = 7; $s.Save()`).join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$w = New-Object -ComObject WScript.Shell; ${ps}`], { encoding: 'utf8' });
  if (r.status === 0 && items.every(i => fs.existsSync(i.file))) {
    say('Created shortcuts:'); items.forEach(i => console.log('   ', i.file));
    return;
  }
  // Locked-down PowerShell (e.g. Smart App Control's constrained mode) can't create shortcuts: explain how by hand.
  say('Windows did not let me create the shortcuts automatically. Create them by hand (1 minute):');
  console.log(`
  1. Right-click the desktop → New → Shortcut
  2. In "Type the location of the item", paste exactly:
       "${process.execPath}" "${script}"
  3. Next → name it  TikTok Agent  → Finish
  4. Repeat with this location and the name  Stop TikTok Agent:
       "${process.execPath}" "${script}" --stop
  (Optional) To start it when you sign in: put a copy of the first shortcut in
       ${startup}
     and add  --background  at the end of its Target.`);
}

function removeShortcuts() {
  if (!win) return;
  const { desktop, menu, startup } = shortcutDirs();
  for (const f of [...LINKS.flatMap(l => [path.join(desktop, `${l.name}.lnk`), path.join(menu, `${l.name}.lnk`)]), path.join(startup, 'TikTok Agent (background).lnk')]) {
    try { fs.rmSync(f, { force: true }); } catch { /* */ }
  }
  say('Shortcuts removed.');
}

if (args.has('--stop')) await stop();
else if (args.has('--install-shortcuts')) installShortcuts(args.has('--autostart'));
else if (args.has('--remove-shortcuts')) removeShortcuts();
else await start({ background: args.has('--background') });
