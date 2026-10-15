// النشر المجدول على قاعدةٍ حقيقية والمزوّد التجريبي — ونشرُ Ayrshare نفسه
// في `ayrsharePublish*.test.ts`.
//
// يُثبَّت هنا ما لا يخصّ المزوّد: ما ترفضه المنصة قبل أن يصلها، والمزوّد غير
// المضبوط لا يترك موعداً «متأخراً» صامتاً، والجدول الذي انقطع عاملُه لا يبقى
// «قيد النشر» إلى الأبد.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

vi.mock('../src/services/notify', () => ({ notifyPublishFailed: vi.fn(async () => {}) }));

import {
  runDuePublishes, reconcilePublishing, missingRequirement, preflightSchedules,
} from '../src/services/publish';
import { youtubeTitle, constraintIssues } from '../src/adapters/media';

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

function build(provider = 'mock'): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider_name', ?)").run(provider);
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

describe('يوم النشر المستهدف لا يَنشر', () => {
  it('معتمدٌ ومجدولٌ مضى يومهما المستهدف بلا موعد: لا نشر ولا طلب', async () => {
    // المجدوِل يقرأ صفوف schedules وحدها — والخطة عمودٌ في المحتوى لا يقرؤه
    for (const [id, status] of [['p_appr', 'approved'], ['p_sch', 'scheduled'], ['p_idea', 'draft']]) {
      db.prepare(
        "INSERT INTO content_posts (id, title, body, status, author_id, planned_on, planned_platforms) VALUES (?, 'عنوان', '<p>نص</p>', ?, 'u1', '2026-01-01', '[\"linkedin\"]')",
      ).run(id, status);
    }
    const r = await runDuePublishes(env);
    expect(r).toEqual({ published: 0, failed: 0, pending: 0 });
    expect(calls).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) n FROM schedules').get().n).toBe(0);
  });
});

describe('المزوّد غير المضبوط', () => {
  it('يكتب سببه على كل موعد بدل أن يتركه معلّقاً صامتاً', async () => {
    db.prepare("UPDATE settings SET value = 'ayrshare' WHERE key = 'provider_name'").run();
    post(db, 'p3', '<p>نص</p>', ['linkedin', 'x']);
    const r = await runDuePublishes(env);
    expect(r.failed).toBe(2);
    expect(row(db, 'sch_p3_linkedin')).toMatchObject({ status: 'failed' });
    expect(row(db, 'sch_p3_x').error).toMatch(/مفتاح Ayrshare/);
  });
});

