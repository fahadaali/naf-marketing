// أعدادُ المؤشرات في الوثائق تطابق ما تزرعه الهجرات.
//
// كان `docs/naf-metrics.md` و`README.md` يعدّان ١١٦ مؤشراً والقاعدة فيها
// ١٢٢: الترحيلان 0024 و0026 أضافا ستةً بعد كتابة الوثيقة ولم تُحدَّث.
// ورقمٌ في وثيقةٍ لا يحرسه شيء يتقادم بصمت — فيُقرأ اليوم صحيحاً وغداً
// خطأً، ولا أحد يعرف متى انقلب.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};

const ROOT = join(import.meta.dirname, '..');

/** الأرقام في الوثائق عربية-هندية — تُحوَّل لتُقارن. */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toArabic = (n: number) => String(n).split('').map((d) => AR_DIGITS[Number(d)]).join('');

function counts() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  const dir = join(ROOT, 'migrations');
  for (const f of readdirSync(dir).filter((f) => /^0\d+.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  const byLayer: Record<string, number> = {};
  for (const r of db.prepare('SELECT layer, COUNT(*) n FROM metric_definitions GROUP BY layer').all() as any[]) {
    byLayer[r.layer] = r.n;
  }
  const bySource: Record<string, number> = {};
  for (const r of db.prepare('SELECT source, COUNT(*) n FROM metric_definitions GROUP BY source').all() as any[]) {
    bySource[r.source] = r.n;
  }
  const total = (db.prepare('SELECT COUNT(*) n FROM metric_definitions').get() as any).n;
  return { byLayer, bySource, total };
}

/** اسم الطبقة العربي في جدول الوثيقة ← مفتاحها في القاعدة. */
const LAYER_AR: Record<string, string> = {
  'الوصول والظهور': 'reach',
  'التفاعل والمحتوى': 'engagement',
  'الموقع والبحث': 'web',
  'التحويل ومسار البيع': 'funnel',
  'التكلفة والعائد': 'cost',
  'الاحتفاظ والنمو': 'retention',
  'الجمهور والاستهداف': 'audience',
  'البريد والتواصل': 'email',
  'الإسناد والقياس': 'attribution',
  'التشغيل وجودة البيانات': 'operations',
};

describe('أعداد المؤشرات في الوثائق', () => {
  const { byLayer, bySource, total } = counts();
  const doc = readFileSync(join(ROOT, 'docs', 'naf-metrics.md'), 'utf8');
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

  it('الطبقات العشر كلُّها مذكورة، ولا طبقة في القاعدة بلا صفّ', () => {
    expect(Object.keys(byLayer).sort()).toEqual(Object.values(LAYER_AR).sort());
  });

  it('عدد كل طبقة في جدول الوثيقة يطابق القاعدة', () => {
    const wrong: string[] = [];
    for (const [ar, key] of Object.entries(LAYER_AR)) {
      const row = new RegExp(`\\|\\s*${ar}\\s*\\|\\s*([٠-٩]+)\\s*\\|`).exec(doc);
      if (!row) { wrong.push(`${ar}: لا صفّ لها في الوثيقة`); continue; }
      const expected = toArabic(byLayer[key]);
      if (row[1] !== expected) wrong.push(`${ar}: الوثيقة ${row[1]} والقاعدة ${expected}`);
    }
    expect(wrong).toEqual([]);
  });

  it('«اثنان وستون تُحتسب آلياً» ما زالت صحيحة', () => {
    expect(bySource.auto).toBe(62);
    expect(doc).toContain('اثنان وستون منها تُحتسب آلياً');
  });

  it('المجموع في README يطابق القاعدة', () => {
    expect(total).toBe(
      Object.values(byLayer).reduce((a, b) => a + b, 0),
    );
    // مكتوبٌ بالحروف، فيُفحص وجودُ العدد لا صيغتُه
    expect(readme, `المجموع الحقيقي ${total}`).toContain('مئةٌ واثنان وعشرون مؤشراً');
    expect(total).toBe(122);
  });
});
