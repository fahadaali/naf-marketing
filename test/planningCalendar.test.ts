// أشهر التقويم وأيامه بتقويم الرياض — بلا `setMonth` ولا تاريخٍ محلّي.

import { describe, it, expect } from 'vitest';
import {
  riyadhYmd, riyadhToday, monthOf, shiftMonth, daysInMonth, monthBounds, monthCells, groupByPostDay,
} from '../web/src/planning';

describe('shiftMonth', () => {
  it('من ٣١ يناير إلى فبراير — العطل الذي كان يتخطّى شهراً', () => {
    expect(shiftMonth(monthOf('2026-01-31'), 1)).toEqual({ year: 2026, month: 2 });
  });

  it('يعبر السنة في الاتجاهين', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 3 }, -14)).toEqual({ year: 2025, month: 1 });
  });
});

describe('daysInMonth', () => {
  it('فبراير الكبيسة وغيرها', () => {
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28);
    expect(daysInMonth({ year: 2026, month: 10 })).toBe(31);
  });
});

describe('monthBounds', () => {
  it('أوّل الشهر وآخره، ولحظتا البداية بتوقيت الرياض', () => {
    expect(monthBounds({ year: 2026, month: 11 })).toEqual({
      first: '2026-11-01',
      last: '2026-11-30',
      fromIso: '2026-10-31T21:00:00.000Z',
      toIso: '2026-11-30T21:00:00.000Z',
    });
  });

  it('ديسمبر ينتهي عند أوّل يناير التالي', () => {
    expect(monthBounds({ year: 2026, month: 12 }).toIso).toBe('2026-12-31T21:00:00.000Z');
  });
});

describe('monthCells', () => {
  it('الأسبوع يبدأ بالأحد: أكتوبر ٢٠٢٦ يبدأ خميساً', () => {
    const cells = monthCells({ year: 2026, month: 10 });
    expect(cells.slice(0, 4).every((c) => c.day === null)).toBe(true);
    expect(cells[4]).toEqual({ day: 1, ymd: '2026-10-01' });
    expect(cells.length % 7).toBe(0);
    expect(cells.filter((c) => c.day !== null)).toHaveLength(31);
  });

  it('شهرٌ يبدأ أحداً لا فراغ قبله', () => {
    expect(monthCells({ year: 2026, month: 11 })[0]).toEqual({ day: 1, ymd: '2026-11-01' });
  });
});

describe('اليوم بتقويم الرياض', () => {
  it('لحظةٌ قبل منتصف الليل بغرينتش يومٌ تالٍ في الرياض', () => {
    expect(riyadhYmd('2026-11-19T23:30:00.000Z')).toBe('2026-11-20');
    expect(riyadhYmd('2026-11-19T20:59:59Z')).toBe('2026-11-19');
  });

  it('اليوم والشهر من الرياض لا من الجهاز', () => {
    expect(riyadhToday(new Date('2026-01-31T22:00:00Z'))).toBe('2026-02-01');
    expect(monthOf(riyadhToday(new Date('2026-01-31T22:00:00Z')))).toEqual({ year: 2026, month: 2 });
  });
});

describe('groupByPostDay', () => {
  const row = (id: string, post_id: string, platform: string, scheduled_at: string) =>
    ({ id, post_id, platform, scheduled_at, title: `عنوان ${post_id}` });

  it('محتوى على ثلاث منصات في يومه بطاقةٌ واحدة بشعاراتها الثلاثة', () => {
    const byDay = groupByPostDay([
      row('s1', 'p1', 'instagram', '2026-11-15T09:00:00.000Z'),
      row('s2', 'p1', 'x', '2026-11-15T09:00:00.000Z'),
      row('s3', 'p1', 'linkedin', '2026-11-15T09:00:00.000Z'),
    ]);
    expect(Object.keys(byDay)).toEqual(['2026-11-15']);
    expect(byDay['2026-11-15']).toHaveLength(1);
    expect(byDay['2026-11-15'][0]).toMatchObject({ post_id: 'p1', title: 'عنوان p1', platforms: ['linkedin', 'x', 'instagram'] });
  });

  it('منصةٌ نُقل موعدها إلى يومٍ آخر: بطاقةٌ في كل يوم بمنصاته فيه', () => {
    const byDay = groupByPostDay([
      row('s1', 'p1', 'x', '2026-11-15T09:00:00.000Z'),
      row('s2', 'p1', 'linkedin', '2026-11-16T09:00:00.000Z'),
    ]);
    expect(byDay['2026-11-15'][0].platforms).toEqual(['x']);
    expect(byDay['2026-11-16'][0].platforms).toEqual(['linkedin']);
  });

  it('اليوم بتقويم الرياض: ٢١:٣٠ غرينتش في اليوم التالي', () => {
    const byDay = groupByPostDay([row('s1', 'p1', 'x', '2026-11-14T21:30:00.000Z')]);
    expect(Object.keys(byDay)).toEqual(['2026-11-15']);
  });

  it('المنصة المجدولة مرتين شعارٌ واحد، والوقتان باقيان، والبطاقات بأبكر موعد', () => {
    const byDay = groupByPostDay([
      row('s1', 'p2', 'x', '2026-11-15T12:00:00.000Z'),
      row('s2', 'p1', 'x', '2026-11-15T10:00:00.000Z'),
      row('s3', 'p1', 'x', '2026-11-15T08:00:00.000Z'),
    ]);
    const [first, second] = byDay['2026-11-15'];
    expect(first).toMatchObject({ post_id: 'p1', platforms: ['x'], first_at: '2026-11-15T08:00:00.000Z' });
    expect(first.slots.map((s) => s.at)).toEqual(['2026-11-15T08:00:00.000Z', '2026-11-15T10:00:00.000Z']);
    expect(second.post_id).toBe('p2');
  });
});
