-- ===== إتمام الدليل: المرجعية الثالثة، والقرار، والمرحلتان الغائبتان =====
-- ما يسدّه هذا الملفّ مذكورٌ في `naf-terms.md` §١٣ قبل أن يصل هنا.

-- ── المرجعية الثالثة ──
-- الرقم بلا مرجعية لا يعني شيئاً، والمرجعية ثلاث: مقارنةٌ زمنية ومستهدفٌ
-- مسجَّل ومعيارٌ قطاعي. والأولان كانا في المخطّط، وهذا الثالث.
--
-- والمعيار غير المستهدف: المستهدف ما نلتزم به، والمعيار ما عليه القطاع.
-- ومكتبٌ يبلغ مستهدفه وهو دون القطاع بلغ ما وضعه لنفسه لا ما يكفي للمنافسة.
ALTER TABLE metric_definitions ADD COLUMN benchmark_value REAL;
ALTER TABLE metric_definitions ADD COLUMN benchmark_note TEXT;

-- ── القرار المحتمل ──
-- القاعدة الأولى في ملاحظات الدليل: لا تقس ما لا تنوي التصرف بناءً عليه.
-- والحقل عند التعريف لا في التقرير — يسأل السؤال قبل أن يُجمع الرقم لا بعده.
ALTER TABLE metric_definitions ADD COLUMN decision TEXT;

-- ── استحقاق المراجعة ──
-- الدورية وحدها لا تُنبّه: مؤشرٌ ربعيٌّ لم يُراجع منذ سنة يبدو كأخيه
-- المراجَع أمس. والاستحقاق يُشتقّ من الدورية وتاريخ آخر مراجعة.
ALTER TABLE metric_definitions ADD COLUMN reviewed_at TEXT;

-- ═══ المرحلتان الغائبتان من مسار البيع ═══
--
-- المراحل ستّ: زائر ← محتمل ← مؤهل ← اجتماع ← عرض ← تعاقد. وأربعٌ منها لها
-- بيانات، والاجتماعُ والعرضُ لا يسجّلهما أي مصدر اليوم — وبينهما يقع نصف
-- المسار. فمن عرف أن مئةً تأهّلوا وعشرةً تعاقدوا لا يعرف أين تسرّبَ التسعون:
-- أفي طلب الاجتماع أم بعد تقديم العرض. والقرار يختلف — الأولى عيبُ رسالة
-- والثانية عيبُ سعرٍ أو عرض.
--
-- فيُسجَّلان مؤشرين يُدخَلان اليوم، ويُملآن من مصدرٍ حين يوجد. وحسابُ
-- المراحل الستّ في `services/metrics.ts` يقرؤهما فيكتمل المسار من غير هجرة.
INSERT OR IGNORE INTO metric_definitions
  (key, layer, name_ar, name_en, unit, class, source, integration_key, cadence, dim_key, target_value, target_direction, target_min, target_max, board_rank, sort) VALUES
('meetings','funnel','الاجتماعات','Meetings Held','count','north_star','manual',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,4085),
('proposals','funnel','العروض المقدمة','Proposals Submitted','count','north_star','manual',NULL,'monthly','',NULL,'higher_better',NULL,NULL,NULL,4086),
-- الاهتمام موضوعٌ يتابعه الشخص، والإشارة سلوكٌ يسبق الشراء. وجمعُهما في رقم
-- واحد يُخفي الفرق الذي تُبنى عليه الميزانية.
('purchase_intent','audience','إشارات السلوك الشرائي','Purchase Intent Signals','count','operational','integration','ads','quarterly','signal',NULL,'higher_better',NULL,NULL,NULL,7065);

-- ── معدل الإغلاق يعود إلى تعريف الدليل ──
-- «العقود الموقعة ÷ العروض المقدمة». وكان يُحسب على القضايا المحسومة، وتلك
-- تقيس جودة تنفيذ ما وُقّع لا جودة ما عُرض: مكتبٌ يربح قضاياه كلَّها يقرأ
-- إغلاقاً ممتازاً وهو لا يفوز إلا بعرضٍ من عشرة.
-- والحساب يفضّل العروض حين تُسجَّل، ويتراجع إلى المحسومة حين لا تُسجَّل —
-- والفرق يظهر في الملاحظة المرافقة للقيمة.
UPDATE metric_definitions SET decision = 'إن نزل عن المستهدف: راجع التسعير وبنية العرض قبل الرسالة.'
  WHERE key = 'win_rate';
UPDATE metric_definitions SET decision = 'إن ارتفع: أعد توزيع الميزانية على الشرائح الأقل تكلفةً في الطبقة السابعة.'
  WHERE key = 'cac';
