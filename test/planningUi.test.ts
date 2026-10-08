// خطة المحتوى في الواجهة — المحاور، والأسابيع، والاستيراد. دوالّ صافية من
// `web/src/planning.ts`، كما تُختبر أشهر التقويم في `planningCalendar.test.ts`.

import { describe, it, expect } from 'vitest';
import {
  pillarsFrom, PILLAR_MAX, planFromPost, planPayload, dayDate, EMPTY_PLAN, groupByPlannedDay,
  addDays, weekStart, forwardRange, pivotWeeks, PIVOT_MAX_WEEKS,
  rowsFromTable, mapImportRow, exportDay, type ImportContext,
  canDropOnDay,
} from '../web/src/planning';
import { FORMAT_LABELS } from '../web/src/api';
import { FORMAT_TYPE, PILLAR_MAX as SERVER_PILLAR_MAX } from '../src/services/planning';

describe('الأشكال والحدود بين الخادم والواجهة', () => {
  it('مفاتيح الأشكال نفسها في الطرفين — شكلٌ بلا تسمية يُعرض مفتاحاً خاماً', () => {
    expect(Object.keys(FORMAT_LABELS).sort()).toEqual(Object.keys(FORMAT_TYPE).sort());
  });

  it('حدّ طول المحور واحد', () => {
    expect(PILLAR_MAX).toBe(SERVER_PILLAR_MAX);
  });
});

describe('planFromPost وplanPayload', () => {
  it('صفّ الخادم ← حقول الشاشة، والفارغ نصٌّ فارغ', () => {
    expect(planFromPost({
      planned_on: '2026-11-03', planned_platforms: '["x","linkedin"]', format: 'carousel',
      assignee_id: 'usr_1', pillar: 'توعية', campaign_id: 'cmp_1', brief: 'ملخّص',
    })).toEqual({
      planned_on: '2026-11-03', planned_platforms: ['x', 'linkedin'], format: 'carousel',
      assignee_id: 'usr_1', pillar: 'توعية', campaign_id: 'cmp_1', brief: 'ملخّص',
    });
    expect(planFromPost({ planned_on: null, planned_platforms: null, format: null, content_type: 'video' }))
      .toEqual({ ...EMPTY_PLAN, format: 'video' });
  });

  it('حقول الشاشة ← الخادم: الفارغ null يمسح، والمنصات مصفوفة', () => {
    expect(planPayload(EMPTY_PLAN)).toEqual({
      planned_on: null, planned_platforms: null, format: 'text', assignee_id: null, pillar: null, campaign_id: null, brief: null,
    });
    expect(planPayload({ ...EMPTY_PLAN, planned_platforms: ['x'], brief: '  فكرة  ' }))
      .toMatchObject({ planned_platforms: ['x'], brief: 'فكرة' });
  });

  it('dayDate يومٌ محلّيّ بلا إزاحة', () => {
    const d = dayDate('2026-11-03');
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 11, 3]);
  });
});

describe('pillarsFrom', () => {
  it('نصوصٌ مقصوصة بلا فراغ ولا تكرار، بترتيبها', () => {
    expect(pillarsFrom({ content_pillars: [' توعية نظامية ', 'قصص عملاء', 'توعية نظامية', '', '  '] }))
      .toEqual(['توعية نظامية', 'قصص عملاء']);
  });

  it('ما ليس مصفوفةً أو ليس نصّاً لا يُسقط الشاشة', () => {
    expect(pillarsFrom(undefined)).toEqual([]);
    expect(pillarsFrom({})).toEqual([]);
    expect(pillarsFrom({ content_pillars: 'توعية' })).toEqual([]);
    expect(pillarsFrom({ content_pillars: [1, null, { a: 1 }, 'قصص'] })).toEqual(['قصص']);
  });

  it('الطول بحدّ الخادم', () => {
    expect(pillarsFrom({ content_pillars: ['م'.repeat(200)] })[0]).toHaveLength(PILLAR_MAX);
  });
});

