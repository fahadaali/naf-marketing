// البحث يُرجع منصات المحتوى مع نتيجته — لصفّ الشعارات فوق عنوانه.

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { searchRoutes } from '../src/routes/search';

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
  db.prepare("INSERT INTO content_posts (id,title,body,status,author_id,planned_platforms) VALUES ('p1','عقود العمل','alphaword','scheduled','usr_1','[\"tiktok\"]')").run();
  db.prepare("INSERT INTO schedules (id,post_id,platform,scheduled_at) VALUES ('s1','p1','x','2026-11-01T09:00:00Z')").run();
});

describe('GET /search', () => {
  it('النتيجة تحمل منصاتها المجدولة والمخطّطة', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('sub', 'usr_1'); await next(); });
    app.route('/search', searchRoutes);
    const res = await app.request('http://localhost/search?q=alphaword', {}, { DB: d1(db) } as any);
    const { posts } = (await res.json()) as any;
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: 'p1', scheduled_platforms: 'x', planned_platforms: '["tiktok"]' });
  });
});
