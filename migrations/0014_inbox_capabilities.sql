-- توسيع صندوق التعليقات/الرسائل: أعلام قدرات المنصة وحالة الإخفاء
-- (لدعم DMs والإشارات والإشراف والرد الخاص عبر SocialAPI الموحّد).
-- ملاحظة: نفّذ كل عبارة على حدة في D1 Console وتجاوز أي «duplicate column».
ALTER TABLE platform_comments ADD COLUMN capabilities_json TEXT;
ALTER TABLE platform_comments ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
