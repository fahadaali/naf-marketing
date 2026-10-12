// وصفُ الوسيط — نصّه البديل ووسم الذكاء الاصطناعي — من حفظه إلى ما يُرسل لكل منصة.
//
// الحقول من صفحات المنصات في توثيق Ayrshare: `altText` مصفوفةٌ بترتيب الوسائط
// (لينكدإن وإنستغرام وإكس للصور، وفيسبوك للصورة والمقطع)، و`isAIGenerated`
// لإكس وإنستغرام وتيك توك (للمقطع)، و`containsSyntheticMedia` ليوتيوب.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

vi.mock('../src/services/notify', () => ({ notifyPublishFailed: vi.fn(async () => {}) }));

import { describeMedia } from '../src/adapters/ayrshare';
import { keepDescription, type PublishMedia } from '../src/adapters/provider';
import { runDuePublishes } from '../src/services/publish';
import { generateImageAsset } from '../src/services/mediaGen';
import { mediaRoutes } from '../src/routes/media';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

const img = (alt: string | null, ai = false): PublishMedia => ({ mimeType: 'image/jpeg', filename: 'a.jpg', alt, aiGenerated: ai });
const vid = (alt: string | null, ai = false): PublishMedia => ({ mimeType: 'video/mp4', filename: 'v.mp4', alt, aiGenerated: ai });

