// النشر عبر Ayrshare على قاعدةٍ حقيقية ومزوّدٍ مخنوق.
//
// الأشكال هنا من صفحات التوثيق نفسها (https://www.ayrshare.com/docs):
// ردّ `POST /post` بـ `postIds` و`errors`، وتغليفه في `posts` مع ملفّ مستخدم،
// ومعرّف تيك توك `"pending"` حتى يعالج المقطع، والرابط الموقَّع للرفع.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

vi.mock('../src/services/notify', () => ({ notifyPublishFailed: vi.fn(async () => {}) }));

import { runDuePublishes, reconcilePublishing } from '../src/services/publish';
import { ayrsharePlatform, ayrshareOutcome, ayrshareMediaIssues } from '../src/adapters/ayrshare';

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
  db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES (?, 'عنوان المقطع', ?, 'scheduled', 'u1')").run(id, body);
  for (const p of platforms) {
    db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status) VALUES (?, ?, ?, ?, 'pending')")
      .run(`sch_${id}_${p}`, id, p, PAST);
  }
}

const row = (db: any, id: string) => db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);

type Call = { key: string; headers: Record<string, string>; body: any };
type Reply = { status?: number; body: unknown };
let replies: Record<string, (url: URL, init?: RequestInit) => Reply>;
let calls: Call[];
let db: any;
let env: any;

const STORAGE = 'https://storage.googleapis.com/ayr/upload-1';

