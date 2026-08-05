-- ===== الموقع الرئيسي مصدراً =====
--
-- ستة مؤشرات تخصّ الموقع كانت خارج الدليل كلّه، لا بلا مصدر بل بلا تعريف.
-- وسببُ غيابها أن «تحليلات الموقع» في الدليل تعني خاصية GA4، وGA4 يرى
-- الصفحة ولا يرى الصفّ في القاعدة: يعدّ من ضغط «أرسل» حدثاً، ولا يعرف
-- كم طلبَ تواصلٍ استقرّ فعلاً، ولا كم منها عن أي خدمة، ولا كم مقالاً
-- نُشر. والرقمان يفترقان دائماً — مانعُ الإعلانات وحده يبتلع خُمسها.
--
-- فالموقع مصدرٌ تاسع، يُقرأ منه ما يملكه هو: صفوفُ قاعدته لا زياراتُه.
-- والزيارات تبقى حيث هي — `web_analytics` — فلا رقمَ له مصدران.

-- ── المصدر ──
-- معطَّلٌ كغيره: يظهر في «التكاملات» غير مربوط، ويُربط بعنوان نقطة
-- المؤشرات في الموقع. ورمزُه `SITE_API_TOKEN` نفسه الذي تحمله نقاطه
-- العامة هنا، فسرٌّ واحد للاتجاهين.
INSERT OR IGNORE INTO integrations (key, is_enabled, config_json) VALUES
  ('website', 0, '{}');

-- ── المؤشرات ──
-- الأسماء مسجّلة في `naf-terms.md` §١٣ قبل هذا السطر، والوحدات والفئات
-- منه. وثلاثتها في طبقاتها لا في طبقةٍ جديدة اسمها «الموقع»: طلبُ
-- التواصل تحويلٌ مهما كان بابه، والاشتراك بريدٌ، والنشر تشغيل.
INSERT OR IGNORE INTO metric_definitions
  (key, layer, name_ar, name_en, unit, class, source, integration_key, cadence, dim_key, target_value, target_direction, target_min, target_max, board_rank, sort) VALUES

-- الطبقة الرابعة: التحويل ومسار البيع
('site_contact_requests','funnel','طلبات التواصل من الموقع','Website Contact Requests','count','north_star','integration','website','weekly','',NULL,'higher_better',NULL,NULL,NULL,420),
('site_contact_by_service','funnel','طلبات التواصل حسب الخدمة','Website Requests by Service','count','operational','integration','website','monthly','service',NULL,'higher_better',NULL,NULL,NULL,421),
('site_job_applications','funnel','طلبات التوظيف من الموقع','Website Job Applications','count','operational','integration','website','monthly','',NULL,'higher_better',NULL,NULL,NULL,422),

-- الطبقة الثامنة: البريد والتواصل المباشر
-- المشتركون الواصلون من نموذج الموقع وحده — لا إجمالي القائمة، فذاك
-- تحسبه المنصّة من جدولها ويشمل الاستيراد والإضافة اليدوية.
('site_newsletter_signups','email','اشتراكات النشرة من الموقع','Website Newsletter Signups','count','operational','integration','website','monthly','',NULL,'higher_better',NULL,NULL,NULL,809),

-- الطبقة العاشرة: التشغيل وجودة البيانات
('site_articles_published','operations','المقالات المنشورة في الموقع','Website Articles Published','count','operational','integration','website','monthly','',NULL,'higher_better',NULL,NULL,NULL,1006),
-- لقطةٌ لا حصيلةَ فترة: عددُ ما ينقصه الإنجليزي اليوم. وهدفُه الصفر،
-- فاتجاهه `lower_better`.
('site_missing_translations','operations','الحقول بلا ترجمة إنجليزية','Website Untranslated Fields','count','operational','integration','website','monthly','',0,'lower_better',NULL,NULL,NULL,1007);
