-- ═══ الردّ من خارج المنصة، وما قُرئ من الصندوق ═══
--
-- التعليق كان يدخل «تم الرد» حين يُردّ عليه من هنا وحده. والفريق يردّ كثيراً
-- من تطبيق المنصّة نفسها، فيبقى تعليقٌ أُجيب «بلا رد» — أو لا يظهر أصلاً إن
-- وقع بعد الصفحة الأولى من تعليقات منشوره.
--
-- `reply_source` يقول من أين جاء الرد: `platform` كُتب من هنا، و`external`
-- عُرف من ردود المنصّة. وكل ردٍّ قائمٍ بلا كاتبٍ منّا كان من الثاني أصلاً —
-- ردودُ الملف التجاري المقروءة مع مراجعاتها.
ALTER TABLE platform_comments ADD COLUMN reply_source TEXT;
UPDATE platform_comments
SET reply_source = CASE WHEN replied_by IS NULL THEN 'external' ELSE 'platform' END
WHERE reply_body IS NOT NULL;

-- آخر مرّةٍ فُحصت فيها ردود التعليق بحثاً عن ردٍّ منّا — فتدور الحصّة على
-- التعليقات بلا رد ولا تقف عند أحدثها.
ALTER TABLE platform_comments ADD COLUMN reply_checked_at TEXT;

-- الصندوق يُقرأ بالتاريخ ويُحتسب منه بالفترة
CREATE INDEX IF NOT EXISTS idx_comments_created ON platform_comments(created_at);

-- ── ما قُرئ من منشورات الصندوق ──
-- بصمةُ نشاط المنشور كما يعلنها المزوّد (عدد التعليقات ووقت آخرها): منشورٌ
-- لم تتغيّر بصمتُه لا يُعاد جلبُ تعليقاته. و`tail_cursor` آخرُ صفحةٍ بلغتها
-- القراءة — التعليقات من الأقدم إلى الأحدث، فمنشورٌ بمئات التعليقات يُستأنف
-- من آخره لا من أوّله. و`needs_more` منشورٌ وقفت قراءته دون آخره.
CREATE TABLE IF NOT EXISTS inbox_post_state (
  inbox_post_id TEXT NOT NULL,
  account_id    TEXT NOT NULL DEFAULT '',
  platform      TEXT,
  signature     TEXT NOT NULL DEFAULT '',
  seen_at       TEXT,
  synced_at     TEXT,
  tail_cursor   TEXT,
  needs_more    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (inbox_post_id, account_id)
);