beforeEach(() => {
  db = build();
  const media = new Map<string, ArrayBuffer>();
  env = {
    DB: d1(db),
    AYRSHARE_API_KEY: 'ayr_key_test',
    AYRSHARE_X_API_KEY: 'x_key',
    AYRSHARE_X_API_SECRET: 'x_secret',
    MEDIA: {
      head: async (k: string) => (media.has(k) ? { size: media.get(k)!.byteLength } : null),
      get: async (k: string) => (media.has(k) ? { body: new Blob([media.get(k)!]).stream() } : null),
      _put: (k: string) => media.set(k, new TextEncoder().encode('VIDEODATA').buffer),
    },
  };
  replies = {};
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.origin === 'https://api.ayrshare.com' ? url.pathname.replace(/^\/api/, '') : url.href.split('?')[0];
    const key = `${(init?.method || 'GET').toUpperCase()} ${path}`;
    let body: any = init?.body;
    if (body instanceof ReadableStream) body = await new Response(body).text();
    else if (body instanceof ArrayBuffer) body = new TextDecoder().decode(body);
    try { body = typeof body === 'string' && body.startsWith('{') ? JSON.parse(body) : body; } catch { /* نصّ */ }
    calls.push({ key, headers: { ...(init?.headers as Record<string, string>) }, body });
    const r = replies[key]?.(url, init) ?? { status: 404, body: { status: 'error', code: 101, message: 'not found' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('أسماء المنصات لدى Ayrshare', () => {
  it('إكس twitter، والملف التجاري gmb، ولينكدإن واحد', () => {
    expect(ayrsharePlatform('x')).toBe('twitter');
    expect(ayrsharePlatform('google')).toBe('gmb');
    expect(ayrsharePlatform('linkedin_page')).toBe('linkedin');
    expect(ayrsharePlatform('instagram')).toBe('instagram');
  });
});

describe('حال النشر من ردّ Ayrshare', () => {
  it('النجاح والرفض بسببه والانتظار', () => {
    expect(ayrshareOutcome({ status: 'success', errors: [], postIds: [{ status: 'success', id: '1', platform: 'twitter' }], id: 'A1' }))
      .toEqual({ state: 'published' });
    expect(ayrshareOutcome({
      status: 'error',
      errors: [{ action: 'post', status: 'error', code: 110, message: 'Status is a duplicate.', platform: 'twitter' }],
      postIds: [],
      id: 'A2',
    })).toEqual({ state: 'failed', error: 'twitter: Status is a duplicate.' });
    // تيك توك يعالج المقطع: معرّفه "pending" حتى ينتهي
    expect(ayrshareOutcome({ status: 'success', errors: [], postIds: [{ status: 'success', id: 'pending', platform: 'tiktok' }], id: 'A3' }))
      .toEqual({ state: 'pending' });
    expect(ayrshareOutcome({ status: 'scheduled', id: 'A4' })).toEqual({ state: 'published' });
    expect(ayrshareOutcome({ id: 'A5' })).toBeNull();
  });

  it('يقرأ الردّ المغلّف في posts كما يردّه ملفّ المستخدم', () => {
    expect(ayrshareOutcome({ status: 'error', posts: [{ status: 'error', errors: [{ code: 156, message: 'Instagram is not linked.', platform: 'instagram' }], postIds: [] }] }))
      .toEqual({ state: 'failed', error: 'instagram: Instagram is not linked.' });
  });
});

describe('النشر عبر Ayrshare', () => {
  it('يرفع المقطع برابطٍ موقَّع وينشره بالرابط العامّ وعنوانه وظهوره', async () => {
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename) VALUES ('vid_1', 'k/vid_1', 'video/mp4', 'clip')").run();
    env.MEDIA._put('k/vid_1');
    post(db, 'p1', '<p>وصف المقطع</p><img src="/api/media/vid_1">', ['youtube']);

    replies['GET /media/uploadUrl'] = () => ({
      body: { accessUrl: 'https://media.ayrshare.com/x/clip.mp4', contentType: 'video/mp4', uploadUrl: STORAGE },
    });
    replies[`PUT ${STORAGE}`] = () => ({ body: {} });
    replies['POST /post'] = () => ({
      body: { status: 'success', errors: [], postIds: [{ status: 'success', id: 'yt1', platform: 'youtube' }], id: 'AYR_1' },
    });

    const r = await runDuePublishes(env);
    expect(r).toMatchObject({ published: 1, failed: 0 });
    expect(row(db, 'sch_p1_youtube')).toMatchObject({ status: 'published', provider_post_id: 'AYR_1' });

    const ask = calls.find((c) => c.key === 'GET /media/uploadUrl')!;
    expect(ask.headers.authorization).toBe('Bearer ayr_key_test');
    const put = calls.find((c) => c.key === `PUT ${STORAGE}`)!;
    expect(put.headers['content-type']).toBe('video/mp4');
    expect(put.headers.authorization).toBeUndefined();
    expect(put.body).toBe('VIDEODATA');

    const sent = calls.find((c) => c.key === 'POST /post')!.body;
    expect(sent).toMatchObject({
      post: 'وصف المقطع',
      platforms: ['youtube'],
      mediaUrls: ['https://media.ayrshare.com/x/clip.mp4'],
      isVideo: true,
      youTubeOptions: { title: 'عنوان المقطع', visibility: 'public' },
    });
  });

  it('يسمّي إكس twitter ويرسل مفتاحَي تطبيقه، ويحوّل التعليق الأول', async () => {
    post(db, 'p2', '<p>نص</p>', ['x']);
    db.prepare("INSERT INTO post_variants (id, post_id, platform, first_comment) VALUES ('v1', 'p2', 'x', 'الرابط في التعليق')").run();
    replies['POST /post'] = () => ({
      body: { status: 'success', errors: [], postIds: [{ status: 'success', id: '9', platform: 'twitter' }], id: 'AYR_2' },
    });

    await runDuePublishes(env);
    const call = calls.find((c) => c.key === 'POST /post')!;
    expect(call.body).toMatchObject({ platforms: ['twitter'], firstComment: { comment: 'الرابط في التعليق' } });
    expect(call.headers['X-Twitter-OAuth1-Api-Key']).toBe('x_key');
    expect(call.headers['X-Twitter-OAuth1-Api-Secret']).toBe('x_secret');
    expect(row(db, 'sch_p2_x')).toMatchObject({ status: 'published' });
  });

  it('إكس بلا مفتاحَي التطبيق يُرفض قبل أيّ طلب بسببٍ يقول ما يُضبط', async () => {
    delete env.AYRSHARE_X_API_KEY;
    post(db, 'p3', '<p>نص</p>', ['x']);
    const r = await runDuePublishes(env);
    expect(r.failed).toBe(1);
    expect(row(db, 'sch_p3_x').error).toMatch(/AYRSHARE_X_API_KEY/);
    expect(calls).toEqual([]);
  });

  it('صورةٌ أكبر من حدّ المنصة تُرفض قبل رفعها بسببٍ عربيّ', async () => {
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename) VALUES ('img_1', 'k/img_1', 'image/png', 'cover.png')").run();
    const bytes = new Uint8Array(9 * 1048576);
    env.MEDIA.head = async () => ({ size: bytes.byteLength });
    env.MEDIA.get = async () => ({ body: new Blob([bytes]).stream() });
    post(db, 'p9', '<p>نص</p><img src="/api/media/img_1">', ['instagram', 'x', 'facebook']);
    replies['POST /post'] = () => ({
      body: { status: 'success', errors: [], postIds: [{ status: 'success', id: '1', platform: 'facebook' }], id: 'AYR_9' },
    });
    replies['GET /media/uploadUrl'] = () => ({
      body: { accessUrl: 'https://media.ayrshare.com/x/cover.png', contentType: 'image/png', uploadUrl: STORAGE },
    });
    replies[`PUT ${STORAGE}`] = () => ({ body: {} });

    await runDuePublishes(env);
    expect(row(db, 'sch_p9_instagram')).toMatchObject({ status: 'failed' });
    expect(row(db, 'sch_p9_instagram').error).toMatch(/9\.0 ميغابايت.*8\.0 ميغابايت/);
    expect(row(db, 'sch_p9_x').error).toMatch(/5\.0 ميغابايت/);
    // حدّ فيسبوك ١٠ ميغابايت: تُرفع وتُنشر
    expect(row(db, 'sch_p9_facebook')).toMatchObject({ status: 'published' });
    expect(calls.filter((c) => c.key === 'GET /media/uploadUrl')).toHaveLength(1);
    expect(calls.filter((c) => c.key === 'POST /post')).toHaveLength(1);
  });

  it('مع ربط Images تُضغط الصورة لمنصةٍ تجاوزت حدّها، والأصل يُرسل لمن يقبله', async () => {
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename) VALUES ('img_2', 'k/img_2', 'image/png', 'cover.png')").run();
    const bytes = new Uint8Array(9 * 1048576);
    env.MEDIA.head = async () => ({ size: bytes.byteLength });
    env.MEDIA.get = async () => ({ body: new Blob([bytes]).stream() });
    env.IMAGES = {
      // أبعادٌ تحت أطول ضلعٍ للمنصتين، فلا يُصغَّر شيء — الحجم وحده يُضغط
      info: async () => ({ format: 'image/png', fileSize: bytes.byteLength, width: 1400, height: 1050 }),
      input: () => {
        const t: any = {
          transform: () => t,
          // حجم JPEG يتبع الجودة: ٩٠ ألف بايت لكل درجة
          output: async (o: { quality: number }) => ({ image: () => new Blob([new Uint8Array(o.quality * 90_000)]).stream() }),
        };
        return t;
      },
    };
    post(db, 'p10', '<p>نص</p><img src="/api/media/img_2">', ['instagram', 'facebook']);
    replies['GET /media/uploadUrl'] = (url) => ({
      body: { accessUrl: `https://media.ayrshare.com/x/${url.searchParams.get('fileName')}`, uploadUrl: STORAGE },
    });
    replies[`PUT ${STORAGE}`] = () => ({ body: {} });
    replies['POST /post'] = () => ({
      body: { status: 'success', errors: [], postIds: [{ status: 'success', id: '1', platform: 'x' }], id: 'AYR_10' },
    });

    await runDuePublishes(env);
    expect(row(db, 'sch_p10_instagram')).toMatchObject({ status: 'published', error: null });
    expect(row(db, 'sch_p10_facebook')).toMatchObject({ status: 'published' });

    const asks = calls.filter((c) => c.key === 'GET /media/uploadUrl');
    const puts = calls.filter((c) => c.key === `PUT ${STORAGE}`);
    // إنستغرام (حدّه ٨): نسخة JPEG تحت الحدّ. فيسبوك (حدّه ١٠): الأصل كما هو
    const igPut = puts.find((c) => c.headers['content-type'] === 'image/jpeg')!;
    expect(igPut.body.length).toBeLessThanOrEqual(8 * 1048576);
    expect(igPut.body.length).toBe(93 * 90_000);
    expect(puts.find((c) => c.headers['content-type'] === 'image/png')!.body.length).toBe(bytes.byteLength);
    expect(asks.map((c) => c.key)).toHaveLength(2);
    const sent = calls.filter((c) => c.key === 'POST /post').map((c) => c.body.mediaUrls[0]);
    expect(sent).toEqual(expect.arrayContaining(['https://media.ayrshare.com/x/cover.jpg', 'https://media.ayrshare.com/x/cover.png']));
  });

  it('الفحص المسبق يقول حدّ كل منصة ولا يحكم بما لا يُعرف حدّه', () => {
    const img = { filename: 'a.jpg', mimeType: 'image/jpeg', size: 6 * 1048576 };
    expect(ayrshareMediaIssues({ platforms: ['x'], text: '', media: [img] } as any)).toHaveLength(1);
    expect(ayrshareMediaIssues({ platforms: ['facebook'], text: '', media: [img] } as any)).toEqual([]);
    expect(ayrshareMediaIssues({ platforms: ['google'], text: '', media: [img] } as any)).toEqual([]);
    const clip = { filename: 'c.mp4', mimeType: 'video/mp4', size: 90 * 1048576 };
    expect(ayrshareMediaIssues({ platforms: ['x'], text: '', media: [clip] } as any)).toEqual([]);
  });

  it('الرفض يُكتب بسبب المنصة من errors لا برمز الحالة', async () => {
    post(db, 'p4', '<p>نص</p>', ['linkedin']);
    replies['POST /post'] = () => ({
      status: 400,
      body: {
        status: 'error',
        errors: [{ action: 'post', status: 'error', code: 156, message: 'Linkedin is not linked.', platform: 'linkedin' }],
        postIds: [],
        id: 'AYR_4',
      },
    });
    await runDuePublishes(env);
    expect(row(db, 'sch_p4_linkedin')).toMatchObject({ status: 'failed' });
    expect(row(db, 'sch_p4_linkedin').error).toBe('فشل النشر عبر Ayrshare: linkedin: Linkedin is not linked.');
  });

  it('رمز 419 يقول إن إكس يشترط مفتاحَي التطبيق', async () => {
    post(db, 'p5', '<p>نص</p>', ['x']);
    replies['POST /post'] = () => ({ status: 400, body: { status: 'error', code: 419, message: 'x_credentials_required' } });
    await runDuePublishes(env);
    expect(row(db, 'sch_p5_x').error).toMatch(/مفتاحَي تطبيق المطوّر/);
  });

  it('تيك توك ينتظر المعالجة ثم يُحسم من GET /post/:id', async () => {
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename) VALUES ('vid_2', 'k/vid_2', 'video/mp4', 'v.mp4')").run();
    env.MEDIA._put('k/vid_2');
    post(db, 'p6', '<p>نص</p><img src="/api/media/vid_2">', ['tiktok']);
    replies['GET /media/uploadUrl'] = () => ({
      body: { accessUrl: 'https://media.ayrshare.com/x/v.mp4', contentType: 'video/mp4', uploadUrl: STORAGE },
    });
    replies[`PUT ${STORAGE}`] = () => ({ body: {} });
    replies['POST /post'] = () => ({
      body: { status: 'success', errors: [], postIds: [{ status: 'success', id: 'pending', idShare: 'v_pub', platform: 'tiktok' }], id: 'AYR_6' },
    });

    const r = await runDuePublishes(env);
    expect(r.pending).toBe(1);
    expect(row(db, 'sch_p6_tiktok')).toMatchObject({ status: 'processing', provider_post_id: 'AYR_6' });
    expect(calls.find((c) => c.key === 'POST /post')!.body.tikTokOptions).toEqual({ visibility: 'public' });

    replies['GET /post/AYR_6'] = () => ({
      body: { status: 'success', errors: [], id: 'AYR_6', postIds: [{ status: 'success', id: '7484', platform: 'tiktok' }] },
    });
    const rec = await reconcilePublishing(env);
    expect(rec.published).toBe(1);
    expect(row(db, 'sch_p6_tiktok')).toMatchObject({ status: 'published' });
  });
});

