// مفتاحُ محاولة النشر لدى Ayrshare، وما لا تُعرف نتيجته، والإيقاف بدل «رفض المفتاح».
//
// من صفحة «Post API Overview» في توثيقه: `idempotencyKey` فريدٌ لكل ملف، وطلبٌ
// بالمفتاح نفسه يُرفض «regardless of the post's state (success, error, pending,
// or deleted)». فالمفتاح يبقى ما دامت النتيجة لا تُعرف، ويُجدَّد بعد كل نتيجةٍ
// معروفة — وإلا رُفضت إعادةُ منشورٍ رُفض لسببٍ أُصلح.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

vi.mock('../src/services/notify', () => ({ notifyPublishFailed: vi.fn(async () => {}) }));

import { runDuePublishes, publishPostNow, reconcilePublishing } from '../src/services/publish';
import {
  DUPLICATE_KEY_ERROR, UNCERTAIN_ERROR, ALREADY_RETRIED_ERROR, ayrshareOutcome, duplicateKeyRejection, retryableFailure, uncertainOutcome, AyrshareError,
} from '../src/adapters/ayrshare';
import { SUSPENSION_KEY } from '../src/services/ayrshareAlerts';

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
    batch: async (stmts: any[]) => stmts.map((s) => ({ meta: { changes: db.prepare(s.sql).run(...s.binds).changes } })),
  };
}

const PAST = '2026-01-01T09:00:00Z';

function build(): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider_name', 'ayrshare')").run();
  db.prepare("INSERT INTO users (id, name, email, password_hash, role_name) VALUES ('u1', 'فهد', 'f@naf.sa', 'h', 'general_manager')").run();
  return db;
}

function post(db: any, id: string, body: string, platforms: string[]): void {
  db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES (?, 'عنوان', ?, 'scheduled', 'u1')").run(id, body);
  for (const p of platforms) {
    db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status) VALUES (?, ?, ?, ?, 'pending')")
      .run(`sch_${id}_${p}`, id, p, PAST);
  }
}

const row = (db: any, id: string) => db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);

type Reply = { status?: number; body: unknown } | 'network';
let replies: Record<string, (url: URL, init?: RequestInit) => Reply>;
let calls: { key: string; body: any }[];
let db: any;
let env: any;

const STORAGE = 'https://storage.googleapis.com/ayr/upload-1';
const OK = (id: string): Reply => ({ body: { status: 'success', errors: [], postIds: [{ status: 'success', id }], id } });
const sent = () => calls.filter((c) => c.key === 'POST /post').map((c) => c.body);

