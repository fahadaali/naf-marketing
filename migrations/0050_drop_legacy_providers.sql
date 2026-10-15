-- Ayrshare مزوّد النشر الوحيد — قرار المالك. وتُحذف من بيانات SocialAPI وBuffer
-- ما لا يعرفه Ayrshare وحده؛ وما عرفه يبقى بأرقامه.

-- ١) لقطاتٌ مفتاحها من مزوّدٍ سابق — نائبُ SocialAPI (`…:منصة`) أو معرّف Buffer
--    (٢٤ خانة ست عشرية فيها حرف) — ولم يُعرف معرّفها الأصلي على المنصة: لا
--    يطابقها Ayrshare ولا تُطلب بها تعليقات. وما عُرف معرّفه الأصلي يبقى.
DELETE FROM analytics_snapshots
WHERE native_post_id IS NULL
  AND (provider_post_id LIKE '%:' || platform
       OR (length(provider_post_id) = 24 AND provider_post_id NOT GLOB '*[^0-9a-f]*' AND provider_post_id GLOB '*[a-f]*'));

-- ٢) عناصر الصندوق من أيام SocialAPI التي لم تُضمّ إلى نظيرها في Ayrshare.
--    عناصر Ayrshare وحدها تبدأ بـ `ayc|` (تعليق) و`ayd|` (رسالة) و`ayr|` (مراجعة).
DELETE FROM platform_comments
WHERE substr(provider_comment_id, 1, 4) NOT IN ('ayc|', 'ayd|', 'ayr|');

-- ٣) حالُ قراءة منشورات الصندوق بحسابات SocialAPI
DELETE FROM inbox_post_state WHERE account_id NOT LIKE 'ayrshare:%';

-- ٤) إعدادات المزوّدَين: خريطتا الحسابات، وخطّاف SocialAPI، ومؤشّرات سجلّه
DELETE FROM settings WHERE key IN (
  'buffer_profiles', 'socialapi_profiles',
  'secret:socialapi_webhook', 'socialapi_webhook_secret', 'socialapi_webhook_id',
  'youtube_sync_at', 'posts_history_at', 'inbox_history_cursor'
);
DELETE FROM settings WHERE key LIKE 'account_history:%' AND key NOT LIKE 'account_history:ayrshare:%';

-- ٥) والمزوّد المختار إن بقي أحدَهما
UPDATE settings SET value = 'ayrshare' WHERE key = 'provider_name' AND value IN ('buffer', 'socialapi');