describe('المقطع بارزاً عبر Ayrshare', () => {
  const ok = (id: string) => () => ({ body: { status: 'success', errors: [], postIds: [{ status: 'success', id }], id } });

  function video(id: string, w: number, h: number, ms: number): void {
    db.prepare('INSERT INTO media_assets (id, r2_key, mime_type, filename, width, height, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, `k/${id}`, 'video/mp4', `${id}.mp4`, w, h, ms);
    env.MEDIA._put(`k/${id}`);
  }

  beforeEach(() => {
    replies['GET /media/uploadUrl'] = (url) => ({
      body: { accessUrl: `https://media.ayrshare.com/${url.searchParams.get('fileName')}`, uploadUrl: STORAGE },
    });
    replies[`PUT ${STORAGE}`] = () => ({ body: {} });
  });

  const sent = () => calls.filter((c) => c.key === 'POST /post').map((c) => c.body);

  it('إنستغرام: ريلز يظهر في الخلاصة والريلز معاً', async () => {
    video('v_ig', 1080, 1920, 30_000);
    post(db, 'r1', '<p>نص</p><img src="/api/media/v_ig">', ['instagram']);
    replies['POST /post'] = ok('A1');
    await runDuePublishes(env);
    expect(sent()[0]).toMatchObject({ isVideo: true, instagramOptions: { shareReelsFeed: true } });
  });

  it('فيسبوك: الطوليّ حتى ٩٠ ثانية ريلز، والأفقيّ فيديو عادي', async () => {
    video('v_fb', 1080, 1920, 45_000);
    video('v_wide', 1920, 1080, 45_000);
    post(db, 'r2', '<img src="/api/media/v_fb">', ['facebook']);
    post(db, 'r3', '<img src="/api/media/v_wide">', ['facebook']);
    replies['POST /post'] = ok('A2');
    await runDuePublishes(env);
    const [reel, plain] = sent();
    expect(reel.faceBookOptions).toEqual({ reels: true });
    expect(plain.faceBookOptions).toBeUndefined();
  });

  it('يوتيوب: الطوليّ حتى ثلاث دقائق شورتس', async () => {
    video('v_yt', 1080, 1920, 60_000);
    post(db, 'r4', '<img src="/api/media/v_yt">', ['youtube']);
    replies['POST /post'] = ok('A3');
    await runDuePublishes(env);
    expect(sent()[0].youTubeOptions).toMatchObject({ shorts: true, visibility: 'public' });
  });

  it('سناب: المقطع سبوتلايت وقصة محفوظة وقصة — والمعرّفات كلها محفوظة', async () => {
    video('v_sc', 1080, 1920, 20_000);
    post(db, 'r5', '<img src="/api/media/v_sc">', ['snapchat']);
    let n = 0;
    replies['POST /post'] = () => ok(`S${++n}`)();
    await runDuePublishes(env);
    expect(sent().map((b) => b.snapChatOptions)).toEqual([{ spotlight: true }, { savedStory: true }, undefined]);
    // الوسيط يُرفع مرّةً واحدة للنشرات الثلاث
    expect(calls.filter((c) => c.key === 'GET /media/uploadUrl')).toHaveLength(1);
    expect(row(db, 'sch_r5_snapchat')).toMatchObject({ status: 'published', provider_post_id: 'S1', error: null });
    expect(JSON.parse(row(db, 'sch_r5_snapchat').extra_provider_ids)).toEqual(['S2', 'S3']);
  });

  it('سناب: الصورة قصة محفوظة وقصة، وما فشل منها يُكتب تحت الموعد المنشور', async () => {
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename, width, height) VALUES ('i_sc', 'k/i_sc', 'image/jpeg', 'a.jpg', 1080, 1920)").run();
    env.MEDIA._put('k/i_sc');
    post(db, 'r6', '<img src="/api/media/i_sc">', ['snapchat']);
    replies['POST /post'] = (_u, init) => {
      const b = JSON.parse(String(init?.body));
      return b.snapChatOptions?.savedStory
        ? { status: 400, body: { status: 'error', errors: [{ code: 300, message: 'Public profile required', platform: 'snapchat' }] } }
        : ok('S9')();
    };
    await runDuePublishes(env);
    expect(sent().map((b) => b.snapChatOptions)).toEqual([{ savedStory: true }, undefined]);
    const r = row(db, 'sch_r6_snapchat');
    expect(r).toMatchObject({ status: 'published', provider_post_id: 'S9' });
    expect(r.error).toMatch(/لم يُنشر على سناب: القصة المحفوظة: .*Public profile required/);
  });

  it('سناب: إن فشلت كلها فشل الموعد بأسبابها', async () => {
    video('v_sc2', 1080, 1920, 20_000);
    post(db, 'r7', '<img src="/api/media/v_sc2">', ['snapchat']);
    replies['POST /post'] = () => ({ status: 400, body: { status: 'error', errors: [{ code: 1, message: 'nope', platform: 'snapchat' }] } });
    await runDuePublishes(env);
    const r = row(db, 'sch_r7_snapchat');
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/سبوتلايت: .*nope.* · القصة المحفوظة: .* · القصة: /);
  });

  it('الغلاف يُرفع ويُرسل thumbNail، وشورتس بلا غلاف', async () => {
    video('v_li', 1920, 1080, 30_000);
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename) VALUES ('c_1', 'k/c_1', 'image/jpeg', 'cover.jpg')").run();
    env.MEDIA._put('k/c_1');
    post(db, 'r8', '<img src="/api/media/v_li">', ['linkedin', 'x']);
    db.prepare("UPDATE content_posts SET video_cover_id = 'c_1' WHERE id = 'r8'").run();
    video('v_short', 1080, 1920, 30_000);
    post(db, 'r9', '<img src="/api/media/v_short">', ['youtube']);
    db.prepare("UPDATE content_posts SET video_cover_id = 'c_1' WHERE id = 'r9'").run();
    replies['POST /post'] = ok('A9');
    await runDuePublishes(env);
    const bodies = sent();
    const li = bodies.find((b) => b.platforms[0] === 'linkedin');
    const x = bodies.find((b) => b.platforms[0] === 'twitter');
    const yt = bodies.find((b) => b.platforms[0] === 'youtube');
    expect(li.linkedInOptions).toEqual({ thumbNail: 'https://media.ayrshare.com/cover.jpg' });
    expect(x.twitterOptions).toEqual({ thumbNail: 'https://media.ayrshare.com/cover.jpg' });
    expect(yt.youTubeOptions.shorts).toBe(true);
    expect(yt.youTubeOptions.thumbNail).toBeUndefined();
  });

  it('مدّةٌ خارج حدّ المنصة تُرفض قبل الرفع بنصٍّ يقول ما يُفعل', async () => {
    video('v_long', 1080, 1920, 90_000);
    post(db, 'r10', '<img src="/api/media/v_long">', ['snapchat']);
    await runDuePublishes(env);
    expect(row(db, 'sch_r10_snapchat').error).toMatch(/أطول من حدّ هذه المنصة \(60 ثانية/);
    expect(calls).toEqual([]);
  });
});

