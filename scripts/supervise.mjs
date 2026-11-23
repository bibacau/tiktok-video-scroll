// Keeps the app running in the background (started by launch.mjs). If the app crashes it is
// restarted after 5 seconds; a normal stop (dashboard Stop button / launch.mjs --stop) ends this too.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const LOG = path.join(DATA, 'logs', 'app.log');
const FLAG = path.join(DATA, 'stop.flag');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(path.join(DATA, 'supervisor.pid'), String(process.pid));
const note = msg => fs.appendFileSync(LOG, `[${new Date().toISOString()}] supervisor: ${msg}\n`);

let quickCrashes = 0;
while (true) {
  const started = Date.now();
  note('starting app');
  const out = fs.openSync(LOG, 'a');
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'src', 'index.ts')], {
      cwd: ROOT, stdio: ['ignore', out, out], windowsHide: true, env: process.env,
    });
    child.on('exit', c => resolve(c ?? 1));
    child.on('error', e => { note(`could not start: ${e.message}`); resolve(1); });
  });
  fs.closeSync(out);
  if (code === 0 || fs.existsSync(FLAG)) { note(`app stopped (code ${code})`); break; }
  quickCrashes = Date.now() - started < 30_000 ? quickCrashes + 1 : 0;
  if (quickCrashes >= 5) { note('app keeps crashing right after start — giving up. Check the messages above.'); break; }
  note(`app exited with code ${code}, restarting in 5s`);
  await new Promise(r => setTimeout(r, 5000));
}
try { fs.rmSync(FLAG, { force: true }); } catch { /* */ }
try { fs.rmSync(path.join(DATA, 'supervisor.pid'), { force: true }); } catch { /* */ }
