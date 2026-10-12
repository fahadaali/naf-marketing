// خيارات النشر لكل منصة — من حفظها مع نسخة المنصة إلى حقول Ayrshare.
//
// الحقول من صفحات المنصات في توثيقه: «X Thread» (`thread`، `threadNumber`،
// والفاصل `\u2063\n\u2063\n` الذي لا يقطع)، و«Instagram/Facebook Stories»
// (`stories`)، و«Call to Action» و«Events Post» (`callToAction`، `event`)،
// و«YouTube Post Optional Fields» و«Subtitles» (`categoryId`، `tags`، `subTitleUrl`).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

vi.mock('../src/services/notify', () => ({ notifyPublishFailed: vi.fn(async () => {}) }));

import { normalizeOptions, optionIssues } from '../src/services/publishOptions';
import { runDuePublishes, preflightSchedules } from '../src/services/publish';
import { postRoutes } from '../src/routes/posts';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

describe('ما يُقبل من خيارات كل منصة', () => {
  it('يُحفظ لكل منصةٍ ما تعرفه وحده', () => {
    expect(normalizeOptions('x', { thread: true, threadNumber: true, story: true })).toEqual({ options: { thread: true, threadNumber: true } });
    expect(normalizeOptions('x', { threadNumber: true })).toEqual({ options: null });
    expect(normalizeOptions('instagram', { story: true, thread: true })).toEqual({ options: { story: true } });
    expect(normalizeOptions('linkedin', { story: true })).toEqual({ options: null });
  });

  it('زرّ نشاطي التجاري برابطه، والاتصال بلا رابط', () => {
    expect(normalizeOptions('google', { cta: { type: 'call', url: 'https://x' } })).toEqual({ options: { cta: { type: 'call' } } });
    expect(normalizeOptions('google', { cta: { type: 'book', url: 'https://naf.sa/book' } }))
      .toEqual({ options: { cta: { type: 'book', url: 'https://naf.sa/book' } } });
    expect(normalizeOptions('google', { cta: { type: 'book', url: 'naf.sa' } }).error).toBe('رابط الزرّ مطلوب، ويبدأ بـ https://');
    // نوعٌ لا نعرضه لا يُحفظ
    expect(normalizeOptions('google', { cta: { type: 'shop', url: 'https://naf.sa' } })).toEqual({ options: null });
  });

  it('الفعالية بعنوانٍ وموعدين والانتهاء بعد البدء', () => {
    const ok = normalizeOptions('google', { event: { title: 'ندوة نظام الشركات', start: '2026-11-01T15:00:00.000Z', end: '2026-11-01T17:00:00.000Z' } });
    expect(ok.options?.event).toEqual({ title: 'ندوة نظام الشركات', start: '2026-11-01T15:00:00.000Z', end: '2026-11-01T17:00:00.000Z' });
    expect(normalizeOptions('google', { event: { title: 'ندوة', start: '2026-11-01T17:00:00Z', end: '2026-11-01T15:00:00Z' } }).error)
      .toBe('الفعالية تحتاج عنواناً وموعدَي بدءٍ وانتهاء، والانتهاء بعد البدء');
    expect(normalizeOptions('google', { event: { title: 'ع'.repeat(59), start: '2026-11-01T15:00:00Z', end: '2026-11-01T17:00:00Z' } }).error)
      .toBe('عنوان الفعالية أطول من \u206858\u2069 حرفاً. اختصره ثم احفظ');
  });

  it('يوتيوب: تصنيفٌ معروض، ووسومٌ بحدودها، وملف ترجمة بلغته', () => {
    expect(normalizeOptions('youtube', { categoryId: 27, tags: ['#قانون', 'قانون', 'نظام الشركات'], subtitle: { mediaId: 'm1', language: 'fr', filename: 'a.srt' } }))
      .toEqual({ options: { categoryId: 27, tags: ['قانون', 'نظام الشركات'], subtitle: { mediaId: 'm1', language: 'ar', filename: 'a.srt' } } });
    expect(normalizeOptions('youtube', { categoryId: 10 })).toEqual({ options: null });
    expect(normalizeOptions('youtube', { tags: ['ق'] }).error).toBe('وسم يوتيوب حرفان فأكثر، ومجموع الوسوم خمس مئة حرف');
  });

  it('ما يمنع الخيار بوسائط المنشور', () => {
    const img = { mimeType: 'image/jpeg' };
    const long = { mimeType: 'video/mp4', duration_ms: 75_000 };
    expect(optionIssues('instagram', { story: true }, [img, img])[0]).toMatch(/^القصة صورةٌ واحدة أو مقطعٌ واحد/);
    expect(optionIssues('instagram', { story: true }, [long])).toEqual([]);
    expect(optionIssues('facebook', { story: true }, [long])).toEqual(['قصة فيسبوك لا تتجاوز دقيقة. اختصر المقطع، أو انشره منشوراً لا قصة']);
    expect(optionIssues('google', { event: { title: 'ع', start: '', end: '' } }, [long])[0]).toMatch(/^فعالية نشاطي التجاري لا تقبل مقطعاً/);
  });
});

