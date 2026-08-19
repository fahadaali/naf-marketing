// سلاسل المؤشرات — القارئ الذي يرسم خطّ الاتجاه في البطاقة.
//
// ‏`readSeries` والمسار `‎/metrics/series/:key` كانا مبنيَّين بلا شاشة
// تقرؤهما. وحين بُنيت الشاشة لزم قارئٌ يجمع مفاتيح اللوحة في نداءٍ
// واحد — عشر بطاقات في اللوحة وأربعٌ وعشرون في أوسع طبقة، ونداءٌ لكل
// بطاقة كلفةٌ لا يبرّرها خطٌّ بعرض أربعة وستين بكسلاً.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { readSeriesBulk, readSeries } from '../src/services/metrics';
import type { Env } from '../src/types';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const ROOT = join(import.meta.dirname, '..');

/** يلفّ node:sqlite بواجهة D1 — نفس ما تفعله بقية اختبارات المؤشرات. */
function envOf(db: any): Env {
  return {
    DB: {
      prepare(sql: string) {
        const st = {
          _b: [] as unknown[],
          bind(...b: unknown[]) { st._b = b; return st; },
          async all() { return { results: db.prepare(sql).all(...st._b) }; },
          async first() { return db.prepare(sql).get(...st._b) ?? null; },
          async run() { return { meta: { changes: db.prepare(sql).run(...st._b).changes } }; },
        };
        return st;
      },
    },
  } as unknown as Env;
}

function seeded() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  const dir = join(ROOT, 'migrations');
  for (const f of readdirSync(dir).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }

  const put = (key: string, start: string, value: number, dimKey = '', dimValue = '') =>
    db.prepare(
      `INSERT OR REPLACE INTO metric_values
         (metric_key, period, period_start, period_end, dim_key, dim_value, value, source)
       VALUES (?, 'weekly', ?, ?, ?, ?, ?, 'auto')`,
    ).run(key, start, start, dimKey, dimValue, value);

  // ثلاث فترات لمؤشرين، بترتيب إدخالٍ مختلطٍ عمداً
  put('sessions', '2026-07-13', 300);
  put('sessions', '2026-06-29', 100);
  put('sessions', '2026-07-06', 200);
  put('leads', '2026-07-06', 12);
  put('leads', '2026-06-29', 9);
  // صفٌّ ببُعد — يجب ألّا يدخل السلسلة، وإلا اختلط المجموع بتفصيله
  put('sessions', '2026-07-13', 999, 'channel', 'organic');
  // وفترةٌ من نوعٍ آخر
  db.prepare(
    `INSERT OR REPLACE INTO metric_values
       (metric_key, period, period_start, period_end, dim_key, dim_value, value, source)
     VALUES ('sessions', 'monthly', '2026-07-01', '2026-07-31', '', '', 5000, 'auto')`,
  ).run();

  return envOf(db);
}

describe('readSeriesBulk', () => {
  it('يجمع سلاسل عدّة مفاتيح مرتّبةً من الأقدم إلى الأحدث', async () => {
    const out = await readSeriesBulk(seeded(), ['sessions', 'leads'], 'weekly');
    expect(out.sessions.map((p) => p.value)).toEqual([100, 200, 300]);
    expect(out.sessions.map((p) => p.period_start)).toEqual(['2026-06-29', '2026-07-06', '2026-07-13']);
    expect(out.leads.map((p) => p.value)).toEqual([9, 12]);
  });

  it('لا يخلط قيمة الأبعاد بالمجموع', async () => {
    const out = await readSeriesBulk(seeded(), ['sessions'], 'weekly');
    expect(out.sessions.map((p) => p.value)).not.toContain(999);
  });

  it('يفصل بين أنواع الفترات', async () => {
    const out = await readSeriesBulk(seeded(), ['sessions'], 'monthly');
    expect(out.sessions.map((p) => p.value)).toEqual([5000]);
  });

  it('الحدّ لكل مفتاح لا للاستعلام كلّه', async () => {
    // حدٌّ واحد على استعلامٍ يجمع المفاتيح يقصّ سلسلةً ويترك أخرى
    const out = await readSeriesBulk(seeded(), ['sessions', 'leads'], 'weekly', 2);
    expect(out.sessions).toHaveLength(2);
    expect(out.leads).toHaveLength(2);
    // والمقصوص أقدمُها لا أحدثها
    expect(out.sessions.map((p) => p.value)).toEqual([200, 300]);
  });

  it('مفتاحٌ بلا قيم لا يظهر أصلاً، وقائمةٌ فارغة تعطي كائناً فارغاً', async () => {
    const env = seeded();
    expect(await readSeriesBulk(env, [], 'weekly')).toEqual({});
    const out = await readSeriesBulk(env, ['sessions', 'مؤشر-لا-وجود-له'], 'weekly');
    expect(Object.keys(out)).toEqual(['sessions']);
  });

  it('يوافق readSeries للمفتاح الواحد — قارئان لا يفترقان', async () => {
    const env = seeded();
    const one = await readSeries(env, 'sessions', 'weekly');
    const many = await readSeriesBulk(env, ['sessions'], 'weekly');
    expect(many.sessions).toEqual(one);
  });
});
