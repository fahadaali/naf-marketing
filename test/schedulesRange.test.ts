// مواعيد التقويم بنطاق الشهر — لا أقدمَ خمس مئة.
//
// الحاضنة نفسها في campaigns.test.ts: القاعدة من ملفّات الهجرة، والمصادقة
// تُتجاوز بضبط `sub` قبل الموجّه.

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { scheduleRoutes } from '../src/routes/schedules';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt; },
        async first<T>() { return (db.prepare(sql).get(...args) ?? null) as T; },
        async all<T>() { return { results: db.prepare(sql).all(...args) as T[] }; },
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
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES ('usr_1','فهد','f@naf.sa','h','general_manager',1)").run();
  db.prepare("INSERT INTO content_posts (id,title,status,author_id) VALUES ('p1','عنوان','scheduled','usr_1')").run();
  const s = db.prepare("INSERT INTO schedules (id,post_id,platform,scheduled_at) VALUES (?,'p1','x',?)");
  s.run('oct_last', '2026-10-31T20:59:00.000Z'); // ٣١ أكتوبر ٢٣:٥٩ في الرياض
  s.run('nov_first', '2026-10-31T21:00:00.000Z'); // ١ نوفمبر ٠٠:٠٠ في الرياض
  s.run('nov_mid', '2026-11-15T09:00:00.000Z');
  s.run('dec_first', '2026-11-30T21:00:00.000Z'); // ١ ديسمبر في الرياض
});

async function get(path: string) {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('sub', 'usr_1'); await next(); });
  app.route('/schedules', scheduleRoutes);
  const res = await app.request(`http://localhost${path}`, {}, { DB: d1(db) } as any, {
    waitUntil: () => {}, passThroughOnException: () => {},
  } as any);
  return res.json() as Promise<any>;
}

describe('GET /schedules بنطاق', () => {
  it('شهر نوفمبر بتوقيت الرياض: بدايته داخلة ونهايته خارجة', async () => {
    const r = await get('/schedules?from=2026-10-31T21:00:00.000Z&to=2026-11-30T21:00:00.000Z');
    expect(r.schedules.map((s: any) => s.id)).toEqual(['nov_first', 'nov_mid']);
    expect(r.schedules[0].title).toBe('عنوان');
  });

  it('بلا نطاقٍ كما كان: كل المواعيد مرتّبة', async () => {
    const r = await get('/schedules');
    expect(r.schedules.map((s: any) => s.id)).toEqual(['oct_last', 'nov_first', 'nov_mid', 'dec_first']);
  });

  it('حدٌّ غير صالح يُهمل ولا يُسقط الطلب', async () => {
    const r = await get('/schedules?from=nonsense&to=2026-11-01T00:00:00Z');
    expect(r.schedules.map((s: any) => s.id)).toEqual(['oct_last', 'nov_first']);
  });
});
