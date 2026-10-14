-- معرّف المنشور على منصته كما يردّه سجلّها (`GET /history/:platform`).
--
-- لقطات ما قبل Ayrshare مفتاحُها معرّف مزوّدها (Buffer أو نائب SocialAPI)، وحين
-- يطابقها سجلّ المنصة يبقى مفتاحها القديم كي لا تُعدّ مرّتين. وبذاك المفتاح كانت
-- تُطلب تعليقاتها فيردّ Ayrshare «غير موجود» بصمت — فلا يظهر تعليقٌ على منشورٍ
-- قديم أبداً. فيُحفظ المعرّف الأصلي بجانب المفتاح، وبه تُطلب التعليقات.
ALTER TABLE analytics_snapshots ADD COLUMN native_post_id TEXT;
CREATE INDEX IF NOT EXISTS idx_analytics_native ON analytics_snapshots(native_post_id);

-- يُقرأ سجلّ كل منصةٍ في Ayrshare من أوّله مرّةً أخرى، فتأخذ اللقطات القديمة
-- معرّفاتها الأصلية. ما سبق قراءته يُطابَق ولا يُكرَّر، والقراءة تجري بحصّتها المعتادة.
UPDATE settings SET value = '{"cursor":null,"doneAt":null}' WHERE key LIKE 'account_history:ayrshare:%';
