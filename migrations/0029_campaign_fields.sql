-- ===== حقول الحملة: مسؤولها وميزانيتها ومستهدفاتها =====
-- الحملة كانت سبعة أعمدة: اسمٌ وهدفٌ ومدّةٌ ومنصاتٌ وحالة. تجمع منشورات
-- ولا تقول شيئاً عن جدواها — لا مَن يملكها، ولا كم رُصد لها، ولا ما الرقم
-- الذي يُحكم عليها به. وشاشةٌ تعرض «مئة ألف ظهور» بلا سقفٍ تُقاس عليه
-- تعرض رقماً لا مؤشراً، وهو ما يمنعه دليل المؤشرات صراحةً.

-- آخر تعديل. لا افتراض له: SQLite لا تقبل افتراضاً غير ثابت في
-- ADD COLUMN، بخلاف created_at التي وُلدت مع الجدول في 0001. والصفوف
-- القائمة تُملأ من created_at أسفل هذا الملف كي لا يدّعي صفٌّ قديم
-- أنه عُدّل للتوّ.
ALTER TABLE campaigns ADD COLUMN updated_at TEXT;

-- مسؤول الحملة — لا «مالكها». والعمود يشير إلى users(id) فيلزم ذكره في
-- USER_REFERENCES بـ src/sso.ts: الترحيل الكسول يستبدل المعرّف المحلّي
-- بـ sub المركزي عند أول دخول، وعمودٌ خارج تلك القائمة يبقى معلّقاً بلا
-- خطأ ظاهر.
ALTER TABLE campaigns ADD COLUMN owner_id TEXT REFERENCES users(id);

-- الميزانية المخطّطة بالريال. اختيارية ولا افتراض صفر: «بلا ميزانية
-- مسجّلة» و«ميزانيةٌ صفر» واقعتان مختلفتان، ودمجهما في صفرٍ واحد يجعل
-- ما لم يُسجَّل بعد يبدو قراراً.
-- ولا علاقة لها بـ ad_spend.campaign_id: ذاك معرّف حملة المزوّد الإعلاني
-- نصّاً حرّاً، وهذا رقمُ تخطيطٍ داخليّ. ربطهما يخلط المرصود بالمنفَق.
ALTER TABLE campaigns ADD COLUMN budget REAL;

-- المستهدفات الثلاثة — أعمدة لا حقل JSON: المجموعة مغلقة (ثلاثة لا
-- تزيد بتبدّل ذوق)، والمقارنة تجري في SQL جنب التجميع، وسابقةُ الجدول
-- نفسها في 0023 تخزّن target_value وtarget_min وtarget_max أعمدةً.
-- وكلٌّ منها higher_better بطبعه، فلا عمود اتجاهٍ لا يحمل إلا قيمةً واحدة.
-- وتقابل ثلاث طبقاتٍ من دليل المؤشرات: الوصول والظهور، والتفاعل،
-- والتحويل ومسار البيع.
ALTER TABLE campaigns ADD COLUMN target_impressions INTEGER;
ALTER TABLE campaigns ADD COLUMN target_engagement INTEGER;
ALTER TABLE campaigns ADD COLUMN target_leads INTEGER;

-- الصفوف القائمة: آخر تعديلٍ معلومٍ هو إنشاؤها.
UPDATE campaigns SET updated_at = created_at WHERE updated_at IS NULL;

-- القائمة تُصفّي بالحالة افتراضاً (المؤرشفة تخرج من العرض الأول).
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
