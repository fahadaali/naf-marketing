import type { Env } from '../types';
import type { ModerateAction } from '../adapters/provider';
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

  // تنظيف السجلات القديمة الفارغة/العالقة (من مزامنات سابقة قبل الإصلاحات):
  // نحذف كل عنصر بلا نص ولم يُردّ عليه — عدا التقييمات (قد تكون تقييم نجوم بلا نص فتبقى).
  // العناصر الحقيقية تُعاد إضافتها فوراً أدناه.
  await env.DB.prepare(
    "DELETE FROM platform_comments WHERE (body IS NULL OR TRIM(body) = '') AND reply_body IS NULL AND replied_at IS NULL AND kind <> 'review'",
  ).run();

  let added = 0;
  for (const it of items) {
    if (!it.id) continue;
    const caps = it.capabilities ? JSON.stringify(it.capabilities) : null;
    const res = await env.DB.prepare(
      `INSERT INTO platform_comments
         (id, post_id, schedule_id, platform, provider_comment_id, kind, author_name, body, created_at,
          capabilities_json, is_hidden, reply_body)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, provider_comment_id) DO UPDATE SET
         kind = excluded.kind, body = excluded.body, author_name = excluded.author_name,
         capabilities_json = excluded.capabilities_json, is_hidden = excluded.is_hidden,
         reply_body = COALESCE(platform_comments.reply_body, excluded.reply_body)`,
    )
      .bind(
        newId('cm'), it.platform, it.id, it.kind, it.authorName, it.body, it.createdAt,
        caps, it.isHidden ? 1 : 0, it.repliedBody || null,
      )
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

// إشراف على تعليق: إخفاء/إظهار/حذف/إعجاب عبر المزوّد، وتحديث الحالة محلياً.
export async function moderateComment(env: Env, commentId: string, action: ModerateAction): Promise<void> {
  const row = await env.DB.prepare('SELECT provider_comment_id FROM platform_comments WHERE id = ?')
    .bind(commentId)
    .first<{ provider_comment_id: string }>();
  if (!row) throw new Error('التعليق غير موجود');

  const provider = await getProvider(env);
  if (!provider.moderateComment) throw new Error('المزوّد الحالي لا يدعم الإشراف على التعليقات');
  await provider.moderateComment(row.provider_comment_id, action);

  if (action === 'delete') {
    await env.DB.prepare('DELETE FROM platform_comments WHERE id = ?').bind(commentId).run();
  } else if (action === 'hide' || action === 'unhide') {
    await env.DB.prepare('UPDATE platform_comments SET is_hidden = ? WHERE id = ?')
      .bind(action === 'hide' ? 1 : 0, commentId)
      .run();
  }
}

// رد خاص لصاحب التعليق (Instagram/Facebook) — يُسجَّل كردّ محلياً.
export async function privateReplyToComment(env: Env, commentId: string, text: string, userId: string): Promise<void> {
  const row = await env.DB.prepare('SELECT provider_comment_id FROM platform_comments WHERE id = ?')
    .bind(commentId)
    .first<{ provider_comment_id: string }>();
  if (!row) throw new Error('التعليق غير موجود');

  const provider = await getProvider(env);
  if (!provider.privateReply) throw new Error('المزوّد الحالي لا يدعم الرد الخاص');
  await provider.privateReply(row.provider_comment_id, text);

  await env.DB.prepare(
    "UPDATE platform_comments SET reply_body = ?, replied_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), replied_by = ? WHERE id = ?",
  )
    .bind(`(رد خاص) ${text}`, userId, commentId)
    .run();
}
