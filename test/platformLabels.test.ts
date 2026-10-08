/* المنصة باسمها لا بمفتاحها في كل نصٍّ يكتبه الخادم — naf-terms §٣ «أسماء
   منصات التواصل». وكانت كلّها تكتب المفتاح: «جدولة على: x, linkedin» في سجلّ
   الاعتماد، و«فشل نشر منشور — x: …» في الإشعار، و`twitter` في التقرير المرفوع.

   القاعدة SQLite حقيقية من ملفّات الهجرة، كما في posts.test.ts. */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  PLATFORM_AR, platformName, platformNames, normalizePlatformKey, scheduleNote, noteForDisplay, customPlatformLabels,
} from '../src/platformLabels';
import { normalizePlatform, PLATFORM_KEYS } from '../web/src/platformKeys';
import { scheduleRoutes } from '../src/routes/schedules';
import { postRoutes } from '../src/routes/posts';
import { notifyPublishFailed } from '../src/services/notify';
import { buildReportWorkbook } from '../src/services/report';
import { SocialApiProvider } from '../src/adapters/socialapi';
import { BufferProvider } from '../src/adapters/buffer';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'migrations');
const ISOLATES = /[⁦-⁩]/g;

function d1(db: any) {
  const norm = (a: unknown) => (a === undefined ? null : a as any);
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        sql,
        get args() { return args; },
        bind(...a: unknown[]) { args = a.map(norm); return stmt; },
        async first<T>() { return (db.prepare(sql).get(...args) ?? null) as T; },
        async all<T>() { return { results: db.prepare(sql).all(...args) as T[], success: true }; },
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
      };
      return stmt;
    },
    async batch(statements: any[]) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
  };
}

let db: any;
const env = () => ({ DB: d1(db), APP_NAME: 'ناف' } as any);
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES ('usr_gm','فهد','f@naf.sa','h','general_manager',1)").run();
});

const setLabels = (labels: unknown) =>
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('platform_labels', ?)").run(JSON.stringify(labels));

