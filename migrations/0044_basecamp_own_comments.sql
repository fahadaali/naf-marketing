-- تعليقات بيسكامب التي تكتبها المنصة نفسها (إعلان انتقال المرحلة مع ذكر أعضاء المشروع).
-- تُستثنى من سحب التعليقات العكسي، وإلا عادت ملاحظاتٍ على المنشور وإشعاراتٍ بلا معنى.
CREATE TABLE IF NOT EXISTS basecamp_own_comments (
  comment_id TEXT PRIMARY KEY,
  post_id    TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