UPDATE metric_definitions SET decision = 'إن نزل عن ٣:١: أوقف التوسّع في الإنفاق حتى ترتفع القيمة العمرية أو تنزل التكلفة.'
  WHERE key = 'ltv_cac_ratio';
UPDATE metric_definitions SET decision = 'إن تجاوز الساعة: راجع توزيع المناوبة على القنوات المباشرة — من يردّ أولاً يفوز بالعميل.'
  WHERE key = 'first_response_minutes';
UPDATE metric_definitions SET decision = 'إن تجاوز ٣ في حملة مدفوعة: أوقف الحملة أو وسّع الجمهور — الميزانية تُحرق على الجمهور نفسه.'
  WHERE key = 'frequency';
UPDATE metric_definitions SET decision = 'إن تجاوز ٧٠٪ في صفحة خدمة: راجع العرض أو الاستهداف.'
  WHERE key = 'bounce_rate';
UPDATE metric_definitions SET decision = 'راجع الجدول ربعياً: الشريحة الأعلى قيمةً بأقل تكلفة اكتساب تأخذ الميزانية.'
  WHERE key = 'high_value_segments';
UPDATE metric_definitions SET decision = 'أعِد قراءة أسباب الخسارة معه: الرسالة التسويقية تُعاد صياغتها من هذا الجدول.'
  WHERE key = 'loss_reasons';

-- ── المعايير القطاعية المذكورة في الدليل نصّاً ──
-- ما ذكره الدليل حدّاً مهنياً يُسجَّل معياراً، وما لم يذكره يبقى فارغاً
-- ويُدخله من يعرفه. ولا يُخمَّن رقم: معيارٌ مخترع أسوأ من غيابه، لأنه
-- يُقارَن به ويُبنى عليه قرار.
UPDATE metric_definitions SET benchmark_value = 1, benchmark_note = 'المستهدف المهني في المحتوى القانوني: ١٪ فأعلى في المنشورات.'
  WHERE key = 'ctr';
UPDATE metric_definitions SET benchmark_value = 2, benchmark_note = 'المستهدف المهني في البريد: ٢٪ فأعلى.'
  WHERE key = 'email_click_rate';
UPDATE metric_definitions SET benchmark_value = 3, benchmark_note = 'المستهدف ٣:١ فأعلى. أقل من ذلك نموذج نمو غير مستدام.'
  WHERE key = 'ltv_cac_ratio';
UPDATE metric_definitions SET benchmark_value = 70, benchmark_note = 'أعلى من ٧٠٪ في صفحة خدمة يعني خللاً في العرض أو الاستهداف.'
  WHERE key = 'bounce_rate';
UPDATE metric_definitions SET benchmark_value = 3, benchmark_note = 'فوق ٣ في الحملات المدفوعة إرهاقٌ للجمهور نفسه وحرقٌ للميزانية.'
  WHERE key = 'frequency';
UPDATE metric_definitions SET benchmark_note = 'في الخدمات القانونية غالباً بين ٥ و١٢ نقطة.'
  WHERE key = 'journey_touchpoints';

-- ── خريطة الحرارة ──
-- ليست رقماً: لا قيمة عددية لها، وهي مخرَجٌ بصريّ من أداة قياسٍ خارجية.
-- فلا تُسجَّل مؤشراً بوحدةٍ مخترعة — تُسجَّل رابطاً في إعداد تحليلات الموقع،
-- ويُعرض في طبقتها زرَّ فتحٍ لا بطاقةَ رقم. ورقمٌ مخترعٌ لها أسوأ من غيابها:
-- «نسبة التمرير» مسجّلة مؤشراً مستقلاً وتقيس شيئاً آخر.
UPDATE integrations
SET config_json = json_set(COALESCE(NULLIF(config_json, ''), '{}'), '$.heatmap_url', '')
WHERE key = 'web_analytics' AND json_extract(COALESCE(NULLIF(config_json, ''), '{}'), '$.heatmap_url') IS NULL;

-- ── بُعدان يفتحان مؤشرين كانا رقماً واحداً ──
-- الدليل يطلب زمن دورة البيع «ومتوسطه لكل نوع خدمة»: رقمٌ واحد يخفي أن
-- عقد التأسيس يُغلق في أسبوع والتقاضي في أشهر، فيبدو المتوسط بطيئاً في
-- الأول وسريعاً في الثاني ولا يصف أيّهما.
UPDATE metric_definitions SET dim_key = 'service' WHERE key = 'sales_cycle_days';
-- ويذكر اختبار أ/ب على «العناوين والصور والعروض ونماذج التواصل» — أربعةٌ
-- لا واحد. والمحتسب اليوم عناوين البريد، والبقيّة تُدخَل ببُعدها فتقع في
-- الصفّ نفسه بلا مؤشر رابع.
UPDATE metric_definitions SET dim_key = 'test' WHERE key = 'ab_test_lift';
