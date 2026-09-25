// مزامنة صندوق التعليقات على قاعدةٍ حقيقية بالمخطّط الفعلي، ومزوّدٍ مخنوق.
//
// ما يُثبَّت هنا هو ما غاب فغابت معه التعليقات: الصفحات تُتبع إلى آخرها،
// والدورة تقف عند ميزانيتها ولا تسقط، والردّ المكتوب من تطبيق المنصّة يُعرف
// فينقل التعليق إلى «تم الرد» — وما لم يُكتب منّا لا يُنسب إلينا.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { syncComments, readInboxReport, postPriority } from '../src/services/commentsSync';
import { mapComment, isOwnAuthor, nextCursor, diagnoseInbox } from '../src/adapters/socialapi';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    sql,
    binds,
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...binds);
      return { meta: { changes: r.changes } };
    },
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: any[]) => stmts.map((s) => {
      const r = db.prepare(s.sql).run(...s.binds);
      return { meta: { changes: r.changes } };
    }),
  };
}

function build(): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider_name', 'socialapi')").run();
  return db;
}

/* ─── مزوّدٌ مخنوق ─── */

type Handler = (url: URL, method: string) => { status?: number; body: unknown } | undefined;
let handlers: Handler[] = [];
let calls: string[] = [];

/** يُسجّل مساراً مخنوقاً — والأحدث تسجيلاً يسبق، فيعلو ما يعرّفه الاختبار على الافتراضي. */
function route(method: string, path: string | RegExp, respond: (url: URL) => { status?: number; body: unknown }): void {
  handlers.unshift((url, m) => {
    if (m !== method) return undefined;
    const p = url.pathname.replace(/^\/v1/, '');
    const ok = typeof path === 'string' ? p === path : path.test(p);
    return ok ? respond(url) : undefined;
  });
}

function install(): void {
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method || 'GET').toUpperCase();
    calls.push(`${method} ${url.pathname.replace(/^\/v1/, '')}${url.search}`);
    for (const h of handlers) {
      const r = h(url, method);
      if (r) {
        const status = r.status ?? 200;
        return { ok: status < 400, status, text: async () => JSON.stringify(r.body) } as unknown as Response;
      }
    }
    return { ok: false, status: 404, text: async () => '{"error":"not found"}' } as unknown as Response;
  });
}

const ACCOUNT = { id: 'acc_ig', platform: 'instagram', name: 'NAF Law', username: 'naf.law' };

function comment(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `sapi_cmt_${i}`,
    platform_id: `c${i}`,
    platform: 'instagram',
    author: { id: `u${i}`, name: `عميل ${i}` },
    text: `سؤال رقم ${i}؟`,
    created_at: `2026-09-${String(1 + (i % 20)).padStart(2, '0')}T10:00:00Z`,
    ...extra,
  };
}

let db: any;
let env: any;

function rows(where = '1=1'): any[] {
  return db.prepare(`SELECT * FROM platform_comments WHERE ${where} ORDER BY provider_comment_id`).all();
}

