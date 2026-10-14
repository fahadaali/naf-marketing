-- أسماء المنصات في لقطات التحليلات بمفاتيحنا.
--
-- لقطات Buffer كُتبت باسم خدمته (`post.service`: twitter…) ولقطات SocialAPI باسم
-- منصته الخام إن غاب حسابها من الخريطة. وسحب التعليقات يطلب بمفاتيحنا (x…)،
-- فما كُتب باسمٍ آخر لا تُطلب تعليقاته أبداً. والخريطة هي المسجّلة نفسها
-- (`ALIASES` في src/platformLabels.ts) — ولا يُمسّ `linkedin`: أحسابٌ هو أم صفحة
-- لا يُعرف من اللقطة.
UPDATE analytics_snapshots SET platform = CASE lower(trim(platform))
    WHEN 'twitter' THEN 'x'
    WHEN 'twitter.com' THEN 'x'
    WHEN 'googlebusiness' THEN 'google'
    WHEN 'google_business' THEN 'google'
    WHEN 'gbp' THEN 'google'
    WHEN 'linkedinpage' THEN 'linkedin_page'
    WHEN 'linkedin-page' THEN 'linkedin_page'
    WHEN 'ig' THEN 'instagram'
    WHEN 'fb' THEN 'facebook'
    WHEN 'yt' THEN 'youtube'
    ELSE lower(trim(platform))
  END
WHERE lower(trim(platform)) IN ('twitter', 'twitter.com', 'googlebusiness', 'google_business', 'gbp', 'linkedinpage', 'linkedin-page', 'ig', 'fb', 'yt')
   OR (platform <> lower(trim(platform))
       AND lower(trim(platform)) IN ('x', 'linkedin', 'linkedin_page', 'google', 'instagram', 'snapchat', 'tiktok', 'facebook', 'youtube', 'threads'));
