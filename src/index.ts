import fs from 'node:fs';
import { ensureDirs, paths } from './paths.ts';
import { getDb, closeDb } from './db.ts';
import { log } from './log.ts';
import { listPresets, loadSecretsIntoRedactor } from './settings/store.ts';
import { buildServer } from './api/server.ts';
import { controller } from './runtime/controller.ts';
import { poster } from './post/poster.ts';

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
  log('info', 'app', `Data folder: ${paths.data} (settings, API keys, Edge profiles, videos)`);
  if (process.env.NO_SCHEDULER !== '1') { controller.startScheduler(); poster.start(); }

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
