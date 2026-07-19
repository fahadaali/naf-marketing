import type { Env } from '../types';
import { getProvider } from '../adapters';
import { newId } from '../util';

// يجلب التعليقات/الرسائل الجديدة لكل منشور منشور من المزوّد (إن دعمها) ويخزّنها.
export async function syncComments(env: Env): Promise<number> {
  const provider = await getProvider(env);
  if (!provider.getComments) return 0; // المزوّد الحالي لا يدعم التعليقات

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
  const comment = await env.DB.prepare(
    `SELECT pc.provider_comment_id, s.provider_post_id
     FROM platform_comments pc JOIN schedules s ON s.id = pc.schedule_id
     WHERE pc.id = ?`,
  )
    .bind(commentId)
    .first<{ provider_comment_id: string; provider_post_id: string }>();
  if (!comment) throw new Error('التعليق غير موجود');

  const provider = await getProvider(env);
  if (!provider.replyComment) throw new Error('المزوّد الحالي لا يدعم الرد على التعليقات');
  await provider.replyComment(comment.provider_post_id, comment.provider_comment_id, text);

  await env.DB.prepare(
    "UPDATE platform_comments SET reply_body = ?, replied_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), replied_by = ? WHERE id = ?",
  )
    .bind(text, userId, commentId)
    .run();
}
