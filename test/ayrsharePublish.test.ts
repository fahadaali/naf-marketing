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
import { ayrsharePlatform, ayrshareOutcome } from '../src/adapters/ayrshare';

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
