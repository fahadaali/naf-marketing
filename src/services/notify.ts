import type { Env } from '../types';
import { newId } from '../util';
import { getEmailProvider } from './email';

type NotifyInput = { type: string; title: string; body?: string; link?: string };

// ينشئ إشعاراً داخل التطبيق لكل مستخدم، ويحاول إرسال بريد (best-effort، لا يعطّل عند الفشل)
async function notifyUsers(env: Env, userIds: string[], input: NotifyInput): Promise<void> {
  if (!userIds.length) return;
  const stmts = userIds.map((uid) =>
    env.DB.prepare(
      'INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(newId('ntf'), uid, input.type, input.title, input.body || null, input.link || null),
  );
  await env.DB.batch(stmts);

  try {
    const provider = await getEmailProvider(env);
    const { results } = await env.DB.prepare(
      `SELECT email FROM users WHERE id IN (${userIds.map(() => '?').join(',')}) AND is_active = 1`,
    )
      .bind(...userIds)
      .all<{ email: string }>();
    const html = `<div dir="rtl" style="font-family:sans-serif"><h3>${input.title}</h3><p>${input.body || ''}</p></div>`;
    for (const r of results) {
      try { await provider.send(r.email, input.title, html); } catch { /* تُتجاهل */ }
    }
  } catch { /* لا تعطّل الإشعار داخل التطبيق عند فشل البريد */ }
}

async function usersWithPermission(env: Env, permissionKey: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id FROM users u
     JOIN roles_permissions rp ON rp.role_name = u.role_name AND rp.permission_key = ?
     WHERE rp.allowed = 1 AND u.is_active = 1`,
  )
    .bind(permissionKey)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

// إشعار بوصول محتوى لدور المراجعة/الاعتماد
export async function notifyStageReached(env: Env, postId: string, toStatus: string): Promise<void> {
  const post = await env.DB.prepare('SELECT title FROM content_posts WHERE id = ?').bind(postId).first<{ title: string }>();
  if (!post) return;
  const link = `/editor/${postId}`;

  if (toStatus === 'pending_marketing') {
    const ids = await usersWithPermission(env, 'content.review');
    await notifyUsers(env, ids, { type: 'approval_turn', title: 'محتوى بانتظار مراجعتك', body: post.title, link });
  } else if (toStatus === 'pending_gm') {
    const ids = await usersWithPermission(env, 'content.approve_final');
    await notifyUsers(env, ids, { type: 'approval_turn', title: 'محتوى بانتظار اعتمادك النهائي', body: post.title, link });
  } else if (toStatus === 'rejected') {
    const author = await env.DB.prepare('SELECT author_id FROM content_posts WHERE id = ?').bind(postId).first<{ author_id: string }>();
    if (author) await notifyUsers(env, [author.author_id], { type: 'rejected', title: 'رُفض محتواك', body: post.title, link });
  }
}

// إشعار بفشل نشر مجدول
export async function notifyPublishFailed(env: Env, postId: string, platform: string, error: string): Promise<void> {
  const post = await env.DB.prepare('SELECT title, author_id FROM content_posts WHERE id = ?')
    .bind(postId)
    .first<{ title: string; author_id: string }>();
  if (!post) return;
  const gmIds = await usersWithPermission(env, 'content.approve_final');
  const ids = Array.from(new Set([...gmIds, post.author_id]));
  await notifyUsers(env, ids, {
    type: 'publish_failed',
    title: 'فشل نشر منشور',
    body: `${post.title} — ${platform}: ${error}`,
    link: `/editor/${postId}`,
  });
}
