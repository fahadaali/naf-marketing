// قراءة المؤشرات على قاعدةٍ حقيقية بالمخطّط الفعلي، وبغلافٍ يحاكي حدَّ D1.
//
// ═══ لماذا يحاكي الغلاف حدّاً لا يحدّه node:sqlite ═══
//
// المحرّك واحد، والحدُّ ليس منه: D1 يقف عند **مئة رابطة** في الاستعلام
// الواحد، وSQLite المحليّة تقبل مئاتٍ بلا شكوى. فاختبارٌ يمرّ هنا ويسقط هناك
// هو ما وقع فعلاً — قراءة اللوحة المختصرة كانت ترسل رابطةً لكل مؤشر في
// الدليل، فتجاوزت المئة بلا أن ينبّه اختبار.
//
// فالغلاف يعدّ الرابطات ويرمي كما يرمي D1. وما يمرّ به يمرّ هناك.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

import { readBoard, readLayer, upsertValue } from '../src/services/metrics';
import { periodOf } from '../src/services/period';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

/** حدّ D1 المعلن: أكثر من هذا في استعلامٍ واحد يُردّ خطأً. */
const D1_MAX_BINDINGS = 100;

/** غلافٌ يعطي `node:sqlite` واجهةَ D1 — ويرفض ما تجاوز حدَّ الرابطات كما ترفضه. */
function d1(db: any) {
  const check = (binds: unknown[]) => {
    if (binds.length > D1_MAX_BINDINGS) {
      throw new Error(`D1_ERROR: too many SQL variables (${binds.length} > ${D1_MAX_BINDINGS})`);
    }
  };
  const stmt = (sql: string, binds: unknown[] = []): any => ({
    bind: (...args: unknown[]) => stmt(sql, args),
    all: async () => (check(binds), { results: db.prepare(sql).all(...binds) }),
    first: async () => (check(binds), db.prepare(sql).get(...binds) ?? null),
    run: async () => {
      check(binds);
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

const JULY = periodOf('monthly', '2026-07-15T00:00:00Z');
const JUNE = periodOf('monthly', '2026-06-15T00:00:00Z');

let db: any;
let env: any;

beforeEach(() => {
  db = build();
  env = { DB: d1(db) };
});

describe('قراءة المؤشرات تحت حدّ الرابطات', () => {
  it('اللوحة المختصرة تُقرأ مهما كبر الدليل', async () => {
    // الدليل اليوم أكثر من مئة مؤشر — وهو ما كان يكسر القراءة
    const n = db.prepare('SELECT COUNT(*) AS n FROM metric_definitions').get().n as number;
    expect(n).toBeGreaterThan(D1_MAX_BINDINGS);

    const board = await readBoard(env, JULY);
    expect(board.length).toBe(10); // عشرة أرقام بترتيبها المسجَّل
  });

  it('قراءة الطبقات كلها لا تسرد المفاتيح رابطةً رابطة', async () => {
    const all = await readLayer(env, JULY);
    expect(all.length).toBe(db.prepare('SELECT COUNT(*) AS n FROM metric_definitions').get().n);
  });

  it('الطبقة الواحدة تُقرأ ولا تحمل مؤشرات غيرها', async () => {
    const reach = await readLayer(env, JULY, 'reach');
    expect(reach.length).toBeGreaterThan(0);
    expect(reach.every((m) => m.layer === 'reach')).toBe(true);
  });
});

describe('القيمة والقيمة السابقة والتوزيع', () => {
  it('يقرأ قيمة الفترة وقيمة سابقتها والتوزيع على البُعد', async () => {
    await upsertValue(env, JULY, { metricKey: 'reach', value: 1500, source: 'auto' });
    await upsertValue(env, JUNE, { metricKey: 'reach', value: 1000, source: 'auto' });
    await upsertValue(env, JULY, {
      metricKey: 'followers_total', dimKey: 'platform', dimValue: 'linkedin', value: 400, source: 'integration',
    });
    await upsertValue(env, JULY, {
      metricKey: 'followers_total', dimKey: 'platform', dimValue: 'x', value: 900, source: 'integration',
    });

    const layer = await readLayer(env, JULY, 'reach');
    const reach = layer.find((m) => m.key === 'reach');
    expect(reach?.value).toBe(1500);
    expect(reach?.previous).toBe(1000); // يونيو
    expect(reach?.breakdown).toEqual([]);

    const followers = layer.find((m) => m.key === 'followers_total');
    // التوزيع مرتّبٌ تنازلياً، والرقم المجمّع غائبٌ ما لم يُكتب
    expect(followers?.value).toBeNull();
    expect(followers?.breakdown.map((b) => b.dim_value)).toEqual(['x', 'linkedin']);
  });

  it('لا تُخلط قيمة طبقةٍ بقيمة أخرى عند حدّ الطبقة', async () => {
    await upsertValue(env, JULY, { metricKey: 'reach', value: 1500, source: 'auto' });
    await upsertValue(env, JULY, { metricKey: 'leads', value: 42, source: 'auto' });

    const reach = await readLayer(env, JULY, 'reach');
    expect(reach.find((m) => m.key === 'leads')).toBeUndefined();
    expect(reach.find((m) => m.key === 'reach')?.value).toBe(1500);
  });
});
