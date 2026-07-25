import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/routes/webhooks';

const SECRET = 'whsec_test_1234567890';
const BODY = JSON.stringify({ event: 'comment.received', data: { id: 'sapi_cmt_x' } });
const valid = 'sha256=' + createHmac('sha256', SECRET).update(BODY).digest('hex');

// التحقق من توقيع الويب هوك — منطق أمني: يجب ألّا يقبل توقيعاً مزوّراً
describe('verifySignature', () => {
  it('يقبل التوقيع الصحيح (مطابق لمرجع Node)', async () => {
    expect(await verifySignature(SECRET, BODY, valid)).toBe(true);
  });

  it('يرفض التوقيع بسرّ خاطئ', async () => {
    expect(await verifySignature('wrong_secret', BODY, valid)).toBe(false);
  });

  it('يرفض عند العبث بالجسم', async () => {
    expect(await verifySignature(SECRET, BODY + ' ', valid)).toBe(false);
  });

  it('يرفض الترويسة الفارغة', async () => {
    expect(await verifySignature(SECRET, BODY, '')).toBe(false);
  });

  it('يرفض توقيعاً بلا بادئة sha256=', async () => {
    const bare = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(await verifySignature(SECRET, BODY, bare)).toBe(false);
  });

  it('يرفض توقيعاً بطول مختلف دون تسريب توقيت', async () => {
    expect(await verifySignature(SECRET, BODY, 'sha256=abc')).toBe(false);
  });
});
