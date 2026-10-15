// إلغاء الجدولة من رقائق المنصات: منصةٌ متعثّرة تُلغى والبقية منشورة فيصير
// المحتوى «منشوراً»، وإلغاء كل شيءٍ بلا نشرٍ يعيده «معتمداً».
//
// الحاضنة نفسها في scheduleAfterPublish.test.ts.

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
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
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
  db.prepare("INSERT INTO content_posts (id,title,body,status,author_id) VALUES ('p1','عنوان','<p>نص</p>','scheduled','usr_1')").run();
});

function sched(id: string, platform: string, status: string) {
  db.prepare("INSERT INTO schedules (id,post_id,platform,scheduled_at,status) VALUES (?,'p1',?,'2026-10-11T10:00:00.000Z',?)").run(id, platform, status);
}

async function call(method: string, path: string, body?: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('sub', 'usr_1'); await next(); });
  app.route('/schedules', scheduleRoutes);
  const res = await app.request(`http://localhost/schedules${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, { DB: d1(db) } as any, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
  return { status: res.status, body: (await res.json()) as any };
}

const status = () => db.prepare("SELECT status FROM content_posts WHERE id = 'p1'").get().status;
const platforms = () => db.prepare("SELECT platform, status FROM schedules WHERE post_id = 'p1' ORDER BY platform").all();

describe('إلغاء الجدولة على منصاتٍ بعينها', () => {
  it('المتعثّرة تُلغى والبقية منشورة ← «منشور»، ويُكتب الانتقال', async () => {
    sched('s_x', 'x', 'published');
    sched('s_li', 'linkedin_page', 'published');
    sched('s_tt', 'tiktok', 'failed');
    const r = await call('POST', '/cancel', { post_id: 'p1', platforms: ['tiktok'] });
    expect(r).toMatchObject({ status: 200, body: { ok: true, cancelled: 1, status: 'published' } });
    expect(status()).toBe('published');
    expect(platforms().map((p: any) => p.platform)).toEqual(['linkedin_page', 'x']);
    expect(db.prepare("SELECT from_status, to_status, actor_id FROM approvals WHERE post_id = 'p1'").get())
      .toEqual({ from_status: 'scheduled', to_status: 'published', actor_id: 'usr_1' });
  });

  it('إلغاء كل شيءٍ بلا نشر ← «معتمد»', async () => {
    sched('s_x', 'x', 'pending');
    sched('s_tt', 'tiktok', 'failed');
    const r = await call('POST', '/cancel', { post_id: 'p1', platforms: ['x', 'tiktok'] });
    expect(r.body.status).toBe('approved');
    expect(status()).toBe('approved');
  });

  it('منصةٌ من اثنتين تنتظران ← يبقى «مجدولاً»', async () => {
    sched('s_x', 'x', 'pending');
    sched('s_tt', 'tiktok', 'pending');
    await call('POST', '/cancel', { post_id: 'p1', platforms: ['tiktok'] });
    expect(status()).toBe('scheduled');
    expect(platforms()).toEqual([{ platform: 'x', status: 'pending' }]);
  });

  it('ما نُشر أو يُنشر الآن لا يُلغى، ويُقال', async () => {
    sched('s_x', 'x', 'published');
    sched('s_tt', 'tiktok', 'processing');
    const r = await call('POST', '/cancel', { post_id: 'p1', platforms: ['x', 'tiktok'] });
    expect(r.status).toBe(404);
    expect(platforms()).toHaveLength(2);
    expect(status()).toBe('scheduled');
  });
});

describe('إلغاء جدولة موعدٍ واحد', () => {
  it('يسوّي حالة المنشور كالإلغاء بالمنصات', async () => {
    sched('s_x', 'x', 'published');
    sched('s_tt', 'tiktok', 'failed');
    const r = await call('DELETE', '/s_tt');
    expect(r.body).toMatchObject({ ok: true, status: 'published' });
    expect(status()).toBe('published');
  });

  it('موعدٌ غير موجود أو منشور ← 404 لا «تم» صامت', async () => {
    sched('s_x', 'x', 'published');
    expect((await call('DELETE', '/s_x')).status).toBe(404);
    expect((await call('DELETE', '/nope')).status).toBe(404);
  });
});