/* ═══ على قاعدةٍ حقيقية ═══ */

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    sql,
    binds,
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...binds).changes } }),
  });
  return { prepare: (sql: string) => stmt(sql) };
}

let db: any;
let env: any;
let sent: any[];
let checked: string[];
const STORAGE = 'https://storage.googleapis.com/ayr/upload-1';

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider_name', 'ayrshare')").run();
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES ('gm','فهد','f@naf.sa','h','general_manager',1)").run();
  const stored = new Map<string, ArrayBuffer>();
  env = {
    DB: d1(db),
    AYRSHARE_API_KEY: 'ayr_key_test',
    AYRSHARE_X_API_KEY: 'x_key',
    AYRSHARE_X_API_SECRET: 'x_secret',
    MEDIA: {
      head: async (k: string) => (stored.has(k) ? { size: stored.get(k)!.byteLength } : null),
      get: async (k: string) => (stored.has(k) ? { body: new Blob([stored.get(k)!]).stream() } : null),
      put: (k: string) => stored.set(k, new TextEncoder().encode('DATA').buffer),
    },
  };
  sent = [];
  checked = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/media/uploadUrl') {
      return Response.json({ accessUrl: `https://media.ayrshare.com/${url.searchParams.get('fileName')}`, uploadUrl: STORAGE });
    }
    if (url.href.startsWith(STORAGE)) {
      if (init?.body instanceof ReadableStream) await new Response(init.body).text();
      return Response.json({});
    }
    if (url.pathname === '/api/post') {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ status: 'success', errors: [], postIds: [{ status: 'success', id: 'n1' }], id: `A${sent.length}` });
    }
    if (url.pathname === '/api/post/checkPostWeight') {
      checked.push(JSON.parse(String(init?.body)).post);
      return Response.json({ twitterWeightedLength: 400, twitterValid: false, maxCharLimits: { twitter: 280 } });
    }
    if (url.pathname === '/api/user') return Response.json({ displayNames: [{ platform: 'twitter', id: 't' }] });
    return Response.json({ status: 'error', message: 'not found' }, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function asset(id: string, mime: string, filename = `${id}.${mime.split('/')[1]}`): void {
  db.prepare('INSERT INTO media_assets (id, r2_key, mime_type, filename, size) VALUES (?, ?, ?, ?, 4)').run(id, `k/${id}`, mime, filename);
  env.MEDIA.put(`k/${id}`);
}

function post(id: string, body: string, platform: string, options: unknown, extra: Record<string, string> = {}): void {
  db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES (?, 'ندوة الشركات', ?, 'scheduled', 'gm')").run(id, body);
  db.prepare('INSERT INTO post_variants (id, post_id, platform, options_json, first_comment) VALUES (?, ?, ?, ?, ?)')
    .run(`v_${id}`, id, platform, JSON.stringify(options), extra.first_comment ?? null);
  db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status) VALUES (?, ?, ?, '2026-01-01T09:00:00Z', 'pending')")
    .run(`s_${id}`, id, platform);
}

