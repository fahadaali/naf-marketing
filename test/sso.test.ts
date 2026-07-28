// اختبارات الترحيل الكسول — أخطر ما في الربط: يمسّ أحد عشر عموداً
// في معاملة واحدة. يُختبر على بديل بسيط لـ D1 يسجّل ما نُفّذ.

import { describe, it, expect } from 'vitest';
import {
  linkOrCreateUser,
  notifyAccessChange,
  PUBLIC_PATHS,
  PUBLIC_PREFIXES,
  USER_REFERENCES,
  DEFAULT_ROLE,
} from '../src/sso';
import { getUserFromRequest } from '../src/auth';
import type { Env } from '../src/types';

type Recorded = { sql: string; args: unknown[] };

function fakeDb(rows: Record<string, unknown> | null | ((sql: string, args: unknown[]) => unknown)) {
  const run: Recorded[] = [];
  const batched: Recorded[][] = [];

  const db = {
    prepare(sql: string) {
      const stmt: any = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          stmt.args = args;
          return stmt;
        },
        async first() {
          run.push({ sql, args: stmt.args });
          return typeof rows === 'function' ? rows(sql, stmt.args) : rows;
        },
        async run() {
          run.push({ sql, args: stmt.args });
          return { success: true };
        },
      };
      return stmt;
    },
    async batch(statements: any[]) {
      batched.push(statements.map((s) => ({ sql: s.sql, args: s.args })));
      return statements.map(() => ({ success: true }));
    },
  };

  return { db, run, batched };
}

const env = (db: unknown) => ({ DB: db } as unknown as Env);

describe('الترحيل الكسول', () => {
  it('عضو مُرحَّل سلفاً لا يُكتب له شيء', async () => {
    const { db, batched, run } = fakeDb((sql) => (sql.includes('WHERE id = ?') ? { id: 'sub-1' } : null));
    await linkOrCreateUser(env(db), { sub: 'sub-1', email: 'f@example.com' });

    expect(batched).toHaveLength(0);
    expect(run.filter((r) => r.sql.includes('INSERT'))).toHaveLength(0);
  });

  it('عضو جديد تماماً يُنشأ بكلمة مرور فارغة وبأقلّ الأدوار', async () => {
    const { db, run, batched } = fakeDb(null);
    await linkOrCreateUser(env(db), { sub: 'sub-9', email: 'New@Example.com', name: 'فهد' });

    const insert = run.find((r) => r.sql.includes('INSERT INTO users'));
    expect(insert).toBeDefined();
    // password_hash هنا NOT NULL ومستخدم الدخول الموحّد بلا كلمة مرور.
    expect(insert!.sql).toContain("''");
    expect(insert!.args).toEqual(['sub-9', 'فهد', 'new@example.com', DEFAULT_ROLE]);
    // إنشاء لا ترحيل — لا معاملة.
    expect(batched).toHaveLength(0);
  });

  it('عضو قائم يُطابَق بالبريد ويُرحَّل في معاملة واحدة', async () => {
    const { db, batched } = fakeDb((sql) =>
      sql.includes('lower(email)') ? { id: 'usr_old' } : null,
    );
    await linkOrCreateUser(env(db), { sub: 'sub-2', email: 'f@example.com' });

    expect(batched).toHaveLength(1);
    const tx = batched[0];

    // تأجيل المفاتيح أولاً: تغيير المفتاح الأساسي يترك أبناءه معلّقين لحظة.
    expect(tx[0].sql).toContain('defer_foreign_keys');
    expect(tx[1].sql).toContain('UPDATE users SET id');
    expect(tx[1].args).toEqual(['sub-2', 'usr_old']);

    // الجلسات القديمة تُطرح لا تُرحَّل.
    expect(tx.some((s) => s.sql.startsWith('DELETE FROM sessions'))).toBe(true);

    // كل عمود مرتبط حُدّث، ولا واحد نُسي.
    for (const [table, column] of USER_REFERENCES) {
      const stmt = tx.find((s) => s.sql === `UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`);
      expect(stmt, `${table}.${column} لم يُرحَّل`).toBeDefined();
      expect(stmt!.args).toEqual(['sub-2', 'usr_old']);
    }

    // مجموع العبارات: تأجيل + users + sessions + الأعمدة المرتبطة.
    expect(tx).toHaveLength(3 + USER_REFERENCES.length);
  });

  it('كل عبارات الترحيل في معاملة واحدة لا متفرّقة', async () => {
    const { db, run, batched } = fakeDb((sql) => (sql.includes('lower(email)') ? { id: 'usr_old' } : null));
    await linkOrCreateUser(env(db), { sub: 'sub-3', email: 'f@example.com' });

    // خارج المعاملة قراءتان فقط؛ ولو خرج تحديث واحد منها لبقيت القاعدة
    // نصف مُرحَّلة عند أي فشل.
    expect(run.every((r) => r.sql.startsWith('SELECT'))).toBe(true);
    expect(batched).toHaveLength(1);
  });

  it('المطابقة بالبريد لا تتأثر بحالة الأحرف', async () => {
    const { db, run } = fakeDb((sql) => (sql.includes('lower(email)') ? { id: 'usr_old' } : null));
    await linkOrCreateUser(env(db), { sub: 'sub-4', email: 'FAHAD@Example.COM' });

    const lookup = run.find((r) => r.sql.includes('lower(email)'));
    expect(lookup!.sql).toContain('lower(email) = lower(?)');
  });

  it('خريطة الأعمدة تطابق المخطّط الحيّ', () => {
    // أحد عشر عموداً — والثاني عشر (sessions.user_id) يُطرح لا يُرحَّل.
    expect(USER_REFERENCES).toHaveLength(11);
    // platform_comments لا platform_comments_new: أُعيد بناؤه في 0015.
    expect(USER_REFERENCES.map(([t]) => t)).toContain('platform_comments');
    expect(USER_REFERENCES.map(([t]) => t)).not.toContain('platform_comments_new');
    expect(USER_REFERENCES.map(([t]) => t)).not.toContain('sessions');
  });
});