beforeEach(() => {
  db = build();
  const media = new Map<string, ArrayBuffer>();
  env = {
    DB: d1(db),
    AYRSHARE_API_KEY: 'ayr_key_test',
    MEDIA: {
      head: async (k: string) => (media.has(k) ? { size: media.get(k)!.byteLength } : null),
      get: async (k: string) => (media.has(k) ? { body: new Blob([media.get(k)!]).stream() } : null),
      _put: (k: string) => media.set(k, new TextEncoder().encode('VIDEODATA').buffer),
    },
  };
  replies = {
    'GET /media/uploadUrl': (url) => ({
      body: { accessUrl: `https://media.ayrshare.com/${url.searchParams.get('fileName')}`, uploadUrl: STORAGE },
    }),
    [`PUT ${STORAGE}`]: () => ({ body: {} }),
  };
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.origin === 'https://api.ayrshare.com' ? url.pathname.replace(/^\/api/, '') : url.href.split('?')[0];
    const key = `${(init?.method || 'GET').toUpperCase()} ${path}`;
    let body: any = init?.body;
    if (body instanceof ReadableStream) body = await new Response(body).text();
    try { body = typeof body === 'string' && body.startsWith('{') ? JSON.parse(body) : body; } catch { /* نصّ */ }
    calls.push({ key, body });
    const r = replies[key]?.(url, init) ?? { status: 404, body: { status: 'error', code: 101, message: 'not found' } };
    // انقطاعٌ قبل الردّ — كما يرمي fetch في العامل
    if (r === 'network') throw new TypeError('Network connection lost.');
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('مفتاح محاولة النشر', () => {
  it('كل محاولةٍ تحمل مفتاحها، ويُمحى بعد النشر', async () => {
    post(db, 'p1', '<p>نص</p>', ['linkedin']);
    replies['POST /post'] = () => OK('A1');
    await runDuePublishes(env);
    expect(sent()[0].idempotencyKey).toMatch(/^pub_[0-9a-f]{32}$/);
    expect(row(db, 'sch_p1_linkedin')).toMatchObject({ status: 'published', publish_key: null });
  });

  it('انقطاعٌ قبل الردّ: يبقى المفتاح، والإعادة به نفسه — ورفضُه يقول إن المنشور وصل', async () => {
    post(db, 'p2', '<p>نص</p>', ['linkedin']);
    replies['POST /post'] = () => 'network';
    await runDuePublishes(env);
    const first = row(db, 'sch_p2_linkedin');
    expect(first).toMatchObject({ status: 'failed', error: UNCERTAIN_ERROR });
    expect(first.publish_key).toBe(sent()[0].idempotencyKey);

    // المحاولة الأولى كانت وصلت: يرفض Ayrshare المفتاح ولا يُنشر ثانيةً
    replies['POST /post'] = () => ({ status: 400, body: { status: 'error', code: 400, message: 'Duplicate idempotencyKey found.' } });
    await publishPostNow(env, 'p2');
    expect(sent()[1].idempotencyKey).toBe(first.publish_key);
    expect(row(db, 'sch_p2_linkedin')).toMatchObject({ status: 'failed', error: DUPLICATE_KEY_ERROR, publish_key: null });

    // ومن تحقّق ولم يجده يعيد النشر بمفتاحٍ جديد
    replies['POST /post'] = () => OK('A2');
    await publishPostNow(env, 'p2');
    expect(sent()[2].idempotencyKey).not.toBe(first.publish_key);
    expect(row(db, 'sch_p2_linkedin')).toMatchObject({ status: 'published', provider_post_id: 'A2' });
  });

  it('الرفض المعروف يمحو المفتاح فتحمل الإعادة مفتاحاً جديداً', async () => {
    post(db, 'p3', '<p>نص</p>', ['linkedin']);
    replies['POST /post'] = () => ({
      status: 400,
      body: { status: 'error', errors: [{ code: 156, message: 'Linkedin is not linked.', platform: 'linkedin' }], postIds: [], id: 'A3' },
    });
    await runDuePublishes(env);
    expect(row(db, 'sch_p3_linkedin')).toMatchObject({ status: 'failed', publish_key: null });
    replies['POST /post'] = () => OK('A3b');
    await publishPostNow(env, 'p3');
    expect(sent()[1].idempotencyKey).not.toBe(sent()[0].idempotencyKey);
  });

  it('بوّابةٌ ٥٠٢ بلا رمزٍ من Ayrshare لا تُعرف نتيجتها، و٤٩٩ رفضٌ معروفٌ مؤقت', async () => {
    post(db, 'p4', '<p>نص</p>', ['linkedin']);
    replies['POST /post'] = () => ({ status: 502, body: { message: 'Bad Gateway' } });
    await runDuePublishes(env);
    expect(row(db, 'sch_p4_linkedin')).toMatchObject({ status: 'failed', error: UNCERTAIN_ERROR });
    expect(row(db, 'sch_p4_linkedin').publish_key).toBeTruthy();

    post(db, 'p5', '<p>نص</p>', ['facebook']);
    replies['POST /post'] = () => ({
      status: 503,
      body: {
        status: 'error',
        errors: [{ action: 'post', code: 499, retryAvailable: true, message: 'Media probe unavailable.', platform: 'facebook' }],
      },
    });
    await runDuePublishes(env);
    const r = row(db, 'sch_p5_facebook');
    expect(r).toMatchObject({ status: 'failed', publish_key: null });
    expect(r.error).toBe('فشل النشر عبر Ayrshare: facebook: Media probe unavailable.. تعثّرٌ مؤقت لدى المنصة — أعد النشر بعد دقائق');
  });

  it('العامل المنقطع يُبقي مفتاحه، فتحمله الإعادة', async () => {
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES ('p6', 'ع', '<p>نص</p>', 'scheduled', 'u1')").run();
    db.prepare(
      `INSERT INTO schedules (id, post_id, platform, scheduled_at, status, published_at, publish_key)
       VALUES ('sch_p6', 'p6', 'linkedin', ?, 'processing', ?, 'pub_old')`,
    ).run(PAST, new Date(Date.now() - 30 * 60_000).toISOString());
    await reconcilePublishing(env);
    expect(row(db, 'sch_p6')).toMatchObject({ status: 'failed', publish_key: 'pub_old' });

    replies['POST /post'] = () => OK('A6');
    await publishPostNow(env, 'p6');
    expect(sent()[0].idempotencyKey).toBe('pub_old');
    expect(row(db, 'sch_p6')).toMatchObject({ status: 'published', publish_key: null });
  });

  it('ما لم يؤكّده المزوّد في ساعة يُبقي مفتاحه، وما رفضه يمحوه', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    for (const id of ['p7', 'p8']) {
      db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES (?, 'ع', '<p>نص</p>', 'scheduled', 'u1')").run(id);
      db.prepare(
        `INSERT INTO schedules (id, post_id, platform, scheduled_at, status, provider_post_id, published_at, publish_key)
         VALUES (?, ?, 'linkedin', ?, 'processing', ?, ?, ?)`,
      ).run(`sch_${id}`, id, PAST, `AYR_${id}`, old, `pub_${id}`);
    }
    replies['GET /post/AYR_p7'] = () => ({ body: { status: 'pending', id: 'AYR_p7' } });
    replies['GET /post/AYR_p8'] = () => ({
      body: { status: 'error', id: 'AYR_p8', errors: [{ code: 1, message: 'nope', platform: 'linkedin' }] },
    });
    replies['GET /history/linkedin'] = () => ({ body: { posts: [] } });
    await reconcilePublishing(env);
    expect(row(db, 'sch_p7')).toMatchObject({ status: 'failed', publish_key: 'pub_p7' });
    expect(row(db, 'sch_p8')).toMatchObject({ status: 'failed', publish_key: null });
  });

  it('سناب: لكل نشرةٍ مفتاحُها من مفتاح الموعد', async () => {
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename, width, height, duration_ms) VALUES ('v1', 'k/v1', 'video/mp4', 'v1.mp4', 1080, 1920, 20000)").run();
    env.MEDIA._put('k/v1');
    post(db, 's1', '<img src="/api/media/v1">', ['snapchat']);
    let n = 0;
    replies['POST /post'] = () => OK(`S${++n}`);
    await runDuePublishes(env);
    const keys = sent().map((b) => b.idempotencyKey);
    const base = keys[0].replace(/-spotlight$/, '');
    expect(keys).toEqual([`${base}-spotlight`, `${base}-saved`, `${base}-story`]);
  });

  it('سناب: نشرةٌ لا تُعرف نتيجتها والبقية رُفضت — يبقى مفتاح الموعد', async () => {
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename, width, height) VALUES ('i1', 'k/i1', 'image/jpeg', 'a.jpg', 1080, 1920)").run();
    env.MEDIA._put('k/i1');
    post(db, 's2', '<img src="/api/media/i1">', ['snapchat']);
    replies['POST /post'] = (_u, init) =>
      JSON.parse(String(init?.body)).snapChatOptions?.savedStory
        ? 'network'
        : { status: 400, body: { status: 'error', errors: [{ code: 1, message: 'nope', platform: 'snapchat' }] } };
    await runDuePublishes(env);
    expect(row(db, 'sch_s2_snapchat').status).toBe('failed');
    expect(row(db, 'sch_s2_snapchat').publish_key).toBeTruthy();
  });
});

