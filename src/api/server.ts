import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import { creator, getCreation, listCreations, type Step } from '../create/pipeline.ts';
import { listFiles, saveUpload, deleteUpload, isKind } from '../files.ts';
import { listWindowsVoices } from '../create/tts.ts';
import { closeProfile, profileState } from '../browser/edge.ts';
import { logins } from '../browser/login.ts';
import { addAccount, getAccount, listAccounts, removeAccount, updateAccount } from '../post/accounts.ts';
import { nextSlot, postSettingsFor, poster } from '../post/poster.ts';
import { analyticsAt, latestMetrics, performanceSummary } from '../post/analytics.ts';
import { engagementStats, listComments } from '../watch/engage.ts';
import { listSearches } from '../watch/search.ts';
import { EDGE_VOICES } from '../settings/schema.ts';
import { paths } from '../paths.ts';
import { getDb } from '../db.ts';
import { bus, log, type LogEvent } from '../log.ts';
import { controller } from '../runtime/controller.ts';
import { appSchema, presetSchema } from '../settings/schema.ts';
import * as store from '../settings/store.ts';
import { listPrompts, resetPrompt, setPrompt } from '../settings/prompts.ts';
import { budgetSummary } from '../llm/budget.ts';
import { chatJson, listModels, resetImageCapability } from '../llm/client.ts';
import { testVision } from '../llm/vision-test.ts';
import { generatePicks, getPicks } from '../watch/picks.ts';
import { regeneratePlan, todaysPlan } from '../schedule/planner.ts';
import { today } from '../time.ts';

