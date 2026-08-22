// آلة حالات الاعتماد — التسلسل الإلزامي وفصلُ الكاتب عن المعتمِد.
//
// الفصل أُضيف بعد تدقيق: `post.author_id` كان يُمرَّر عبر ثلاث طبقات
// ولا يُقرأ، فمدير التسويق يعتمد ما كتبه بنفسه والمراجعةُ توقيعٌ على
// الذات. والمدير العام مستثنى بحكم موقعه — لا معتمِد فوقه.

import { describe, it, expect } from 'vitest';
import { transition } from '../src/services/workflow';
import type { Env, Role, User } from '../src/types';

/** قاعدة بديلة في الذاكرة: تكفي لأن الدالة تقرأ صلاحيةً وتكتب صفّين. */
function fakeEnv(perms: Record<string, boolean>): { env: Env; writes: string[] } {
  const writes: string[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const stmt = {
          _binds: [] as unknown[],
          bind(...b: unknown[]) { stmt._binds = b; return stmt; },
          async first<T>() {
            if (sql.includes('roles_permissions')) {
              const [, key] = stmt._binds as [string, string];
              return (perms[key] ? { allowed: 1 } : null) as T;
            }
            return null as T;
          },
          async run() { writes.push(sql.trim().split('\n')[0]); return { meta: { changes: 1 } }; },
          async all() { return { results: [] }; },
        };
        return stmt;
      },
    },
  } as unknown as Env;
  return { env, writes };
}

const user = (id: string, role: Role): User => ({
  id, name: 'عضو', email: `${id}@naflaw.sa`, role_name: role, is_active: 1, created_at: '',
});

const post = (author: string, status: string) => ({ id: 'p1', status, author_id: author });

const ALL = {
  'content.submit': true, 'content.review': true, 'content.approve_final': true,
};

describe('التسلسل الإلزامي', () => {
  it('لا يتجاوز مرحلة — الاعتماد على مسودة مرفوض', async () => {
    const { env } = fakeEnv(ALL);
    const r = await transition(env, user('u1', 'marketing_manager'), post('u2', 'draft'), 'approve');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it('يمنع من لا يملك الصلاحية', async () => {
    const { env } = fakeEnv({ 'content.review': false });
    const r = await transition(env, user('u1', 'writer'), post('u2', 'pending_marketing'), 'approve');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('سبب الرفض إلزامي', async () => {
    const { env } = fakeEnv(ALL);
    const r = await transition(env, user('u1', 'marketing_manager'), post('u2', 'pending_marketing'), 'reject', '  ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe('لا يعتمد المحتوى كاتبُه', () => {
  it('مدير التسويق لا يعتمد ما كتبه', async () => {
    const { env, writes } = fakeEnv(ALL);
    const r = await transition(env, user('u1', 'marketing_manager'), post('u1', 'pending_marketing'), 'approve');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toContain('كاتبُه');
    }
    expect(writes, 'لا يُكتب شيء عند الردّ').toEqual([]);
  });

  it('ويعتمد ما كتبه غيرُه', async () => {
    const { env } = fakeEnv(ALL);
    const r = await transition(env, user('u1', 'marketing_manager'), post('u2', 'pending_marketing'), 'approve');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe('pending_gm');
  });

  it('المدير العام مستثنى — لا معتمِد فوقه', async () => {
    const { env } = fakeEnv(ALL);
    const r = await transition(env, user('u1', 'general_manager'), post('u1', 'pending_gm'), 'approve');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe('approved');
  });

  it('والرفض على عمل النفس مسموح — سحبٌ لا مراجعة', async () => {
    const { env } = fakeEnv(ALL);
    const r = await transition(env, user('u1', 'marketing_manager'), post('u1', 'pending_marketing'), 'reject', 'أعيد صياغته');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe('rejected');
  });

  it('والأرشفة كذلك', async () => {
    const { env } = fakeEnv(ALL);
    const r = await transition(env, user('u1', 'general_manager'), post('u1', 'published'), 'archive');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe('archived');
  });
});
