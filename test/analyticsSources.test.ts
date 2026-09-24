/* «مصادر الأرقام» وتقرير سحب الصندوق — على مسارهما الحقيقي وقاعدةٍ حقيقية.

   سؤال المستخدم الذي بُنيت له اللوحة: رقمٌ غائبٌ أو صفر — أمِن مصدرٍ غير
   مربوط، أم من مصدرٍ مربوطٍ لم يصل منه شيء؟ فيُثبَّت هنا أن الجواب يُقرأ
   من البيانات نفسها: كم منشوراً في الفترة وكم منها له أرقام، وكم محتملاً
   وكم منهم مؤهّل بحالات الإعدادات، وما آخر سحبٍ وما سببُ تعذّره. */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { analyticsRoutes } from '../src/routes/analytics';
import { commentRoutes } from '../src/routes/comments';
import { periodOf } from '../src/services/period';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a.map((x) => (x === undefined ? null : x)); return stmt; },
        async first<T>() { return (db.prepare(sql).get(...args) ?? null) as T; },
        async all<T>() { return { results: db.prepare(sql).all(...args) as T[], success: true }; },
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
      };
      return stmt;
    },
  };
}

let db: any;
let app: Hono<any>;
const JULY = periodOf('monthly', '2026-07-15T00:00:00Z');

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare('INSERT INTO users (id,name,email,password_hash,role_name) VALUES (?,?,?,?,?)')
    .run('usr_t', 'فهد', 'f@naf.sa', 'h', 'general_manager');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('sub', 'usr_t'); await next(); });
  app.route('/analytics', analyticsRoutes);
  app.route('/comments', commentRoutes);
});

async function get(path: string) {
  const res = await app.request(`http://localhost${path}`, {}, { DB: d1(db) } as any);
  return { status: res.status, body: (await res.json()) as any };
}

describe('مصادر الأرقام', () => {
  it('يعدّ منشورات الفترة وما له أرقام منها، ولا يعدّ النشرة البريدية', async () => {
    db.prepare(
      `INSERT INTO analytics_snapshots (id, provider_post_id, platform, reach, impressions, engagement, sent_at, via_platform, source)
       VALUES ('a1','p1','linkedin', 100, 300, 20, '2026-07-05T10:00:00Z', 0, 'posts'),
              ('a2','p2','instagram', NULL, NULL, NULL, '2026-07-06T10:00:00Z', 0, 'account'),
              ('n1','nl:1','email', 900, 400, 30, '2026-07-07T10:00:00Z', 1, 'newsletter'),
              ('a3','p3','x', 5, 5, 5, '2026-08-02T10:00:00Z', 0, 'posts')`,
    ).run();

    const { status, body } = await get(`/analytics/sources?period=monthly&start=${JULY.start}`);
    expect(status).toBe(200);
    expect(body.posts.count).toBe(2);
    expect(body.posts.measured).toBe(1);
  });

  it('يعدّ المؤهلين بحالات الإعدادات — فيظهر ألّا تطابق حين لا تطابق', async () => {
    const lead = db.prepare(
      `INSERT INTO crm_leads (id, status, created_at, synced_at) VALUES (?, ?, '2026-07-03T08:00:00Z', '2026-08-01T00:00:00Z')`,
    );
    lead.run('l1', 'جديد');
    lead.run('l2', 'قيد المتابعة');

    const { body } = await get(`/analytics/sources?period=monthly&start=${JULY.start}`);
    expect(body.crm.leads).toBe(2);
    expect(body.crm.mql).toBe(0);
    expect(body.crm.mql_statuses).toEqual(['تم التواصل', 'بانتظار توقيع']);

    lead.run('l3', 'تم التواصل');
    const again = await get(`/analytics/sources?period=monthly&start=${JULY.start}`);
    expect(again.body.crm.mql).toBe(1);
  });

  it('يعيد حالة كل تكاملٍ بلا إعداداته', async () => {
    db.prepare(
      "UPDATE integrations SET is_enabled = 1, last_sync_status = 'sync_failed', last_error = 'ردّ المصدر بالحالة 401', config_json = '{\"property_id\":\"123\"}' WHERE key = 'web_analytics'",
    ).run();
    const { body } = await get('/analytics/sources');
    const web = body.integrations.find((i: any) => i.key === 'web_analytics');
    expect(web).toMatchObject({ is_enabled: true, last_sync_status: 'sync_failed', last_error: 'ردّ المصدر بالحالة 401' });
    expect(web.config).toBeUndefined();
  });
});

describe('تقرير سحب الصندوق في قائمة التعليقات', () => {
  it('تحمل القائمة آخر تقريرٍ محفوظ', async () => {
    const report = { at: '2026-09-24T10:04:00Z', ok: true, complete: false, kinds: {}, errors: [] };
    db.prepare("INSERT INTO settings (key, value) VALUES ('inbox_sync_report', ?)").run(JSON.stringify(report));
    const { status, body } = await get('/comments');
    expect(status).toBe(200);
    expect(body.sync).toMatchObject({ complete: false, at: '2026-09-24T10:04:00Z' });
  });

  it('تعدّ الردّ من خارج المنصة في «تم الرد»', async () => {
    db.prepare(
      `INSERT INTO platform_comments (id, platform, provider_comment_id, kind, body, reply_body, reply_source, created_at)
       VALUES ('c1','instagram','p|a|1','comment','سؤال؟','أهلاً','external','2026-09-01T10:00:00Z'),
              ('c2','instagram','p|a|2','comment','سؤال آخر؟',NULL,NULL,'2026-09-01T11:00:00Z')`,
    ).run();
    const { body } = await get('/comments?replied=1');
    expect(body.counts).toEqual({ all: 2, unreplied: 1, replied: 1 });
    expect(body.comments.map((c: any) => c.id)).toEqual(['c1']);
    expect(body.comments[0].reply_source).toBe('external');
  });
});
