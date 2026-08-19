import type { Env, User } from '../types';
import { hasPermission } from '../permissions';
import { newId, nowIso } from '../util';

// دورة حياة المحتوى — التسلسل الإلزامي. لا يمكن تجاوز مرحلة.
// draft -> pending_marketing -> pending_gm -> approved/scheduled -> published -> archived
// rejected: حالة عرضية تُعيد المحتوى للكاتب مع سبب إلزامي من أي مرحلة مراجعة.

export type Action = 'submit' | 'approve' | 'reject' | 'archive';

type Post = { id: string; status: string; author_id: string };

// الانتقالات المسموحة: (action, currentStatus) -> { to, permission }
const TRANSITIONS: Record<string, { to: string; permission: string }> = {
  'submit:draft': { to: 'pending_marketing', permission: 'content.submit' },
  'submit:rejected': { to: 'pending_marketing', permission: 'content.submit' },
  'approve:pending_marketing': { to: 'pending_gm', permission: 'content.review' },
  'approve:pending_gm': { to: 'approved', permission: 'content.approve_final' },
  'reject:pending_marketing': { to: 'rejected', permission: 'content.review' },
  'reject:pending_gm': { to: 'rejected', permission: 'content.approve_final' },
  'archive:published': { to: 'archived', permission: 'content.approve_final' },
  'archive:approved': { to: 'archived', permission: 'content.approve_final' },
};

export async function transition(
  env: Env,
  user: User,
  post: Post,
  action: Action,
  note?: string,
): Promise<{ ok: true; to: string } | { ok: false; status: number; error: string }> {
  const key = `${action}:${post.status}`;
  const rule = TRANSITIONS[key];
  if (!rule) {
    return { ok: false, status: 400, error: `لا يمكن تنفيذ «${action}» على الحالة الحالية` };
  }

  const allowed = await hasPermission(env, user.role_name, rule.permission);
  if (!allowed) return { ok: false, status: 403, error: 'ليست لديك صلاحية لهذه العملية' };

  /* ═══ لا يعتمد المحتوى كاتبُه ═══

     كان `post.author_id` يُمرَّر إلى هنا عبر ثلاث طبقات ولا يُقرأ —
     حقلٌ يوحي بقاعدةٍ لم تُكتب. فمدير التسويق كان يعتمد ما كتبه بنفسه،
     والمراجعةُ حينئذٍ توقيعٌ على الذات لا مراجعة.

     والمدير العام مستثنى بحكم موقعه: لا معتمِد فوقه، فمنعُه يوقف محتواه
     عند بابٍ لا يفتحه أحد. والرفضُ والأرشفة خارج القاعدة — من حقّ
     المرء أن يسحب عمله أو يؤرشفه.

     والأثر مسجَّل في `approvals` كما هو، فيقرأ المدقّق من اعتمد ومتى. */
  if (action === 'approve' && user.id === post.author_id && user.role_name !== 'general_manager') {
    return {
      ok: false,
      status: 403,
      error: 'لا يعتمد المحتوى كاتبُه. يعتمده غيرك ممّن يملك الصلاحية.',
    };
  }

  if (action === 'reject' && (!note || !note.trim())) {
    return { ok: false, status: 400, error: 'سبب الرفض إلزامي' };
  }

  const to = rule.to;
  const now = nowIso();

  if (to === 'rejected') {
    await env.DB.prepare(
      "UPDATE content_posts SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?",
    )
      .bind(note!.trim(), now, post.id)
      .run();
  } else {
    await env.DB.prepare(
      'UPDATE content_posts SET status = ?, reject_reason = NULL, updated_at = ? WHERE id = ?',
    )
      .bind(to, now, post.id)
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO approvals (id, post_id, from_status, to_status, actor_id, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId('appr'), post.id, post.status, to, user.id, note || null)
    .run();

  return { ok: true, to };
}
