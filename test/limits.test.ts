// حصص المزامنة بحسب الخطة، واحتياطها.
//
// الخطة المدفوعة ترفع الحصص، وما يُثبَّت هنا هو الاحتياط: الغياب مجانية،
// وللخطّاف والسحب اليدوي سقفُ وقت، ودورةٌ سقطت تُنزل الحصص يوماً كاملاً —
// ولا تُنزلها دورةٌ جارية ولا دورةٌ أتمّت تقريرها.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { runLimits, noteDeadRun, declaredPlan } from '../src/services/limits';
import { BudgetExhausted, CallBudget } from '../src/adapters/socialapi';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    sql,
    binds,
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...binds);
      return { meta: { changes: r.changes } };
    },
  });
  return { prepare: (sql: string) => stmt(sql) };
}

function build(): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  return db;
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

let db: any;

beforeEach(() => {
  db = build();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('الحصص بحسب الخطة', () => {
  it('يفترض المجانية حين لا تُعلَن الخطة — الافتراض الآمن', async () => {
    const env: any = { DB: d1(db) };
    expect(declaredPlan(env)).toBe('free');
    const l = await runLimits(env, 'cron');
    expect(l.calls).toBe(40);
    expect(l.plan).toBe('free');
    expect(l.fallback).toBe(false);
  });

  it('يرفع حصص المجدولة والسحب اليدوي في المدفوعة، ولا يرفع حصّة الخطّاف', async () => {
    const env: any = { DB: d1(db), WORKERS_PLAN: 'paid' };
    expect((await runLimits(env, 'cron')).calls).toBe(150);
    expect((await runLimits(env, 'manual')).calls).toBe(60);
    // الخطّاف يعمل بعد الردّ على المزوّد، وله ثلاثون ثانيةً في الخطتين
    expect((await runLimits(env, 'webhook')).calls).toBe(30);
  });

  it('يجعل لكل دورةٍ سقف وقت: عشرون ثانيةً للخطّاف، وثماني دقائق للمجدولة', async () => {
    const env: any = { DB: d1(db), WORKERS_PLAN: 'paid' };
    const before = Date.now();
    const hook = await runLimits(env, 'webhook');
    const cron = await runLimits(env, 'cron');
    expect(hook.deadline - before).toBeGreaterThanOrEqual(20_000);
    expect(hook.deadline - before).toBeLessThan(21_000);
    expect(cron.deadline - before).toBeGreaterThanOrEqual(8 * 60_000);
    expect(cron.deadline - before).toBeLessThan(8 * 60_000 + 1000);
  });
});

describe('الاحتياط: دورةٌ سقطت تُنزل الحصص يوماً', () => {
  it('ينزل إلى حصص المجانية بعد دورةٍ بدأت ولم تكتب تقريرها', async () => {
    const env: any = { DB: d1(db), WORKERS_PLAN: 'paid' };
    // بدأت قبل عشرين دقيقة، وآخر تقريرٍ كُتب قبل أربعين
    expect(await noteDeadRun(env, ago(20), ago(40))).toBe(true);
    const l = await runLimits(env, 'cron');
    expect(l.calls).toBe(40);
    expect(l.plan).toBe('paid');
    expect(l.fallback).toBe(true);
  });

  it('يعود إلى المدفوعة بعد يومٍ كامل', async () => {
    const env: any = { DB: d1(db), WORKERS_PLAN: 'paid' };
    await noteDeadRun(env, ago(20), ago(40));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 3_600_000);
    const l = await runLimits(env, 'cron');
    expect(l.calls).toBe(150);
    expect(l.fallback).toBe(false);
  });

  it('لا تُنزلها دورةٌ أتمّت تقريرها، ولا دورةٌ ما زالت تجري، ولا قفلٌ غائب', async () => {
    const env: any = { DB: d1(db), WORKERS_PLAN: 'paid' };
    // التقرير بعد القفل: أتمّت
    expect(await noteDeadRun(env, ago(40), ago(39))).toBe(false);
    // بدأت قبل خمس دقائق: قد تكون جاريةً بعد
    expect(await noteDeadRun(env, ago(5), ago(40))).toBe(false);
    expect(await noteDeadRun(env, null, ago(40))).toBe(false);
    expect((await runLimits(env, 'cron')).fallback).toBe(false);
  });

  it('لا يسجّل احتياطاً في المجانية — حصصها هي الاحتياط', async () => {
    const env: any = { DB: d1(db) };
    expect(await noteDeadRun(env, ago(20), ago(40))).toBe(false);
  });
});

describe('ميزانية الدورة تقف ولا تسقط', () => {
  it('تنفد عند سقف الوقت كما تنفد عند عدد النداءات', () => {
    const b = new CallBudget(100, Date.now() - 1);
    expect(b.left).toBe(0);
    expect(() => b.spend()).toThrow(BudgetExhausted);
  });

  it('تقف حين يطلب المزوّد التمهّل، وتقول لماذا', () => {
    const b = new CallBudget(100);
    b.spend();
    b.stop('rate_limit');
    expect(b.left).toBe(0);
    expect(b.stoppedBy).toBe('rate_limit');
    expect(() => b.spend()).toThrow(BudgetExhausted);
  });
});
