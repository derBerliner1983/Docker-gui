import { execFileSync } from 'child_process';
import { notificationQueries, notifyConfigQueries, type NotifyConfigRow } from '../db/index';
import { hasBinary } from './privilege';

export type NotifyLevel = 'info' | 'success' | 'warning' | 'error';
export type NotifyEvent = 'backup' | 'security' | 'container' | 'antivirus' | 'test';

const EMOJI: Record<NotifyLevel, string> = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '🚨' };

function eventEnabled(cfg: NotifyConfigRow, event: NotifyEvent): boolean {
  switch (event) {
    case 'backup': return cfg.on_backup === 1;
    case 'security': return cfg.on_security === 1;
    case 'container': return cfg.on_container === 1;
    case 'antivirus': return cfg.on_antivirus === 1;
    default: return true; // test always dispatches
  }
}

async function dispatchWebhook(url: string, level: NotifyLevel, title: string, message: string): Promise<void> {
  const text = `${EMOJI[level]} **${title}**\n${message}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // content → Discord, text → Slack/Mattermost, the rest → generic consumers
      body: JSON.stringify({ content: text, text, app: 'core-hub', level, title, message, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* webhook unreachable – ignore, already logged in DB */ }
}

function dispatchEmail(to: string, title: string, message: string): void {
  const bin = hasBinary('mail') ? 'mail' : hasBinary('mailx') ? 'mailx' : null;
  if (!bin) return;
  try {
    execFileSync(bin, ['-s', `[Core-Hub] ${title}`, to], { input: message, timeout: 8000, stdio: ['pipe', 'ignore', 'ignore'] });
  } catch { /* local MTA missing – ignore */ }
}

/**
 * Record a notification and dispatch it to the configured channels.
 * Always stored in the DB log; external delivery depends on the per-event toggles.
 */
export async function notify(level: NotifyLevel, title: string, message = '', event: NotifyEvent = 'test'): Promise<void> {
  try {
    notificationQueries.create.run(level, title, message || null, event);
    notificationQueries.prune.run();
  } catch { /* DB issue – never block the caller */ }

  let cfg;
  try { cfg = notifyConfigQueries.get.get(); } catch { return; }
  if (!cfg || !eventEnabled(cfg, event)) return;

  if (cfg.webhook_url) await dispatchWebhook(cfg.webhook_url, level, title, message);
  if (cfg.email_to) dispatchEmail(cfg.email_to, title, message);
}