describe('«نشر الآن» لمنصةٍ بعينها', () => {
  it('ينشر المسمّاة وحدها، ومواعيد البقية باقية', async () => {
    post(db, 'pn', '<p>نص</p>', ['linkedin', 'x']);
    replies['POST /post'] = () => OK('A_pn');
    const res = await publishPostNow(env, 'pn', ['linkedin']);
    expect(res.published).toBe(1);
    expect(sent()).toHaveLength(1);
    expect(sent()[0].platforms).toEqual(['linkedin']);
    expect(row(db, 'sch_pn_x').status).toBe('pending');
  });
});

describe('حساب النشر المعطّل', () => {
  it('رفضُ ٤٠٣ يقول التعطيل وسببه وما يُفعّله — لا «رفض المفتاح»', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(SUSPENSION_KEY, JSON.stringify({
      reason: 'Confirm your identity before you can publish as this Page.', platform: 'facebook', origin: 'policy', unsuspendAt: null,
    }));
    post(db, 'q1', '<p>نص</p>', ['linkedin']);
    replies['POST /post'] = () => ({ status: 403, body: { status: 'error', message: 'Profile suspended' } });
    await runDuePublishes(env);
    expect(row(db, 'sch_q1_linkedin').error).toBe(
      'حساب النشر معطّلٌ لدى Ayrshare: \u2068Confirm your identity before you can publish as this Page.\u2069. ' +
        'حُلّ السبب على فيسبوك نفسها ثم أعد ربطها في Ayrshare.',
    );
  });

  it('وبلا تعطيلٍ محفوظ يبقى ٤٠٣ بسببه كما كان', async () => {
    post(db, 'q2', '<p>نص</p>', ['linkedin']);
    replies['POST /post'] = () => ({ status: 403, body: { status: 'error', message: 'Invalid API key' } });
    await runDuePublishes(env);
    expect(row(db, 'sch_q2_linkedin').error).toBe('فشل النشر عبر Ayrshare: Invalid API key');
  });
});

