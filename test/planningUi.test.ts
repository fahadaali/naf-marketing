// خطة المحتوى في الواجهة — المحاور، والأسابيع، والاستيراد. دوالّ صافية من
// `web/src/planning.ts`، كما تُختبر أشهر التقويم في `planningCalendar.test.ts`.

import { describe, it, expect } from 'vitest';
import { pillarsFrom, PILLAR_MAX, planFromPost, planPayload, dayDate, EMPTY_PLAN, groupByPlannedDay } from '../web/src/planning';
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
