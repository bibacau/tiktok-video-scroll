// The no-script launcher: start in background, supervisor restarts a crashed app, Stop really stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tta-launch-'));
const PORT = '8077';
const env = { ...process.env, DATA_DIR: DATA, PORT, NO_SCHEDULER: '1' };
const launch = (...a: string[]) => spawnSync(process.execPath, ['scripts/launch.mjs', ...a], { env, encoding: 'utf8', timeout: 90_000 });
const alive = async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/api/info`)).ok; } catch { return false; } };
const until = async (fn: () => Promise<boolean>, ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 300)); } return false; };

test('launch → crash → auto-restart → stop', { timeout: 120_000 }, async () => {
  fs.mkdirSync(path.join(process.cwd(), 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'node_modules', '.deps-v5'), 'test'); // deps already installed here
  const r = launch('--background');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Running/);
  assert.ok(await alive());
  const pid = Number(fs.readFileSync(path.join(DATA, 'app.pid'), 'utf8'));
  process.kill(pid, 'SIGKILL'); // crash
  assert.ok(await until(async () => !(await alive()), 5000));
  assert.ok(await until(async () => (await alive()) && Number(fs.readFileSync(path.join(DATA, 'app.pid'), 'utf8')) !== pid, 30_000), 'restarted by the supervisor');
  // dashboard Stop button
  await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.ok(await until(async () => !(await alive()), 10_000));
  await new Promise(r => setTimeout(r, 7000));
  assert.equal(await alive(), false, 'stays stopped');
  assert.ok(await until(async () => !fs.existsSync(path.join(DATA, 'supervisor.pid')), 5000), 'supervisor ended');
  assert.match(fs.readFileSync(path.join(DATA, 'logs', 'app.log'), 'utf8'), /restarting in 5s[\s\S]*app stopped/);
  // start again, then stop with --stop
  assert.equal(launch('--background').status, 0);
  assert.ok(await alive());
  const s = launch('--stop');
  assert.match(s.stdout, /Stopped/);
  assert.equal(await alive(), false);
});
