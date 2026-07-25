import { describe, it, expect } from 'vitest';
import { mapMetrics } from '../src/adapters/socialapi';
import { mapPostMetrics } from '../src/adapters/buffer';

// تخريط مقاييس SocialAPI — هنا وقعت أخطاء فعلية سابقاً (المقاييس المتداخلة داخل extra)
describe('mapMetrics (SocialAPI)', () => {
  it('يجمع مقاييس التفاعل المعروفة', () => {
    const m = mapMetrics({ likes: 5, comments: 3, shares: 2, saves: 1 });
    expect(m.engagement).toBe(11);
  });

  it('يتعمّق في الكائنات المتداخلة (extra.view_count)', () => {
    const m = mapMetrics({ likes: 0, comments: 0, extra: { view_count: 52 } });
    const keys = m.raw.map((r) => r.type);
    expect(keys).toContain('view_count');
    // لا انطباعات صريحة → تُشتق من المشاهدات
    expect(m.impressions).toBe(52);
  });

  it('يميّز الوصول والانطباعات', () => {
    const m = mapMetrics({ reach: 100, impressions: 250 });
    expect(m.reach).toBe(100);
    expect(m.impressions).toBe(250);
  });

  it('يقبل شكل المصفوفة [{type,value}]', () => {
    const m = mapMetrics([{ type: 'likes', value: 4 }, { type: 'reach', value: 10 }]);
    expect(m.engagement).toBe(4);
    expect(m.reach).toBe(10);
  });

  it('يُعلّم النسب بوحدة percentage', () => {
    const m = mapMetrics({ engagement_rate: 3.5 });
    expect(m.raw.find((r) => r.type === 'engagement_rate')?.unit).toBe('percentage');
  });

  it('يتعامل مع الفارغ/غير الصالح بأمان', () => {
    expect(mapMetrics({}).engagement).toBe(0);
    expect(mapMetrics(null).raw).toEqual([]);
  });
});

// تخريط مقاييس Buffer — يعتمد على type/name من تعداد PostMetricType
describe('mapPostMetrics (Buffer)', () => {
  it('يجمع التفاعل ويقرأ الوصول', () => {
    const m = mapPostMetrics([
      { type: 'reach', value: 200 },
      { type: 'likes', value: 6 },
      { type: 'comments', value: 4 },
    ]);
    expect(m.reach).toBe(200);
    expect(m.engagement).toBe(10);
  });

  it('يشتق الانطباعات من المشاهدات عند غيابها', () => {
    const m = mapPostMetrics([{ type: 'views', value: 90 }]);
    expect(m.impressions).toBe(90);
  });

  it('يتجاهل القيم غير الرقمية', () => {
    const m = mapPostMetrics([{ type: 'likes', value: 'x' as any }]);
    expect(m.engagement).toBe(0);
  });
});
