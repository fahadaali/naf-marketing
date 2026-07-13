-- مزامنة بيسكامب (مشروع «إدارة التسويق»): ربط المنشور ببطاقة المهمة، وتخزين مرجع مرفق الوسيط.
CREATE TABLE IF NOT EXISTS basecamp_tasks (
  post_id    TEXT PRIMARY KEY,
  todo_id    TEXT,
  list_id    TEXT,
  stage      TEXT,
  updated_at TEXT
);

-- مرجع المرفق في بيسكامب (sgid) لإعادة استخدامه في وصف المهام دون إعادة الرفع
ALTER TABLE media_assets ADD COLUMN basecamp_sgid TEXT;
