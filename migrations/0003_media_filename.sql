-- إضافة اسم الملف الأصلي للوسائط (لدعم التنزيل بالاسم الصحيح)
ALTER TABLE media_assets ADD COLUMN filename TEXT;
