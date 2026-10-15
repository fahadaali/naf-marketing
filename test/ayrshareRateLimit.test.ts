// حدُّ طلبات حساب Ayrshare — 300 طلب كل خمس دقائق للحساب كلّه، وألفُ رفضٍ في
// يومٍ يعطّله (صفحة «HTTP Errors» في توثيقه، 429). العدّاد من ترويستَي
// `x-ratelimit-count` و`x-ratelimit-max`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { ayrshareAuth, getProvider } from '../src/adapters';
import { AYRSHARE_RATE_KEY, ayrshareCall, RATE_LIMIT_ERROR } from '../src/adapters/ayrshare';
import { BudgetExhausted, CallBudget } from '../src/adapters/budget';

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
let calls: string[];
let reply: () => { status?: number; body: unknown; count?: number };

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('provider_name', 'ayrshare') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  env = { DB: d1(db), AYRSHARE_API_KEY: 'ayr_key_test' };
  calls = [];
  reply = () => ({ body: { status: 'success' } });
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method || 'GET'} ${new URL(String(input)).pathname.replace(/^\/api/, '')}`);
    const r = reply();
    const headers: Record<string, string> = r.count === undefined ? {} : { 'x-ratelimit-max': '300', 'x-ratelimit-count': String(r.count) };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const stored = () => db.prepare('SELECT value FROM settings WHERE key = ?').get(AYRSHARE_RATE_KEY)?.value;

describe('السحب يترك للنشر وللمستخدم مئة طلب', () => {
  it('يقف السحب حين يبلغ العدّاد مئتين، والنداء بلا حصّةٍ يمضي', async () => {
    const auth = ayrshareAuth(env)!;
    const budget = new CallBudget(150);
    reply = () => ({ body: { status: 'success' }, count: 199 });
    await ayrshareCall(auth, 'GET', '/user', undefined, budget);
    await ayrshareCall(auth, 'GET', '/user', undefined, budget);
    reply = () => ({ body: { status: 'success' }, count: 200 });
    await ayrshareCall(auth, 'GET', '/user', undefined, budget);
    expect(calls).toHaveLength(3);

    await expect(ayrshareCall(auth, 'GET', '/user', undefined, budget)).rejects.toBeInstanceOf(BudgetExhausted);
    expect(budget.stoppedBy).toBe('rate_limit');
    expect(calls).toHaveLength(3);

    await ayrshareCall(auth, 'GET', '/user');
    expect(calls).toHaveLength(4);
    // القرب من الحدّ لا يُحفظ: النافذة تنقضي ولا يُعرف متى
    expect(stored()).toBeUndefined();
  });

  it('ردٌّ بلا ترويسة لا يوقف شيئاً', async () => {
    const auth = ayrshareAuth(env)!;
    const budget = new CallBudget(150);
    for (let i = 0; i < 5; i++) await ayrshareCall(auth, 'GET', '/user', undefined, budget);
    expect(calls).toHaveLength(5);
  });
});

describe('الرفض يُحفظ خمس دقائق لا يُنادى فيها Ayrshare', () => {
  it('من أي استدعاءٍ بعده: السحب يقف بلا نداء، وغيره يُقال له السبب بلا نداء', async () => {
    reply = () => ({ status: 429, body: { status: 'error', code: 429, message: 'Too many requests' } });
    const before = Date.now();
    await expect(ayrshareCall(ayrshareAuth(env)!, 'GET', '/user')).rejects.toThrow(RATE_LIMIT_ERROR);
    expect(Number(stored())).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(calls).toHaveLength(1);

    // استدعاءٌ آخر — مصادقةٌ جديدة تقرأ الرفض من الإعدادات
    reply = () => ({ body: { status: 'success' } });
    const budget = new CallBudget(150);
    await expect(ayrshareCall(ayrshareAuth(env)!, 'GET', '/user', undefined, budget)).rejects.toBeInstanceOf(BudgetExhausted);
    expect(budget.stoppedBy).toBe('rate_limit');
    await expect(ayrshareCall(ayrshareAuth(env)!, 'POST', '/analytics/social', {})).rejects.toThrow(RATE_LIMIT_ERROR);
    expect(calls).toHaveLength(1);
  });

  it('والنشر كذلك لا يُرسل في النافذة', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(AYRSHARE_RATE_KEY, String(Date.now() + 60_000));
    const provider = await getProvider(env);
    await expect(provider.publish({ text: 'منشور', platforms: ['linkedin'] } as any)).rejects.toThrow(RATE_LIMIT_ERROR);
    expect(calls).toHaveLength(0);
  });

  it('وبعد انقضائها يُنادى كما كان', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(AYRSHARE_RATE_KEY, String(Date.now() - 1000));
    await ayrshareCall(ayrshareAuth(env)!, 'GET', '/user', undefined, new CallBudget(150));
    expect(calls).toEqual(['GET /user']);
  });

  it('وتمهّلُ منصةٍ بعينها ليس رفضاً للحساب: لا يُحفظ', async () => {
    reply = () => ({ status: 429, body: { status: 'error', facebook: { code: 444, message: 'throttled' } } });
    await expect(ayrshareCall(ayrshareAuth(env)!, 'POST', '/analytics/post', {})).rejects.toThrow('طلبت المنصة التمهّل');
    expect(stored()).toBeUndefined();
  });
});
