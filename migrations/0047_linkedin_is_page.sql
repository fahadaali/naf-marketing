-- لينكدإن ناف صفحةٌ لا حساب (قرار المالك). اللقطات المحفوظة باسم `linkedin`
-- — من Buffer أو SocialAPI قبل أن يفرّق المزوّد بينهما — هي منشورات الصفحة،
-- فتُكتب باسمها ليطلب سحب التعليقات تعليقاتها. ولقطةٌ بالمعرّف نفسه لا تتكرّر:
-- المفتاح `provider_post_id` فريد، والمنصة وحدها تتغيّر.
UPDATE analytics_snapshots SET platform = 'linkedin_page' WHERE platform = 'linkedin';