describe('تصنيف الخطأ', () => {
  it('لا ردّ أصلاً أو بوّابةٌ بلا رمز ← لا تُعرف النتيجة؛ وما فيه رمزٌ معروف', () => {
    expect(uncertainOutcome(new TypeError('fetch failed'))).toBe(true);
    expect(uncertainOutcome(new AyrshareError('x', 504, { message: 'Gateway Timeout' }))).toBe(true);
    expect(uncertainOutcome(new AyrshareError('x', 503, { errors: [{ code: 499 }] }))).toBe(false);
    expect(uncertainOutcome(new AyrshareError('x', 500, { errors: [{ code: 107 }] }))).toBe(false);
    expect(uncertainOutcome(new AyrshareError('x', 400, {}))).toBe(false);
  });

  it('رفضُ المفتاح من نصّه، والتعثّر المؤقت حين تقوله الأخطاء كلها', () => {
    expect(duplicateKeyRejection({ errors: [{ message: 'Duplicate idempotency key' }] })).toBe(true);
    expect(duplicateKeyRejection({ errors: [{ code: 110, message: 'Status is a duplicate.' }] })).toBe(false);
    expect(retryableFailure({ errors: [{ retryAvailable: true }, { retryAvailable: true }] })).toBe(true);
    expect(retryableFailure({ errors: [{ retryAvailable: true }, { code: 156 }] })).toBe(false);
    expect(retryableFailure({ errors: [] })).toBe(false);
  });
});

