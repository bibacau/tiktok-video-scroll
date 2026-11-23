import fs from 'node:fs';
import { ensureDirs, paths } from './paths.js';
import { getDb, closeDb } from './db.js';
import { log } from './log.js';
import { listPresets, loadSecretsIntoRedactor } from './settings/store.js';
import { buildServer } from './api/server.js';
import { controller } from './runtime/controller.js';

const PORT = Number(process.env.PORT || 8004);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  ensureDirs();
  getDb();
  loadSecretsIntoRedactor();
  listPresets(); // creates the Default preset on first run
  const app = await buildServer();
  await app.listen({ port: PORT, host: HOST });
  fs.writeFileSync(paths.pid, String(process.pid));
  log('info', 'app', `Dashboard running on http://localhost:${PORT}`);
  if (process.env.NO_SCHEDULER !== '1') controller.startScheduler();

  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return; closing = true;
    log('info', 'app', `Shutting down (${sig})`);
    await controller.shutdown().catch(() => {});
    await app.close().catch(() => {});
    try { fs.unlinkSync(paths.pid); } catch { /* ignore */ }
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

process.on('unhandledRejection', (e: any) => log('error', 'app', `Unhandled: ${e?.message ?? e}`));
process.on('uncaughtException', (e: any) => log('error', 'app', `Uncaught: ${e?.message ?? e}`));

main().catch(e => { console.error(e); process.exit(1); });
