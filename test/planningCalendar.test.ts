// أشهر التقويم وأيامه بتقويم الرياض — بلا `setMonth` ولا تاريخٍ محلّي.

import { describe, it, expect } from 'vitest';
import {
  riyadhYmd, riyadhToday, monthOf, shiftMonth, daysInMonth, monthBounds, monthCells,
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