describe('مهلة المنصة انتهت — يُعاد المنشور نفسه', () => {
  const TIMEOUT = 'One or more of the social networks timed out with your request. Please re-try the post. You may use the /retry endpoint: https://www.ayrshare.com/docs/apis/post/retry-post';

  function failedTikTok(id: string, retryId: string | null) {
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES (?, 'ع', '<p>نص المنشور الطويل</p>', 'scheduled', 'u1')").run(id);
    db.prepare(
      `INSERT INTO schedules (id, post_id, platform, scheduled_at, status, provider_post_id, error, retry_id)
       VALUES (?, ?, 'tiktok', ?, 'failed', ?, 'x', ?)`,
    ).run(`sch_${id}`, id, PAST, `AYR_${id}`, retryId);
  }

  it('رسالة المهلة فشلٌ يُعاد', () => {
    expect(ayrshareOutcome({ status: 'error', id: 'A', errors: [{ platform: 'tiktok', message: TIMEOUT }] }))
      .toMatchObject({ state: 'failed', retryable: true });
    expect(ayrshareOutcome({ status: 'error', id: 'A', errors: [{ platform: 'tiktok', message: 'Video too short' }] }))
      .not.toHaveProperty('retryable');
  });

  it('المتابعة تكتبه فاشلاً بسببٍ يُفهم، ويبقى معرّفه للإعادة', async () => {
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES ('t1', 'ع', '<p>نص</p>', 'scheduled', 'u1')").run();
    db.prepare(
      `INSERT INTO schedules (id, post_id, platform, scheduled_at, status, provider_post_id, published_at, publish_key)
       VALUES ('sch_t1', 't1', 'tiktok', ?, 'processing', 'AYR_t1', ?, 'pub_t1')`,
    ).run(PAST, old);
    replies['GET /post/AYR_t1'] = () => ({ body: { status: 'error', id: 'AYR_t1', errors: [{ platform: 'tiktok', message: TIMEOUT }] } });
    replies['GET /history/tiktok'] = () => ({ body: { posts: [] } });
    await reconcilePublishing(env);
    const r = row(db, 'sch_t1');
    expect(r).toMatchObject({ status: 'failed', retry_id: 'AYR_t1' });
    expect(r.error).toMatch(/^انتهت مهلة تيك توك قبل أن تردّ، ولم يُرفض المحتوى/);
  });

  it('«نشر الآن» يعيد المنشور نفسه ولا يرسل منشوراً جديداً', async () => {
    failedTikTok('t2', 'AYR_t2');
    replies['GET /history/tiktok'] = () => ({ body: { posts: [] } });
    replies['PUT /post/retry'] = () => ({ body: { status: 'pending', id: 'AYR_t2' } });
    const res = await publishPostNow(env, 't2');
    expect(res.pending).toBe(1);
    expect(calls.find((c) => c.key === 'PUT /post/retry')!.body).toEqual({ id: 'AYR_t2' });
    expect(sent()).toHaveLength(0);
    expect(row(db, 'sch_t2')).toMatchObject({ status: 'processing', provider_post_id: 'AYR_t2', retry_id: null });
  });

  it('ما ظهر في سجلّ المنصة يُكتب منشوراً ولا يُعاد', async () => {
    failedTikTok('t3', 'AYR_t3');
    replies['GET /history/tiktok'] = () => ({ body: { posts: [{ id: 'tt_9', post: 'نص المنشور الطويل', created: new Date().toISOString() }] } });
    await publishPostNow(env, 't3');
    expect(calls.some((c) => c.key === 'PUT /post/retry')).toBe(false);
    expect(row(db, 'sch_t3')).toMatchObject({ status: 'published', provider_post_id: 'AYR_t3', retry_id: null });
  });

  it('ما أُعيد قبلُ يُقال، ويُفلت معرّفه فتُرسله المحاولة التالية جديداً', async () => {
    failedTikTok('t4', 'AYR_t4');
    replies['GET /history/tiktok'] = () => ({ body: { posts: [] } });
    replies['PUT /post/retry'] = () => ({ status: 400, body: { action: 'post', status: 'error', code: 329, message: 'This post was already retried and cannot be retried again.' } });
    await publishPostNow(env, 't4');
    expect(row(db, 'sch_t4')).toMatchObject({ status: 'failed', error: ALREADY_RETRIED_ERROR, retry_id: null });
  });
});
