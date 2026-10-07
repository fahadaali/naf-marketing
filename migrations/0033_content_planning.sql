-- ===== خطة المحتوى: يومُ النشر المستهدف ومنصاته وشكله ومسؤوله ومحوره =====
-- المنصة تجدول النشر ولا مكان فيها لتخطيط الإنتاج: المحتوى يولد مسودةً بلا
-- يومٍ ولا منصةٍ ولا مسؤول، والجدولة لا تُقبل إلا لمعتمد. والفكرة سجلُّ
-- محتوى في أوّل مراحله لا كيانٌ موازٍ، فالخطة أعمدةٌ هنا لا جدولٌ جديد —
-- وبها تظهر الفكرة في كل ما يقرأ المحتوى، ويُكتب نصّها في السجلّ نفسه.
--
-- ولا قيد CHECK على أيٍّ منها. تغيير القيد في SQLite إعادةُ بناءٍ للجدول،
-- وهذا الجدول يرتبط به ثمانية جداول بعضها ON DELETE CASCADE وفهرسُ FTS
-- بمعرّف الصف — و DROP TABLE حذفٌ ضمنيّ يُطلق التسلسل. القيم يتحقّق منها
-- src/services/planning.ts. وحالة «فكرة» لا عمود لها: مشتقّةٌ من
-- status = 'draft' AND body = '' كما تُشتقّ «متأخر».

-- يوم النشر المستهدف: يومٌ بتقويم الرياض نصّاً 'YYYY-MM-DD' لا لحظة. الخطة
-- تقول «يوم» لا «ساعة»، والنصّ يُقارن بالنصّ بلا تحويل منطقة زمنية. ولا
-- يقرؤه النشر أبداً: المجدوِل يقرأ صفوف schedules المعلّقة وحدها
-- (src/services/publish.ts)، فلا يُنشر محتوى لأن يومه المستهدف حلّ.
ALTER TABLE content_posts ADD COLUMN planned_on TEXT;

-- منصات الخطة، JSON كـ campaigns.target_platforms: ["linkedin","x"]. تقترح
-- ولا تُلزم — منصات النشر تُختار عند الجدولة من المفعّل منها.
ALTER TABLE content_posts ADD COLUMN planned_platforms TEXT;

-- الشكل: text و image و carousel و infographic و video و short_video و
-- story و article. ولكل شكلٍ نوعٌ واحد في content_type يُشتقّ منه في الكود،
-- فالمؤشرات التي تجمع بالنوع لا تتغيّر. وافتراضه text كافتراض content_type،
-- والأنواع الثلاثة أشكالٌ بأنفسها فتُملأ الصفوف القائمة منها أسفل الملف.
ALTER TABLE content_posts ADD COLUMN format TEXT NOT NULL DEFAULT 'text';

-- مسؤول التنفيذ. يشير إلى users(id) فيلزم ذكره في USER_REFERENCES بـ
-- src/sso.ts — الترحيل الكسول يستبدل المعرّف المحلّي بمعرّف المركز، وعمودٌ
-- خارج تلك القائمة يبقى معلّقاً بلا خطأ ظاهر. وهو غير author_id: الكاتب من
-- كتب النصّ، والمسؤول من أُسند إليه أن يكتبه.
ALTER TABLE content_posts ADD COLUMN assignee_id TEXT REFERENCES users(id);

-- محور المحتوى نصّاً كما في قائمة الإعدادات content_pillars — بياناتٌ
-- كاسم الحملة، لا مصطلحٌ في السجلّ.
ALTER TABLE content_posts ADD COLUMN pillar TEXT;

-- ملخّص الفكرة، منفصلٌ عن body: النصّ يُكتب لاحقاً، والملخّص يبقى مرجعاً
-- لمن يكتبه — ولو كان في body لصارت الفكرة «مسودة» قبل أن يُكتب منها حرف.
ALTER TABLE content_posts ADD COLUMN brief TEXT;

-- الصفوف القائمة: شكلُها نوعُها. وصفوف النص أخذت الافتراض، والتحديث مقصورٌ
-- على غيرها لأن كل تحديثٍ في content_posts يعيد فهرسة صفّه في FTS (0008).
UPDATE content_posts SET format = content_type WHERE content_type IN ('image','video');

-- التقويم وعرض «حجم العمل» يسألان بنطاق اليوم المستهدف.
CREATE INDEX IF NOT EXISTS idx_posts_planned ON content_posts(planned_on);

-- pending_at استعلامٌ فرعيّ لكل صفٍّ في قائمة المحتوى ولا فهرس على post_id،
-- وقائمة الخطة تبلغ ألف صف.
CREATE INDEX IF NOT EXISTS idx_schedules_post ON schedules(post_id);
