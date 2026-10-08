// خطة المحتوى في الواجهة — المحاور، والأسابيع، والاستيراد. دوالّ صافية من
// `web/src/planning.ts`، كما تُختبر أشهر التقويم في `planningCalendar.test.ts`.

import { describe, it, expect } from 'vitest';
import { pillarsFrom, PILLAR_MAX } from '../web/src/planning';

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
