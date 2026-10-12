// حذفُ المنشور من منصته عبر Ayrshare — الأشكال من صفحة «Delete Post» في توثيقه:
// `DELETE /post` بمعرّف Ayrshare، و`markManualDeleted` لإنستغرام وتيك توك (لا
// يحذفان عبر الواجهة)، و383 «حُذف من قبل»، و382 «لم يُحذف من المنصة»، و114
// «لا يُعرف المعرّف». والموعد يبقى بوقت حذفه (0041).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { scheduleRoutes } from '../src/routes/schedules';
import { PUBLISHED_COUNT_SQL } from '../src/services/planning';

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
let replies: Record<string, () => { status?: number; body: unknown }>;
let deletes: any[];

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider_name', 'ayrshare')").run();
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES ('gm','فهد','f@naf.sa','h','general_manager',1)").run();
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES ('mm','سارة','s@naf.sa','h','marketing_manager',1)").run();
  db.prepare("INSERT INTO content_posts (id,title,body,status,author_id) VALUES ('p1','عنوان','<p>نص</p>','published','gm')").run();
  const s = db.prepare(
    `INSERT INTO schedules (id,post_id,platform,scheduled_at,status,provider_post_id,extra_provider_ids)
     VALUES (?,'p1',?,'2026-10-11T10:00:00.000Z',?,?,?)`,
  );
  s.run('s_li', 'linkedin', 'published', 'AYR_LI', null);
  s.run('s_ig', 'instagram', 'published', 'AYR_IG', null);
  s.run('s_sc', 'snapchat', 'published', 'S1', JSON.stringify(['S2', 'S3']));
  s.run('s_x', 'x', 'pending', null, null);

  replies = {};
  deletes = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if ((init?.method || 'GET') === 'DELETE' && url.pathname === '/api/post') deletes.push(body);
    const r = replies[body?.id]?.() ?? { body: { status: 'success' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function call(path: string, user = 'gm', init: RequestInit = { method: 'POST', body: '{}' }) {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('sub', user); await next(); });
  app.route('/schedules', scheduleRoutes);
  const waits: Promise<unknown>[] = [];
  const res = await app.request(
    `http://localhost/schedules${path}`,
    { headers: { 'content-type': 'application/json' }, ...init },
    { DB: d1(db), AYRSHARE_API_KEY: 'ayr_key_test' } as any,
    { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException: () => {} } as any,
  );
  await Promise.all(waits);
  return { status: res.status, body: (await res.json()) as any };
}

const row = (id: string) => db.prepare('SELECT status, deleted_at FROM schedules WHERE id = ?').get(id);

describe('حذف المنشور من منصته', () => {
  it('لينكدإن يُحذف من منصته، ويبقى موعده بوقت حذفه، ويُسجَّل في التدقيق', async () => {
    const r = await call('/s_li/delete-post');
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(deletes).toEqual([{ id: 'AYR_LI' }]);
    expect(row('s_li').status).toBe('published');
    expect(row('s_li').deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(db.prepare("SELECT actor_id, action, entity_id, details FROM audit_log").all()).toEqual([
      { actor_id: 'gm', action: 'post_unpublish', entity_id: 's_li', details: 'لينكدإن' },
    ]);
  });

  it('إنستغرام يُسجَّل محذوفاً بعد حذفه من التطبيق — وما بقي عليه يُقال', async () => {
    replies.AYR_IG = () => ({
      status: 400,
      body: { action: 'delete', status: 'error', code: 382, message: 'The post was not manually deleted at the social network.' },
    });
    const first = await call('/s_ig/delete-post');
    expect(first.status).toBe(502);
    expect(first.body.error).toBe('المنشور ما زال على إنستغرام. احذفه من تطبيقها أولاً ثم أعد الحذف هنا');
    expect(deletes).toEqual([{ id: 'AYR_IG', markManualDeleted: true }]);
    expect(row('s_ig').deleted_at).toBeNull();

    replies.AYR_IG = () => ({ body: { status: 'success', id: 'AYR_IG' } });
    expect((await call('/s_ig/delete-post')).status).toBe(200);
    expect(row('s_ig').deleted_at).not.toBeNull();
  });

  it('سناب: كل نشرةٍ تُحذف، وما حُذف من قبل لا يُعيق', async () => {
    replies.S2 = () => ({ status: 400, body: { action: 'delete', status: 'error', code: 383, message: 'The post is already deleted.' } });
    expect((await call('/s_sc/delete-post')).status).toBe(200);
    expect(deletes.map((d) => d.id)).toEqual(['S1', 'S2', 'S3']);
    expect(row('s_sc').deleted_at).not.toBeNull();
  });

  it('رفضٌ داخل ردٍّ ناجح يُقال بسببه، ومعرّفٌ لا يعرفه Ayrshare يُحال إلى التطبيق', async () => {
    replies.AYR_LI = () => ({ body: { status: 'error', linkedin: { action: 'delete', status: 'error', message: 'Not allowed' } } });
    expect((await call('/s_li/delete-post')).body.error).toBe('تعذّر حذف المنشور من لينكدإن: Not allowed');

    replies.AYR_LI = () => ({ status: 400, body: { action: 'delete', status: 'error', code: 114, message: 'Delete id not found.' } });
    expect((await call('/s_li/delete-post')).body.error).toBe('لا يعرف Ayrshare هذا المنشور. احذفه من تطبيق لينكدإن');
    expect(row('s_li').deleted_at).toBeNull();
  });

  it('للمدير العام وحده، ولما نُشر ولم يُحذف', async () => {
    expect((await call('/s_li/delete-post', 'mm')).status).toBe(403);
    expect((await call('/s_x/delete-post')).body.error).toMatch(/^لا يُحذف من المنصة إلا منشورٌ نُشر عليها/);
    await call('/s_li/delete-post');
    expect((await call('/s_li/delete-post')).body.error).toBe('حُذف هذا المنشور من منصته من قبل');
    expect(deletes).toHaveLength(1);
  });

  it('مزوّدٌ لا يحذف يقول ذلك ولا يمسّ الموعد', async () => {
    db.prepare("UPDATE settings SET value = 'mock' WHERE key = 'provider_name'").run();
    const r = await call('/s_li/delete-post');
    expect(r.body.error).toBe('مزوّد النشر الحالي لا يحذف المنشور من منصته. احذفه من تطبيق المنصة');
    expect(row('s_li').deleted_at).toBeNull();
  });

  it('ما حُذف من منصته يُجدوَل عليها من جديد، ولا يُعدّ في «منشور جزئياً»', async () => {
    const count = () => db.prepare(`SELECT ${PUBLISHED_COUNT_SQL} FROM content_posts p WHERE p.id = 'p1'`).get().published_count;
    expect(count()).toBe(3);
    await call('/s_li/delete-post');
    expect(count()).toBe(2);

    const r = await call('', 'gm', {
      method: 'POST',
      body: JSON.stringify({ post_id: 'p1', platforms: ['linkedin'], scheduled_at: '2026-10-20T09:00:00.000Z' }),
    });
    expect(r.status).toBe(200);
    expect(db.prepare("SELECT status, deleted_at IS NOT NULL AS deleted FROM schedules WHERE post_id = 'p1' AND platform = 'linkedin' ORDER BY created_at, rowid").all())
      .toEqual([{ status: 'published', deleted: 1 }, { status: 'pending', deleted: 0 }]);
  });
});