// التبليغ العكسي — الموضع الثاني الذي يمسّ عقد المركز.
// المركز يطابق العضو على البريد في هذا المسار وحده، ويقبل `granted`
// و`revoked` لا غيرهما. ومعرّفٌ مكان بريد يردّه بـ`invalid_body` صامتاً،
// فتبقى بطاقة الموقوف تدعوه إلى باب لا يفتح.
describe('التبليغ العكسي', () => {
  function ssoEnv(email: string | null) {
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => (sql.includes('SELECT email') && email ? { email } : null),
        }),
      }),
    };
    return {
      DB: db,
      AUTH_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
      AUTH_ISSUER: 'https://naf-id.pages.dev',
      PLATFORM_ID: 'naf-marketing',
      AUTH_CLIENT_SECRET: 'shhh',
      MEMBERS_TABLE: 'users',
      MEMBERS_ID_COLUMN: 'id',
      MEMBERS_NAME_COLUMN: 'name',
      MEMBERS_ROLE_COLUMN: 'role_name',
      MEMBERS_PERMS_COLUMN: '-',
      MEMBERS_TIME_FORMAT: 'iso',
      DEFAULT_ROLE: 'writer',
    } as unknown as Env;
  }

  function captureFetch() {
    const calls: Array<{ url: string; body: any }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any = {}) => {
      calls.push({
        url: typeof input === 'string' ? input : input.url,
        body: init.body ? JSON.parse(init.body) : null,
      });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    return { calls, restore: () => { globalThis.fetch = original; } };
  }

  it('يرسل البريد وحالة المركز إلى المسار الداخلي', async () => {
    const net = captureFetch();
    try {
      await notifyAccessChange(ssoEnv('Fahad@Example.com'), 'sub-1', false);

      expect(net.calls).toHaveLength(1);
      expect(net.calls[0].url).toBe('https://naf-id.pages.dev/api/internal/access');
      expect(net.calls[0].body).toMatchObject({
        platformId: 'naf-marketing',
        secret: 'shhh',
        email: 'Fahad@Example.com',
        state: 'revoked',
      });
      // لا معرّف ولا `active` — كلاهما يردّه المركز.
      expect(net.calls[0].body.userId).toBeUndefined();
      expect(net.calls[0].body.status).toBeUndefined();
    } finally {
      net.restore();
    }
  });

  it('إعادة التفعيل ترسل granted لا active', async () => {
    const net = captureFetch();
    try {
      await notifyAccessChange(ssoEnv('f@example.com'), 'sub-1', true);
      expect(net.calls[0].body.state).toBe('granted');
    } finally {
      net.restore();
    }
  });

  it('عضو بلا بريد لا يُبلَّغ عنه، ولا يرمي', async () => {
    const net = captureFetch();
    try {
      await expect(notifyAccessChange(ssoEnv(null), 'sub-1', false)).resolves.toBeUndefined();
      expect(net.calls).toHaveLength(0);
    } finally {
      net.restore();
    }
  });

  it('تعذّر الوصول إلى المركز لا يردّ العملية على المسؤول', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch;
    try {
      await expect(notifyAccessChange(ssoEnv('f@example.com'), 'sub-1', false)).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});

