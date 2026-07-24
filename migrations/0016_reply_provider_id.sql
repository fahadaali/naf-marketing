-- معرّف الرد على المنصة (يُلتقط عند إرسال الرد) لتمكين تعديله أو حذفه لاحقاً.
ALTER TABLE platform_comments ADD COLUMN reply_provider_id TEXT;