describe('لينكدإن «قيد النشر» وهو منشور', () => {
  const TEXT = 'تعلن شركة ناف للمحاماة عن إطلاق خدمة الاستشارات القانونية للشركات الناشئة';
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  function waiting(id: string, sentMinAgo: number): void {
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES (?, 'ع', ?, 'scheduled', 'u1')").run(id, `<p>${TEXT}</p>`);
    db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status, provider_post_id, published_at) VALUES (?, ?, 'linkedin_page', ?, 'processing', ?, ?)")
      .run(`sch_${id}`, id, PAST, `AYR_${id}`, ago(sentMinAgo));
  }

  it('وجهةٌ حيّة تُعدّ منشوراً ولو بقي أعلى الردّ pending — وتيك توك بمعرّف pending ينتظر', () => {
    expect(ayrshareOutcome({ status: 'pending', id: 'A', postIds: [{ status: 'success', id: 'urn:li:share:7381', platform: 'linkedin' }] }))
      .toEqual({ state: 'published' });
    expect(ayrshareOutcome({ status: 'pending', id: 'A', postIds: [{ platform: 'linkedin', postUrl: 'https://www.linkedin.com/feed/update/urn:li:share:1' }] }))
      .toEqual({ state: 'published' });
    expect(ayrshareOutcome({ status: 'success', id: 'A', postIds: [{ status: 'success', id: 'pending', platform: 'tiktok' }] }))
      .toEqual({ state: 'pending' });
    expect(ayrshareOutcome({ status: 'pending', id: 'A' })).toEqual({ state: 'pending' });
  });

  it('pending بعد خمس دقائق: منشورٌ بالنصّ نفسه في سجلّ لينكدإن يحسمه منشوراً', async () => {
    waiting('L1', 12);
    replies['GET /post/AYR_L1'] = () => ({ body: { status: 'pending', id: 'AYR_L1' } });
    replies['GET /history/linkedin'] = () => ({
      body: { posts: [{ id: 'urn:li:share:99', post: `${TEXT}\n\n#ناف`, created: ago(10), postUrl: 'https://www.linkedin.com/feed/update/urn:li:share:99' }] },
    });
    const r = await reconcilePublishing(env);
    expect(r.published).toBe(1);
    expect(row(db, 'sch_L1')).toMatchObject({ status: 'published', error: null });
  });

  it('نصٌّ لا يطابق، أو منشورٌ أقدم من الإرسال، يُبقيه قيد النشر', async () => {
    waiting('L2', 12);
    replies['GET /post/AYR_L2'] = () => ({ body: { status: 'pending', id: 'AYR_L2' } });
    replies['GET /history/linkedin'] = () => ({
      body: { posts: [
        { id: 'urn:li:share:1', post: 'منشورٌ آخر لا علاقة له بهذا الموعد إطلاقاً', created: ago(5) },
        { id: 'urn:li:share:2', post: TEXT, created: ago(120) },
      ] },
    });
    await reconcilePublishing(env);
    expect(row(db, 'sch_L2').status).toBe('processing');
  });

  it('قبل خمس دقائق لا يُسأل سجلّ المنصة', async () => {
    waiting('L3', 2);
    replies['GET /post/AYR_L3'] = () => ({ body: { status: 'pending', id: 'AYR_L3' } });
    await reconcilePublishing(env);
    expect(row(db, 'sch_L3').status).toBe('processing');
    expect(calls.some((c) => c.key.startsWith('GET /history'))).toBe(false);
  });
});

