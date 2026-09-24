// احتساب الفترات الماضية على دفعات.
//
// الليل يحتسب الجارية والسابقة، وما قبلهما يدور عليه هذا: ثلاث فتراتٍ في كل
// ساعة، ما لم يُحتسب قطّ أوّلاً ثم أقدمُها احتساباً — فتُفتح السنة الماضية
// بأرقامها لا فارغة.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const { computed } = vi.hoisted(() => ({ computed: [] as string[] }));
vi.mock('../src/services/metrics', () => ({
  computeAuto: vi.fn(async (_env: unknown, p: { kind: string; start: string }) => {
    computed.push(`${p.kind}:${p.start}`);
    return { period: p, written: 0 };
  }),
}));

import { pastPeriods, recomputePastPeriods } from '../src/services/metricsHistory';
import { periodOf, previousPeriod } from '../src/services/period';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function d1(db: any) {
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    sql,
    binds,
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...binds) }),
    first: async () => db.prepare(sql).get(...binds) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...binds).changes } }),
  });
  return { prepare: (sql: string) => stmt(sql) };
}

let env: any;
const AT = new Date('2026-09-24T10:58:00Z');

beforeEach(() => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  env = { DB: d1(db) };
  computed.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('الفترات الماضية', () => {
  it('تبدأ قبل السابقة — الجارية والسابقة يحتسبهما الليل', () => {
    const periods = pastPeriods(AT);
    expect(periods).toHaveLength(12 + 12 + 4 + 1);
    for (const kind of ['weekly', 'monthly', 'quarterly', 'annual'] as const) {
      const current = periodOf(kind, AT);
      const starts = periods.filter((p) => p.kind === kind).map((p) => p.start);
      expect(starts).not.toContain(current.start);
      expect(starts).not.toContain(previousPeriod(current).start);
    }
    // سنةٌ من الأشهر قبل السابق: من يوليو ٢٠٢٦ رجوعاً إلى أغسطس ٢٠٢٥
    const months = periods.filter((p) => p.kind === 'monthly').map((p) => p.start);
    expect(months[0]).toBe('2026-07-01');
    expect(months.at(-1)).toBe('2025-08-01');
    expect(periods.find((p) => p.kind === 'annual')?.start).toBe('2024-01-01');
  });

  it('يحتسب فترتين في كل دفعة، ويدور حتى يبلغها كلَّها ثم يبدأ بأقدمها احتساباً', async () => {
    // ساعةٌ بين الدفعات كما في الجدول — فلكلّ دفعةٍ وقتُ احتسابها
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT);
    const hour = () => vi.setSystemTime(Date.now() + 3_600_000);
    const key = (p: { kind: string; start: string }) => `${p.kind}:${p.start}`;

    const first = await recomputePastPeriods(env, AT);
    expect(first).toHaveLength(2);
    hour();
    const second = await recomputePastPeriods(env, AT);

    for (let i = 0; i < 13; i++) {
      hour();
      await recomputePastPeriods(env, AT);
    }
    // خمس عشرة دفعةً من اثنتين تبلغ التسع والعشرين كلَّها
    expect(new Set(computed).size).toBe(29);

    computed.length = 0;
    hour();
    await recomputePastPeriods(env, AT);
    /* والتسع والعشرون لا تنقسم على اثنتين: الخامسة عشرة أتمّت آخر فترةٍ
       وأعادت أقدم ما احتُسب — أولى الدفعة الأولى. فالسادسة عشرة تأخذ ثانيتها
       ثم أولى الثانية: أقدمُها احتساباً، لا ما جاء أوّلاً في القائمة. */
    expect(computed).toEqual([key(first[1]), key(second[0])]);
  });

  it('فترةٌ يتعذّر احتسابها تنتقل إلى آخر الدور ولا تبقى أوّله', async () => {
    const { computeAuto } = await import('../src/services/metrics');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT);
    const [broken] = pastPeriods(AT);
    vi.mocked(computeAuto).mockImplementation(async (_env: any, p: any) => {
      computed.push(`${p.kind}:${p.start}`);
      if (p.start === broken.start && p.kind === broken.kind) throw new Error('تعذّر');
      return { period: p, written: 0 };
    });

    await recomputePastPeriods(env, AT);
    computed.length = 0;
    vi.setSystemTime(Date.now() + 3_600_000);
    await recomputePastPeriods(env, AT);
    expect(computed).not.toContain(`${broken.kind}:${broken.start}`);
  });
});
