// جدولة منصةٍ أخرى لمحتوى نُشر: كان المنشور لا يُجدوَل أبداً، فمنصةٌ نُسيت في
// الجدولة الأولى (لينكدإن) لا سبيل إليها. ويُعرض بعدها «منشوراً جزئياً».
//
// الحاضنة نفسها في schedulesRange.test.ts.

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { scheduleRoutes } from '../src/routes/schedules';
import { displayStatus, STATUS_LABELS, STATUS_BADGE } from '../web/src/api';
import { KANBAN_COLS } from '../web/src/contentFlow';

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
  // نُشر على إكس وإنستغرام، ونُسي لينكدإن
  db.prepare("INSERT INTO content_posts (id,title,body,status,author_id) VALUES ('p1','عنوان','<p>نص</p>','published','usr_1')").run();
  const s = db.prepare("INSERT INTO schedules (id,post_id,platform,scheduled_at,status) VALUES (?,'p1',?,'2026-10-11T10:00:00.000Z','published')");
  s.run('s_x', 'x');
  s.run('s_ig', 'instagram');
});

async function schedule(platforms: string[]) {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('sub', 'usr_1'); await next(); });
  app.route('/schedules', scheduleRoutes);
  const res = await app.request('http://localhost/schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ post_id: 'p1', platforms, scheduled_at: '2026-10-12T09:00:00.000Z' }),
  }, { DB: d1(db) } as any, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
  return { status: res.status, body: (await res.json()) as any };
}

const rows = () => db.prepare("SELECT platform, status FROM schedules WHERE post_id = 'p1' ORDER BY platform").all();

describe('جدولة منصةٍ أخرى لمحتوى منشور', () => {
  it('تُنشئ موعداً للمنصة المنسيّة ويعود المحتوى «مجدولاً»', async () => {
    const r = await schedule(['linkedin_page']);
    expect(r.status).toBe(200);
    expect(rows()).toEqual([
      { platform: 'instagram', status: 'published' },
      { platform: 'linkedin_page', status: 'pending' },
      { platform: 'x', status: 'published' },
    ]);
    expect(db.prepare("SELECT status FROM content_posts WHERE id = 'p1'").get().status).toBe('scheduled');
  });

  it('ما نُشر عليه لا يُجدوَل ثانيةً — فلا يُنشر مرّتين', async () => {
    await schedule(['x', 'linkedin_page']);
    expect(rows().filter((r: any) => r.platform === 'x')).toEqual([{ platform: 'x', status: 'published' }]);
  });

  it('جدولة ما نُشر عليه وحده تُردّ بسببها', async () => {
    const r = await schedule(['x']);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('نُشر المحتوى على هذه المنصات من قبل. اختر منصةً لم يُنشر عليها');
    expect(db.prepare("SELECT status FROM content_posts WHERE id = 'p1'").get().status).toBe('published');
  });
});

describe('«منشور جزئياً»', () => {
  it('مجدولٌ نُشر على بعض منصاته', () => {
    expect(displayStatus({ status: 'scheduled', published_count: 2, body: '<p>نص</p>' })).toBe('partial');
    expect(displayStatus({ status: 'scheduled', published_count: 0, body: '<p>نص</p>' })).toBe('scheduled');
    expect(displayStatus({ status: 'published', published_count: 2, body: '<p>نص</p>' })).toBe('published');
  });

  it('«متأخر» أولى منه: موعدٌ فات يحتاج عملاً', () => {
    expect(displayStatus({ status: 'scheduled', published_count: 1, pending_at: '2000-01-01T00:00:00Z', body: '<p>نص</p>' })).toBe('late');
  });

  it('تسميته ولونه المسجّلان، وعموده «مجدول»', () => {
    expect(STATUS_LABELS.partial).toBe('منشور جزئياً');
    expect(STATUS_BADGE.partial).toBe(STATUS_BADGE.scheduled);
    expect(KANBAN_COLS.find((c) => c.statuses.includes('partial'))?.key).toBe('scheduled');
  });
});
