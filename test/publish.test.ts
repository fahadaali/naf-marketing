// النشر المجدول على قاعدةٍ حقيقية ومزوّدٍ مخنوق.
//
// يُثبَّت هنا ما جعل المجدول يفشل على كل المنصات ولا يقول لماذا: الرفع إلى
// مسار السرد، والقبول يُكتب «منشوراً»، والرفض داخل الوجهة يُقرأ نجاحاً،
// والمزوّد غير المضبوط يترك كل موعدٍ «متأخراً» صامتاً، والجدول الذي انقطع
// عاملُه يبقى «قيد النشر» إلى الأبد.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

vi.mock('../src/services/notify', () => ({ notifyPublishFailed: vi.fn(async () => {}) }));

import {
  runDuePublishes, publishPostNow, reconcilePublishing, missingRequirement, CONFIRM_WITHIN_MS,
} from '../src/services/publish';
import { publishOutcome, validationIssues, instagramContentType } from '../src/adapters/socialapi';

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

function build(provider = 'socialapi'): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider_name', ?)").run(provider);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('socialapi_profiles', ?)")
    .run(JSON.stringify({ linkedin: 'acc_li', instagram: 'acc_ig', x: 'acc_x', tiktok: 'acc_tt' }));
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

type Reply = { status?: number; body: unknown };
let replies: Record<string, (url: URL, init?: RequestInit) => Reply>;
let calls: string[];
let db: any;
let env: any;

