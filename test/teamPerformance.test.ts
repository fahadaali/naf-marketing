/* لوحة أداء الفريق — على مسارها الحقيقي وقاعدةٍ حقيقية.

   ما يُثبَّت: سرعة الاعتماد تقيس قرارات المراجعة وحدها (لا إرسال الكاتب ولا
   الجدولة)، والإنتاجية لا تعدّ الأفكار. وكلاهما يخصّ خطة المحتوى: فكرةٌ تُخطَّط
   قبل أشهر تجعل إرسالها «اعتماداً» بألفي ساعة لو قيس من إنشائها. */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { analyticsRoutes } from '../src/routes/analytics';

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
        async run() { db.prepare(sql).run(...args); return { success: true }; },
      };
      return stmt;
    },
  };
}

let db: any;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  const user = db.prepare('INSERT INTO users (id,name,email,password_hash,role_name) VALUES (?,?,?,?,?)');
  user.run('usr_gm', 'المدير العام', 'g@naf.sa', 'h', 'general_manager');
  user.run('usr_mm', 'مدير التسويق', 'm@naf.sa', 'h', 'marketing_manager');
  user.run('usr_w', 'الكاتب', 'w@naf.sa', 'h', 'writer');

  const post = db.prepare('INSERT INTO content_posts (id,title,body,status,author_id,created_at) VALUES (?,?,?,?,?,?)');
  // خُطّطت في يوليو وكُتبت وأُرسلت في أكتوبر
  post.run('p1', 'منشور', '<p>نص</p>', 'scheduled', 'usr_w', '2026-07-01T00:00:00Z');
  post.run('d1', 'مسودة', '<p>نص</p>', 'draft', 'usr_w', '2026-10-01T00:00:00Z');
  post.run('i1', 'فكرة', '', 'draft', 'usr_mm', '2026-10-01T00:00:00Z');
  post.run('i2', 'فكرة', '', 'draft', 'usr_mm', '2026-10-01T00:00:00Z');

  const act = db.prepare('INSERT INTO approvals (id,post_id,from_status,to_status,actor_id,created_at) VALUES (?,?,?,?,?,?)');
  act.run('a1', 'p1', 'draft', 'pending_marketing', 'usr_w', '2026-10-01T10:00:00Z');
  act.run('a2', 'p1', 'pending_marketing', 'pending_gm', 'usr_mm', '2026-10-01T12:00:00Z');
  act.run('a3', 'p1', 'pending_gm', 'approved', 'usr_gm', '2026-10-01T16:00:00Z');
  act.run('a4', 'p1', 'approved', 'scheduled', 'usr_mm', '2026-10-02T09:00:00Z');
});

async function performance() {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('sub', 'usr_gm'); await next(); });
  app.route('/analytics', analyticsRoutes);
  const res = await app.request('http://localhost/analytics/performance', {}, { DB: d1(db) } as any);
  return (await res.json()) as any;
}

describe('أداء الفريق', () => {
  it('سرعة الاعتماد: قرارات المراجعة وحدها، كلٌّ من الإجراء الذي سبقه', async () => {
    const { approvers } = await performance();
    const by = Object.fromEntries(approvers.map((a: any) => [a.id, a]));
    expect(by.usr_mm).toMatchObject({ actions_count: 1, avg_hours: 2 });
    expect(by.usr_gm).toMatchObject({ actions_count: 1, avg_hours: 4 });
  });

  it('الكاتب ليس معتمِداً — إرساله للمراجعة لا يُقاس من إنشاء المنشور', async () => {
    const { approvers } = await performance();
    expect(approvers.map((a: any) => a.id)).not.toContain('usr_w');
  });

  it('الإنتاجية لا تعدّ الأفكار', async () => {
    const { writers } = await performance();
    expect(writers.map((w: any) => [w.id, w.created_count])).toEqual([['usr_w', 2]]);
  });
});

describe('خط الإنتاج في لوحة التحليلات', () => {
  it('«فكرة» خانةٌ مستقلّة عن «مسودة»', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('sub', 'usr_gm'); await next(); });
    app.route('/analytics', analyticsRoutes);
    const res = await app.request('http://localhost/analytics/dashboard', {}, { DB: d1(db) } as any);
    const { pipeline } = (await res.json()) as any;
    const by = Object.fromEntries(pipeline.map((s: any) => [s.status, s.count]));
    expect(by).toMatchObject({ idea: 2, draft: 1, scheduled: 1 });
  });
});

describe('قائمة المنصات في لوحة التحليلات', () => {
  it('كل منصةٍ لها منشورات — ولو لم تُفعَّل للنشر، وبلا النشرة البريدية', async () => {
    const add = db.prepare("INSERT INTO analytics_snapshots (id, provider_post_id, platform, source, metrics_json) VALUES (?, ?, ?, ?, '[]')");
    add.run('s1', 'Y1', 'youtube', null);
    add.run('s2', 'X1', 'x', null);
    add.run('s3', 'N1', 'email', 'newsletter');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('sub', 'usr_gm'); await next(); });
    app.route('/analytics', analyticsRoutes);
    const res = await app.request('http://localhost/analytics/dashboard?platform=x', {}, { DB: d1(db) } as any);
    expect(((await res.json()) as any).platforms).toEqual(['x', 'youtube']);
  });
});
