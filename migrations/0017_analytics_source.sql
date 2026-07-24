-- مصدر لقطة التحليلات: 'posts' (من /posts) أو 'export' (تصدير تحليلات) أو NULL (قديم/جدول نشر).
-- يمكّن إعادة بناء لقطات /posts في كل سحب دون حذف صفوف التصدير.
ALTER TABLE analytics_snapshots ADD COLUMN source TEXT;