describe('عنوان يوتيوب', () => {
  it('مئة حرف، بلا «<>»، ومن أوّل سطرٍ إن غاب', () => {
    expect(youtubeTitle('  عنوان <المقطع>  ', '')).toBe('عنوان المقطع');
    expect(youtubeTitle('', '\n  السطر الأول\nالثاني')).toBe('السطر الأول');
    expect([...youtubeTitle('ن'.repeat(150), '')]).toHaveLength(100);
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

describe('الفحص عند الجدولة', () => {
  const big = { mimeType: 'image/png', filename: 'big.png', size: 10_404_521 };

  it('حدود المنصة: الصيغة والحجم وما لا تقبله أصلاً وطول النص والدوّارة', () => {
    const ig = { media: { supported_image_types: ['image/jpeg'], max_image_size_bytes: 8_388_608 } };
    expect(constraintIssues(ig, { platforms: ['instagram'], text: 'نص', media: [big] })).toEqual([
      'صيغة الصورة «big.png» (image/png) لا تقبلها هذه المنصة. المقبول: image/jpeg',
      'حجم الصورة «big.png» (9.9 ميغابايت) أكبر من حدّ هذه المنصة (8.0 ميغابايت). صغّره ثم ضعه مكان القديم',
    ]);
    expect(constraintIssues({ media: { max_image_size_bytes: 0 } }, { platforms: ['youtube'], text: 'نص', media: [big] }))
      .toEqual(['هذه المنصة لا تقبل الصور. احذف «big.png» من نسخة المنصة أو لا تجدولها عليها']);
    expect(constraintIssues({ text: { max_length: 5, counting_mode: 'chars' } }, { platforms: ['x'], text: 'نصٌّ طويل', media: [] }))
      .toEqual(['النص أطول من حدّ هذه المنصة: 9 من 5. اختصره في نسخة المنصة']);
    // طريقة عدٍّ لا نعرفها لا يُحكم بها
    expect(constraintIssues({ text: { max_length: 5, counting_mode: 'weighted' } }, { platforms: ['x'], text: 'نصٌّ طويل', media: [] }))
      .toEqual([]);
    const two = [{ mimeType: 'image/jpeg', filename: 'a.jpg', size: 1 }, { mimeType: 'image/jpeg', filename: 'b.jpg', size: 1 }];
    expect(constraintIssues({ carousel: { supported: false } }, { platforms: ['x'], text: 'نص', media: two }))
      .toEqual(['هذه المنصة لا تقبل أكثر من وسيطٍ واحد في المنشور']);
  });

  it('يُكتب السبب على كل موعدٍ معلّق ويُردّ — ولا يُرسل منشور', async () => {
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename) VALUES ('med_pf', 'k/med_pf', 'image/png', 'p.png')").run();
    env.MEDIA._put('k/med_pf');
    post(db, 'pf1', '<p>نص</p><img src="/api/media/med_pf">', ['tiktok', 'linkedin']);
    const issues = await preflightSchedules(env, 'pf1', ['tiktok', 'linkedin']);
    expect(issues.map((i) => i.platform)).toEqual(['tiktok']);
    expect(row(db, 'sch_pf1_tiktok').error).toMatch(/بأقلّ من صورتين/);
    expect(row(db, 'sch_pf1_linkedin').error).toBeNull();
    // الموعد باقٍ معلّقاً — المحتوى قد يُصلَح قبل موعده
    expect(row(db, 'sch_pf1_tiktok').status).toBe('pending');
    expect(calls).toEqual([]);
  });

  it('أوّل محاولة نشرٍ تمحو سبب الفحص المسبق', async () => {
    post(db, 'pf3', '<p>نص</p>', ['linkedin']);
    db.prepare("UPDATE schedules SET error = 'سبب قديم' WHERE id = 'sch_pf3_linkedin'").run();
    await runDuePublishes(env);
    expect(row(db, 'sch_pf3_linkedin')).toMatchObject({ status: 'published', error: null });
  });
});

describe('مقطع تيك توك المولّد من الصورة الواحدة', () => {
  beforeEach(() => {
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename) VALUES ('med_one', 'k/med_one', 'image/jpeg', 'one.jpg')").run();
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename) VALUES ('med_two', 'k/med_two', 'image/jpeg', 'two.jpg')").run();
    db.prepare("INSERT INTO media_assets (id, r2_key, mime_type, filename, width, height, duration_ms) VALUES ('med_vid', 'k/med_vid', 'video/mp4', 'one.mp4', 1080, 1920, 5000)").run();
    for (const k of ['k/med_one', 'k/med_two', 'k/med_vid']) env.MEDIA._put(k);
  });

  it('يحلّ المقطع محلّ صورته فلا يُرفض المنشور', async () => {
    post(db, 'tt1', '<p>نص</p><img src="/api/media/med_one">', ['tiktok']);
    db.prepare("INSERT INTO post_variants (id, post_id, platform, generated_media_id, generated_from_id) VALUES ('vt1', 'tt1', 'tiktok', 'med_vid', 'med_one')").run();
    const issues = await preflightSchedules(env, 'tt1', ['tiktok']);
    expect(issues).toEqual([]);
  });

  it('صورةٌ تغيّرت بعد التوليد تُرسل هي، فيُقال ما ينقص ولا يُنشر مقطعٌ قديم', async () => {
    post(db, 'tt2', '<p>نص</p><img src="/api/media/med_two">', ['tiktok']);
    db.prepare("INSERT INTO post_variants (id, post_id, platform, generated_media_id, generated_from_id) VALUES ('vt2', 'tt2', 'tiktok', 'med_vid', 'med_one')").run();
    const issues = await preflightSchedules(env, 'tt2', ['tiktok']);
    expect(issues[0].error).toMatch(/بأقلّ من صورتين/);
  });
});