const tokenFor = (pw: string) => createHash('sha256').update(`dash:${pw}`).digest('hex');

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  await app.register(fastifyWebsocket);
  await app.register(fastifyMultipart, { limits: { fileSize: 200 * 1024 * 1024, files: 20 } });
  await app.register(fastifyStatic, { root: paths.web, prefix: '/' });
  await app.register(fastifyStatic, { root: path.join(paths.root, 'node_modules'), prefix: '/vendor/', decorateReply: false, allowedPath: p => /^\/(preact|htm)\//.test(p) });
  await app.register(fastifyStatic, { root: paths.media, prefix: '/media/', decorateReply: false });
  await app.register(fastifyStatic, { root: paths.renders, prefix: '/renders/', decorateReply: false });
  await app.register(fastifyStatic, { root: path.join(paths.uploads, 'logos'), prefix: '/uploads/logos/', decorateReply: false });

  // Optional dashboard password (set in Settings). Localhost is always allowed.
  app.addHook('onRequest', async (req, reply) => {
    const pw = store.getAppSettings().general.dashboardPassword;
    if (!pw || !['/api/', '/ws', '/media/', '/renders/', '/uploads/'].some(p => req.url.startsWith(p))) return;
    if (req.url.startsWith('/api/login')) return;
    const ip = req.ip;
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return;
    const given = String(req.headers['x-dashboard-token'] ?? (req.query as any)?.token ?? '');
    const want = tokenFor(pw);
    if (given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) reply.code(401).send({ error: 'Password required' });
  });
  app.post('/api/login', async (req, reply) => {
    const pw = store.getAppSettings().general.dashboardPassword;
    const given = String((req.body as any)?.password ?? '');
    if (!pw) return { token: '' };
    if (tokenFor(given) !== tokenFor(pw)) return reply.code(401).send({ error: 'Wrong password' });
    return { token: tokenFor(pw) };
  });

  app.setErrorHandler((err: any, _req, reply) => {
    const code = err.statusCode && err.statusCode < 600 ? err.statusCode : 500;
    if (code >= 500) log('error', 'api', err.message);
    reply.code(code).send({ error: err.message });
  });

  // ----------------------------------------------------------- schema & settings
  app.get('/api/schema', async () => ({ preset: presetSchema, app: appSchema }));
  // Settings are saved one group / one section at a time, merged on the server, with a version check.
  const clientId = (req: any) => String(req.headers['x-client-id'] ?? '').slice(0, 64) || undefined;
  app.get('/api/app-settings', async () => ({ ...store.getAppSettingsPublic(), _versions: store.appVersions() }));
  app.patch('/api/app-settings/groups/:group', async req => {
    const b = (req.body ?? {}) as any;
    return store.patchAppGroup((req.params as any).group, b.value, b.version, clientId(req));
  });
  app.put('/api/app-settings', async (_req, reply) => reply.code(410).send({ error: 'Whole-settings saves are no longer accepted (they overwrote newer changes). Reload the dashboard.' }));

  app.get('/api/presets', async () => {
    const presets = store.listPresets();
    return { presets, dayPresets: store.getDayPresets(), versions: Object.fromEntries(presets.map(p => [p.id, store.presetVersions(p.id)])) };
  });
  app.patch('/api/presets/:id/sections/:section', async req => {
    const { id, section } = req.params as any; const b = (req.body ?? {}) as any;
    return store.patchPresetSection(id, section, b.value, b.version, clientId(req));
  });
  app.post('/api/presets', async req => {
    const b = (req.body ?? {}) as any;
    const from = b.copyFrom ? store.getPreset(b.copyFrom) : null;
    return store.createPreset(String(b.name || (from ? `${from.name} copy` : 'New preset')), from?.data ?? {});
  });
  // Rename only — settings are saved per section (PATCH above) so a stale page can't overwrite other sections.
  app.put('/api/presets/:id', async req => store.updatePreset((req.params as any).id, { name: (req.body as any)?.name }));
  app.delete('/api/presets/:id', async req => { store.deletePreset((req.params as any).id); return { ok: true }; });
  app.put('/api/day-presets', async req => store.setDayPresets(req.body as any));

  app.get('/api/prompts', async () => listPrompts());
  app.put('/api/prompts/:key', async req => { setPrompt((req.params as any).key, String((req.body as any)?.text ?? '')); return { ok: true }; });
  app.delete('/api/prompts/:key', async req => { resetPrompt((req.params as any).key); return { ok: true }; });

  app.get('/api/memory', async () => store.getMemory());
  app.put('/api/memory', async req => store.saveMemory(req.body as any));
  app.post('/api/memory/clear', async req => store.clearMemory(((req.body as any)?.what ?? 'interests')));

  app.get('/api/export', async (req, reply) => {
    reply.header('content-disposition', `attachment; filename="tiktok-agent-settings-${today()}.json"`);
    return store.exportAll((req.query as any)?.memory !== '0');
  });
  app.post('/api/import', async req => store.importAll(req.body));

  // ----------------------------------------------------------- AI
  app.get('/api/models', async () => ({ models: await listModels() }));
  app.post('/api/test-llm', async () => {
    const r = await chatJson({ step: 'watch', system: 'Reply with JSON {"ok": true, "hello": "<one friendly word in Malay>"}' });
    return { ok: true, model: r.model, reply: r.json };
  });
  app.post('/api/test-vision', async () => testVision());
  app.post('/api/reset-image-capability', async () => { resetImageCapability(); return { ok: true }; });

  // ----------------------------------------------------------- control
  app.get('/api/status', async () => controller.snapshot());
  app.post('/api/control/start', async req => {
    const b = (req.body ?? {}) as any;
    return controller.start({ minutes: b.minutes ? Number(b.minutes) : undefined, presetId: b.presetId || undefined });
  });
  app.post('/api/control/pause', async () => controller.pause());
  app.post('/api/control/resume', async () => controller.resume());
  app.post('/api/control/stop', async () => controller.stop());
  app.post('/api/control/open-browser', async req => { await controller.openBrowser((req.body as any)?.url); return controller.snapshot(); });
  app.post('/api/control/close-browser', async () => { await controller.closeBrowser(); return controller.snapshot(); });
  app.post('/api/control/dismiss-alert', async () => { controller.dismissAlert(); return controller.snapshot(); });
  app.get('/api/login/:profile', async req => logins.status((req.params as any).profile));
  app.post('/api/login/:profile/check', async req => logins.check((req.params as any).profile));
  app.post('/api/login/:profile/open', async req => {
    const profile = String((req.params as any).profile);
    const agentBusy = controller.browser.profile() === profile && controller.status.state !== 'idle';
    if (!agentBusy && controller.browser.profile() === profile) await controller.browser.detach();
    return logins.open(profile, { agentBusy });
  });
  app.get('/api/browser/profiles/:name', async req => profileState((req.params as any).name));
  app.post('/api/browser/profiles/:name/close', async req => {
    const name = String((req.params as any).name);
    if (controller.status.state !== 'idle' && controller.browser.profile() === name) throw Object.assign(new Error('Stop the session first'), { statusCode: 409 });
    if (controller.browser.profile() === name) await controller.browser.detach();
    const killed = await closeProfile(name);
    log('info', 'browser', `Closed Edge profile "${name}" (${killed} leftover process(es) ended)`);
    if (controller.status.alert?.profile === name) controller.dismissAlert();
    return { ok: true, killed, ...(await profileState(name)) };
  });
  app.get('/api/screenshot', async () => controller.lastScreenshot ?? {});
  app.post('/api/screenshot', async () => (await controller.snapshotNow()) ?? {});

  // ----------------------------------------------------------- schedule
  app.get('/api/plan', async () => todaysPlan());
  app.post('/api/plan/regenerate', async () => regeneratePlan());

  // ----------------------------------------------------------- picks & history
  app.get('/api/picks', async req => getPicks(String((req.query as any)?.day || today())));
  app.post('/api/picks/generate', async req => {
    const day = String((req.body as any)?.day || today());
    const presetId = (req.body as any)?.presetId || store.getDayPresets()[(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[new Date(day + 'T12:00:00').getDay()]];
    return generatePicks(day, store.getPreset(presetId) ?? store.listPresets()[0]);
  });
  app.get('/api/history/sessions', async req => {
    const limit = Math.min(500, Number((req.query as any)?.limit) || 100);
    return getDb().prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT ?').all(limit);
  });
  app.get('/api/history/videos', async req => {
    const q = req.query as any;
    const where: string[] = [], args: any[] = [];
    if (q.session) { where.push('session_id = ?'); args.push(Number(q.session)); }
    if (q.day) { where.push('day = ?'); args.push(String(q.day)); }
    if (q.saved === '1') where.push('saved = 1');
    if (q.decision) { where.push('decision = ?'); args.push(String(q.decision)); }
    const limit = Math.min(1000, Number(q.limit) || 200), offset = Math.max(0, Number(q.offset) || 0);
    const rows = getDb().prepare(`SELECT * FROM videos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    return rows.map(r => ({ ...r, data: JSON.parse(r.data || '{}') }));
  });
  app.get('/api/history/events', async req => {
    const limit = Math.min(1000, Number((req.query as any)?.limit) || 200);
    return (getDb().prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit) as any[]).map(e => ({ ...e, data: e.data ? JSON.parse(e.data) : null }));
  });
  app.get('/api/budget', async () => budgetSummary());
  app.get('/api/history/searches', async () => listSearches());

  app.get('/api/info', async () => ({
    version: '0.1.0', lan: Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i!.address),
    passwordRequired: !!store.getAppSettings().general.dashboardPassword, dataDir: paths.data,
  }));

  // Stop the whole app: dashboard Stop button and `launch.mjs --stop`. Protected by the dashboard
  // password (if set) like every other control. Writes stop.flag so the supervisor doesn't restart it.
  app.post('/api/shutdown', async req => {
    log('info', 'app', `Stop requested from ${req.ip}`);
    try { fs.writeFileSync(path.join(paths.data, 'stop.flag'), 'stop'); } catch { /* */ }
    setTimeout(() => process.emit('SIGTERM' as any), 300);
    return { ok: true };
  });

  // ----------------------------------------------------------- video creation
  app.get('/api/creations', async () => ({ creations: listCreations(100), queue: creator.state() }));
  app.get('/api/creations/:id', async (req, reply) => getCreation(Number((req.params as any).id)) ?? reply.code(404).send({ error: 'Not found' }));
  app.post('/api/creations', async req => {
    const b = (req.body ?? {}) as any;
    return creator.createVideos({ presetId: b.presetId || undefined, count: Number(b.count) || 1, topic: typeof b.topic === 'string' && b.topic.trim() ? b.topic.trim() : undefined });
  });
  app.post('/api/creations/:id/regenerate', async req => {
    const step = String((req.body as any)?.step) as Step;
    if (!['script', 'voice', 'visuals', 'render'].includes(step)) throw Object.assign(new Error('step must be script, voice, visuals or render'), { statusCode: 400 });
    return creator.rebuild(Number((req.params as any).id), step);
  });
  app.put('/api/creations/:id/script', async req => creator.saveScript(Number((req.params as any).id), req.body as any));
  app.delete('/api/creations/:id', async req => { creator.delete(Number((req.params as any).id)); return { ok: true }; });
  app.get('/api/voices', async () => ({ edge: EDGE_VOICES, windows: await listWindowsVoices().catch(() => []) }));

  // ----------------------------------------------------------- posting: accounts, queue, analytics, comments
  app.get('/api/accounts', async () => listAccounts());
  app.post('/api/accounts', async req => { const b = (req.body ?? {}) as any; return addAccount(String(b.name ?? ''), b.handle); });
  app.put('/api/accounts/:id', async req => updateAccount((req.params as any).id, req.body as any));
  app.delete('/api/accounts/:id', async req => { await removeAccount((req.params as any).id, (req.query as any)?.profile === '1'); return { ok: true }; });
  app.post('/api/accounts/:id/login', async req => {
    const a = getAccount((req.params as any).id);
    if (!a) throw Object.assign(new Error('Account not found'), { statusCode: 404 });
    const b = store.getAppSettings().browser;
    const qr = (req.body as any)?.qr !== false;
    return logins.open(a.profile, { url: `${b.baseUrl.replace(/\/+$/, '')}${qr ? '/login/qrcode' : b.loginPath}` });
  });
  app.get('/api/post/queue', async () => {
    const all = listCreations(200);
    const by = (...s: string[]) => all.filter((c: any) => s.includes(c.status));
    return {
      waiting: by('ready'), scheduled: by('approved', 'scheduled', 'posting', 'scheduled_tiktok'), posted: by('posted').slice(0, 50),
      failed: by('post_failed'), rejected: by('rejected').slice(0, 20), poster: poster.state(),
      comments: listComments().filter((c: any) => ['pending', 'approved', 'failed'].includes(c.status)), engagementToday: engagementStats(),
    };
  });
  app.get('/api/post/:id/next-slot', async req => {
    const c = getCreation(Number((req.params as any).id));
    if (!c) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    const post = postSettingsFor(c), account = (req.query as any)?.account || c.account_id || post.account;
    return { at: account ? nextSlot(post, account)?.toISOString() ?? null : null, scheduleWith: post.scheduleWith, account };
  });
  app.post('/api/post/:id/approve', async req => { const b = (req.body ?? {}) as any; return poster.approve(Number((req.params as any).id), { when: b.when, accountId: b.accountId }); });
  app.post('/api/post/:id/reject', async req => poster.reject(Number((req.params as any).id)));
  app.post('/api/post/:id/unschedule', async req => poster.unschedule(Number((req.params as any).id)));
  app.get('/api/analytics/:account', async req => {
    const id = (req.params as any).account;
    const days = Math.max(1, Number((req.query as any)?.days) || 14);
    return { at: analyticsAt(id), posts: latestMetrics(id), summary: performanceSummary(id, days) };
  });
  app.post('/api/analytics/:account/refresh', async req => { poster.refresh((req.params as any).account); return { ok: true, queued: true }; });
  app.post('/api/comments/:id/approve', async req => {
    const id = Number((req.params as any).id), text = String((req.body as any)?.text ?? '').trim().slice(0, 150);
    const db = (await import('../db.ts')).getDb();
    if (text) db.prepare("UPDATE engagements SET text = ? WHERE id = ? AND kind = 'comment'").run(text, id);
    db.prepare("UPDATE engagements SET status = 'approved', error = NULL WHERE id = ? AND kind = 'comment' AND status IN ('pending', 'failed')").run(id);
    void controller.postApprovedComments().catch(() => {});
    return { ok: true, willPost: controller.status.state === 'idle' ? 'now' : 'after the current session' };
  });
  app.post('/api/comments/:id/reject', async req => {
    (await import('../db.ts')).getDb().prepare("UPDATE engagements SET status = 'rejected' WHERE id = ? AND kind = 'comment' AND status != 'posted'").run(Number((req.params as any).id));
    return { ok: true };
  });

  // ----------------------------------------------------------- uploads (fonts, logos, music)
  app.get('/api/files/:kind', async req => {
    const kind = (req.params as any).kind;
    if (!isKind(kind)) throw Object.assign(new Error('Unknown kind'), { statusCode: 404 });
    return listFiles(kind);
  });
  app.post('/api/files/:kind', async req => {
    const kind = (req.params as any).kind;
    if (!isKind(kind)) throw Object.assign(new Error('Unknown kind'), { statusCode: 404 });
    const saved: string[] = [];
    for await (const part of req.files()) saved.push(saveUpload(kind, part.filename, await part.toBuffer()));
    log('info', 'files', `Uploaded ${saved.length} ${kind} file(s)`);
    return { saved };
  });
  app.delete('/api/files/:kind/:name', async req => {
    const { kind, name } = req.params as any;
    if (!isKind(kind)) throw Object.assign(new Error('Unknown kind'), { statusCode: 404 });
    deleteUpload(kind, name); return { ok: true };
  });

  // ----------------------------------------------------------- live updates
  app.get('/ws', { websocket: true }, socket => {
    controller.viewers++;
    const send = (type: string, data: unknown) => { if (socket.readyState === 1) socket.send(JSON.stringify({ type, data })); };
    const onStatus = (s: unknown) => send('status', s);
    const onShot = (s: unknown) => send('screenshot', s);
    const onLog = (e: LogEvent) => { if (e.level !== 'debug') send('log', e); };
    const onCreation = (c: unknown) => send('creation', c);
    const onQueue = (q: unknown) => send('creatorQueue', q);
    const onDeleted = (id: unknown) => send('creationDeleted', id);
    const onLogin = (st: unknown) => send('login', st);
    const onPostQueue = (q: unknown) => send('posterQueue', q);
    const onAnalytics = (a: unknown) => send('analytics', a);
    const onSettings = (e: unknown) => send('settingsChanged', e);
    store.settingsBus.on('changed', onSettings);
    logins.on('status', onLogin); poster.on('queue', onPostQueue); poster.on('analytics', onAnalytics);
    controller.on('status', onStatus); controller.on('screenshot', onShot); bus.on('log', onLog);
    creator.on('update', onCreation); creator.on('queue', onQueue); creator.on('deleted', onDeleted);
    send('status', controller.snapshot());
    if (controller.lastScreenshot) send('screenshot', controller.lastScreenshot);
    socket.on('close', () => {
      controller.viewers--; controller.off('status', onStatus); controller.off('screenshot', onShot); bus.off('log', onLog);
      store.settingsBus.off('changed', onSettings);
      logins.off('status', onLogin); poster.off('queue', onPostQueue); poster.off('analytics', onAnalytics);
      creator.off('update', onCreation); creator.off('queue', onQueue); creator.off('deleted', onDeleted);
    });
  });

  return app;
}
