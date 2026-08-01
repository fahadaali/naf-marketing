-- ===== سجلّ المؤشرات =====
-- مصدر هذا الملف «دليل مؤشرات التسويق والتحليل — شركة ناف القانونية»،
-- وأسماء المؤشرات ووحداتها وفئاتها مسجّلة في `naf-terms.md` §١٣ قبل أن تصل هنا.
--
-- ═══ لماذا جدولان لا خمسة عشر ═══
--
-- الطبقات العشر في الدليل تحمل مؤشرات من طبائع مختلفة: منها ما هو رقم واحد
-- للفترة (الوصول)، ومنها ما هو توزيع على بُعد (مصادر الزيارات، أسباب الخسارة،
-- ترتيب الكلمات). وبناء جدول لكل واحد يعطي خمسة عشر جدولاً تتشابه أعمدتها
-- وتفترق أسماؤها، ثم يحتاج كل مؤشر جديد في الدليل هجرةً جديدة.
--
-- فالتعريف في `metric_definitions` والقيمة في `metric_values`، والبُعد عمودان
-- في الثاني: `dim_key` يقول «على أي شيء وُزّع» و`dim_value` يقول «أيّه». ومؤشرٌ
-- بلا توزيع يحمل فيهما فراغين — لا `NULL`، لأن `UNIQUE` في SQLite يعدّ كل
-- `NULL` مختلفاً عن أخيه فيسمح بصفّين متطابقين للفترة نفسها.
--
-- ═══ ولماذا القيمة `REAL` ═══
--
-- المبالغ في هذا الجدول ليست دفتراً محاسبياً بل مؤشرات تُقرأ: تكلفة اكتساب
-- ومتوسط عقد ونسبة إنفاق. والقاعدة المعتمدة في `naf-manger` — المبالغ هللات
-- صحيحة — تحمي دفتر العمولات من انحراف القرش، وهذا ليس دفتراً. وخلط الوحدات
-- في عمود واحد يحمل نسباً وثوانيَ وترتيباً ومبالغَ أسوأ من فقد الدقّة العشرية:
-- الوحدة في `metric_definitions.unit` هي ما يقرأ به العارض الرقم.

-- ── تعريف المؤشر ──
-- سطر لكل مؤشر في الدليل. لا يُحذف منه سطر: مؤشرٌ لا مصدر له اليوم يبقى
-- معرّفاً بلا قيمة، فيظهر في «دليل المؤشرات» ثغرةً معروفة لا رقماً مفقوداً.
CREATE TABLE IF NOT EXISTS metric_definitions (
  key              TEXT PRIMARY KEY,
  layer            TEXT NOT NULL,                    -- طبقات الدليل العشر
  name_ar          TEXT NOT NULL,                    -- الاسم المعتمد في naf-terms.md §١٣
  name_en          TEXT NOT NULL,                    -- الاسم في الدليل، للبحث لا للعرض
  unit             TEXT NOT NULL,                    -- count|percentage|currency|ratio|days|hours|minutes|seconds|rank|score|rating
  class            TEXT NOT NULL,                    -- vanity|operational|north_star
  source           TEXT NOT NULL,                    -- auto|integration|manual
  integration_key  TEXT,                             -- المصدر الخارجي إن كان source='integration'
  cadence          TEXT NOT NULL,                    -- weekly|monthly|quarterly|annual
  dim_key          TEXT NOT NULL DEFAULT '',         -- البُعد الذي يُوزّع عليه ('' = رقم واحد)
  target_value     REAL,                             -- المستهدف؛ NULL يعني «لا مستهدف» وتُعرض صراحةً
  target_direction TEXT NOT NULL DEFAULT 'higher_better',  -- higher_better|lower_better|range
  target_min       REAL,                             -- لـ range وحده
  target_max       REAL,
  board_rank       INTEGER,                          -- ١..١٠ في اللوحة المختصرة، وإلا NULL
  sort             INTEGER NOT NULL DEFAULT 0,
  note             TEXT
);
CREATE INDEX IF NOT EXISTS idx_metric_defs_layer ON metric_definitions(layer, sort);
CREATE INDEX IF NOT EXISTS idx_metric_defs_board ON metric_definitions(board_rank);

