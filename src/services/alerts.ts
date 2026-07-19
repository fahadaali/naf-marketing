import type { Env } from '../types';
import { notifyUsers, usersWithPermission } from './notify';

const STAGE_PERMISSION: Record<string, string> = {
  pending_marketing: 'content.review',
  pending_gm: 'content.approve_final',
};

async function staleAlertDays(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'stale_alert_days'").first<{ value: string }>();
  const n = row ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export type StaleContentItem = {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  days_stuck: number;
};

// المحتوى العالق في مرحلة مراجعة/اعتماد لأكثر من الحد المسموح
export async function listStaleContent(env: Env): Promise<StaleContentItem[]> {
  const days = await staleAlertDays(env);
  const { results } = await env.DB.prepare(
    `SELECT id, title, status, updated_at,
            CAST((julianday('now') - julianday(updated_at)) AS INTEGER) AS days_stuck
     FROM content_posts
     WHERE status IN ('pending_marketing','pending_gm')
       AND julianday('now') - julianday(updated_at) >= ?
     ORDER BY updated_at ASC`,
  )
    .bind(days)
    .all<StaleContentItem>();
  return results;
}

// يفحص المحتوى المتأخر في مرحلته الحالية وينبّه المسؤولين عنه (بحد أقصى تنبيه واحد كل ~٢٠ ساعة لكل منشور)
export async function checkStaleContent(env: Env): Promise<void> {
  const stale = await listStaleContent(env);
  for (const item of stale) {
    const permissionKey = STAGE_PERMISSION[item.status];
    if (!permissionKey) continue;
    const link = `/editor/${item.id}`;

    const recent = await env.DB.prepare(
      `SELECT id FROM notifications
       WHERE type = 'stale_alert' AND link = ?
         AND created_at >= datetime('now', '-20 hours')
       LIMIT 1`,
    )
      .bind(link)
      .first();
    if (recent) continue;

    const ids = await usersWithPermission(env, permissionKey);
    if (!ids.length) continue;
    await notifyUsers(env, ids, {
      type: 'stale_alert',
      title: 'محتوى متأخر بحاجة لمتابعة',
      body: `"${item.title}" عالق منذ ${item.days_stuck} يوم/أيام في مرحلة المراجعة`,
      link,
    });
  }
}
