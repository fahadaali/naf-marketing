-- ═══ حذف الريتويت من لقطات إكس ═══
--
-- سجلُّ حساب إكس يردّ الريتويت منشوراً من منشوراته، وأرقامُه أرقامُ التغريدة
-- الأصلية لا أرقامنا: ريتويتٌ لتغريدة خادم الحرمين دخل التفاعلَ بأكثر من مئة
-- ألف. وقد توقّف دخوله في `ayrsharePlatformHistory` و`mapAccountPost`، وهذا يرفع
-- ما كُتب منه — قرار المالك.
--
-- والتمييز بنصّه: إكس يكتب الريتويت «RT @صاحبها: …» دائماً، والعنوان المحفوظ أوّل
-- النص. وما ارتبط بمحتوى في المنصة (`post_id`) لا يُمسّ: نُشر منها فليس ريتويتاً.
-- والاقتباس (Quote) ليس ريتويتاً: نصُّه نصُّنا وأرقامُه أرقامنا، فيبقى.

DELETE FROM analytics_snapshots
WHERE platform IN ('x', 'twitter') AND post_id IS NULL AND title LIKE 'RT @%';

-- ── المحتسب منها ──
-- كما في 0034: قيم التواصل المحتسبة من اللقطات لا تحمل مصدرها، فتُرفع ويعيدها
-- الاحتساب على ما بقي — للفترة الجارية والسابقة بعد السحب التالي، وعلى دفعاتٍ
-- لما قبلهما (`metricsHistory.ts`). ومؤشرات الصندوق لا تُمسّ: لا ريتويت فيها.
DELETE FROM metric_values
WHERE source = 'auto' AND metric_key IN (
  'reach', 'impressions', 'engagement', 'frequency', 'engagement_rate_reach',
  'likes', 'comments', 'shares', 'saves', 'ctr', 'avg_view_duration', 'completion_rate',
  'engagement_by_content_type', 'engagement_by_time_slot', 'organic_paid_split'
);
