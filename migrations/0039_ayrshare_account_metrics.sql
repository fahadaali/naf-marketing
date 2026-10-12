-- ═══ أرقام الحساب كاملةً من مزوّد النشر ═══
--
-- كان يُقرأ من `POST /analytics/social` في Ayrshare عددُ المتابعين وحده ويُرمى
-- الباقي. وفيه بالمفتاح نفسه أرقامُ كل حساب لا منشوراته — يوماً بيوم لفيسبوك
-- والملف التجاري وإنستغرام وسناب وتيك توك ويوتيوب، فتُجمع أيامُ كل فترة. فتُسجَّل
-- تسعةٌ جديدة، والأسماء في `naf-terms.md` §١٣ «بانتظار التسجيل في naf-ui» بقرار
-- المالك. والتفصيل — من أيّ حقلٍ يأتي كل رقم — في `docs/naf-metrics.md`.
--
-- «مشاهدات الحساب» و«وصول الحساب» غير «الظهور» و«الوصول»: تلك تُحتسب من
-- منشورات الفترة وحدها، وهذه ما تعلنه المنصة للحساب كلّه — ومنه ما نُشر قبل
-- الفترة وشوهد فيها. ووصول الحساب مجموعُ الوصول اليومي كما تعلنه ميتا وسناب،
-- فمن رأى المحتوى في يومين يُعدّ مرّتين.

INSERT OR IGNORE INTO metric_definitions
  (key, layer, name_ar, name_en, unit, class, source, integration_key, cadence, dim_key, target_value, target_direction, target_min, target_max, board_rank, sort) VALUES
('account_reach','reach','وصول الحساب','Account Reach','count','operational','integration','social','monthly','platform',NULL,'higher_better',NULL,NULL,NULL,1011),
('account_views','reach','مشاهدات الحساب','Account Content Views','count','vanity','integration','social','monthly','platform',NULL,'higher_better',NULL,NULL,NULL,1021),
('new_followers','reach','المتابعون الجدد','New Followers','count','operational','integration','social','monthly','platform',NULL,'higher_better',NULL,NULL,NULL,1051),
('profile_views','reach','زيارات الحساب','Profile Views','count','operational','integration','social','monthly','platform',NULL,'higher_better',NULL,NULL,NULL,1071),
('watch_time','engagement','وقت المشاهدة','Watch Time','minutes','operational','integration','social','monthly','platform',NULL,'higher_better',NULL,NULL,NULL,2091),
('profile_website_clicks','web','النقر إلى الموقع من الحسابات','Profile Website Clicks','count','operational','integration','social','monthly','platform',NULL,'higher_better',NULL,NULL,NULL,3191),
('followers_country','audience','المتابعون حسب البلد','Followers by Country','count','operational','integration','social','quarterly','country',NULL,'higher_better',NULL,NULL,NULL,7011),
('followers_age','audience','المتابعون حسب الفئة العمرية','Followers by Age','count','operational','integration','social','quarterly','age_range',NULL,'higher_better',NULL,NULL,NULL,7012),
('followers_gender','audience','المتابعون حسب الجنس','Followers by Gender','count','operational','integration','social','quarterly','gender',NULL,'higher_better',NULL,NULL,NULL,7013);

-- ── إلغاءات المتابعة: من مُدخَلٍ إلى مسحوب ──
-- يوتيوب يعلن `subscribersLost` وسناب `unsubscribes` يوماً بيوم. وما سواهما
-- يبقى تسجيله باليد ممكناً، كما بقي لـ«إجمالي المتابعين» حين صار مسحوباً.
UPDATE metric_definitions
SET source = 'integration', integration_key = 'social'
WHERE key = 'unfollows';

-- ── أداء الملف التجاري: من «الملف التجاري» إلى مزوّد النشر — بقرار المالك ──
-- الرقم رقمُ جوجل في الحالين، كما نُقلت المراجعات والتقييم قبلها في 0025.
-- والفرق أن واجهة جوجل تحتاج حساباً خدمياً واعتماداً للموقع، ومزوّد النشر
-- يقرأها بالمفتاح القائم. ومصدرٌ لا يكتب إلا ما سُجّل له (`metricSync`) —
-- فلا يتناوب الرقمَ مصدران إن بقي «الملف التجاري» مربوطاً.
UPDATE metric_definitions
SET integration_key = 'social'
WHERE key IN ('gbp_views', 'gbp_calls', 'gbp_directions');

-- ── مصدر «مزوّد النشر» مربوطٌ حين يكون Ayrshare هو المزوّد ──
-- كان يُبذر معطّلاً، فلا يُسحب حتى عددُ المتابعين ما لم يُفعَّل من التكاملات
-- — وAyrshare مضبوطٌ ومفتاحه قائم. ومن اختار المزوّد بالأسرار لا بالإعدادات
-- يفعّله من التكاملات كما كان.
UPDATE integrations
SET is_enabled = 1
WHERE key = 'social'
  AND EXISTS (SELECT 1 FROM settings WHERE key = 'provider_name' AND value = 'ayrshare');
