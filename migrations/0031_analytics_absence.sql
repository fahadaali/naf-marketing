-- ═══ الغياب ليس صفراً — في لقطات المنشورات ═══
--
-- كان تخريط المقاييس يكتب صفراً لكل ما لم يُعلنه المزوّد: منشورٌ لم تُزامَن
-- أرقامه بعد، ومنصّةٌ لا تُعلن الوصول، ومقياسٌ بلاحقةٍ لم يُعرف اسمها. فتدخل
-- الأصفار المجاميع والمتوسطات، ويُقرأ «الوصول صفر» والوصول لم يُقَس.
--
-- والأعمدة تقبل `NULL` منذ أول هجرة؛ فيُعاد ما كُتب صفراً عن غيابٍ إلى
-- غيابه، ويُترك ما أعلنه المزوّد صفراً صريحاً. والدليل على الغياب أن
-- `metrics_json` لا يحمل اسم المقياس أصلاً. والنشرة البريدية خارج هذا كلّه:
-- أرقامها من إرسالنا نحن لا من مزوّد.

-- متى أُعلنت أرقام اللقطة آخر مرّة — من المزوّد إن أعلن وقته، وإلا وقتُ السحب
ALTER TABLE analytics_snapshots ADD COLUMN metrics_at TEXT;
-- معرّف المنشور عند SocialAPI — به تُطلب أرقامه الحيّة
ALTER TABLE analytics_snapshots ADD COLUMN provider_uuid TEXT;

-- لقطةٌ بلا أي مقياسٍ معلن: الثلاثة غياب
UPDATE analytics_snapshots
SET reach = NULL, impressions = NULL, engagement = NULL
WHERE COALESCE(source, '') <> 'newsletter'
  AND (metrics_json IS NULL OR TRIM(metrics_json) IN ('', '[]'))
  AND COALESCE(reach, 0) = 0 AND COALESCE(impressions, 0) = 0 AND COALESCE(engagement, 0) = 0;

-- مقياسٌ بعينه لم يُعلَن وكُتب صفراً
UPDATE analytics_snapshots SET reach = NULL
WHERE COALESCE(source, '') <> 'newsletter' AND reach = 0
  AND metrics_json IS NOT NULL AND metrics_json NOT LIKE '%reach%';

UPDATE analytics_snapshots SET impressions = NULL
WHERE COALESCE(source, '') <> 'newsletter' AND impressions = 0
  AND metrics_json IS NOT NULL
  AND metrics_json NOT LIKE '%impression%' AND metrics_json NOT LIKE '%view%' AND metrics_json NOT LIKE '%reach%';

UPDATE analytics_snapshots SET engagement = NULL
WHERE COALESCE(source, '') <> 'newsletter' AND engagement = 0
  AND metrics_json IS NOT NULL
  AND metrics_json NOT LIKE '%like%' AND metrics_json NOT LIKE '%comment%' AND metrics_json NOT LIKE '%share%'
  AND metrics_json NOT LIKE '%save%' AND metrics_json NOT LIKE '%reaction%' AND metrics_json NOT LIKE '%click%'
  AND metrics_json NOT LIKE '%repost%' AND metrics_json NOT LIKE '%retweet%' AND metrics_json NOT LIKE '%quote%'
  AND metrics_json NOT LIKE '%follow%' AND metrics_json NOT LIKE '%favorite%' AND metrics_json NOT LIKE '%engagement%';

-- ما بقي له رقمٌ معلن: وقتُه وقتُ آخر سحب
UPDATE analytics_snapshots SET metrics_at = captured_at
WHERE reach IS NOT NULL OR impressions IS NOT NULL OR engagement IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_uuid ON analytics_snapshots(provider_uuid);
CREATE INDEX IF NOT EXISTS idx_analytics_sent ON analytics_snapshots(sent_at);