describe('وصف الوسائط لكل منصة', () => {
  it('النص البديل بترتيب الصور حتى أوّل صورةٍ بلا وصف', () => {
    expect(describeMedia('linkedin', [img('مكتب ناف'), img('فريق العمل')])).toEqual({ altText: ['مكتب ناف', 'فريق العمل'] });
    expect(describeMedia('instagram', [img('أ'), img(null), img('ج')])).toEqual({ altText: ['أ'] });
    expect(describeMedia('twitter', [img(null), img('ب')])).toEqual({});
  });

  it('المقطع: فيسبوك يقبل وصفه، وإكس لا يُرسل معه نصٌّ بديل فلا يسقط المقطع', () => {
    expect(describeMedia('facebook', [vid('مقطع تعريفي')])).toEqual({ altText: ['مقطع تعريفي'] });
    expect(describeMedia('twitter', [img('صورة'), vid('مقطع')])).toEqual({});
    expect(describeMedia('linkedin', [vid('مقطع')])).toEqual({});
    expect(describeMedia('instagram', [vid('ريلز')])).toEqual({});
  });

  it('الوسم حيث تعلنه المنصة، وتيك توك للمقطع وحده', () => {
    expect(describeMedia('twitter', [img(null, true)])).toEqual({ isAIGenerated: true });
    expect(describeMedia('instagram', [img(null), img(null, true)])).toEqual({ isAIGenerated: true });
    expect(describeMedia('tiktok', [img(null, true), img(null)])).toEqual({});
    expect(describeMedia('tiktok', [vid(null, true)])).toEqual({ isAIGenerated: true });
    expect(describeMedia('youtube', [vid(null, true)])).toEqual({ containsSyntheticMedia: true });
    expect(describeMedia('facebook', [img(null, true)])).toEqual({});
    expect(describeMedia('linkedin', [img(null, true)])).toEqual({});
  });

  it('الوصف يبقى مع الوسيط حين يُكيَّف أو يُضغط', () => {
    const from = img('وصف', true);
    const to: PublishMedia = { mimeType: 'image/jpeg', filename: 'a-frame.jpg', data: new ArrayBuffer(1) };
    expect(keepDescription(from, to)).toMatchObject({ filename: 'a-frame.jpg', alt: 'وصف', aiGenerated: true });
    expect(keepDescription(from, from)).toBe(from);
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
      put: async (k: string, v: Uint8Array | ArrayBuffer) => { stored.set(k, v instanceof Uint8Array ? v.buffer : v); },
    },
  };
  sent = [];
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
    return Response.json({ status: 'error', message: 'not found' }, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function asset(id: string, mime: string, alt: string | null, ai: number): void {
  db.prepare('INSERT INTO media_assets (id, r2_key, mime_type, filename, size, alt_text, ai_generated) VALUES (?, ?, ?, ?, 4, ?, ?)')
    .run(id, `k/${id}`, mime, `${id}.${mime.split('/')[1]}`, alt, ai);
  env.MEDIA.put(`k/${id}`, new TextEncoder().encode('DATA'));
}

describe('النشر بوصف الوسائط', () => {
  it('لينكدإن ينال النص البديل، وإكس الوسم — من الوسيط المحفوظ', async () => {
    asset('m1', 'image/jpeg', 'شعار ناف على واجهة المكتب', 1);
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES ('p1', 'ع', '<p>نص</p><img src=\"/api/media/m1\">', 'scheduled', 'gm')").run();
    for (const p of ['linkedin', 'x']) {
      db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status) VALUES (?, 'p1', ?, '2026-01-01T09:00:00Z', 'pending')")
        .run(`s_${p}`, p);
    }
    await runDuePublishes(env);
    const li = sent.find((b) => b.platforms[0] === 'linkedin');
    const x = sent.find((b) => b.platforms[0] === 'twitter');
    expect(li.linkedInOptions).toEqual({ altText: ['شعار ناف على واجهة المكتب'] });
    expect(x.twitterOptions).toEqual({ altText: ['شعار ناف على واجهة المكتب'], isAIGenerated: true });
  });

  it('المقطع المصنوع لتيك توك من صورةٍ مولَّدة يُوسم كصورته', async () => {
    asset('i1', 'image/jpeg', null, 1);
    asset('v1', 'video/mp4', null, 0);
    db.prepare("INSERT INTO content_posts (id, title, body, status, author_id) VALUES ('p2', 'ع', '<p>نص</p><img src=\"/api/media/i1\">', 'scheduled', 'gm')").run();
    db.prepare("INSERT INTO post_variants (id, post_id, platform, generated_media_id, generated_from_id) VALUES ('pv', 'p2', 'tiktok', 'v1', 'i1')").run();
    db.prepare("INSERT INTO schedules (id, post_id, platform, scheduled_at, status) VALUES ('s_tt', 'p2', 'tiktok', '2026-01-01T09:00:00Z', 'pending')").run();
    await runDuePublishes(env);
    expect(sent[0].tikTokOptions).toMatchObject({ visibility: 'public', isAIGenerated: true });
  });
});

describe('حفظ الوصف وتوليد الوسيط', () => {
  async function patch(id: string, body: unknown) {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('sub', 'gm'); await next(); });
    app.route('/media', mediaRoutes);
    const res = await app.request(`http://localhost/media/${id}/describe`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, env, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    return { status: res.status, body: (await res.json()) as any };
  }
  const row = (id: string) => db.prepare('SELECT alt_text, ai_generated FROM media_assets WHERE id = ?').get(id);

  it('يحفظ النص البديل والوسم، والفارغ يمحو، والطويل يُردّ بسببه', async () => {
    asset('m2', 'image/png', null, 0);
    expect((await patch('m2', { alt_text: '  وصف الصورة  ', ai_generated: true })).status).toBe(200);
    expect(row('m2')).toEqual({ alt_text: 'وصف الصورة', ai_generated: 1 });
    await patch('m2', { alt_text: '' });
    expect(row('m2')).toEqual({ alt_text: null, ai_generated: 1 });
    const long = await patch('m2', { alt_text: 'ا'.repeat(1001) });
    expect(long).toEqual({ status: 400, body: { error: 'النص البديل أطول من ألف حرف. اختصره ثم احفظ' } });
    expect((await patch('nope', { ai_generated: false })).status).toBe(404);
  });

  it('الصورة المولَّدة هنا تُوسم عند توليدها', async () => {
    const a = await generateImageAsset(env, 'مكتب محاماة حديث', 'gm');
    expect(row(a.id).ai_generated).toBe(1);
  });
});
