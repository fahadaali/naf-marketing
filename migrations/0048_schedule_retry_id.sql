-- معرّف المنشور لدى المزوّد حين فشل بتعثّرٍ يُعاد (مهلة المنصة انتهت قبل أن تردّ).
-- به يُعاد المنشور نفسه (`PUT /post/retry` في Ayrshare) بدل إرسال منشورٍ جديد:
-- المنصة قد تكون استلمته فيتكرّر — وتيك توك لا يُحذف منه منشورٌ عبر الواجهة.
ALTER TABLE schedules ADD COLUMN retry_id TEXT;

-- وما فشل كذلك قبل هذا الإصلاح يُعاد بالطريقة نفسها: معرّفه باقٍ في provider_post_id.
UPDATE schedules SET retry_id = provider_post_id
WHERE status = 'failed' AND provider_post_id IS NOT NULL AND provider_post_id <> ''
  AND (error LIKE '%timed out%' OR error LIKE '%re-try the post%' OR error LIKE '%/retry%');