/** جدول المفاتيح والأسماء تحت عنوانه في naf-terms.md — أوّل جدولٍ بعده. */
function termsTable(heading: string): Record<string, string> {
  const md = readFileSync(join(ROOT, 'naf-terms.md'), 'utf8');
  const start = md.indexOf(`### ${heading}\n`);
  if (start < 0) throw new Error(`لا عنوان «${heading}» في naf-terms.md`);
  const out: Record<string, string> = {};
  let inTable = false;
  for (const line of md.slice(start).split('\n').slice(1)) {
    const m = line.match(/^\| `([^`]+)` \| ([^|]+?) \|/);
    if (m) { out[m[1]] = m[2].trim(); inTable = true; } else if (inTable && !line.startsWith('|')) break;
  }
  return out;
}

describe('أسماء المنصات في الخادم', () => {
  it('نسخة السجلّ حرفياً — والعلامة اللاتينية معزولة الاتجاه وحدها', () => {
    const registry = termsTable('أسماء منصات التواصل');
    const copy = Object.fromEntries(Object.entries(PLATFORM_AR).map(([k, v]) => [k, v.replace(ISOLATES, '')]));
    expect(copy).toEqual(registry);
    expect(Object.keys(PLATFORM_AR)).toEqual([...PLATFORM_KEYS]);
  });

  it('أسماء الواجهة هي أسماء الخادم نفسها', () => {
    const src = readFileSync(join(ROOT, 'web/src/platforms.tsx'), 'utf8');
    const web: Record<string, string> = {};
    for (const m of src.matchAll(/^ {2}(\w+): \{\s*label: '([^']+)'/gm)) web[m[1]] = m[2].replace(/\\u(\w{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    expect(web).toEqual(PLATFORM_AR);
  });

  it('مرادفات المزوّدين تتوحّد كما في الواجهة', () => {
    for (const k of ['twitter', 'twitter.com', 'googlebusiness', 'google_business', 'gbp', 'linkedinpage', ' LinkedIn-Page ', 'ig', 'fb', 'yt', 'x', 'pinterest']) {
      expect(normalizePlatformKey(k)).toBe(normalizePlatform(k));
    }
  });

  it('الاسم: المخصّص أولاً، ثم المسجّل، ثم المفتاح لمنصةٍ لا اسم لها', () => {
    expect(platformName('twitter')).toBe('إكس');
    expect(platformName('googlebusiness')).toBe('نشاطي التجاري (⁨Google⁩)');
    expect(platformName('pinterest', { pinterest: 'بنترست' })).toBe('بنترست');
    expect(platformName('x', { x: 'حسابنا على إكس' })).toBe('حسابنا على إكس');
    expect(platformName('pinterest')).toBe('pinterest');
    expect(platformNames(['x', 'linkedin'])).toBe('إكس، لينكدإن');
  });

  it('ملاحظة الجدولة بالأسماء والفاصلة العربية — صفّ السياق في السجلّ', () => {
    expect(scheduleNote(['x', 'linkedin'])).toBe('جدولة على: إكس، لينكدإن');
  });

  it('الملاحظة القديمة تُقرأ بالأسماء، والجديدة تمرّ كما هي، وسبب الرفض لا يُمسّ', () => {
    expect(noteForDisplay('جدولة على: x, linkedin')).toBe('جدولة على: إكس، لينكدإن');
    expect(noteForDisplay('جدولة على: إكس، لينكدإن')).toBe('جدولة على: إكس، لينكدإن');
    expect(noteForDisplay('جدولة على: pinterest', { pinterest: 'بنترست' })).toBe('جدولة على: بنترست');
    expect(noteForDisplay('العنوان طويل، اختصره')).toBe('العنوان طويل، اختصره');
    expect(noteForDisplay(null)).toBe('');
  });

  it('الأسماء المخصّصة: النصّية وحدها، والمشوَّه يسقط إلى لا شيء', async () => {
    setLabels({ pinterest: 'بنترست', bad: 5, empty: ' ' });
    expect(await customPlatformLabels(env())).toEqual({ pinterest: 'بنترست' });
    db.prepare("UPDATE settings SET value = '{oops' WHERE key = 'platform_labels'").run();
    expect(await customPlatformLabels(env())).toEqual({});
    db.prepare("UPDATE settings SET value = '[\"x\"]' WHERE key = 'platform_labels'").run();
    expect(await customPlatformLabels(env())).toEqual({});
  });
});

describe('سجلّ الاعتماد', () => {
  function app() {
    const a = new Hono();
    a.use('*', async (c, next) => { c.set('sub', 'usr_gm'); await next(); });
    a.route('/schedules', scheduleRoutes);
    a.route('/posts', postRoutes);
    return a;
  }

  it('الجدولة تكتب الأسماء، والمنصة المكرّرة مرّةً واحدة', async () => {
    setLabels({ pinterest: 'بنترست' });
    db.prepare("INSERT INTO content_posts (id,title,body,status,author_id) VALUES ('p1','عنوان','<p>نص</p>','approved','usr_gm')").run();
    const res = await app().request('http://localhost/schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ post_id: 'p1', platforms: ['x', 'linkedin', 'x', 'pinterest'], scheduled_at: '2026-12-01T09:00:00Z' }),
    }, env(), ctx);
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT note FROM approvals WHERE post_id = 'p1' AND to_status = 'scheduled'").get();
    expect(row.note).toBe('جدولة على: إكس، لينكدإن، بنترست');
  });

  it('المحرّر يقرأ الملاحظة القديمة بالأسماء، ولا يمسّ غيرها', async () => {
    db.prepare("INSERT INTO content_posts (id,title,body,status,author_id) VALUES ('p2','عنوان','<p>نص</p>','scheduled','usr_gm')").run();
    const ins = db.prepare("INSERT INTO approvals (id,post_id,from_status,to_status,actor_id,note,created_at) VALUES (?, 'p2', ?, ?, 'usr_gm', ?, ?)");
    ins.run('a1', 'pending_gm', 'rejected', 'العنوان طويل، اختصره', '2026-10-01T09:00:00Z');
    ins.run('a2', 'approved', 'scheduled', 'جدولة على: twitter, google', '2026-10-02T09:00:00Z');
    ins.run('a3', 'pending_gm', 'approved', null, '2026-10-03T09:00:00Z');
    const res = await app().request('http://localhost/posts/p2', {}, env(), ctx);
    const body = await res.json() as any;
    expect(body.approvals.map((a: any) => a.note)).toEqual([
      'العنوان طويل، اختصره',
      'جدولة على: إكس، نشاطي التجاري (⁨Google⁩)',
      null,
    ]);
  });
});

describe('الإشعار ورسائل المزوّد', () => {
  it('فشل النشر يذكر المنصة باسمها', async () => {
    db.prepare("INSERT INTO content_posts (id,title,body,status,author_id) VALUES ('p3','إطلاق الخدمة','<p>نص</p>','scheduled','usr_gm')").run();
    await notifyPublishFailed(env(), 'p3', 'twitter', 'رفضت المنصة النص');
    const n = db.prepare("SELECT title, body FROM notifications WHERE type = 'publish_failed'").get();
    expect(n.body).toBe('إطلاق الخدمة — إكس: رفضت المنصة النص');
  });

  it('حسابٌ غير مربوط: الأسماء لا المفاتيح، والمخصّصة بأسمائها', async () => {
    const input = { text: 'نص', platforms: ['x', 'pinterest'] } as any;
    await expect(new SocialApiProvider('k', {}, { pinterest: 'بنترست' }).publish(input))
      .rejects.toThrow('لا يوجد حساب SocialAPI مربوط للمنصات: إكس، بنترست —');
    await expect(new BufferProvider('k', {}).publish(input))
      .rejects.toThrow('لا توجد قناة Buffer مربوطة للمنصات: إكس، pinterest —');
  });
});

describe('التقرير المرفوع', () => {
  it('المنصة باسمها، والشكل بتسميته، وملاحظة الجدولة القديمة بالأسماء', async () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO content_posts (id,title,body,status,author_id,format,content_type) VALUES ('p4','دليل الاشتراك','<p>نص</p>','scheduled','usr_gm','carousel','image')").run();
    db.prepare("INSERT INTO approvals (id,post_id,from_status,to_status,actor_id,note,created_at) VALUES ('a4','p4','approved','scheduled','usr_gm','جدولة على: x, linkedin',?)").run(now);
    const snap = db.prepare("INSERT INTO analytics_snapshots (id, provider_post_id, platform, title, reach, impressions, engagement, captured_at) VALUES (?, ?, ?, 'دليل الاشتراك', 10, 20, 3, ?)");
    snap.run('s1', 'pp1', 'twitter', now);
    snap.run('s2', 'pp2', 'googlebusiness', now);

    const { sheets } = await buildReportWorkbook(env(), 'week');
    const sheet = (name: string) => sheets.find((s) => s.name === name)!.rows;

    const content = sheet('المحتوى');
    expect(content[0][3]).toBe('الشكل');
    expect(content[1][3]).toBe('كاروسيل');

    expect(sheet('سجل الاعتمادات')[1][4]).toBe('جدولة على: إكس، لينكدإن');

    const byPlatform = sheet('تحليلات المنصات').slice(1).map((r) => r[0]);
    expect(byPlatform.sort()).toEqual(['إكس', 'نشاطي التجاري (⁨Google⁩)'].sort());
    const byPost = sheet('تحليلات المنشورات').slice(1).map((r) => r[1]);
    expect(byPost.sort()).toEqual(['إكس', 'نشاطي التجاري (⁨Google⁩)'].sort());
  });
});