describe('«تعثّرٌ يُعاد» ولينكدإن نشر', () => {
  const TEXT = 'تعلن شركة ناف للمحاماة عن إطلاق خدمة الاستشارات القانونية للشركات الناشئة';
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const retryable = (id?: string) => ({
    status: 'error',
    errors: [{ action: 'post', status: 'error', code: 108, message: 'LinkedIn Error: please try again', retryAvailable: true, platform: 'linkedin' }],
    postIds: [],
    ...(id ? { id } : {}),
  });

  function sent(id: string, sentMinAgo: number): void {
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES (?, 'ع', ?, 'scheduled', 'u1')").run(id, `<p>${TEXT}</p>`);
    db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status, provider_post_id, published_at, publish_key) VALUES (?, ?, 'linkedin_page', ?, 'processing', ?, ?, 'pub_k')")
      .run(`sch_${id}`, id, PAST, `AYR_${id}`, ago(sentMinAgo));
  }
  const onLinkedIn = (createdMinAgo: number) => () => ({
    body: { posts: [{ id: 'urn:li:share:7', post: TEXT, created: ago(createdMinAgo) }] },
  });

  it('بمعرّفٍ لدى Ayrshare لا يُكتب فاشلاً: يبقى قيد النشر بمعرّفه ومفتاحه', async () => {
    post(db, 'u1p', `<p>${TEXT}</p>`, ['linkedin_page']);
    replies['POST /post'] = () => ({ status: 400, body: retryable('AYR_U1') });
    const r = await runDuePublishes(env);
    expect(r).toMatchObject({ failed: 0, pending: 1 });
    expect(row(db, 'sch_u1p_linkedin_page')).toMatchObject({ status: 'processing', provider_post_id: 'AYR_U1', error: null });
    expect(row(db, 'sch_u1p_linkedin_page').publish_key).toBeTruthy();
  });

  it('وبلا معرّف، أو برفضٍ لا يُعاد، يفشل كما كان', async () => {
    post(db, 'u2p', `<p>${TEXT}</p>`, ['linkedin_page']);
    replies['POST /post'] = () => ({ status: 400, body: retryable() });
    await runDuePublishes(env);
    expect(row(db, 'sch_u2p_linkedin_page')).toMatchObject({ status: 'failed' });
    expect(row(db, 'sch_u2p_linkedin_page').error).toMatch(/تعثّرٌ مؤقت لدى المنصة/);

    post(db, 'u3p', `<p>${TEXT} ثانية</p>`, ['linkedin_page']);
    replies['POST /post'] = () => ({
      status: 400,
      body: { status: 'error', errors: [{ code: 110, message: 'Post too long', platform: 'linkedin' }], postIds: [], id: 'AYR_U3' },
    });
    await runDuePublishes(env);
    expect(row(db, 'sch_u3p_linkedin_page').status).toBe('failed');
  });

  it('سجلّ لينكدإن يحسمه منشوراً فوراً — بلا انتظار الدقائق الخمس', async () => {
    sent('R1', 2);
    replies['GET /post/AYR_R1'] = () => ({ body: { ...retryable('AYR_R1') } });
    replies['GET /history/linkedin'] = onLinkedIn(1);
    const r = await reconcilePublishing(env);
    expect(r.published).toBe(1);
    expect(row(db, 'sch_R1')).toMatchObject({ status: 'published', error: null, publish_key: null });
  });

  it('لم يظهر: يُمهَل ربع ساعة، ثم يفشل بسببه', async () => {
    sent('R2', 3);
    sent('R3', 20);
    replies['GET /post/AYR_R2'] = () => ({ body: retryable('AYR_R2') });
    replies['GET /post/AYR_R3'] = () => ({ body: retryable('AYR_R3') });
    replies['GET /history/linkedin'] = () => ({ body: { posts: [] } });
    await reconcilePublishing(env);
    expect(row(db, 'sch_R2').status).toBe('processing');
    expect(row(db, 'sch_R3')).toMatchObject({ status: 'failed' });
    expect(row(db, 'sch_R3').error).toMatch(/LinkedIn Error/);
  });

  it('ورفضٌ لا يُعاد يُسأل عنه السجلّ مرّةً ثم يفشل بلا مهلة', async () => {
    sent('R4', 3);
    replies['GET /post/AYR_R4'] = () => ({
      body: { status: 'error', errors: [{ code: 110, message: 'Post too long', platform: 'linkedin' }], id: 'AYR_R4' },
    });
    replies['GET /history/linkedin'] = () => ({ body: { posts: [] } });
    await reconcilePublishing(env);
    expect(row(db, 'sch_R4').status).toBe('failed');
  });
});

