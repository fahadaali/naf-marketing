-- ═══ الوسيط على مقاس كل منصة ═══
--
-- كان الوسيط يُرسل إلى كل منصةٍ بأبعاده كما رُفع: سناب وتيك توك يريدان
-- ‎9:16‎، وإنستغرام يرفض ما خرج عن ‎4:5–1.91:1‎. فتُحفظ أبعاده ليُعرف قبل
-- النشر هل تقبله المنصة أم يُكيَّف لها، ومدّةُ المقطع ليُعرف هل يصير ريلز
-- أو شورتس أو سبوتلايت.
--
-- أبعاد الصورة يقرؤها الخادم عند الرفع. وأبعاد المقطع ومدّته يقرؤها المتصفح
-- (لا يملك العامل ما يقرأ به ملف فيديو)، والقديم بلا قيمٍ يُكمَّل حين يُفتح
-- محتواه في المحرر. والفارغ يعني «لا يُعرف» فيُنشر كما كان يُنشر.

ALTER TABLE media_assets ADD COLUMN width INTEGER;
ALTER TABLE media_assets ADD COLUMN height INTEGER;
ALTER TABLE media_assets ADD COLUMN duration_ms INTEGER;

-- غلاف المقطع: صورةٌ تظهر قبل التشغيل في المنصات التي تقبلها.
ALTER TABLE content_posts ADD COLUMN video_cover_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL;

-- الصورة التي وُلّد منها مقطع نسخة المنصة (تيك توك بصورةٍ واحدة) — إن تغيّرت
-- صورة المحتوى بعده عُرف أن المقطع قديمٌ فيُولَّد من جديد. والفارغ: وسيطٌ
-- اختاره الفريق بيده.
ALTER TABLE post_variants ADD COLUMN media_source_id TEXT;

-- سناب يُنشر في موعده الواحد أكثر من نشرة (سبوتلايت وقصة محفوظة وقصة).
-- المعرّف الأول في `provider_post_id` كما كان، والبقية هنا مصفوفة JSON.
ALTER TABLE schedules ADD COLUMN extra_provider_ids TEXT;
