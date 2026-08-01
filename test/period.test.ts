// حدود الفترات — الموضع الذي ينزلق فيه يومٌ كامل بلا أن يُلاحظ.
//
// كل رقم في `metric_values` مؤرَّخ بفترة، والفترة تُحسب بتوقيت الرياض بينما
// الأعمدة مخزّنة UTC. فخطأ ثلاث ساعات هنا ينقل منشورَ الواحدة صباحاً إلى
// الأسبوع الماضي، ويُنقص من كل أسبوعٍ ثلاثَ ساعاتٍ من طرفيه بلا سطرِ خطأ.

import { describe, it, expect } from 'vitest';
import { periodOf, previousPeriod, periodBoundsUtc, periodDays, parsePeriod, riyadhToday } from '../src/services/period';

describe('periodOf', () => {
  it('يبدأ الأسبوع بالأحد — أوّل أيام العمل في السعودية', () => {
    // 2026-08-01 سبت. أحدُ أسبوعه هو 2026-07-26.
    expect(periodOf('weekly', '2026-08-01T09:00:00Z')).toEqual({
      kind: 'weekly', start: '2026-07-26', end: '2026-08-01',
    });
    // والأحد نفسه يبدأ أسبوعه لا يُنسب لما قبله
    expect(periodOf('weekly', '2026-07-26T09:00:00Z').start).toBe('2026-07-26');
  });

  it('ينسب اللحظة إلى يومها في الرياض لا في غرينتش', () => {
    /* 2026-08-01T22:30Z سبتٌ في غرينتش، وهو 2026-08-02T01:30 بالرياض — أحدٌ
       جديد. فالحساب من UTC يضعه في الأسبوع المنتهي، والحسابُ الصحيح يبدأ به
       أسبوعاً. وهذه بعينها الساعاتُ الثلاث التي تنزلق. */
    expect(periodOf('weekly', '2026-08-01T22:30:00Z').start).toBe('2026-08-02');
    expect(periodOf('weekly', '2026-08-01T18:30:00Z').start).toBe('2026-07-26');
    expect(riyadhToday('2026-08-01T22:30:00Z')).toBe('2026-08-02');
    // وحدُّ الشهر ينزلق كما ينزلق حدُّ الأسبوع
    expect(periodOf('monthly', '2026-07-31T22:00:00Z').start).toBe('2026-08-01');
  });

  it('يضبط آخر يوم في الشهر ولو كان كبيساً', () => {
    expect(periodOf('monthly', '2026-02-10T00:00:00Z')).toEqual({ kind: 'monthly', start: '2026-02-01', end: '2026-02-28' });
    expect(periodOf('monthly', '2028-02-10T00:00:00Z').end).toBe('2028-02-29');
    expect(periodOf('monthly', '2026-12-31T00:00:00Z')).toEqual({ kind: 'monthly', start: '2026-12-01', end: '2026-12-31' });
  });

  it('يقسم السنة أرباعاً بحدودها الصحيحة', () => {
    expect(periodOf('quarterly', '2026-08-01T00:00:00Z')).toEqual({ kind: 'quarterly', start: '2026-07-01', end: '2026-09-30' });
    expect(periodOf('quarterly', '2026-11-20T00:00:00Z')).toEqual({ kind: 'quarterly', start: '2026-10-01', end: '2026-12-31' });
    expect(periodOf('annual', '2026-08-01T00:00:00Z')).toEqual({ kind: 'annual', start: '2026-01-01', end: '2026-12-31' });
  });
});

describe('previousPeriod', () => {
  it('يعبر حدّ السنة في الأسبوع والشهر والربع', () => {
    expect(previousPeriod(periodOf('monthly', '2027-01-15T00:00:00Z'))).toEqual({
      kind: 'monthly', start: '2026-12-01', end: '2026-12-31',
    });
    expect(previousPeriod(periodOf('quarterly', '2027-01-15T00:00:00Z')).start).toBe('2026-10-01');
    // أسبوعُ 2027-01-03 السابقُ ينتهي 2027-01-02
    expect(previousPeriod(periodOf('weekly', '2027-01-05T00:00:00Z')).end).toBe('2027-01-02');
  });
});

describe('periodBoundsUtc', () => {
  it('يزيح الحدّين ثلاث ساعات، والنهاية حصرية', () => {
    // شهرٌ يبدأ 2026-08-01 بالرياض يبدأ 2026-07-31T21:00Z
    expect(periodBoundsUtc(periodOf('monthly', '2026-08-10T00:00:00Z'))).toEqual({
      from: '2026-07-31T21:00:00Z',
      to: '2026-08-31T21:00:00Z',
    });
  });

  it('يجعل شهرين متتاليين متلاصقين بلا فجوة ولا تداخل', () => {
    const july = periodBoundsUtc(periodOf('monthly', '2026-07-10T00:00:00Z'));
    const august = periodBoundsUtc(periodOf('monthly', '2026-08-10T00:00:00Z'));
    expect(july.to).toBe(august.from);
  });
});

describe('periodDays', () => {
  it('يعدّ أيام الفترة شاملةً طرفيها', () => {
    expect(periodDays(periodOf('weekly', '2026-08-01T00:00:00Z'))).toBe(7);
    expect(periodDays(periodOf('monthly', '2026-02-10T00:00:00Z'))).toBe(28);
    expect(periodDays(periodOf('annual', '2026-08-01T00:00:00Z'))).toBe(365);
  });
});

describe('parsePeriod', () => {
  it('يردّ أيَّ يومٍ في الفترة إلى بدايتها — فلا مفتاحان لفترة واحدة', () => {
    // الأربعاء 2026-07-29 يُردّ إلى أحد أسبوعه
    expect(parsePeriod('weekly', '2026-07-29')?.start).toBe('2026-07-26');
    expect(parsePeriod('monthly', '2026-07-29')?.start).toBe('2026-07-01');
  });

  it('يرفض ما ليس نوعاً ولا تاريخاً', () => {
    expect(parsePeriod('daily', '2026-07-29')).toBeNull();
    expect(parsePeriod('monthly', '29/07/2026')).toBeNull();
    expect(parsePeriod('monthly', undefined)).toBeNull();
  });
});