-- ── قيمة المؤشر في فترة ──
CREATE TABLE IF NOT EXISTS metric_values (
  id              TEXT PRIMARY KEY,
  metric_key      TEXT NOT NULL REFERENCES metric_definitions(key) ON DELETE CASCADE,
  period          TEXT NOT NULL,                     -- weekly|monthly|quarterly|annual
  period_start    TEXT NOT NULL,                     -- YYYY-MM-DD بتوقيت الرياض
  period_end      TEXT NOT NULL,                     -- YYYY-MM-DD شاملاً
  dim_key         TEXT NOT NULL DEFAULT '',
  dim_value       TEXT NOT NULL DEFAULT '',
  value           REAL NOT NULL,
  sample          INTEGER,                           -- حجم العيّنة التي حُسب منها الرقم إن كان متوسطاً
  source          TEXT NOT NULL,                     -- auto|integration|manual
  integration_key TEXT,
  entered_by      TEXT REFERENCES users(id),
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (metric_key, period, period_start, dim_key, dim_value)
);
CREATE INDEX IF NOT EXISTS idx_metric_values_lookup ON metric_values(metric_key, period, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_metric_values_period ON metric_values(period, period_start DESC);

-- ── المصادر الخارجية ──
-- السرّ لا يُخزَّن هنا إطلاقاً: `config_json` غير سرّي (معرّف حساب، نطاق،
-- عنوان)، والمفاتيح عبر Cloudflare Secrets كبقية مفاتيح المنصة.
CREATE TABLE IF NOT EXISTS integrations (
  key              TEXT PRIMARY KEY,                 -- crm|web_analytics|search_console|business_profile|ads|messaging|call_tracking|listening
  is_enabled       INTEGER NOT NULL DEFAULT 0,
  config_json      TEXT NOT NULL DEFAULT '{}',
  last_sync_at     TEXT,
  last_sync_status TEXT NOT NULL DEFAULT 'never_synced',  -- never_synced|ok|sync_failed
  last_error       TEXT,
  last_ok_at       TEXT,                             -- آخر سحبٍ نجح — يُقرأ منه عمر الرقم المعروض
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ═══ مرآة منصة إدارة المكتب ═══
--
-- الطبقة الرابعة كلها تُبنى على سجلّ العميل المحتمل، وسجلُّه في `naf-manger`
-- لا هنا. فتُنسخ الصفوف مرآةً للقراءة، ولا تُكتب من هذه المنصة أبداً: مصدر
-- الحقيقة هناك، ومنصةُ تسويقٍ تكتب في سجلّ العملاء تُنتج نسختين تفترقان.
--
-- والمرآة تُعاد بناؤها في كل سحب، فلا تُبنى عليها مفاتيح أجنبية من جداولنا.

CREATE TABLE IF NOT EXISTS crm_leads (
  id              TEXT PRIMARY KEY,                  -- معرّف المحتمل في منصة إدارة المكتب
  full_name       TEXT,
  phone           TEXT,
  email           TEXT,
  source          TEXT,                              -- مصدر المحتمل كما سجّلته تلك المنصة
  status          TEXT,                              -- prospect_status
  client_type     TEXT,
  expected_value  REAL,                              -- بالريال بعد القسمة على مئة
  assigned_to     TEXT,
  follow_up_date  TEXT,
  created_at      TEXT,                              -- ISO 8601 بعد التحويل من ثوانٍ
  updated_at      TEXT,
  -- تحويل المحتمل إلى عميل في تلك المنصة يُنشئ العميل ويحذف المحتمل، فالسجلّ
  -- الأصلي يزول ومعه تاريخُ أول تواصل. وزمن دورة البيع كلُّه هو الفرق بين
  -- ذلك التاريخ وتاريخ التعاقد — فلو حذفنا الصفّ من المرآة كما حُذف هناك
  -- لسقط المؤشر نهائياً ولا سبيل لاستعادته.
  -- فالصفّ يبقى موسوماً `is_present = 0`، ويُربط بالعميل الذي صار إليه.
  is_present      INTEGER NOT NULL DEFAULT 1,
  disappeared_at  TEXT,
  converted_client_id TEXT,
  synced_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_created ON crm_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_crm_leads_present ON crm_leads(is_present);
CREATE INDEX IF NOT EXISTS idx_crm_leads_source ON crm_leads(source);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON crm_leads(status);

CREATE TABLE IF NOT EXISTS crm_clients (
  id          TEXT PRIMARY KEY,
  full_name   TEXT,
  -- الهاتف والبريد ليسا للعرض بل للمطابقة: بهما يُعرف أيُّ محتملٍ صار هذا
  -- العميل حين يزول صفّه من المصدر، ومن المطابقة وحدها يُحسب زمن دورة البيع.
  phone       TEXT,
  email       TEXT,
  client_type TEXT,
  status      TEXT,                                  -- current|former
  join_date   TEXT,
  created_at  TEXT,
  updated_at  TEXT,
  synced_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_clients_join ON crm_clients(join_date);
CREATE INDEX IF NOT EXISTS idx_crm_clients_status ON crm_clients(status);

CREATE TABLE IF NOT EXISTS crm_cases (
  id               TEXT PRIMARY KEY,
  case_number      TEXT,
  case_type        TEXT,
  client_id        TEXT,
  status           TEXT,                             -- pending|in-progress|completed|postponed
  outcome          TEXT,                             -- won|lost|...
  fee_amount       REAL,                             -- من fee_structure
  collected_amount REAL,                             -- من payment_status.collectedAmount
  marketer_id      TEXT,
  marketer_name    TEXT,
  created_at       TEXT,
  updated_at       TEXT,
  synced_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_cases_client ON crm_cases(client_id);
CREATE INDEX IF NOT EXISTS idx_crm_cases_created ON crm_cases(created_at);
CREATE INDEX IF NOT EXISTS idx_crm_cases_outcome ON crm_cases(outcome);

-- ── الإنفاق الإعلاني ──
-- الطبقة الخامسة كلها تقف عليه: بلا إنفاق مسجَّل لا تكلفة نقرة ولا تكلفة
-- عميل ولا عائد. ويصل من تكامل إعلاني أو يُدخَل، والعمود `source` يقول أيّهما.
CREATE TABLE IF NOT EXISTS ad_spend (
  id              TEXT PRIMARY KEY,
  period_start    TEXT NOT NULL,                     -- YYYY-MM-DD
  period_end      TEXT NOT NULL,
  platform        TEXT NOT NULL,                     -- مفتاح المنصة، أو 'other'
  campaign_id     TEXT NOT NULL DEFAULT '',          -- حملة المنصة إن رُبط، وإلا فراغ
  amount          REAL NOT NULL DEFAULT 0,           -- بالريال
  impressions     INTEGER NOT NULL DEFAULT 0,
  clicks          INTEGER NOT NULL DEFAULT 0,
  conversions     INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'manual',
  integration_key TEXT,
  entered_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (period_start, platform, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_spend_period ON ad_spend(period_start, period_end);

-- ── الصلاحيات ──
-- «عرض التحليلات» قائمة ولم تتغيّر. والجديدتان تفرّقان بين من يقرأ الرقم
-- ومن يسجّله، ومن يربط مصدره: تسجيلُ قيمةٍ باليد يدخل اللوحة كما يدخلها
-- الرقم المسحوب، فمن يملكه يملك تحريك مؤشر قيادي.
INSERT OR IGNORE INTO roles_permissions (role_name, permission_key, allowed) VALUES
  ('writer','metrics.manage',0), ('marketing_manager','metrics.manage',1), ('general_manager','metrics.manage',1),
  ('writer','integrations.manage',0), ('marketing_manager','integrations.manage',0), ('general_manager','integrations.manage',1);

-- ── إعدادات القياس ──
-- نموذج الإسناد ونافذة الأثر المؤجل يُعلَنان على الشاشة مع كل رقم:
-- تبديل النموذج بين تقريرين يغيّر النتيجة دون أن يتغيّر شيء في الواقع.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('attribution_model', 'last_touch'),
  ('lagged_impact_days', '90'),
  ('metrics_week_start', 'sunday'),
  ('crm_base_url', ''),
  ('mql_statuses', '["تم التواصل","بانتظار توقيع"]'),
  ('sql_statuses', '["بانتظار توقيع"]');

-- ── المصادر الثمانية ──
-- تُبذر كلها معطّلة: المصدر يظهر في شاشة التكاملات «غير مربوط» فيُعرف أنه
-- ممكن، ولا يُسحب منه شيء حتى يُربط. وغيابُ صفٍّ أسوأ من صفٍّ معطّل — من
-- لا يرى المصدر يظنّ المؤشر مستحيلاً.
INSERT OR IGNORE INTO integrations (key, is_enabled, config_json) VALUES
  ('crm', 0, '{}'),
  ('web_analytics', 0, '{}'),
  ('search_console', 0, '{}'),
  ('business_profile', 0, '{}'),
  ('ads', 0, '{}'),
  ('messaging', 0, '{}'),
  ('call_tracking', 0, '{}'),
  ('listening', 0, '{}');

-- ═══ دليل المؤشرات ═══
-- كل مؤشر في الدليل، بترتيب طبقاته. `source` يقول من أين تأتي القيمة:
--   auto        — تحسبها المنصة من بياناتها (لقطات التحليلات، النشرات، سجلّ
--                 الاعتماد، مرآة إدارة المكتب، الإنفاق المسجَّل)
--   integration — تصل من مصدر خارجي مربوط
--   manual      — يسجّلها عضو الفريق، وتحمل اسمه وتاريخه

INSERT OR IGNORE INTO metric_definitions
  (key, layer, name_ar, name_en, unit, class, source, integration_key, cadence, dim_key, target_value, target_direction, target_min, target_max, board_rank, sort) VALUES

-- ── الطبقة الأولى: الوصول والظهور ──
('reach','reach','الوصول','Reach','count','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,101),
('impressions','reach','الظهور','Impressions','count','vanity','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,102),
('frequency','reach','معدل التكرار','Frequency','ratio','operational','auto',NULL,'monthly','',NULL,'range',1,3,NULL,103),
('organic_paid_split','reach','نسبة الوصول العضوي إلى المدفوع','Organic vs Paid Split','percentage','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,104),
('followers_total','reach','إجمالي المتابعين','Followers','count','vanity','manual',NULL,'monthly','platform',NULL,'higher_better',NULL,NULL,NULL,105),
('follower_growth_rate','reach','معدل النمو في المتابعين','Follower Growth Rate','percentage','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,106),
('unfollows','reach','إلغاءات المتابعة','Unfollows','count','operational','manual',NULL,'monthly','platform',NULL,'lower_better',NULL,NULL,NULL,107),
('traffic_sources','reach','مصادر الزيارات','Traffic Sources','count','operational','integration','web_analytics','monthly','channel',NULL,'higher_better',NULL,NULL,NULL,108),
('share_of_voice','reach','حصة الصوت','Share of Voice','percentage','operational','integration','listening','quarterly','',NULL,'higher_better',NULL,NULL,NULL,109),
('viewability_rate','reach','الظهور المرئي فعلياً','Viewability Rate','percentage','operational','integration','ads','monthly','',NULL,'higher_better',NULL,NULL,NULL,110),
('new_reach_share','reach','نسبة الوصول الجديد','New vs Returning Reach','percentage','operational','manual',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,111),

-- ── الطبقة الثانية: التفاعل وجودة المحتوى ──
('engagement','engagement','التفاعل','Engagement','count','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,201),
('engagement_rate_reach','engagement','معدل التفاعل منسوباً إلى الوصول','Engagement Rate by Reach','percentage','north_star','auto',NULL,'weekly','',NULL,'higher_better',NULL,NULL,9,202),
('ctr','engagement','معدل النقر إلى الظهور','Click-Through Rate','percentage','operational','auto',NULL,'monthly','',1,'higher_better',NULL,NULL,NULL,203),
('saves','engagement','الحفظ','Saves','count','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,204),
('shares','engagement','المشاركات','Shares','count','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,205),
('likes','engagement','الإعجابات','Likes','count','vanity','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,206),
('comments','engagement','التعليقات','Comments','count','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,207),
('qualitative_comments','engagement','التعليقات النوعية','Qualitative Comments','count','north_star','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,208),
('avg_view_duration','engagement','متوسط مدة المشاهدة','Average View Duration','seconds','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,209),
('completion_rate','engagement','نسبة الإكمال','Completion Rate','percentage','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,210),
('scroll_depth','engagement','معدل التمرير حتى النهاية','Scroll Depth','percentage','operational','integration','web_analytics','monthly','',NULL,'higher_better',NULL,NULL,NULL,211),
('engagement_by_content_type','engagement','معدل التفاعل حسب نوع المحتوى','Engagement by Content Type','percentage','operational','auto',NULL,'monthly','content_type',NULL,'higher_better',NULL,NULL,NULL,212),
('engagement_by_time_slot','engagement','معدل التفاعل حسب التوقيت','Engagement by Time Slot','percentage','operational','auto',NULL,'monthly','time_slot',NULL,'higher_better',NULL,NULL,NULL,213),
('sentiment','engagement','المشاعر تجاه العلامة','Sentiment Analysis','percentage','operational','integration','listening','monthly','sentiment',NULL,'higher_better',NULL,NULL,NULL,214),

-- ── الطبقة الثالثة: الموقع ومحركات البحث ──
('sessions','web','الجلسات','Sessions','count','operational','integration','web_analytics','monthly','',NULL,'higher_better',NULL,NULL,NULL,301),
('unique_users','web','المستخدمون الفريدون','Unique Users','count','operational','integration','web_analytics','monthly','',NULL,'higher_better',NULL,NULL,NULL,302),
('bounce_rate','web','معدل الارتداد','Bounce Rate','percentage','operational','integration','web_analytics','monthly','',70,'lower_better',NULL,NULL,NULL,303),
('session_duration','web','متوسط زمن الجلسة','Session Duration','seconds','operational','integration','web_analytics','monthly','',NULL,'higher_better',NULL,NULL,NULL,304),
('pages_per_session','web','عدد الصفحات لكل جلسة','Pages per Session','ratio','operational','integration','web_analytics','monthly','',NULL,'higher_better',NULL,NULL,NULL,305),
('user_flow','web','مسار الزائر','User Flow','count','operational','integration','web_analytics','monthly','page',NULL,'higher_better',NULL,NULL,NULL,306),
('cwv_lcp','web','أكبر عنصر مرئي','Largest Contentful Paint','seconds','operational','integration','web_analytics','monthly','device',2.5,'lower_better',NULL,NULL,NULL,307),
('cwv_inp','web','استجابة التفاعل','Interaction to Next Paint','seconds','operational','integration','web_analytics','monthly','device',0.2,'lower_better',NULL,NULL,NULL,308),
('cwv_cls','web','ثبات التخطيط','Cumulative Layout Shift','score','operational','integration','web_analytics','monthly','device',0.1,'lower_better',NULL,NULL,NULL,309),
('device_split','web','التوزيع بين الجوال والحاسب','Device Split','percentage','operational','integration','web_analytics','monthly','device',NULL,'higher_better',NULL,NULL,NULL,310),
('keyword_rank','web','الترتيب في نتائج البحث','Keyword Rankings','rank','operational','integration','search_console','monthly','keyword',10,'lower_better',NULL,NULL,NULL,311),
('organic_impressions','web','الظهور العضوي','Organic Impressions','count','vanity','integration','search_console','monthly','',NULL,'higher_better',NULL,NULL,NULL,312),
('organic_clicks','web','النقرات العضوية','Organic Clicks','count','operational','integration','search_console','monthly','',NULL,'higher_better',NULL,NULL,NULL,313),
('converting_keywords','web','الكلمات التي تجلب زيارات فعلية','Converting Keywords','count','north_star','integration','search_console','monthly','keyword',NULL,'higher_better',NULL,NULL,NULL,314),
('backlinks','web','الروابط الخلفية','Backlinks','count','operational','manual',NULL,'quarterly','',NULL,'higher_better',NULL,NULL,NULL,315),
('domain_authority','web','قوة النطاق','Domain Authority','score','operational','manual',NULL,'quarterly','',NULL,'higher_better',NULL,NULL,NULL,316),
('gbp_views','web','ظهور الملف التجاري','Business Profile Views','count','operational','integration','business_profile','monthly','',NULL,'higher_better',NULL,NULL,NULL,317),
('gbp_calls','web','طلبات الاتصال من الملف التجاري','Business Profile Calls','count','north_star','integration','business_profile','monthly','',NULL,'higher_better',NULL,NULL,NULL,318),
('gbp_directions','web','طلبات الاتجاهات','Direction Requests','count','operational','integration','business_profile','monthly','',NULL,'higher_better',NULL,NULL,NULL,319),
('gbp_reviews','web','عدد تقييمات الملف التجاري','Business Profile Reviews','count','operational','integration','business_profile','monthly','',NULL,'higher_better',NULL,NULL,NULL,320),
('gbp_rating','web','متوسط تقييم الملف التجاري','Business Profile Rating','rating','operational','integration','business_profile','monthly','',4.5,'higher_better',NULL,NULL,NULL,321),

-- ── الطبقة الرابعة: التحويل ومسار البيع ──
('leads','funnel','العملاء المحتملون','Leads','count','north_star','auto',NULL,'weekly','',NULL,'higher_better',NULL,NULL,NULL,401),
('leads_by_source','funnel','العملاء المحتملون حسب المصدر','Leads by Source','count','north_star','auto',NULL,'weekly','source',NULL,'higher_better',NULL,NULL,NULL,402),
('mql','funnel','المؤهلون تسويقياً','Marketing Qualified Leads','count','north_star','auto',NULL,'weekly','',NULL,'higher_better',NULL,NULL,1,403),
('mql_by_source','funnel','مصدر كل عميل مؤهل','MQL by Source','count','north_star','auto',NULL,'weekly','source',NULL,'higher_better',NULL,NULL,2,404),
('sql','funnel','المؤهلون للبيع','Sales Qualified Leads','count','north_star','auto',NULL,'weekly','',NULL,'higher_better',NULL,NULL,NULL,405),
('lead_quality_ratio','funnel','نسبة التأهيل','Lead Quality Ratio','percentage','north_star','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,406),
('stage_conversion','funnel','معدل التحويل على كل مرحلة','Stage Conversion Rates','percentage','north_star','auto',NULL,'monthly','stage',NULL,'higher_better',NULL,NULL,NULL,407),
('qualified_to_contract','funnel','التحويل من مؤهل إلى تعاقد','Qualified to Contract','percentage','north_star','auto',NULL,'weekly','',NULL,'higher_better',NULL,NULL,3,408),
('win_rate','funnel','معدل الإغلاق','Win Rate','percentage','north_star','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,409),
('sales_cycle_days','funnel','زمن دورة البيع','Sales Cycle Length','days','north_star','auto',NULL,'monthly','',NULL,'lower_better',NULL,NULL,NULL,410),
('loss_reasons','funnel','أسباب الخسارة','Loss Reasons','count','north_star','auto',NULL,'monthly','reason',NULL,'lower_better',NULL,NULL,NULL,411),
('whatsapp_conversations','funnel','المحادثات المفتوحة عبر واتساب','WhatsApp Conversations','count','operational','integration','messaging','weekly','',NULL,'higher_better',NULL,NULL,NULL,412),
('direct_conversations','funnel','المحادثات المفتوحة عبر القنوات المباشرة','Direct Conversations','count','north_star','auto',NULL,'weekly','channel',NULL,'higher_better',NULL,NULL,8,413),
('first_reply_rate','funnel','معدل الرد الأول','First Reply Rate','percentage','operational','auto',NULL,'weekly','',NULL,'higher_better',NULL,NULL,NULL,414),
('inbound_calls','funnel','المكالمات الواردة','Inbound Calls','count','north_star','integration','call_tracking','monthly','',NULL,'higher_better',NULL,NULL,NULL,415),
('inbound_call_minutes','funnel','مدة المكالمات الواردة','Inbound Call Duration','minutes','operational','integration','call_tracking','monthly','',NULL,'higher_better',NULL,NULL,NULL,416),
('form_completions','funnel','تعبئات النموذج','Form Completions','count','north_star','integration','web_analytics','monthly','',NULL,'higher_better',NULL,NULL,NULL,417),
('form_abandonment_rate','funnel','نسبة عدم إكمال النموذج','Form Abandonment','percentage','operational','integration','web_analytics','monthly','',NULL,'lower_better',NULL,NULL,NULL,418),
('gated_downloads','funnel','تحميلات المحتوى المسوّر','Gated Content Downloads','count','north_star','integration','web_analytics','monthly','',NULL,'higher_better',NULL,NULL,NULL,419),

-- ── الطبقة الخامسة: التكلفة والعائد ──
('ad_spend','cost','الإنفاق الإعلاني','Ad Spend','currency','operational','auto',NULL,'monthly','platform',NULL,'lower_better',NULL,NULL,NULL,501),
('team_cost','cost','أجور الفريق','Team Cost','currency','operational','manual',NULL,'monthly','',NULL,'lower_better',NULL,NULL,NULL,502),
('tools_cost','cost','الأدوات والاشتراكات','Tools and Subscriptions','currency','operational','manual',NULL,'monthly','',NULL,'lower_better',NULL,NULL,NULL,503),
('partner_time_cost','cost','تكلفة وقت الشركاء','Partner Time Cost','currency','operational','manual',NULL,'monthly','',NULL,'lower_better',NULL,NULL,NULL,504),
('cpm','cost','تكلفة الألف ظهور','Cost per Mille','currency','operational','auto',NULL,'monthly','',NULL,'lower_better',NULL,NULL,NULL,505),
('cpc','cost','تكلفة النقرة','Cost per Click','currency','operational','auto',NULL,'monthly','',NULL,'lower_better',NULL,NULL,NULL,506),
('cpl','cost','تكلفة العميل المحتمل','Cost per Lead','currency','operational','auto',NULL,'monthly','',NULL,'lower_better',NULL,NULL,NULL,507),
('cpql','cost','تكلفة العميل المؤهل','Cost per Qualified Lead','currency','north_star','auto',NULL,'monthly','',NULL,'lower_better',NULL,NULL,NULL,508),
('cac','cost','تكلفة اكتساب العميل','Customer Acquisition Cost','currency','north_star','auto',NULL,'weekly','',NULL,'lower_better',NULL,NULL,4,509),
('roas','cost','العائد على الإنفاق الإعلاني','Return on Ad Spend','ratio','north_star','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,510),
('romi','cost','العائد على الاستثمار التسويقي','Return on Marketing Investment','percentage','north_star','auto',NULL,'quarterly','',NULL,'higher_better',NULL,NULL,NULL,511),
('ltv','cost','القيمة العمرية للعميل','Customer Lifetime Value','currency','north_star','auto',NULL,'quarterly','',NULL,'higher_better',NULL,NULL,NULL,512),
('ltv_cac_ratio','cost','نسبة القيمة العمرية إلى تكلفة الاكتساب','LTV to CAC Ratio','ratio','north_star','auto',NULL,'weekly','',3,'higher_better',NULL,NULL,6,513),
('cac_payback','cost','فترة استرداد تكلفة الاكتساب','CAC Payback Period','days','north_star','auto',NULL,'quarterly','',NULL,'lower_better',NULL,NULL,NULL,514),
('spend_of_revenue','cost','نسبة الإنفاق التسويقي إلى الإيراد','Marketing Spend as % of Revenue','percentage','north_star','auto',NULL,'quarterly','',NULL,'lower_better',NULL,NULL,NULL,515),

-- ── الطبقة السادسة: الاحتفاظ ونمو العميل القائم ──
('retention_rate','retention','معدل الاحتفاظ','Retention Rate','percentage','north_star','auto',NULL,'quarterly','',NULL,'higher_better',NULL,NULL,NULL,601),
('churn_rate','retention','معدل التسرب','Churn Rate','percentage','north_star','auto',NULL,'quarterly','',NULL,'lower_better',NULL,NULL,NULL,602),
('acv','retention','متوسط قيمة العقد','Average Contract Value','currency','north_star','auto',NULL,'weekly','',NULL,'higher_better',NULL,NULL,5,603),
('arr','retention','الإيراد المتكرر السنوي','Annual Recurring Revenue','currency','north_star','auto',NULL,'quarterly','',NULL,'higher_better',NULL,NULL,NULL,604),
('expansion_revenue','retention','إيراد التوسّع داخل العميل','Expansion Revenue','currency','north_star','auto',NULL,'quarterly','',NULL,'higher_better',NULL,NULL,NULL,605),
('referral_rate','retention','نسبة الإحالات','Referral Rate','percentage','north_star','auto',NULL,'weekly','',NULL,'higher_better',NULL,NULL,10,606),
('nps','retention','مؤشر صافي الترويج','Net Promoter Score','score','north_star','manual',NULL,'quarterly','',30,'higher_better',NULL,NULL,NULL,607),
('csat','retention','مؤشر رضا العميل','Customer Satisfaction Score','score','north_star','manual',NULL,'quarterly','',80,'higher_better',NULL,NULL,NULL,608),

-- ── الطبقة السابعة: الجمهور والاستهداف ──
('audience_geo','audience','التوزيع الجغرافي','Geographic Distribution','count','operational','integration','web_analytics','quarterly','city',NULL,'higher_better',NULL,NULL,NULL,701),
('audience_job_title','audience','المسمى الوظيفي','Job Title','count','operational','integration','ads','quarterly','job_title',NULL,'higher_better',NULL,NULL,NULL,702),
('audience_industry','audience','القطاع','Industry','count','operational','integration','ads','quarterly','industry',NULL,'higher_better',NULL,NULL,NULL,703),
('audience_company_size','audience','حجم المنشأة','Company Size','count','operational','integration','ads','quarterly','company_size',NULL,'higher_better',NULL,NULL,NULL,704),
('audience_seniority','audience','الأقدمية الوظيفية','Seniority Level','count','operational','integration','ads','quarterly','seniority',NULL,'higher_better',NULL,NULL,NULL,705),
('audience_interests','audience','الاهتمامات','Interests','count','operational','integration','ads','quarterly','interest',NULL,'higher_better',NULL,NULL,NULL,706),
('high_value_segments','audience','الشرائح عالية القيمة','High-Value Segments','currency','north_star','auto',NULL,'quarterly','segment',NULL,'higher_better',NULL,NULL,NULL,707),

-- ── الطبقة الثامنة: البريد والتواصل المباشر ──
('email_open_rate','email','معدل الفتح','Open Rate','percentage','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,801),
('email_click_rate','email','معدل النقر','Click Rate','percentage','operational','auto',NULL,'monthly','',2,'higher_better',NULL,NULL,NULL,802),
('email_ctor','email','معدل النقر إلى الفتح','Click-to-Open Rate','percentage','north_star','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,803),
('email_bounce_rate','email','معدل ارتداد البريد','Email Bounce Rate','percentage','operational','auto',NULL,'monthly','',2,'lower_better',NULL,NULL,NULL,804),
('email_unsubscribe_rate','email','معدل إلغاء الاشتراك','Unsubscribe Rate','percentage','operational','auto',NULL,'monthly','',0.5,'lower_better',NULL,NULL,NULL,805),
('email_spam_rate','email','معدل شكاوى البريد المزعج','Spam Complaint Rate','percentage','operational','manual',NULL,'monthly','',0.1,'lower_better',NULL,NULL,NULL,806),
('list_growth_rate','email','معدل النمو في قائمة المشتركين','List Growth Rate','percentage','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,807),
('revenue_per_email','email','الإيراد المنسوب للبريد','Revenue per Email','currency','north_star','manual',NULL,'quarterly','',NULL,'higher_better',NULL,NULL,NULL,808),

-- ── الطبقة التاسعة: الإسناد والقياس المتقدم ──
('journey_touchpoints','attribution','نقاط الاتصال قبل التعاقد','Customer Journey Touchpoints','count','north_star','manual',NULL,'quarterly','',NULL,'range',5,12,NULL,901),
('lagged_impact_days','attribution','الأثر المؤجل','Lagged Impact','days','operational','manual',NULL,'quarterly','',NULL,'higher_better',NULL,NULL,NULL,902),
('ab_test_lift','attribution','أثر اختبار أ ب','A/B Test Lift','percentage','operational','auto',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,903),
('cohort_retention','attribution','احتفاظ الدفعة','Cohort Retention','percentage','north_star','auto',NULL,'quarterly','cohort',NULL,'higher_better',NULL,NULL,NULL,904),

-- ── الطبقة العاشرة: التشغيل وجودة البيانات ──
('calendar_adherence','operations','الالتزام بخطة النشر','Content Calendar Adherence','percentage','operational','auto',NULL,'monthly','',90,'higher_better',NULL,NULL,NULL,1001),
('first_response_minutes','operations','زمن الاستجابة الأول','First Response Time','minutes','north_star','auto',NULL,'weekly','',60,'lower_better',NULL,NULL,7,1002),
('approval_cycle_hours','operations','زمن دورة الاعتماد','Approval Workflow Cycle Time','hours','operational','auto',NULL,'monthly','',48,'lower_better',NULL,NULL,NULL,1003),
('data_completeness','operations','اكتمال بيانات العميل المحتمل','Data Completeness','percentage','operational','auto',NULL,'monthly','',95,'higher_better',NULL,NULL,NULL,1004),
('duplicate_rate','operations','نسبة السجلات المكررة','Duplicate Rate','percentage','operational','auto',NULL,'monthly','',2,'lower_better',NULL,NULL,NULL,1005),
('privacy_compliance','operations','الالتزام بحماية البيانات','Data Privacy Compliance','percentage','operational','auto',NULL,'quarterly','',100,'higher_better',NULL,NULL,NULL,1006);
