// الرد التلقائي على الرسائل الخاصة عبر Ayrshare — «Set/Get Auto Response» في
// توثيقه (`POST`/`GET /messages/autoresponse` بـ autoResponseActive وautoResponseMessage
// وautoResponseWaitSeconds)، ورمزا تفعيل الرسائل 361 و362 من «Messages API Overview».

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { ayrshareRoutes } from '../src/routes/ayrshare';
import { ayrshareCall } from '../src/adapters/ayrshare';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...binds).changes } }),
  });
  return { prepare: (sql: string) => stmt(sql) };
}

let db: any;
let env: any;
let replies: Record<string, () => { status?: number; body: unknown }>;
let sent: { key: string; body: any }[];

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES ('gm','فهد','f@naf.sa','h','general_manager',1)").run();
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_name,is_active) VALUES ('mm','سارة','s@naf.sa','h','marketing_manager',1)").run();
  env = { DB: d1(db), AYRSHARE_API_KEY: 'ayr_key_test' };
  replies = {};
  sent = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method || 'GET'} ${url.pathname.replace(/^\/api/, '')}`;
    sent.push({ key, body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = replies[key]?.() ?? { status: 404, body: { status: 'error', message: 'not found' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function call(method: string, body?: unknown, user = 'gm') {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('sub', user); await next(); });
  app.route('/ayrshare', ayrshareRoutes);
  const waits: Promise<unknown>[] = [];
  const res = await app.request('http://localhost/ayrshare/autoresponse', {
    method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  }, env, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException: () => {} } as any);
  await Promise.all(waits);
  return { status: res.status, body: (await res.json()) as any };
}

describe('الرد التلقائي على الرسائل الخاصة', () => {
  it('يُقرأ كما ضُبط، وبلا ضبطٍ: معطّلٌ بمدّة يوم', async () => {
    replies['GET /messages/autoresponse'] = () => ({ body: { status: 'success', autoResponseActive: true, autoResponseMessage: 'شكراً لتواصلك', autoResponseWaitSeconds: 3600 } });
    expect((await call('GET')).body).toEqual({ active: true, message: 'شكراً لتواصلك', waitSeconds: 3600 });
    replies['GET /messages/autoresponse'] = () => ({ body: { status: 'success' } });
    expect((await call('GET')).body).toEqual({ active: false, message: '', waitSeconds: 86400 });
  });

  it('يُحفظ بحقول Ayrshare ويُسجَّل في التدقيق', async () => {
    replies['POST /messages/autoresponse'] = () => ({ body: { status: 'success' } });
    const r = await call('POST', { active: true, message: '  شكراً لتواصلك مع ناف  ', waitSeconds: 21600 });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(sent.find((s) => s.key === 'POST /messages/autoresponse')!.body).toEqual({
      autoResponseActive: true, autoResponseMessage: 'شكراً لتواصلك مع ناف', autoResponseWaitSeconds: 21600,
    });
    expect(db.prepare('SELECT action, details FROM audit_log').all()).toEqual([
      { action: 'settings_update', details: 'الرد التلقائي على الرسائل الخاصة' },
    ]);
  });

  it('يُردّ بلا نصٍّ مفعّلاً، وبمدّةٍ ليست في القائمة، وبنصٍّ طويل — ولغير المدير العام', async () => {
    expect((await call('POST', { active: true, message: ' ', waitSeconds: 86400 })).body.error).toBe('اكتب نص الرد التلقائي قبل تفعيله');
    expect((await call('POST', { active: false, message: '', waitSeconds: 60 })).body.error).toBe('اختر مدّةً من القائمة');
    expect((await call('POST', { active: true, message: 'ا'.repeat(1001), waitSeconds: 86400 })).body.error)
      .toBe('نص الرد التلقائي أطول من ألف حرف. اختصره ثم احفظ');
    expect((await call('POST', { active: false, message: '', waitSeconds: 86400 }, 'mm')).status).toBe(403);
    expect(sent.some((s) => s.key.startsWith('POST'))).toBe(false);
  });
});

describe('تفعيل الرسائل في الحساب', () => {
  it('٣٦١ يقول إن الرسائل غير مفعّلة لا إن المفتاح مرفوض، و٣٦٢ يطلب إعادة الربط', async () => {
    replies['GET /messages/facebook'] = () => ({ status: 403, body: { status: 'error', code: 361, message: 'Messaging is not enabled' } });
    await expect(ayrshareCall({ key: 'k' }, 'GET', '/messages/facebook'))
      .rejects.toThrow('الرسائل الخاصة غير مفعّلة في حساب Ayrshare. فعّلها من صفحة Account في Ayrshare، ثم أعد ربط فيسبوك وإنستغرام');
    replies['GET /messages/facebook'] = () => ({ status: 400, body: { status: 'error', code: 362, resolution: { relink: true } } });
    await expect(ayrshareCall({ key: 'k' }, 'GET', '/messages/facebook'))
      .rejects.toThrow('أعد ربط فيسبوك وإنستغرام في Ayrshare لتعمل الرسائل الخاصة: Social Accounts ثم أعد الربط');
  });
});