beforeEach(() => {
  db = build();
  env = { DB: d1(db), SOCIALAPI_API_KEY: 'sapi_key_test' };
  handlers = [];
  calls = [];
  install();
  route('GET', '/accounts', () => ({ body: { data: [ACCOUNT] } }));
  // لا مراجعات ولا محادثات ولا إشارات ما لم يُعرّفها الاختبار
  route('GET', '/inbox/reviews', () => ({ status: 501, body: { error: 'not supported' } }));
  route('GET', '/inbox/conversations', () => ({ body: { data: [] } }));
  route('GET', /^\/accounts\/[^/]+\/mentions$/, () => ({ body: { data: [] } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('التعليقات تُقرأ صفحاتٍ إلى آخرها', () => {
  it('يقرأ أحدث التعليقات على منشورٍ تجاوز الصفحة الأولى', async () => {
    const all = Array.from({ length: 130 }, (_, i) => comment(i + 1));
    route('GET', '/inbox/comments', () => ({ body: { data: [{ id: 'post1', account_id: 'acc_ig', platform: 'instagram', comment_count: 130 }] } }));
    route('GET', '/inbox/comments/post1', (url) => {
      const cursor = url.searchParams.get('cursor');
      return cursor === 'p2'
        ? { body: { data: all.slice(100), next_cursor: null } }
        : { body: { data: all.slice(0, 100), next_cursor: 'p2' } };
    });

    const report = await syncComments(env, { budget: 40 });
    expect(report?.ok).toBe(true);
    expect(rows()).toHaveLength(130);
    // الأحدث — في الصفحة الثانية — موجود
    expect(rows("provider_comment_id = 'post1|acc_ig|c130'")).toHaveLength(1);
    expect(report?.added).toBe(130);
  });

  it('لا يعدّ الثابت جديداً، ولا يعيد جلب منشورٍ لم تتغيّر بصمتُه', async () => {
    route('GET', '/inbox/comments', () => ({ body: { data: [{ id: 'post1', account_id: 'acc_ig', platform: 'instagram', comment_count: 2 }] } }));
    route('GET', '/inbox/comments/post1', () => ({ body: { data: [comment(1, { reply_count: 0 }), comment(2, { reply_count: 0 })] } }));

    const first = await syncComments(env, { budget: 40 });
    expect(first?.added).toBe(2);

    calls = [];
    const second = await syncComments(env, { budget: 40 });
    expect(second?.added).toBe(0);
    expect(calls.some((c) => c.startsWith('GET /inbox/comments/post1'))).toBe(false);
  });
});

describe('الردّ من خارج المنصة', () => {
  beforeEach(() => {
    route('GET', '/inbox/comments', () => ({ body: { data: [{ id: 'post1', account_id: 'acc_ig', platform: 'instagram', comment_count: 3 }] } }));
  });

  it('ينقل التعليق إلى «تم الرد» حين يجد ردّاً كتبه حسابُنا', async () => {
    route('GET', '/inbox/comments/post1', () => ({ body: { data: [comment(1, { reply_count: 1 })] } }));
    route('GET', '/inbox/comments/post1/c1/replies', () => ({
      body: { data: [{ id: 'sapi_cmt_r1', platform_id: 'r1', author: { id: 'x', name: 'naf.law' }, text: 'أهلاً، تواصل معنا', created_at: '2026-09-02T12:30:00Z' }] },
    }));

    const report = await syncComments(env, { budget: 40 });
    const [row] = rows();
    expect(row.reply_body).toBe('أهلاً، تواصل معنا');
    expect(row.reply_source).toBe('external');
    expect(row.replied_at).toBe('2026-09-02T12:30:00.000Z');
    expect(row.replied_by).toBeNull();
    expect(report?.externalReplies).toBe(1);
  });

  it('لا ينسب إلينا ردَّ غيرنا — يبقى التعليق «بلا رد»', async () => {
    route('GET', '/inbox/comments/post1', () => ({ body: { data: [comment(1, { reply_count: 1 })] } }));
    route('GET', '/inbox/comments/post1/c1/replies', () => ({
      body: { data: [{ id: 'r1', author: { id: 'u99', name: 'عميل آخر' }, text: 'وأنا كذلك', created_at: '2026-09-02T12:30:00Z' }] },
    }));

    await syncComments(env, { budget: 40 });
    const [row] = rows();
    expect(row.reply_body).toBeNull();
    expect(row.reply_checked_at).not.toBeNull();
  });

  it('يقرأ الردّ المضمّن في التعليق بلا نداءٍ ثانٍ', async () => {
    route('GET', '/inbox/comments/post1', () => ({
      body: { data: [comment(1, { replies: [{ id: 'r1', author: { username: '@NAF.law' }, text: 'تم', created_at: '2026-09-02T13:00:00Z' }] })] },
    }));

    await syncComments(env, { budget: 40 });
    expect(rows()[0].reply_body).toBe('تم');
    expect(calls.some((c) => c.includes('/replies'))).toBe(false);
  });

  it('يعدّ تعليقَنا المرتبط بتعليقٍ ردّاً عليه، ولا يُدرجه عنصراً', async () => {
    route('GET', '/inbox/comments/post1', () => ({
      body: {
        data: [
          comment(1, { reply_count: 0 }),
          { id: 'sapi_cmt_9', platform_id: 'c9', parent_id: 'c1', author: { name: 'NAF Law' }, text: 'نرحب بتواصلك', created_at: '2026-09-02T14:00:00Z' },
        ],
      },
    }));

    await syncComments(env, { budget: 40 });
    const all = rows();
    expect(all).toHaveLength(1);
    expect(all[0].reply_body).toBe('نرحب بتواصلك');
    expect(all[0].reply_source).toBe('external');
  });

  it('يُخرج من الصندوق تعليقاً لنا دخله قبلُ عنصراً ينتظر ردّاً', async () => {
    db.prepare(
      `INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at)
       VALUES ('cm_old', 'instagram', 'post1|acc_ig|c50', 'comment', 'naf.law', 'رابط الموقع في التعليق الأول', '2026-09-01T09:00:00Z')`,
    ).run();
    route('GET', '/inbox/comments/post1', () => ({
      body: { data: [{ id: 'sapi_cmt_50', platform_id: 'c50', author: { name: 'naf.law' }, text: 'رابط الموقع في التعليق الأول', created_at: '2026-09-01T09:00:00Z' }] },
    }));

    await syncComments(env, { budget: 40 });
    expect(rows()).toHaveLength(0);
  });

  it('يجرّب المسار الآخر للردود إن لم يُجب الأول، ويتذكّر ما أجاب', async () => {
    route('GET', '/inbox/comments/post1', () => ({ body: { data: [comment(1, { reply_count: 1 })] } }));
    route('GET', '/accounts/acc_ig/interactions/sapi_cmt_1/replies', () => ({
      body: { data: [{ id: 'r1', author: { name: 'naf.law' }, text: 'تفضّل', created_at: '2026-09-03T08:00:00Z' }] },
    }));

    const report = await syncComments(env, { budget: 40 });
    expect(rows()[0].reply_body).toBe('تفضّل');
    expect(report?.repliesPath).toBe('interactions');
    expect((await readInboxReport(env))?.repliesPath).toBe('interactions');
  });
});

describe('الميزانية', () => {
  it('تقف الدورة عند حدّها واقفةً لا ساقطة، وتُكمل التالية ما بقي', async () => {
    const posts = Array.from({ length: 12 }, (_, i) => ({ id: `post${i}`, account_id: 'acc_ig', platform: 'instagram', comment_count: 1 }));
    route('GET', '/inbox/comments', () => ({ body: { data: posts } }));
    route('GET', /^\/inbox\/comments\/post\d+$/, (url) => {
      const id = url.pathname.split('/').pop() as string;
      return { body: { data: [{ ...comment(1, { reply_count: 0 }), platform_id: `${id}-c` }] } };
    });

    const first = await syncComments(env, { budget: 12 });
    expect(first?.ok).toBe(true);
    expect(first?.complete).toBe(false);
    expect(first?.calls).toBeLessThanOrEqual(12);
    const afterFirst = rows().length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterFirst).toBeLessThan(12);

    // دورات أخرى بالحصّة نفسها حتى يكتمل الصندوق
    for (let i = 0; i < 6 && rows().length < 12; i++) await syncComments(env, { budget: 12 });
    expect(rows()).toHaveLength(12);
  });

  it('يقول ما تعذّر ولا يُسقط ما قُرئ', async () => {
    route('GET', '/inbox/comments', () => ({ status: 500, body: { error: 'upstream' } }));
    route('GET', '/inbox/reviews', () => ({ body: { data: [{ id: 'sapi_rev_1', account_id: 'acc_g', platform: 'google', rating: 5, text: 'خدمة ممتازة' }] } }));

    const report = await syncComments(env, { budget: 40 });
    expect(report?.ok).toBe(false);
    expect(report?.kinds.comment.ok).toBe(false);
    expect(report?.kinds.comment.error).toContain('500');
    expect(report?.kinds.review.ok).toBe(true);
    expect(rows("kind = 'review'")).toHaveLength(1);
  });
});

describe('المراجعات', () => {
  it('ينقل المراجعة المردود عليها في الملف التجاري إلى «تم الرد» بوقتها', async () => {
    route('GET', '/inbox/comments', () => ({ body: { data: [] } }));
    route('GET', '/inbox/reviews', () => ({
      body: {
        data: [
          { id: 'sapi_rev_1', account_id: 'acc_g', platform: 'google', rating: 2, text: 'تأخروا في الرد', created_at: '2026-09-05T08:00:00Z',
            reply: { text: 'نعتذر ونتواصل معك', created_at: '2026-09-05T10:00:00Z' } },
          { id: 'sapi_rev_2', account_id: 'acc_g', platform: 'google', rating: 5, text: 'ممتاز', created_at: '2026-09-06T08:00:00Z' },
        ],
      },
    }));

    await syncComments(env, { budget: 40 });
    const replied = rows("provider_comment_id = 'rv:acc_g:sapi_rev_1'")[0];
    expect(replied.reply_source).toBe('external');
    expect(replied.replied_at).toBe('2026-09-05T10:00:00.000Z');
    expect(rows("provider_comment_id = 'rv:acc_g:sapi_rev_2'")[0].reply_body).toBeNull();
  });

  it('يقرأ الشكل الأقدم: ملخّصٌ لكل حساب ثم مراجعاته', async () => {
    route('GET', '/inbox/comments', () => ({ body: { data: [] } }));
    route('GET', '/inbox/reviews', () => ({ body: { data: [{ account_id: 'acc_g', platform: 'google', total: 1, average: 4 }] } }));
    route('GET', '/inbox/reviews/acc_g', () => ({ body: { data: [{ id: 'r9', rating: 4, text: 'جيد جداً' }] } }));

    await syncComments(env, { budget: 40 });
    expect(rows("provider_comment_id = 'rv:acc_g:r9'")).toHaveLength(1);
  });
});

describe('الرسائل الخاصة', () => {
  beforeEach(() => {
    route('GET', '/inbox/comments', () => ({ body: { data: [] } }));
  });

  it('يعدّ المحادثة مردوداً عليها حين تكون آخر رسالةٍ منّا', async () => {
    db.prepare(
      `INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at)
       VALUES ('cm_dm', 'instagram', 'dm:cv1:acc_ig', 'dm', 'سارة', 'أحتاج استشارة', '2026-09-07T08:00:00Z')`,
    ).run();
    route('GET', '/inbox/conversations', () => ({
      body: { data: [{ id: 'cv1', account_id: 'acc_ig', platform: 'instagram', participant_name: 'سارة',
        last_message: { text: 'أرسلنا لك الرابط', direction: 'outgoing', created_at: '2026-09-07T09:00:00Z' } }] },
    }));

    await syncComments(env, { budget: 40 });
    const [row] = rows();
    expect(row.body).toBe('أحتاج استشارة');
    expect(row.reply_body).toBe('أرسلنا لك الرابط');
    expect(row.reply_source).toBe('external');
  });

  it('يعيد المحادثة إلى «بلا رد» حين يكتب العميل بعد آخر ردّ', async () => {
    db.prepare(
      `INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at, reply_body, replied_at, reply_source)
       VALUES ('cm_dm', 'instagram', 'dm:cv1:acc_ig', 'dm', 'سارة', 'أحتاج استشارة', '2026-09-07T08:00:00Z', 'تفضّلي', '2026-09-07T09:00:00Z', 'platform')`,
    ).run();
    route('GET', '/inbox/conversations', () => ({
      body: { data: [{ id: 'cv1', account_id: 'acc_ig', platform: 'instagram', participant_name: 'سارة',
        last_message: { text: 'وكم التكلفة؟', direction: 'incoming', created_at: '2026-09-08T10:00:00Z' } }] },
    }));

    await syncComments(env, { budget: 40 });
    const [row] = rows();
    expect(row.body).toBe('وكم التكلفة؟');
    expect(row.reply_body).toBeNull();
    expect(row.created_at).toBe('2026-09-08T10:00:00.000Z');
  });
});

describe('الرسائل الخاصة بلا وقت', () => {
  it('لا يعيد فتح محادثةٍ مردودٍ عليها لأن آخر رسالتها بلا وقت', async () => {
    route('GET', '/inbox/comments', () => ({ body: { data: [] } }));
    db.prepare(
      `INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at, reply_body, replied_at, reply_source)
       VALUES ('cm_dm', 'instagram', 'dm:cv1:acc_ig', 'dm', 'سارة', 'أحتاج استشارة', '2026-09-07T08:00:00Z', 'تفضّلي', '2026-09-07T09:00:00Z', 'platform')`,
    ).run();
    route('GET', '/inbox/conversations', () => ({
      body: { data: [{ id: 'cv1', account_id: 'acc_ig', platform: 'instagram', participant_name: 'سارة',
        last_message: { text: 'شكراً', direction: 'incoming' } }] },
    }));

    // مرّتان: وقتٌ مخترع («الآن») كان سيجعل الرسالة أحدث من الردّ في كل دورة
    await syncComments(env, { budget: 40 });
    await syncComments(env, { budget: 40 });
    expect(rows()[0].reply_body).toBe('تفضّلي');
  });
});

describe('الإشارات', () => {
  it('تُقرأ من مسار الحساب، ويُرجع إلى المسار الأقدم إن لم يُجب', async () => {
    route('GET', '/inbox/comments', () => ({ body: { data: [] } }));
    handlers = handlers.filter((h) => !h(new URL('https://api.social-api.ai/v1/accounts/acc_ig/mentions'), 'GET'));
    route('GET', '/inbox/mentions', () => ({ body: { data: [{ id: 'm1', author: { name: 'مكتب آخر' }, text: 'شكراً @naf.law', created_at: '2026-09-09T08:00:00Z' }] } }));

    const report = await syncComments(env, { budget: 40 });
    expect(rows("kind = 'mention'")).toHaveLength(1);
    expect(report?.mentionsPath).toBe('inbox');
  });
});

describe('أدواتٌ صغيرة', () => {
  it('يقرأ مؤشّر الصفحة بشكليه', () => {
    expect(nextCursor({ next_cursor: 'a' })).toBe('a');
    expect(nextCursor({ pagination: { next_cursor: 'b' } })).toBe('b');
    expect(nextCursor({ data: [] })).toBeNull();
  });

  it('يقدّم المنشور الجديد ثم المتغيّر، ويتخطّى الثابت في الدورة التزايدية', () => {
    const now = Date.parse('2026-09-10T12:00:00Z');
    const post = { postId: 'p', accountId: 'a', platform: 'instagram', signature: '3|' };
    const st = { inbox_post_id: 'p', account_id: 'a', signature: '3|', synced_at: '2026-09-10T11:50:00Z', tail_cursor: null, needs_more: 0 };
    expect(postPriority(post, null, false, 'incremental', now)).toBe(0);
    expect(postPriority({ ...post, signature: '4|' }, st, false, 'incremental', now)).toBe(2);
    expect(postPriority(post, st, false, 'incremental', now)).toBeNull();
    expect(postPriority(post, st, false, 'full', now)).toBe(5);
  });

  it('لا يعدّ الاسم القصير دليلاً على أن الكاتب نحن', () => {
    expect(isOwnAuthor({ author: { name: 'ن' } }, new Set(['ن']))).toBe(false);
    expect(isOwnAuthor({ author: { name: 'NAF.law' } }, new Set(['naf.law']))).toBe(true);
    expect(isOwnAuthor({ is_owner: true }, new Set())).toBe(true);
  });

  it('يحفظ ترتيب أسبقية معرّف التعليق القديم كي لا يتكرّر سجلّ', () => {
    expect(mapComment({ id: 'sapi_cmt_1', platform_id: 'c1' }).commentId).toBe('c1');
    expect(mapComment({ id: 'sapi_cmt_1' }).commentId).toBe('sapi_cmt_1');
    expect(mapComment({ content: { text: 'نص' } }).body).toBe('نص');
  });
});

describe('الخطة المدفوعة واحتياطها', () => {
  it('يقف حين يطلب المزوّد التمهّل — ولا يُلحّ، ولا يعدّه عطلاً', async () => {
    route('GET', '/inbox/comments', () => ({
      body: { data: [1, 2, 3].map((i) => ({ id: `post${i}`, account_id: 'acc_ig', platform: 'instagram', comment_count: 1 })) },
    }));
    route('GET', '/inbox/comments/post1', () => ({ body: { data: [comment(1)] } }));
    route('GET', /^\/inbox\/comments\/post[23]$/, () => ({ status: 429, body: { error: 'rate limited' } }));

    const report = await syncComments(env, { budget: 40 });
    expect(report?.ok).toBe(true);
    expect(report?.complete).toBe(false);
    expect(report?.stoppedBy).toBe('rate_limit');
    // ما قُرئ قبل الطلب محفوظ، ولا نداء بعد الـ٤٢٩
    expect(rows()).toHaveLength(1);
    const after = calls.findIndex((c) => /post[23]/.test(c));
    expect(calls.slice(after + 1)).toEqual([]);
  });

  it('ينزل إلى حصص المجانية بعد دورةٍ مجدولة سقطت، ويقول ذلك في التقرير', async () => {
    route('GET', '/inbox/comments', () => ({ body: { data: [] } }));
    env.WORKERS_PLAN = 'paid';
    // دورةٌ مجدولة بدأت قبل عشرين دقيقة ولم تتمّ
    db.prepare("INSERT INTO settings (key, value) VALUES ('run_open:inbox', ?)").run(new Date(Date.now() - 20 * 60_000).toISOString());

    const report = await syncComments(env, {});
    expect(report?.plan).toBe('paid');
    expect(report?.fallback).toBe(true);
    expect(report?.budget).toBe(40);
    // والدورة تمّت فمحت علامتها — والتالية ما زالت في يوم الاحتياط
    expect((db.prepare("SELECT value FROM settings WHERE key = 'run_open:inbox'").get() as { value: string }).value).toBe('');
    expect((await syncComments(env, {}))?.fallback).toBe(true);
  });

  it('لا يقرأ خطّافاً تقاطع مع دورةٍ مجدولة سقوطاً', async () => {
    route('GET', '/inbox/comments', () => ({ body: { data: [] } }));
    env.WORKERS_PLAN = 'paid';
    const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    /* ما كان يُنزل الحصص يوماً بلا سبب: خطّافٌ بدأ بعد دورةٍ مجدولة وانتهى
       قبلها — فالقفل أحدث من التقرير. ولا يُرصد به شيءٌ الآن. */
    db.prepare("INSERT INTO settings (key, value) VALUES ('inbox_sync_report', ?)").run(JSON.stringify({ at: at(40), lastOkAt: at(40) }));
    db.prepare("INSERT INTO settings (key, value) VALUES ('inbox_sync_lock', ?)").run(at(38));
    await syncComments(env, { trigger: 'webhook', skipIfRunningWithinMs: 45_000 });

    const report = await syncComments(env, {});
    expect(report?.fallback).toBe(false);
    expect(report?.budget).toBe(150);
  });

  it('يأخذ حصّة المدفوعة حين لا سقوط', async () => {
    route('GET', '/inbox/comments', () => ({ body: { data: [] } }));
    env.WORKERS_PLAN = 'paid';
    const report = await syncComments(env, {});
    expect(report?.budget).toBe(150);
    expect(report?.fallback).toBe(false);
  });
});

describe('سجلّ الصندوق القديم', () => {
  const setting = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

  it('يمضي في قائمة المنشورات إلى أقدمها ويقرأ ما لم يُقرأ قطّ، ثم يستريح', async () => {
    // خمس صفحات بمنشورٍ في كلٍّ، وسحب السجلّ يقرأ ثلاثاً في كل مرّة
    route('GET', '/inbox/comments', (url) => {
      const n = Number(url.searchParams.get('cursor') || 1);
      return { body: { data: [{ id: `post${n}`, account_id: 'acc_ig', platform: 'instagram', comment_count: 1 }], next_cursor: n < 5 ? String(n + 1) : null } };
    });
    route('GET', /^\/inbox\/comments\/post\d$/, (url) => ({ body: { data: [comment(Number(url.pathname.slice(-1)))] } }));

    await syncComments(env, { mode: 'history', budget: 40 });
    expect(rows()).toHaveLength(3);
    expect(setting('inbox_history_cursor')).toBe('4');

    await syncComments(env, { mode: 'history', budget: 40 });
    expect(rows()).toHaveLength(5);
    expect(setting('inbox_history_done_at')).toBeTruthy();

    calls.length = 0;
    await syncComments(env, { mode: 'history', budget: 40 });
    expect(calls.some((c) => c.startsWith('GET /inbox/comments?'))).toBe(false);
  });

  it('لا يتقدّم مؤشّره قبل أن تُقرأ تعليقات منشورات صفحته كلُّها', async () => {
    route('GET', '/inbox/comments', (url) => {
      const n = Number(url.searchParams.get('cursor') || 1);
      return { body: { data: [{ id: `post${n}`, account_id: 'acc_ig', platform: 'instagram', comment_count: 7 }], next_cursor: n < 4 ? String(n + 1) : null } };
    });
    // المنشور الأول سبع صفحات من التعليقات — وسحب السجلّ يقرأ خمساً للمنشور في المرّة
    route('GET', '/inbox/comments/post1', (url) => {
      const n = Number(url.searchParams.get('cursor') || 1);
      return { body: { data: [comment(n)], next_cursor: n < 7 ? String(n + 1) : null } };
    });
    route('GET', /^\/inbox\/comments\/post[234]$/, () => ({ body: { data: [] } }));

    await syncComments(env, { mode: 'history', budget: 40 });
    expect(setting('inbox_history_cursor') ?? '').toBe('');
    expect(rows()).toHaveLength(5);

    await syncComments(env, { mode: 'history', budget: 40 });
    expect(rows()).toHaveLength(7);
    // اكتمل المنشور الأول فتقدّم المؤشّر إلى ما بعد الصفحات الثلاث
    expect(setting('inbox_history_cursor')).toBe('4');
  });

  it('يعرف ردَّنا على تعليقٍ قديم لم يُفتح منشوره منذ شهور — بالمعرّف المحفوظ', async () => {
    db.prepare(
      `INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at, provider_interaction_id)
       VALUES ('cm_old', 'instagram', 'postOld|acc_ig|c77', 'comment', 'عميل', 'سؤال قديم', ?, 'sapi_cmt_77')`,
    ).run(daysAgo(120));
    // القائمة مقروءةٌ إلى آخرها — لا يبقى إلا الدوران على القديم
    db.prepare("INSERT INTO settings (key, value) VALUES ('inbox_history_done_at', ?)").run(daysAgo(1));
    route('GET', '/accounts/acc_ig/interactions/sapi_cmt_77/replies', () => ({
      body: { data: [{ id: 'r77', author: { name: 'naf.law' }, text: 'أجبناك في الخاص', created_at: daysAgo(119) }] },
    }));

    const report = await syncComments(env, { mode: 'history', budget: 40 });
    const [row] = rows();
    expect(row.reply_body).toBe('أجبناك في الخاص');
    expect(row.reply_source).toBe('external');
    expect(report?.externalReplies).toBe(1);
  });

  it('يفحص التعليق القديم بلا رد مرّةً في الأسبوع لا في كل سحب', async () => {
    db.prepare(
      `INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at)
       VALUES ('cm_old', 'instagram', 'postOld|acc_ig|c78', 'comment', 'عميل', 'سؤال قديم', ?)`,
    ).run(daysAgo(90));
    db.prepare("INSERT INTO settings (key, value) VALUES ('inbox_history_done_at', ?)").run(daysAgo(1));
    route('GET', '/inbox/comments/postOld/c78/replies', () => ({ body: { data: [] } }));

    await syncComments(env, { mode: 'history', budget: 40 });
    expect(rows()[0].reply_checked_at).not.toBeNull();
    expect(rows()[0].reply_body).toBeNull();

    calls.length = 0;
    await syncComments(env, { mode: 'history', budget: 40 });
    expect(calls.some((c) => c.includes('/replies'))).toBe(false);
  });

  it('يحفظ معرّف المزوّد مع التعليق، ويستكمله لصفٍّ كُتب قبل أن يُحفظ', async () => {
    db.prepare(
      `INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at)
       VALUES ('cm_prev', 'instagram', 'post1|acc_ig|c2', 'comment', 'عميل 2', 'سؤال رقم 2؟', '2026-09-03T10:00:00Z')`,
    ).run();
    route('GET', '/inbox/comments', () => ({ body: { data: [{ id: 'post1', account_id: 'acc_ig', platform: 'instagram', comment_count: 2 }] } }));
    route('GET', '/inbox/comments/post1', () => ({ body: { data: [comment(1), comment(2)] } }));

    await syncComments(env, { budget: 40 });
    const byKey = Object.fromEntries(rows().map((r) => [r.provider_comment_id, r.provider_interaction_id]));
    expect(byKey['post1|acc_ig|c1']).toBe('sapi_cmt_1');
    expect(byKey['post1|acc_ig|c2']).toBe('sapi_cmt_2');
  });

  it('يكتب تقريره في موضعه — ولا يمسّ حالة الصندوق المعروضة', async () => {
    route('GET', '/inbox/comments', () => ({ body: { data: [] } }));
    const regular = await syncComments(env, { budget: 40 });
    await syncComments(env, { mode: 'history', budget: 40 });
    expect(await readInboxReport(env)).toEqual(regular);
    expect(JSON.parse(setting('inbox_history_report') ?? '{}').mode).toBe('history');
  });
});

describe('ما وجدته المراجعة قبل الدمج', () => {
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  const states = () => db.prepare('SELECT inbox_post_id FROM inbox_post_state ORDER BY inbox_post_id').all().map((r: any) => r.inbox_post_id);

  it('منشورٌ يتعذّر لا يوقف الباقي — تُحفظ حالةُ ما قُرئ ويُقرأ ما بعده', async () => {
    route('GET', '/inbox/comments', () => ({
      body: { data: [1, 2, 3].map((i) => ({ id: `post${i}`, account_id: 'acc_ig', platform: 'instagram', comment_count: 1 })) },
    }));
    route('GET', '/inbox/comments/post1', () => ({ body: { data: [comment(1)] } }));
    route('GET', '/inbox/comments/post2', () => ({ status: 403, body: { error: 'forbidden' } }));
    route('GET', '/inbox/comments/post3', () => ({ body: { data: [comment(3)] } }));

    const report = await syncComments(env, { budget: 40 });
    expect(rows().map((r) => r.provider_comment_id)).toEqual(['post1|acc_ig|c1', 'post3|acc_ig|c3']);
    // الحالة للثلاثة: المتعذّر لا يُعاد حتى يتغيّر نشاطه
    expect(states()).toEqual(['post1', 'post2', 'post3']);
    expect(report?.ok).toBe(true);
    expect(report?.kinds.comment.error).toBeTruthy();

    calls.length = 0;
    await syncComments(env, { budget: 40 });
    expect(calls.some((c) => c.includes('/inbox/comments/post2'))).toBe(false);
  });

  it('وفي سحب السجلّ يتقدّم المؤشّر متجاوزاً المنشور المتعذّر', async () => {
    route('GET', '/inbox/comments', (url) => {
      const n = Number(url.searchParams.get('cursor') || 1);
      return { body: { data: [{ id: `post${n}`, account_id: 'acc_ig', platform: 'instagram', comment_count: 1 }], next_cursor: n < 5 ? String(n + 1) : null } };
    });
    route('GET', /^\/inbox\/comments\/post[13]$/, (url) => ({ body: { data: [comment(Number(url.pathname.slice(-1)))] } }));
    route('GET', '/inbox/comments/post2', () => ({ status: 404, body: { error: 'deleted' } }));

    await syncComments(env, { mode: 'history', budget: 40 });
    expect((db.prepare("SELECT value FROM settings WHERE key = 'inbox_history_cursor'").get() as { value: string }).value).toBe('4');
  });

  it('كلُّ ما جُرّب تعذّر — عطلٌ يُقال لا منشورٌ شاذّ', async () => {
    route('GET', '/inbox/comments', () => ({ body: { data: [{ id: 'post1', account_id: 'acc_ig', platform: 'instagram', comment_count: 1 }] } }));
    route('GET', '/inbox/comments/post1', () => ({ status: 500, body: { error: 'down' } }));
    const report = await syncComments(env, { budget: 40 });
    expect(report?.ok).toBe(false);
  });

  /* ما جرى في الإنتاج: عملت المزامنة على قاعدةٍ ينقصها عمود، فتعذّر كل منشور.
     وحالةٌ تُكتب لمنشورٍ لم تُحفظ تعليقاته تعلّمه مقروءاً، فلا يُعاد حتى يتغيّر
     نشاطه — وتضيع تعليقاته بصمت. */
  it('عطلٌ عامّ لا يعلّم المنشورات مقروءة — تُعاد حين يزول فتُحفظ تعليقاتها', async () => {
    route('GET', '/inbox/comments', () => ({
      body: { data: [1, 2].map((i) => ({ id: `post${i}`, account_id: 'acc_ig', platform: 'instagram', comment_count: 1 })) },
    }));
    route('GET', /^\/inbox\/comments\/post[12]$/, (url) => ({ body: { data: [comment(Number(url.pathname.slice(-1)))] } }));
    db.exec('ALTER TABLE platform_comments DROP COLUMN provider_interaction_id');

    await syncComments(env, { budget: 40 });
    expect(states()).toEqual([]);

    db.exec('ALTER TABLE platform_comments ADD COLUMN provider_interaction_id TEXT');
    await syncComments(env, { budget: 40 });
    expect(rows().map((r) => r.provider_comment_id)).toEqual(['post1|acc_ig|c1', 'post2|acc_ig|c2']);
  });

  it('ولا يتقدّم مؤشّر السجلّ فوق منشوراتٍ لم تُقرأ لعطلٍ عامّ', async () => {
    route('GET', '/inbox/comments', (url) => {
      const n = Number(url.searchParams.get('cursor') || 1);
      return { body: { data: [{ id: `post${n}`, account_id: 'acc_ig', platform: 'instagram', comment_count: 1 }], next_cursor: n < 5 ? String(n + 1) : null } };
    });
    route('GET', /^\/inbox\/comments\/post\d$/, () => ({ status: 503, body: { error: 'down' } }));

    await syncComments(env, { mode: 'history', budget: 40 });
    const cursor = db.prepare("SELECT value FROM settings WHERE key = 'inbox_history_cursor'").get() as { value: string } | undefined;
    expect(cursor?.value ?? '').toBe('');
    expect(states()).toEqual([]);
  });

  it('تعليقٌ تتعذّر ردودُه لا يُسقط فحص غيره — ولا يبقى أوّلَ الدور', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('inbox_history_done_at', ?)").run(daysAgo(1));
    const add = db.prepare(
      `INSERT INTO platform_comments (id, platform, provider_comment_id, kind, author_name, body, created_at)
       VALUES (?, 'instagram', ?, 'comment', 'عميل', 'سؤال قديم', ?)`,
    );
    add.run('cm_a', 'postA|acc_ig|ca', daysAgo(90));
    add.run('cm_b', 'postB|acc_ig|cb', daysAgo(80));
    add.run('cm_c', 'postC|acc_ig|cc', daysAgo(70));
    // الأحدث أوّلاً في الدور — وهو المتعذّر
    route('GET', '/inbox/comments/postC/cc/replies', () => ({ status: 500, body: { error: 'down' } }));
    route('GET', '/inbox/comments/postB/cb/replies', () => ({ body: { data: [{ id: 'rb', author: { name: 'naf.law' }, text: 'أجبناك', created_at: daysAgo(79) }] } }));
    route('GET', '/inbox/comments/postA/ca/replies', () => ({ body: { data: [] } }));

    await syncComments(env, { mode: 'history', budget: 40 });
    const byId = Object.fromEntries(rows().map((r) => [r.id, r]));
    expect(byId.cm_b.reply_body).toBe('أجبناك');
    for (const id of ['cm_a', 'cm_b', 'cm_c']) expect(byId[id].reply_checked_at).not.toBeNull();
  });

  describe('تنبيه المراجعات السلبية', () => {
    const notifications = () => (db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n;
    beforeEach(() => {
      db.prepare("INSERT INTO users (id,name,email,password_hash,role_name) VALUES ('u1','مدير','m@naf.sa','h','general_manager')").run();
      db.prepare("INSERT OR REPLACE INTO roles_permissions (role_name, permission_key, allowed) VALUES ('general_manager','comments.manage',1)").run();
      route('GET', '/inbox/comments', () => ({ body: { data: [] } }));
    });
    const review = (id: string, at: string) => ({ id, account_id: 'acc_ig', platform: 'google', text: 'تجربة سيئة', rating: 1, created_at: at });

    it('يُنبَّه للمراجعة السلبية الجديدة', async () => {
      route('GET', '/inbox/reviews', () => ({ body: { data: [review('r_new', daysAgo(1))] } }));
      await syncComments(env, { budget: 40 });
      expect(notifications()).toBe(1);
    });

    it('ولا يُنبَّه لمراجعةٍ من سنواتٍ دخلت الصندوق أوّل مرّة — ولا لشيءٍ من سحب السجلّ', async () => {
      route('GET', '/inbox/reviews', () => ({ body: { data: [review('r_2019', '2019-05-01T00:00:00Z')] } }));
      await syncComments(env, { budget: 40 });
      expect(notifications()).toBe(0);

      route('GET', '/inbox/reviews', () => ({ body: { data: [review('r_hist', daysAgo(2))] } }));
      await syncComments(env, { mode: 'history', budget: 40 });
      expect(notifications()).toBe(0);
    });
  });

  it('«جلب الآن» يستأنف المنشور من آخر صفحةٍ بلغها — فيبلغ أحدث تعليقاته', async () => {
    db.prepare(
      `INSERT INTO inbox_post_state (inbox_post_id, account_id, platform, signature, seen_at, synced_at, tail_cursor, needs_more)
       VALUES ('post1', 'acc_ig', 'instagram', '600|', ?, ?, 'p12', 0)`,
    ).run(daysAgo(1), daysAgo(1));
    route('GET', '/inbox/comments', () => ({ body: { data: [{ id: 'post1', account_id: 'acc_ig', platform: 'instagram', comment_count: 601 }] } }));
    route('GET', '/inbox/comments/post1', () => ({ body: { data: [comment(601)], next_cursor: null } }));

    await syncComments(env, { mode: 'full', budget: 40 });
    const first = calls.find((c) => c.startsWith('GET /inbox/comments/post1'));
    expect(first).toContain('cursor=p12');
  });
});

/* التعليقات لا تُحفظ ولا يظهر خطأ، وسببُه في شكل جواب المزوّد. والتشخيص يعيد
   البنية لا القيم: يُصوَّر ويُرسل، فلا يخرج فيه نصُّ عميلٍ ولا اسمُه. */
describe('تشخيص الصندوق', () => {
  beforeEach(() => {
    route('GET', '/inbox/comments', () => ({
      body: { data: [{ id: 'post1', inbox_post_id: 'ibx1', account_id: 'acc_ig', platform: 'instagram', comment_count: 1 }] },
    }));
    route('GET', '/inbox/comments/ibx1', () => ({ body: { data: [comment(1, { reply_count: 2 })] } }));
    route('GET', '/inbox/comments/ibx1/c1/replies', () => ({
      body: {
        data: [
          { id: 'r1', author: { id: '999', username: 'naf.law' }, text: 'شكراً لتواصلك معنا' },
          { id: 'r2', author: { id: '555', name: 'عميل خامس' }, text: 'ما زلت أنتظر' },
        ],
      },
    }));
  });

  it('يجرّب كل معرّفٍ للمنشور ويقول أيّها أعاد التعليقات', async () => {
    const d = await diagnoseInbox('sapi_key_test');
    expect(d.inbox.parsed).toBe(1);
    const tries = d.posts[0].tries;
    expect(tries.map((t) => [t.field, t.value, t.parsed])).toEqual([['id', 'post1', 0], ['inbox_post_id', 'ibx1', 1]]);
    expect(tries[0].error).toContain('404');
    // البنية تُظهر المعرّفات والأعداد
    expect(JSON.stringify(tries[1].shape)).toContain('"reply_count":2');
  });

  it('يقول أيُّ ردٍّ منّا، ويقنّع الكاتب', async () => {
    const d = await diagnoseInbox('sapi_key_test');
    expect(d.replies?.comment).toBe('c1');
    const inbox = d.replies?.tries.find((t) => t.path === 'inbox');
    expect(inbox?.replies.map((r) => r.own)).toEqual([true, false]);
    expect(inbox?.replies[0].author['author.username']).toEqual({ hint: 'naf…(7)', ours: true });
    expect(inbox?.replies[1].author['author.name']?.ours).toBe(false);
  });

  it('لا يُخرج نصَّ تعليقٍ ولا ردٍّ ولا اسمَ كاتب', async () => {
    const out = JSON.stringify(await diagnoseInbox('sapi_key_test'));
    for (const secret of ['سؤال رقم', 'عميل', 'شكراً لتواصلك', 'ما زلت أنتظر', 'u1', '555']) {
      expect(out).not.toContain(secret);
    }
  });
});
