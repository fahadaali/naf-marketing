import type { Env } from '../types';
import { getProvider, providerKey } from '../adapters';
import { listSocialApiInbox } from '../adapters/socialapi';
import { newId } from '../util';

async function providerName(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'provider_name'").first<{ value: string }>();
  return (row?.value || env.PROVIDER_NAME || 'mock').toLowerCase();
}

// يجلب التعليقات/الرسائل الجديدة ويخزّنها — يختار المسار حسب المزوّد.
export async function syncComments(env: Env): Promise<number> {
  if ((await providerName(env)) === 'socialapi') return syncSocialApiInbox(env);
  return syncPerPost(env);
}

// SocialAPI: صندوق وارد موحّد — كل التعليقات/المراجعات عبر كل الحسابات (لا لكل منشور)
async function syncSocialApiInbox(env: Env): Promise<number> {
  const token = providerKey(env, 'socialapi');
  if (!token) return 0;
  const items = await listSocialApiInbox(token);
  let added = 0;
  for (const it of items) {
    if (!it.id) continue;
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO platform_comments
         (id, post_id, schedule_id, platform, provider_comment_id, kind, author_name, body, created_at)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(newId('cm'), it.platform, it.id, it.kind, it.authorName, it.body, it.createdAt)
      .run();
    if (res.meta.changes > 0) added++;
  }
  return added;
}

// مزوّدون يعتمدون getComments لكل منشور نُشر عبر المنصة (Ayrshare/Mock)
async function syncPerPost(env: Env): Promise<number> {
  const provider = await getProvider(env);
  if (!provider.getComments) return 0;

  const { results } = await env.DB.prepare(
    `SELECT DISTINCT s.post_id, s.platform, s.provider_post_id, s.id AS schedule_id
     FROM schedules s WHERE s.status = 'published' AND s.provider_post_id IS NOT NULL`,
  ).all<{ post_id: string; platform: string; provider_post_id: string; schedule_id: string }>();

  let added = 0;
  for (const row of results) {
    let items: Awaited<ReturnType<NonNullable<typeof provider.getComments>>> = [];
    try {
      items = await provider.getComments(row.provider_post_id);
    } catch {
      continue;
    }
    for (const it of items) {
      const res = await env.DB.prepare(
        `INSERT OR IGNORE INTO platform_comments
           (id, post_id, schedule_id, platform, provider_comment_id, kind, author_name, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(newId('cm'), row.post_id, row.schedule_id, row.platform, it.id, it.kind, it.authorName, it.body, it.createdAt)
        .run();
      if (res.meta.changes > 0) added++;
    }
  }
  return added;
}

export async function replyToComment(env: Env, commentId: string, text: string, userId: string): Promise<void> {
  // LEFT JOIN كي يعمل الرد حتى لتعليقات الصندوق غير المرتبطة بجدول نشر (schedule_id = NULL)
  const comment = await env.DB.prepare(
    `SELECT pc.provider_comment_id, s.provider_post_id
     FROM platform_comments pc LEFT JOIN schedules s ON s.id = pc.schedule_id
     WHERE pc.id = ?`,
  )
    .bind(commentId)
    .first<{ provider_comment_id: string; provider_post_id: string | null }>();
  if (!comment) throw new Error('التعليق غير موجود');

  const provider = await getProvider(env);
  if (!provider.replyComment) throw new Error('المزوّد الحالي لا يدعم الرد على التعليقات');
  await provider.replyComment(comment.provider_post_id || '', comment.provider_comment_id, text);

  await env.DB.prepare(
    "UPDATE platform_comments SET reply_body = ?, replied_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), replied_by = ? WHERE id = ?",
  )
    .bind(text, userId, commentId)
    .run();
}