beforeEach(() => {
  db = build();
  const media = new Map<string, ArrayBuffer>();
  env = {
    DB: d1(db),
    SOCIALAPI_API_KEY: 'sapi_key_test',
    MEDIA: {
      head: async (k: string) => (media.has(k) ? { size: media.get(k)!.byteLength } : null),
      get: async (k: string) => (media.has(k) ? { body: new Blob([media.get(k)!]).stream() } : null),
      _put: (k: string) => media.set(k, new TextEncoder().encode('PNGDATA!').buffer),
    },
  };
  replies = {};
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${(init?.method || 'GET').toUpperCase()} ${url.pathname.replace(/^\/v1/, '')}`;
    calls.push(key);
    // الجسم التدفّقي يُقرأ هنا كما يقرؤه الخادم
    if (init?.body instanceof ReadableStream) {
      init = { ...init, body: await new Response(init.body).text() };
    }
    const r = replies[key]?.(url, init) ?? { status: 404, body: { error: { message: 'not found' } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('حال النشر من ردّ المزوّد', () => {
  it('يقرأ رفض الوجهة وسببه من المصفوفة ومن الخريطة', () => {
    expect(publishOutcome({ id: 'p', status: 'partial', targets: [{ status: 'failed', error: { message: 'Duplicate content' } }] }))
      .toEqual({ state: 'failed', error: 'Duplicate content' });
    expect(publishOutcome({ data: { id: 'p', platforms: { x: { status: 'failed', error: 'too long' } } } }))
      .toEqual({ state: 'failed', error: 'too long' });
  });

  it('القبول انتظارٌ لا نشر، والغياب لا يُخترع حالاً', () => {
    expect(publishOutcome({ id: 'p', status: 'publishing', targets: [{ status: 'publishing' }] })).toEqual({ state: 'pending' });
    expect(publishOutcome({ id: 'p', platforms: { threads: { status: 'published' } } })).toEqual({ state: 'published' });
    expect(publishOutcome({ id: 'p' })).toBeNull();
  });
});

describe('ما ترفضه المنصة قبل أن يصلها', () => {
  it('إنستغرام بلا وسيط، ويوتيوب بلا فيديو، والمنشور الفارغ', () => {
    expect(missingRequirement('instagram', 'نص', [])).toMatch(/بلا صورة أو فيديو/);
    expect(missingRequirement('youtube', 'نص', [{ mimeType: 'image/png', filename: 'a.png' }])).toMatch(/إلا فيديو/);
    expect(missingRequirement('linkedin', '', [])).toMatch(/فارغ/);
    expect(missingRequirement('linkedin', 'نص', [])).toBeNull();
    // تيك توك: صورتان فأكثر، أو مقطعٌ واحد
    const img = { mimeType: 'image/jpeg', filename: 'a.jpg' };
    expect(missingRequirement('tiktok', 'نص', [img])).toMatch(/بأقلّ من صورتين/);
    expect(missingRequirement('tiktok', 'نص', [img, img])).toBeNull();
    expect(missingRequirement('tiktok', 'نص', [{ mimeType: 'video/mp4', filename: 'v.mp4' }])).toBeNull();
  });

  it('يُكتب السبب على الجدول ولا يُرسل شيء', async () => {
    post(db, 'p1', '<p>نص بلا صورة</p>', ['instagram']);
    const r = await runDuePublishes(env);
    expect(r.failed).toBe(1);
    expect(row(db, 'sch_p1_instagram')).toMatchObject({ status: 'failed' });
    expect(row(db, 'sch_p1_instagram').error).toMatch(/بلا صورة أو فيديو/);
    expect(calls).toEqual([]);
  });

  it('وسيطٌ في المحتوى لم يعد موجوداً يُقال ولا يُتخطّى', async () => {
    post(db, 'p2', '<p>نص</p><img src="/api/media/med_gone">', ['linkedin']);
    await runDuePublishes(env);
    expect(row(db, 'sch_p2_linkedin').error).toMatch(/لم يعد موجوداً/);
    expect(calls).toEqual([]);
  });
});

describe('المزوّد غير المضبوط', () => {
  it('يكتب سببه على كل موعد بدل أن يتركه معلّقاً صامتاً', async () => {
    env.SOCIALAPI_API_KEY = '';
    post(db, 'p3', '<p>نص</p>', ['linkedin', 'x']);
    const r = await runDuePublishes(env);
    expect(r.failed).toBe(2);
    expect(row(db, 'sch_p3_linkedin')).toMatchObject({ status: 'failed' });
    expect(row(db, 'sch_p3_x').error).toMatch(/مفتاح SocialAPI/);
  });
});

describe('النشر عبر SocialAPI', () => {
  /** وسيطٌ في المكتبة ومنشورٌ يضمّه. */
  function withImage(id: string, postId: string, platform: string, filename = `${id}.png`): void {
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename) VALUES (?, ?, 'image/png', ?)").run(id, `k/${id}`, filename);
    env.MEDIA._put(`k/${id}`);
    post(db, postId, `<p>نص</p><img src="/api/media/${id}">`, [platform]);
  }

  /** منشورٌ بصورتين — تيك توك لا يقبل منشور صورٍ بأقلّ منهما. */
  function withTwoImages(a: string, b: string, postId: string, platform: string): void {
    for (const id of [a, b]) {
      db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename) VALUES (?, ?, 'image/jpeg', ?)").run(id, `k/${id}`, `${id}.jpg`);
      env.MEDIA._put(`k/${id}`);
    }
    post(db, postId, `<p>نص</p><img src="/api/media/${a}"><img src="/api/media/${b}">`, [platform]);
  }

  it('يرفع الوسيط برابطٍ موقَّع ثم يؤكّده ثم ينشر بمعرّفه ونوعه', async () => {
    withImage('med_1', 'p4', 'instagram', '1.png');
    let asked: URLSearchParams | null = null;
    let put: { headers: Headers; body: string } | null = null;
    let sent: any = null;
    replies['GET /media/upload-url'] = (u) => {
      asked = u.searchParams;
      return { body: { media_id: 'sapi_med_1', upload_url: 'https://storage.example/put/abc?sig=1', expires_at: '2026-10-04T17:00:00Z' } };
    };
    replies['PUT /put/abc'] = (_u, init) => {
      put = { headers: new Headers(init?.headers), body: String(init?.body) };
      return { body: {} };
    };
    replies['POST /media/sapi_med_1/verify'] = () => ({ body: { success: true } });
    replies['POST /posts'] = (_u, init) => {
      sent = JSON.parse(String(init?.body));
      return { status: 201, body: { id: 'post_1', status: 'published', targets: [{ account_id: 'acc_ig', status: 'published' }] } };
    };
    const r = await runDuePublishes(env);
    expect(r.published).toBe(1);
    expect(calls).toEqual(['GET /media/upload-url', 'PUT /put/abc', 'POST /media/sapi_med_1/verify', 'POST /posts']);
    expect(asked!.get('media_type')).toBe('image/png');
    expect(asked!.get('filename')).toBe('1.png');
    // الملف كما هو، بنوعه، وبلا مفتاح يُفسد توقيع الرابط
    expect(put!.body).toBe('PNGDATA!');
    expect(put!.headers.get('content-type')).toBe('image/png');
    expect(put!.headers.get('authorization')).toBeNull();
    expect(sent.media).toEqual([{ source: 'sapi_med_1', source_type: 'media_id', type: 'image' }]);
    // إنستغرام يشترط نوع المنشور — صورةٌ واحدة منشورٌ عادي
    expect(sent.platform_data).toEqual({ instagram: { content_type: 'feed' } });
    expect(sent.media_ids).toBeUndefined();
    expect(sent.targets).toEqual([{ account_id: 'acc_ig' }]);
    expect(row(db, 'sch_p4_instagram')).toMatchObject({ status: 'published', provider_post_id: 'post_1' });
    expect(db.prepare("SELECT status FROM content_posts WHERE id = 'p4'").get().status).toBe('published');
  });

  it('يعود إلى الرفع من الخادم إن لم يوجد مسار الرابط الموقَّع', async () => {
    withImage('med_2', 'p5', 'linkedin', '2.png');
    let upload: { type: string; body: string } | null = null;
    replies['POST /media/upload'] = (_u, init) => {
      upload = { type: new Headers(init?.headers).get('content-type') || '', body: String(init?.body) };
      return { body: { media_id: 'sapi_med_2' } };
    };
    replies['POST /posts'] = () => ({ body: { id: 'post_2', status: 'published' } });
    await runDuePublishes(env);
    expect(calls).toEqual(['GET /media/upload-url', 'POST /media/upload', 'POST /posts']);
    // جزءٌ واحد باسم file، فيه الملف كما هو بين الرأس والخاتمة
    const boundary = /boundary=(\S+)/.exec(upload!.type)![1];
    expect(upload!.body).toBe(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="2.png"\r\n` +
      `Content-Type: image/png\r\n\r\nPNGDATA!\r\n--${boundary}--\r\n`,
    );
    expect(row(db, 'sch_p5_linkedin').status).toBe('published');
  });

  it('٤١٣ خادم الويب في الاحتياط يُقال بحجم الملف وما العمل، لا بصفحة HTML', async () => {
    withImage('med_3', 'p11', 'x', 'CD29D019.png');
    const html = '<html> <head><title>413 Request Entity Too Large</title></head> <body> <center><h1>413 Request Entity Too Large</h1></center>';
    replies['POST /media/upload'] = () => ({ status: 413, body: html });
    await runDuePublishes(env);
    const error = row(db, 'sch_p11_x').error;
    expect(error).toMatch(/حجم الوسيط «CD29D019\.png» \(0\.0 ميغابايت\) أكبر مما يقبله مزوّد النشر/);
    expect(error).not.toMatch(/<html>/);
    expect(calls).toEqual(['GET /media/upload-url', 'POST /media/upload']);
  });

  it('٤١٣ المزوّد على الرابط الموقَّع مساحةٌ ممتلئة لا ملفٌ كبير', async () => {
    withImage('med_4', 'p12', 'x');
    replies['GET /media/upload-url'] = () => ({ status: 413, body: { error: { code: 'storage.quota_exceeded', message: 'Storage quota exceeded' } } });
    await runDuePublishes(env);
    expect(row(db, 'sch_p12_x').error).toMatch(/مساحة التخزين في حساب مزوّد النشر ممتلئة/);
    expect(calls).toEqual(['GET /media/upload-url']);
  });

  it('رفضُ التخزين للرفع يُقال ولا يُرسل طلب النشر', async () => {
    withImage('med_5', 'p13', 'x', '5.png');
    replies['GET /media/upload-url'] = () => ({ body: { media_id: 'm5', upload_url: 'https://storage.example/put/m5' } });
    replies['PUT /put/m5'] = () => ({ status: 403, body: '<Error><Code>SignatureDoesNotMatch</Code></Error>' });
    await runDuePublishes(env);
    expect(row(db, 'sch_p13_x').error).toMatch(/فشل رفع الوسيط «5\.png» إلى تخزين المزوّد \(403\): .*SignatureDoesNotMatch/);
    expect(calls).toEqual(['GET /media/upload-url', 'PUT /put/m5']);
  });

  it('رفضُ التحقّق يُكتب بقائمة ما يُصلَح لا بالرسالة العامة وحدها', async () => {
    post(db, 'p14', '<p>نص</p>', ['linkedin']);
    replies['POST /posts'] = () => ({
      status: 400,
      body: {
        error: {
          code: 'validation.failed',
          message: 'post failed validation; fix the listed issues or set skip_validation',
          meta: { errors: [{ platform: 'tiktok', field: 'platform_data.tiktok.privacy_level', message: 'privacy_level is required' }] },
        },
      },
    });
    await runDuePublishes(env);
    expect(row(db, 'sch_p14_linkedin').error).toMatch(
      /post failed validation; fix the listed issues or set skip_validation — tiktok\.platform_data\.tiktok\.privacy_level: privacy_level is required/,
    );
  });

  it('القائمة بحقولها كما يردّها المزوّد فعلاً — بأوّلها كبيراً — والتحذير لا يُعدّ', () => {
    expect(validationIssues({
      error: {
        message: 'post failed validation; fix the listed issues or set skip_validation',
        meta: { issues: [
          { Type: 'error', Platform: 'tiktok', Field: 'privacy_level', Message: 'privacy level is required', Target: 'acc_tt', SegmentIndex: null },
          { Type: 'warning', Platform: 'tiktok', Field: 'text', Message: 'consider hashtags', Target: 'acc_tt', SegmentIndex: null },
        ] },
      },
    })).toBe('tiktok.privacy_level: privacy level is required');
  });

  it('القائمة تُقرأ أينما وقعت في الجسم، وإلا أُلحق meta خاماً', () => {
    expect(validationIssues({
      error: { message: 'post failed validation', meta: { targets: { acc_tt: { errors: [{ field: 'media', message: 'image/png not supported' }] } } } },
    })).toBe('media: image/png not supported');
    expect(validationIssues({ error: { message: 'post failed validation', meta: { tiktok: 'privacy_level required' } } }))
      .toBe('{"tiktok":"privacy_level required"}');
    expect(validationIssues({ error: { message: 'Account not found' } })).toBe('');
  });

  it('تيك توك: الخصوصية العامة من خيارات الحساب، ومنشور الصور «photo»', async () => {
    withTwoImages('med_6', 'med_6b', 'p15', 'tiktok');
    let sent: any = null;
    replies['GET /accounts/acc_tt/creator-info'] = () => ({
      body: { platform: 'tiktok', can_post: true, privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] },
    });
    replies['GET /media/upload-url'] = () => ({ body: { media_id: 'm6', upload_url: 'https://storage.example/put/m6' } });
    replies['PUT /put/m6'] = () => ({ body: {} });
    replies['POST /media/m6/verify'] = () => ({ body: { success: true } });
    replies['POST /posts'] = (_u, init) => {
      sent = JSON.parse(String(init?.body));
      return { status: 201, body: { id: 'post_tt', status: 'publishing', targets: [{ status: 'publishing' }] } };
    };
    await runDuePublishes(env);
    expect(sent.platform_data).toEqual({ tiktok: { privacy_level: 'PUBLIC_TO_EVERYONE', media_type: 'photo' } });
    // الإعداد قبل الرفع: ما يُرفض فيه لا يُستهلك فيه رفع
    expect(calls[0]).toBe('GET /accounts/acc_tt/creator-info');
    expect(row(db, 'sch_p15_tiktok')).toMatchObject({ status: 'processing', provider_post_id: 'post_tt' });
  });

  it('تيك توك بلا خيارٍ عامّ يُقال بخياراته ولا يُختار غيره عنه', async () => {
    withTwoImages('med_7', 'med_7b', 'p16', 'tiktok');
    replies['GET /accounts/acc_tt/creator-info'] = () => ({
      body: { data: { can_post: true, privacy_level_options: ['MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] } },
    });
    await runDuePublishes(env);
    expect(row(db, 'sch_p16_tiktok').error).toMatch(/لا يسمح بالنشر العامّ\. المتاح: MUTUAL_FOLLOW_FRIENDS، SELF_ONLY/);
    expect(calls).toEqual(['GET /accounts/acc_tt/creator-info']);
  });

  it('إنستغرام: أكثر من وسيطٍ دوّارة، والمقطع ريلز', () => {
    expect(instagramContentType(['image', 'image'])).toBe('carousel');
    expect(instagramContentType(['video'])).toBe('reel');
    expect(instagramContentType(['image'])).toBe('feed');
  });

  it('رفضُ الوجهة في ٤٢٢ يُكتب بسببه لا بنصّ الطلب العامّ', async () => {
    post(db, 'p6', '<p>نص</p>', ['x']);
    replies['POST /posts'] = () => ({
      status: 422,
      body: { id: 'post_3', status: 'failed', targets: [{ account_id: 'acc_x', status: 'failed', error: { message: 'Text exceeds 280 characters' } }] },
    });
    const r = await publishPostNow(env, 'p6');
    expect(r.failed).toBe(1);
    expect(r.errors).toEqual([{ platform: 'x', error: 'فشل النشر عبر SocialAPI: Text exceeds 280 characters' }]);
    expect(db.prepare("SELECT status FROM content_posts WHERE id = 'p6'").get().status).toBe('scheduled');
  });

  it('القبول يبقى «قيد النشر» حتى يؤكّده المزوّد أو يرفضه', async () => {
    post(db, 'p7', '<p>نص</p>', ['linkedin', 'x']);
    replies['POST /posts'] = (_u, init) => {
      const acc = JSON.parse(String(init?.body)).targets[0].account_id;
      return { status: 201, body: { id: `post_${acc}`, status: 'publishing', targets: [{ account_id: acc, status: 'publishing' }] } };
    };
    const r = await runDuePublishes(env);
    expect(r).toMatchObject({ published: 0, failed: 0, pending: 2 });
    expect(row(db, 'sch_p7_linkedin')).toMatchObject({ status: 'processing', provider_post_id: 'post_acc_li' });

    replies['GET /posts/post_acc_li'] = () => ({ body: { id: 'post_acc_li', targets: [{ status: 'published' }] } });
    replies['GET /posts/post_acc_x'] = () => ({ body: { id: 'post_acc_x', targets: [{ status: 'failed', error: { message: 'Duplicate content' } }] } });
    const c = await reconcilePublishing(env);
    expect(c).toEqual({ published: 1, failed: 1 });
    expect(row(db, 'sch_p7_linkedin').status).toBe('published');
    expect(row(db, 'sch_p7_x')).toMatchObject({ status: 'failed', error: 'فشل النشر عبر المزوّد: Duplicate content' });
    // منصةٌ رُفضت فلا يصير المحتوى «منشوراً»
    expect(db.prepare("SELECT status FROM content_posts WHERE id = 'p7'").get().status).toBe('scheduled');
  });

  it('ما لم يؤكّده المزوّد خلال ساعة يُعدّ فاشلاً بسببٍ يطلب التحقق', async () => {
    post(db, 'p8', '<p>نص</p>', ['linkedin']);
    const old = new Date(Date.now() - CONFIRM_WITHIN_MS - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    db.prepare("UPDATE schedules SET status = 'processing', provider_post_id = 'post_slow', published_at = ? WHERE id = 'sch_p8_linkedin'").run(old);
    replies['GET /posts/post_slow'] = () => ({ body: { id: 'post_slow', status: 'publishing' } });
    await reconcilePublishing(env);
    expect(row(db, 'sch_p8_linkedin')).toMatchObject({ status: 'failed' });
    expect(row(db, 'sch_p8_linkedin').error).toMatch(/لم يؤكّد المزوّد/);
  });

  it('مزوّدٌ لا يُعلن حالاً يُعدّ منشوره منشوراً كما كان', async () => {
    post(db, 'p9', '<p>نص</p>', ['linkedin']);
    db.prepare("UPDATE schedules SET status = 'processing', provider_post_id = 'post_old', published_at = ? WHERE id = 'sch_p9_linkedin'").run(PAST);
    // GET /posts/post_old → 404 من المخنوق
    await reconcilePublishing(env);
    expect(row(db, 'sch_p9_linkedin').status).toBe('published');
  });
});

describe('الجدول الذي انقطع عامله', () => {
  it('يُعدّ فاشلاً فيُعاد أو يُلغى، والحديث منه لا يُمسّ', async () => {
    post(db, 'p10', '<p>نص</p>', ['linkedin', 'x']);
    db.prepare("UPDATE schedules SET status = 'processing', published_at = NULL WHERE id = 'sch_p10_linkedin'").run();
    db.prepare("UPDATE schedules SET status = 'processing', published_at = ? WHERE id = 'sch_p10_x'")
      .run(new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    const r = await reconcilePublishing(env);
    expect(r.failed).toBe(1);
    expect(row(db, 'sch_p10_linkedin')).toMatchObject({ status: 'failed' });
    expect(row(db, 'sch_p10_linkedin').error).toMatch(/انقطع النشر/);
    expect(row(db, 'sch_p10_x').status).toBe('processing');
    expect(calls).toEqual([]);
  });
});
