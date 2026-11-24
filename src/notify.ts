// Telegram messages (Settings → Notifications). Used by the share fallback; Phase 4 extends this.
import { getAppSettings } from './settings/store.ts';

export function telegramConfigured() {
  const n = getAppSettings().notifications;
  return !!(n.telegramBotToken && n.telegramChatId);
}

export async function sendTelegram(text: string): Promise<void> {
  const n = getAppSettings().notifications;
  if (!n.telegramBotToken || !n.telegramChatId) throw new Error('Telegram is not set up (Settings → Notifications: bot token and chat ID)');
  const base = process.env.TELEGRAM_API ?? 'https://api.telegram.org';
  const res = await fetch(`${base}/bot${n.telegramBotToken}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: n.telegramChatId, text: text.slice(0, 4000), disable_web_page_preview: false }),
    signal: AbortSignal.timeout(20_000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(`Telegram: ${j.description ?? `HTTP ${res.status}`}`);
}