describe('groupByPlannedDay', () => {
  it('بيومه المستهدف وبترتيب الخادم، وما لا يومَ له خارج التقويم', () => {
    const byDay = groupByPlannedDay([
      { id: 'a', planned_on: '2026-11-03' },
      { id: 'b', planned_on: null },
      { id: 'c', planned_on: '2026-11-03' },
      { id: 'd', planned_on: '2026-11-05' },
      { id: 'e' },
    ]);
    expect(Object.keys(byDay)).toEqual(['2026-11-03', '2026-11-05']);
    expect(byDay['2026-11-03'].map((p) => p.id)).toEqual(['a', 'c']);
  });
});

describe('الأيام والأسابيع', () => {
  it('addDays يعبر الشهر والسنة والكبيسة', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('weekStart أحدُ الأسبوع — والأحد نفسه بدايةُ أسبوعه', () => {
    expect(weekStart('2026-10-08')).toBe('2026-10-04'); // خميس
    expect(weekStart('2026-10-04')).toBe('2026-10-04'); // أحد
    expect(weekStart('2026-10-10')).toBe('2026-10-04'); // سبت
    expect(weekStart('2027-01-01')).toBe('2026-12-27'); // يعبر السنة
  });
});

describe('forwardRange', () => {
  it('«الشهر القادم» أوّله إلى آخره، ومن ديسمبر إلى يناير التالي', () => {
    expect(forwardRange('next_month', '2026-10-08')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(forwardRange('next_month', '2026-12-31')).toEqual({ from: '2027-01-01', to: '2027-01-31' });
  });

  it('«خلال 3 أشهر» من اليوم، ونهاية شهرٍ أقصر تُقصّ', () => {
    expect(forwardRange('within_3_months', '2026-10-08')).toEqual({ from: '2026-10-08', to: '2027-01-07' });
    expect(forwardRange('within_3_months', '2026-11-30')).toEqual({ from: '2026-11-30', to: '2027-02-27' });
  });
});

describe('pivotWeeks', () => {
  const row = (planned_on: string | null, keys: string[]) => ({ planned_on, keys });
  const keysOf = (r: { keys: string[] }) => r.keys;

  it('أسابيع متّصلة والفارغ منها صفٌّ بأصفار', () => {
    const { weeks } = pivotWeeks([row('2026-10-05', ['a']), row('2026-10-20', ['a'])], keysOf);
    expect(weeks.map((w) => [w.start, w.end, w.total])).toEqual([
      ['2026-10-04', '2026-10-10', 1],
      ['2026-10-11', '2026-10-17', 0],
      ['2026-10-18', '2026-10-24', 1],
    ]);
  });

  it('متعدّد المفاتيح يُعدّ في كلٍّ منها ومرةً في الإجمالي، وبلا مفتاح في «بلا …»', () => {
    const { weeks, keys } = pivotWeeks([row('2026-10-05', ['x', 'linkedin']), row('2026-10-06', [])], keysOf);
    expect(weeks[0].counts).toEqual({ x: 1, linkedin: 1, '': 1 });
    expect(weeks[0].total).toBe(2);
    expect(keys.sort()).toEqual(['', 'linkedin', 'x']);
  });

  it('ما لا يومَ له خارج العرض، والنطاق يحدّ الأسابيع', () => {
    const { weeks } = pivotWeeks(
      [row(null, ['a']), row('2026-09-30', ['a']), row('2026-10-05', ['a'])],
      keysOf,
      { from: '2026-10-01', to: '2026-10-14' },
    );
    expect(weeks.map((w) => w.start)).toEqual(['2026-09-27', '2026-10-04', '2026-10-11']);
    expect(weeks.map((w) => w.total)).toEqual([0, 1, 0]);
  });

  it('لا صفوف ولا نطاق: لا أسابيع', () => {
    expect(pivotWeeks([], keysOf)).toEqual({ weeks: [], keys: [], truncated: false });
  });

  it('النطاق الأوسع من الحدّ يُقطع ويُقال', () => {
    const r = pivotWeeks([row('2026-01-04', ['a']), row('2028-12-31', ['a'])], keysOf);
    expect(r.weeks).toHaveLength(PIVOT_MAX_WEEKS);
    expect(r.truncated).toBe(true);
  });
});

describe('الاستيراد', () => {
  const ctx: ImportContext = {
    platforms: [{ key: 'x', label: 'إكس' }, { key: 'linkedin', label: 'لينكدإن' }],
    assignees: [{ id: 'usr_1', name: 'سارة' }],
    pillars: ['توعية نظامية'],
    campaigns: [{ id: 'cmp_1', name: 'رمضان' }],
    formats: FORMAT_LABELS,
  };

  it('الرؤوس العربية المسجّلة واللاتينية، بتشكيلٍ أو بدونه', () => {
    const rows = rowsFromTable([
      ['العنوان', 'الشكل', 'يوم النشر المستهدف', 'منصات التواصل', 'مسؤول التنفيذ', 'محور المحتوى', 'ملخّص الفكرة', 'الحملة', 'عمود آخر'],
      ['فكرة أولى', 'قصة', '2026/10/31', 'إكس، لينكدإن', 'سارة', 'توعية نظامية', 'ملخص', 'رمضان', 'يُتجاهل'],
      ['', '', '', '', '', '', '', '', ''],
    ]);
    expect(rows).toEqual([{
      title: 'فكرة أولى', format: 'قصة', planned_on: '2026/10/31', planned_platforms: 'إكس، لينكدإن',
      assignee: 'سارة', pillar: 'توعية نظامية', brief: 'ملخص', campaign: 'رمضان',
    }]);
    expect(rowsFromTable([['Title', 'brief', 'planned_on'], ['t', 'b', '2026-10-31']]))
      .toEqual([{ title: 't', brief: 'b', planned_on: '2026-10-31' }]);
  });

  it('بلا عمود عنوانٍ فالعمود الأول عنوان', () => {
    expect(rowsFromTable([['x', 'المحتوى'], ['عنوان', 'نص']])).toEqual([{ title: 'عنوان', body: 'نص' }]);
  });

  it('الأسماء ← المعرّفات والمفاتيح، واليوم بأرقامٍ هندية', () => {
    const { item, unmatched } = mapImportRow({
      title: 'فكرة', format: 'قصة', planned_on: '٢٠٢٦/١٠/٣١', planned_platforms: 'إكس، linkedin، إكس',
      assignee: 'سارة', pillar: 'توعية نظامية', brief: 'ملخص', campaign: 'رمضان',
    }, ctx);
    expect(item).toEqual({
      title: 'فكرة', body: '', format: 'story', planned_on: '2026-10-31', planned_platforms: ['x', 'linkedin'],
      assignee_id: 'usr_1', pillar: 'توعية نظامية', brief: 'ملخص', campaign_id: 'cmp_1',
    });
    expect(unmatched).toBe(0);
  });

  it('ما لم يُطابَق يُترك فارغاً ويُعدّ — والمنصات قيمةً قيمة', () => {
    const { item, unmatched } = mapImportRow({
      title: 'فكرة', format: 'بودكاست', planned_on: '2026/02/30', planned_platforms: 'إكس، تيليجرام، ماستودون',
      assignee: 'مجهول', pillar: 'محور جديد', campaign: 'حملة غائبة',
    }, ctx);
    expect(item).toEqual({ title: 'فكرة', body: '', planned_platforms: ['x'] });
    expect(unmatched).toBe(7);
  });

  it('يوم التصدير بصيغة الاستيراد نفسها', () => {
    expect(exportDay('2026-10-31')).toBe('2026/10/31');
    expect(exportDay(null)).toBe('');
    const { item } = mapImportRow({ title: 't', planned_on: exportDay('2026-10-31') }, ctx);
    expect(item.planned_on).toBe('2026-10-31');
  });
});

describe('نقل يوم النشر المستهدف بالسحب', () => {
  const today = '2026-10-08';
  it('يُقبل اليوم الجاري وما بعده', () => {
    expect(canDropOnDay('2026-10-12', today, today)).toBe(true);
    expect(canDropOnDay('2026-10-12', '2026-11-01', today)).toBe(true);
    // ما مضى يومُه يُنقل إلى يومٍ قادم
    expect(canDropOnDay('2026-10-01', '2026-10-20', today)).toBe(true);
  });
  it('لا نقل إلى اليوم نفسه ولا إلى يومٍ مضى', () => {
    expect(canDropOnDay('2026-10-12', '2026-10-12', today)).toBe(false);
    expect(canDropOnDay('2026-10-12', '2026-10-07', today)).toBe(false);
  });
});