describe('الخيارات عند النشر عبر Ayrshare', () => {
  it('سلسلة إكس: يقسمها Ayrshare على الجمل، وفاصل الفقرة لا يقطعها', async () => {
    post('p1', '<p>الفقرة الأولى</p><p></p><p>الفقرة الثانية</p>', 'x', { thread: true, threadNumber: true });
    await runDuePublishes(env);
    expect(sent[0].twitterOptions).toEqual({ thread: true, threadNumber: true });
    expect(sent[0].post).toBe('الفقرة الأولى\u2063\n\u2063\nالفقرة الثانية');
  });

  it('قصة إنستغرام: وسيطٌ وحده بلا ريلز ولا نصٍّ بديل ولا تعليقٍ أول — ويبقى الوسم', async () => {
    asset('v1', 'video/mp4');
    db.prepare("UPDATE media_assets SET alt_text = 'وصف', ai_generated = 1 WHERE id = 'v1'").run();
    post('p2', '<img src="/api/media/v1">', 'instagram', { story: true }, { first_comment: 'رابط' });
    await runDuePublishes(env);
    expect(sent[0].instagramOptions).toEqual({ stories: true, isAIGenerated: true });
    expect(sent[0].firstComment).toBeUndefined();
  });

  it('قصة فيسبوك', async () => {
    asset('i1', 'image/jpeg');
    post('p3', '<img src="/api/media/i1">', 'facebook', { story: true });
    await runDuePublishes(env);
    expect(sent[0].faceBookOptions).toEqual({ stories: true });
  });

  it('نشاطي التجاري: زرّ الحجز برابطه وفعاليةٌ بموعديها', async () => {
    post('p4', '<p>ندوة عن نظام الشركات</p>', 'google', {
      cta: { type: 'book', url: 'https://naf.sa/book' },
      event: { title: 'ندوة نظام الشركات', start: '2026-11-01T15:00:00.000Z', end: '2026-11-01T17:00:00.000Z' },
    });
    await runDuePublishes(env);
    expect(sent[0].platforms).toEqual(['gmb']);
    expect(sent[0].gmbOptions).toEqual({
      callToAction: { actionType: 'book', url: 'https://naf.sa/book' },
      event: { title: 'ندوة نظام الشركات', startDate: '2026-11-01T15:00:00.000Z', endDate: '2026-11-01T17:00:00.000Z' },
    });
  });

  it('يوتيوب: التصنيف والوسوم، وملف الترجمة يُرفع ويُرسل رابطه بلغته', async () => {
    asset('v2', 'video/mp4');
    asset('srt1', 'application/x-subrip', 'captions.srt');
    post('p5', '<p>شرح</p><img src="/api/media/v2">', 'youtube', {
      categoryId: 27, tags: ['قانون'], subtitle: { mediaId: 'srt1', language: 'ar' },
    });
    await runDuePublishes(env);
    expect(sent[0].youTubeOptions).toMatchObject({
      title: 'ندوة الشركات', visibility: 'public', categoryId: 27, tags: ['قانون'],
      subTitleUrl: 'https://media.ayrshare.com/captions.srt', subTitleLanguage: 'ar', subTitleName: 'العربية',
    });
  });

  it('ما يمنع الخيار يُقال قبل الإرسال', async () => {
    asset('a', 'image/jpeg');
    asset('b', 'image/jpeg');
    post('p6', '<img src="/api/media/a"><img src="/api/media/b">', 'instagram', { story: true });
    await runDuePublishes(env);
    expect(sent).toEqual([]);
    expect(db.prepare("SELECT status, error FROM schedules WHERE id = 's_p6'").get().error).toMatch(/^القصة صورةٌ واحدة أو مقطعٌ واحد/);
  });

  it('سلسلة إكس لا يُعدّ طولها عيباً عند الجدولة', async () => {
    post('p7', '<p>نصٌّ طويل</p>', 'x', { thread: true });
    const out = await preflightSchedules(env, 'p7', ['x']);
    expect(checked).toHaveLength(1);
    expect(out).toEqual([]);
  });
});

describe('حفظ الخيارات مع نسخة المنصة', () => {
  async function put(platform: string, body: unknown) {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('sub', 'gm'); await next(); });
    app.route('/posts', postRoutes);
    const res = await app.request(`http://localhost/posts/p9/variants/${platform}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, env, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    return { status: res.status, body: (await res.json()) as any };
  }
  const saved = (platform: string) =>
    db.prepare("SELECT options_json, body_override FROM post_variants WHERE post_id = 'p9' AND platform = ?").get(platform);

  it('تُصفّى بما تقبله المنصة، وتبقى إن لم تُرسل، ويُردّ ما لا يصحّ بسببه', async () => {
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES ('p9', 'ع', '<p>نص</p>', 'draft', 'gm')").run();
    expect((await put('x', { body_override: 'نص إكس', options: { thread: true, story: true } })).status).toBe(200);
    expect(JSON.parse(saved('x').options_json)).toEqual({ thread: true });

    await put('x', { body_override: 'نصٌّ آخر' });
    expect(saved('x')).toEqual({ options_json: '{"thread":true}', body_override: 'نصٌّ آخر' });

    const bad = await put('google', { options: { cta: { type: 'book', url: '' } } });
    expect(bad).toEqual({ status: 400, body: { error: 'رابط الزرّ مطلوب، ويبدأ بـ https://' } });

    await put('x', { options: null });
    expect(saved('x').options_json).toBeNull();
  });
});
