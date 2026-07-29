// اختبارات قارئ المستخدم — الموضع الذي افترق فيه الطرفان.
//
// العيب لم يكن يُقرأ خطأً: الحارس يسمح بالمرور والقارئ يردّ «لا مستخدم»،
// فتدور اللوحة في تحميلٍ لا ينتهي. فتُثبَّت هنا ثلاثةٌ: أن الهوية تُؤخذ من
// الحارس، وأن مساراً لم يمرّ به تُسأل عنه الحزمة بلا استثناءات، وأن مفتاح
// جلسة الحزمة لا يُشتقّ هنا إطلاقاً.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticate = vi.fn();

vi.mock('naf-auth', () => ({
  // ما تستعمله `src/sso.ts` عند الاستيراد — يكفي منها شكلُها.
  createConfig: (_env: unknown, overrides: Record<string, unknown> = {}) => ({
    publicPaths: ['/auth/callback', '/denied'],
    publicPrefixes: ['/api/webhooks/'],
    reasons: { notMember: 'not_member' },
    ...overrides,
  }),
  authenticate: (...args: unknown[]) => authenticate(...args),
  handleCallback: vi.fn(),
  handleLogout: vi.fn(),
  handleBackchannelLogout: vi.fn(),
  reportAccessChange: vi.fn(),
}));

const { getUser } = await import('../src/auth');

type Row = Record<string, unknown> | null;

/** سياق Hono بقدر ما تقرؤه الدالة: `env` و `req.raw` و `get`. */
function context(sub: string | undefined, row: Row, path = '/api/posts') {
  const bound: unknown[][] = [];
  const kvReads: string[] = [];

  const env = {
    DB: {
      prepare(sql: string) {
        const stmt: any = {
          bind(...args: unknown[]) {
            bound.push([sql, ...args]);
            return stmt;
          },
          async first() {
            return row;
          },
        };
        return stmt;
      },
    },
    // لو عاد القارئ يفتح الجلسة بنفسه لظهر ذلك هنا.
    AUTH_KV: {
      async get(key: string) {
        kvReads.push(key);
        return null;
      },
    },
    AUTH_ISSUER: 'https://naf-id.pages.dev',
    PLATFORM_ID: 'naf-marketing',
  };

  const c = {
    env,
    req: { raw: new Request(`https://naf-marketing.example${path}`) },
    get: (key: string) => (key === 'sub' ? sub : undefined),
  };

  return { c: c as any, bound, kvReads };
}

describe('قارئ المستخدم', () => {
  beforeEach(() => authenticate.mockReset());

  it('يأخذ المعرّف من الحارس ولا يفتح جلسة KV', async () => {
    const row = { id: 'sub-1', name: 'فهد', role_name: 'writer', is_active: 1 };
    const { c, bound, kvReads } = context('sub-1', row);

    await expect(getUser(c)).resolves.toEqual(row);

    expect(bound[0]).toEqual([expect.stringContaining('FROM users WHERE id = ?'), 'sub-1']);
    // لا قراءة جلسة، ولا نداء ثانٍ للحزمة: الحارس تحقّق في هذا الطلب نفسه.
    expect(kvReads).toEqual([]);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('العضو الموقوف محلياً لا يُقرأ مستخدماً', async () => {
    const { c } = context('sub-1', { id: 'sub-1', role_name: 'writer', is_active: 0 });
    await expect(getUser(c)).resolves.toBeNull();
  });

  it('صفٌّ مفقود يعطي لا شيء', async () => {
    const { c } = context('sub-1', null);
    await expect(getUser(c)).resolves.toBeNull();
  });

  it('مسارٌ لم يمرّ بالحارس تُسأل عنه الحزمة بلا استثناءات', async () => {
    // إدارة الويب هوك تحت البادئة العامة، فلا سبق للحارس عليها.
    const { c, kvReads } = context(undefined, { id: 'sub-2', role_name: 'writer', is_active: 1 },
      '/api/webhooks/socialapi/manage/list');
    authenticate.mockResolvedValue({ claims: { sub: 'sub-2' } });

    await expect(getUser(c)).resolves.toMatchObject({ id: 'sub-2' });

    const config = authenticate.mock.calls[0][2] as { publicPaths: string[]; publicPrefixes: string[] };
    // بالاستثناءات كانت الحزمة تردّ «مسار عام» بلا هوية، فيُمنع صاحب الصلاحية.
    expect(config.publicPaths).toEqual([]);
    expect(config.publicPrefixes).toEqual([]);
    expect(kvReads).toEqual([]);
  });

  it('طلبٌ بلا جلسة لا يصل إلى الجدول', async () => {
    const { c, bound } = context(undefined, null, '/api/webhooks/socialapi/manage/list');
    authenticate.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    await expect(getUser(c)).resolves.toBeNull();
    expect(bound).toEqual([]);
  });
});
