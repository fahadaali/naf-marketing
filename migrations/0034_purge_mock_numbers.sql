-- ═══ حذف أرقام المزوّد التجريبي ═══
--
-- المزوّد التجريبي كان يولّد أرقام وصولٍ وظهورٍ وتفاعل من بصمة معرّف المنشور،
-- وتعليقاتٍ ورسائلَ بأسماءٍ مخترعة. وتُخزَّن كما تُخزَّن الحقيقية: لا عمودَ
-- يفرّقها، فتدخل المؤشرات واللوحة المختصرة والتقرير الدوري أرقاماً مقيسة.
-- وقد توقّف توليدها في `adapters/mock.ts`، وهذا يرفع ما كُتب منها.
--
-- والتمييز بالمعرّف وحده، وهو قاطع: كل منشورٍ «نشره» التجريبي معرّفه عند
-- المزوّد `mock_…`، وتعليقاته `mock_…_c0` منسوبةً إليه. ولا مزوّد حقيقي يعطي
-- معرّفاً بهذه البادئة. فما عداها لا يُمسّ.
--
-- ومواعيد النشر التجريبي في `schedules` باقيةٌ كما هي — قرار المالك.

DELETE FROM platform_comments WHERE provider_comment_id LIKE 'mock\_%' ESCAPE '\';

DELETE FROM analytics_snapshots WHERE provider_post_id LIKE 'mock\_%' ESCAPE '\';

-- ── المحتسب منها ──
-- قيم المؤشرات المحتسبة من لقطات المزوّد وصندوقه (`provider` في `AUTO_SOURCE`
-- بـ`services/metrics.ts`) لا تحمل مصدر لقطاتها، فلا يُعرف أيُّها قام على
-- التجريبي. فتُرفع كلُّها، والاحتساب يعيد ما قام منها على أرقامٍ حقيقية: الليلةَ
-- للفترة الجارية والسابقة، وعلى دفعاتٍ كل ساعة لما قبلهما (`metricsHistory.ts`).
-- والمسحوب والمُدخَل لا يُمسّان.
DELETE FROM metric_values
WHERE source = 'auto' AND metric_key IN (
  'reach', 'impressions', 'engagement', 'frequency', 'engagement_rate_reach',
  'likes', 'comments', 'shares', 'saves', 'ctr', 'avg_view_duration', 'completion_rate',
  'engagement_by_content_type', 'engagement_by_time_slot', 'organic_paid_split',
  'qualitative_comments', 'direct_conversations', 'first_reply_rate', 'first_response_minutes'
);