// الحارس: ما يُعرض لزائرٍ لم يبادل رمزاً، وما لا يُعرض.
// الإذن بالمسار العام وحده لا يكفي — صفحةٌ عامة بأصول محميّة تُخدَم مكسورة.
describe('قائمة الحارس', () => {
  const isPublic = (path: string) =>
    PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));

  it('كل ما تطلبه صفحة المقال العامة مسموح', () => {
    for (const path of [
      '/articles/some-slug',
      '/naf-public.css',
      '/brand/naf-mark.svg',
      '/fonts/arabic-400.css',
      '/fonts/files/arabic-400.woff2',
    ]) {
      expect(isPublic(path), `${path} تطلبه صفحة عامة`).toBe(true);
    }
  });

  it('ما عدا المُعلَن محميّ — ولا استثناء لمسار إدارة', () => {
    for (const path of ['/', '/api/posts', '/api/users', '/api/settings', '/api/auth/login', '/api/audit']) {
      expect(isPublic(path), `${path} يجب أن يكون محمياً`).toBe(false);
    }
  });
});

// الباب الثاني، بعد إزالته.
// كان `getUserFromRequest` يقبل كوكي `naf_session` وجدول `sessions` من نظام
// الدخول المحلي. وبقاؤه كان يعني حارساً واحداً وبابين: الثاني لا يعرفه
// المركز، ولا يسري عليه إيقافُه، ولا ينتهي بانتهاء رمزه.
describe('لا مصدر ثانٍ للمستخدم', () => {
  function env(session: Record<string, unknown> | null) {
    const asked: string[] = [];
    const e = {
      DB: {
        prepare(sql: string) {
          asked.push(sql);
          return { bind: () => ({ first: async () => ({ id: 'sub-1', name: 'فهد', is_active: 1 }) }) };
        },
      },
      AUTH_KV: {
        get: async () => session,
        put: async () => {},
        delete: async () => {},
      },
      AUTH_ISSUER: 'https://naf-id.pages.dev',
      PLATFORM_ID: 'naf-marketing',
      MEMBERS_TABLE: 'users',
      MEMBERS_ID_COLUMN: 'id',
      MEMBERS_ROLE_COLUMN: 'role_name',
      MEMBERS_PERMS_COLUMN: '-',
    } as unknown as Env;
    return { env: e, asked };
  }

  const req = (cookie: string) =>
    new Request('https://platform.example/api/posts', { headers: { cookie } });

  it('كوكي الجلسة المحلية القديمة لا يعرّف أحداً', async () => {
    const { env: e, asked } = env(null);
    expect(await getUserFromRequest(e, req('naf_session=old-token'))).toBeNull();
    // ولا يُستعلَم عن جدول الجلسات أصلاً.
    expect(asked.some((s) => s.includes('sessions'))).toBe(false);
  });

  it('جلسة المركز وحدها هي ما يعرّف المستخدم', async () => {
    const { env: e } = env({ sub: 'sub-1' });
    const user = await getUserFromRequest(e, req('naf_sid=s1'));
    expect(user?.id).toBe('sub-1');
  });

  it('بلا كوكي المركز لا مستخدم، ولو حمل الطلب كوكيات أخرى', async () => {
    const { env: e } = env({ sub: 'sub-1' });
    expect(await getUserFromRequest(e, req('theme=dark; naf_session=old'))).toBeNull();
  });
});
