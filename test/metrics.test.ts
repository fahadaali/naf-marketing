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
    // الاسم يُوحَّد (`views`) ويبقى أصلُه في `name` — كي يُجمع مع `views` من منصّةٍ أخرى
    const views = m.raw.find((r) => r.type === 'views');
    expect(views?.name).toBe('view_count');
    expect(views?.value).toBe(52);
    // لا انطباعات صريحة → تُشتق من المشاهدات
    expect(m.impressions).toBe(52);
  });

  it('يردّ الأسماء ذات اللاحقة إلى أصلها — `like_count` إعجاب', () => {
    const m = mapMetrics({ like_count: 7, comments_count: 3, shares_count: 1, saves_count: 2 });
    expect(m.engagement).toBe(13);
    expect(m.raw.find((r) => r.type === 'likes')?.value).toBe(7);
  });

  it('لا يعدّ الإعجاب مرّتين حين يتكرّر في `extra` باسم المنصّة', () => {
    const m = mapMetrics({ likes: 10, comments: 2, extra: { like_count: 10, reach: 400 } });
    expect(m.engagement).toBe(12);
    expect(m.reach).toBe(400);
  });

  it('لا يجمع أنواع الظهور المتداخلة — يأخذ أكبرها لا مجموعها', () => {
    const m = mapMetrics({ extra: { post_impressions: 900, post_impressions_unique: 600, post_impressions_paid: 100 } });
    expect(m.impressions).toBe(900);
  });

  it('لا يعدّ مدّة المشاهدة مشاهدات', () => {
    const m = mapMetrics({ extra: { averageViewDuration: 35 } });
    expect(m.impressions).toBeNull();
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

  /* كان الفارغ يعود أصفاراً، فدخلت منشوراتٌ لم تُزامَن أرقامها بعد المجاميعَ
     أصفاراً وخفضت كل متوسط. والغياب الآن غياب: `null` و`present: false`. */
  it('يتعامل مع الفارغ/غير الصالح بأمان — غيابٌ لا أصفار', () => {
    expect(mapMetrics({}).engagement).toBeNull();
    expect(mapMetrics({}).present).toBe(false);
    expect(mapMetrics(null).raw).toEqual([]);
    expect(mapMetrics(null).present).toBe(false);
  });

  it('يعدّ الأصفار غياباً حين يعلن المزوّد أنه لم يُزامن الأرقام بعد', () => {
    const m = mapMetrics({ likes: 0, comments: 0, shares: 0, saves: 0, metrics_synced_at: null });
    expect(m.present).toBe(false);
    expect(m.engagement).toBeNull();
  });

  it('يقبل الصفر المُعلَن صفراً حين زامن المزوّد الأرقام', () => {
    const m = mapMetrics({ likes: 0, comments: 0, metrics_synced_at: '2026-09-01T10:00:00Z' });
    expect(m.present).toBe(true);
    expect(m.engagement).toBe(0);
    expect(m.syncedAt).toBe('2026-09-01T10:00:00.000Z');
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