describe('ما كُتب فاشلاً بـ«تعثّرٍ مؤقت» وهو على لينكدإن', () => {
  const TEXT = 'تعلن شركة ناف للمحاماة عن إطلاق خدمة الاستشارات القانونية للشركات الناشئة';
  const recent = new Date(Date.now() - 2 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const ERR = 'فشل النشر عبر Ayrshare: LinkedIn Error. تعثّرٌ مؤقت لدى المنصة — أعد النشر بعد دقائق';

  function failedRow(id: string, body: string, error = ERR): void {
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES (?, 'ع', ?, 'scheduled', 'u1')").run(id, `<p>${body}</p>`);
    db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status, error) VALUES (?, ?, 'linkedin_page', ?, 'failed', ?)")
      .run(`sch_${id}`, id, recent, error);
  }

  it('يُكتب منشوراً ما وُجد بنصّه، ويبقى غيره — مرّةً واحدة', async () => {
    failedRow('F1', TEXT);
    failedRow('F2', 'منشورٌ آخر لم يصل لينكدإن قطّ ولا أثر له في سجلّه');
    failedRow('F3', TEXT, 'النص أطول من حدّ لينكدإن');
    const created = new Date(Date.parse(recent) + 3_600_000).toISOString();
    replies['GET /history/linkedin'] = () => ({ body: { posts: [{ id: 'urn:li:share:9', post: TEXT, created }] } });

    const r = await reconcilePublishing(env);
    expect(r.published).toBe(1);
    expect(row(db, 'sch_F1')).toMatchObject({ status: 'published', error: null, published_at: created });
    expect(row(db, 'sch_F2').status).toBe('failed');
    expect(row(db, 'sch_F3').status).toBe('failed');
    expect(db.prepare("SELECT status FROM content_posts WHERE id = 'F1'").get().status).toBe('published');

    const before = calls.length;
    await reconcilePublishing(env);
    expect(calls.length).toBe(before);
  });
});
