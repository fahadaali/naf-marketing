/* ============================================================
   مزامنة مرآة منصة إدارة الشركة.

   تُستدعى من `Cron` ومن زرّ «سحب الآن» ومن رفع ملفّ التصدير — ثلاثة مداخل
   ومسارٌ واحد بعدها، فلا يفترق ما يُكتب باختلاف من طلبه.
   ============================================================ */

import type { Env } from '../types';
import { nowIso } from '../util';
import { fetchCrmSnapshot, crmKey, CrmError, type CrmSnapshot, type CrmConfig } from '../adapters/crm';

export type CrmSyncResult = { leads: number; clients: number; cases: number; converted: number };

/** يوحّد رقم الجوال للمطابقة: أرقام غربية بلا صفرٍ ولا مفتاح دولة. */
function phoneKey(value: string | null): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').replace(/^00966|^966|^0/, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

function emailKey(value: string | null): string {
  return (value || '').trim().toLowerCase();
}

/**
 * يكتب اللقطة في المرآة.
 *
 * ═══ لماذا لا يُحذف الغائب ═══
 *
 * تحويل المحتمل إلى عميل هناك يُنشئ العميل ويحذف المحتمل. فلو حذفنا الصفّ
 * كما حُذف عندهم لضاع تاريخ أول تواصل، وزمنُ دورة البيع كلُّه هو الفرق بينه
 * وبين تاريخ التعاقد. فالصفّ يبقى موسوماً `is_present = 0`، ويُربط بالعميل
 * الذي صار إليه مطابقةً بالجوال ثم بالبريد.
 *
 * والمطابقة بالجوال أوّلاً: البريد في تلك المنصة اختياري وافتراضُه فراغ،
 * فمطابقةُ فراغٍ بفراغ تربط كل محتملٍ بلا بريد بأوّل عميلٍ بلا بريد.
 */
export async function applyCrmSnapshot(env: Env, snap: CrmSnapshot): Promise<CrmSyncResult> {
  const at = nowIso();

  for (const c of snap.clients) {
    await env.DB.prepare(
      `INSERT INTO crm_clients (id, full_name, phone, email, client_type, status, join_date, created_at, updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         full_name = excluded.full_name, phone = excluded.phone, email = excluded.email,
         client_type = excluded.client_type, status = excluded.status, join_date = excluded.join_date,
         created_at = excluded.created_at, updated_at = excluded.updated_at, synced_at = excluded.synced_at`,
    )
      .bind(c.id, c.fullName, c.phone, c.email, c.clientType, c.status, c.joinDate, c.createdAt, c.updatedAt, at)
      .run();
  }

  for (const l of snap.leads) {
    await env.DB.prepare(
      `INSERT INTO crm_leads (id, full_name, phone, email, source, status, client_type, expected_value,
                              assigned_to, follow_up_date, created_at, updated_at, is_present, disappeared_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         full_name = excluded.full_name, phone = excluded.phone, email = excluded.email,
         source = excluded.source, status = excluded.status, client_type = excluded.client_type,
         expected_value = excluded.expected_value, assigned_to = excluded.assigned_to,
         follow_up_date = excluded.follow_up_date, created_at = excluded.created_at,
         updated_at = excluded.updated_at, is_present = 1, disappeared_at = NULL, synced_at = excluded.synced_at`,
    )
      .bind(
        l.id, l.fullName, l.phone, l.email, l.source, l.status, l.clientType, l.expectedValue,
        l.assignedTo, l.followUpDate, l.createdAt, l.updatedAt, at,
      )
      .run();
  }

  for (const k of snap.cases) {
    await env.DB.prepare(
      `INSERT INTO crm_cases (id, case_number, case_type, client_id, status, outcome, fee_amount,
                              collected_amount, marketer_id, marketer_name, created_at, updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         case_number = excluded.case_number, case_type = excluded.case_type, client_id = excluded.client_id,
         status = excluded.status, outcome = excluded.outcome, fee_amount = excluded.fee_amount,
         collected_amount = excluded.collected_amount, marketer_id = excluded.marketer_id,
         marketer_name = excluded.marketer_name, created_at = excluded.created_at,
         updated_at = excluded.updated_at, synced_at = excluded.synced_at`,
    )
      .bind(
        k.id, k.caseNumber, k.caseType, k.clientId, k.status, k.outcome, k.feeAmount,
        k.collectedAmount, k.marketerId, k.marketerName, k.createdAt, k.updatedAt, at,
      )
      .run();
  }

  /* ما لم يصل في هذه اللقطة يُوسم غائباً — ولا يُحذف. ووسمُه يتم بمقارنة
     `synced_at`: كل صفٍّ وصل الآن حمل الوقت الجديد، وما بقي على وقتٍ أقدم
     لم يصل. وهذا أسلم من بناء قائمة معرّفات في جملة `NOT IN` تطول بطول
     السجلّ حتى تتجاوز حدّ المتغيّرات في SQLite. */
  await env.DB.prepare(
    `UPDATE crm_leads SET is_present = 0, disappeared_at = COALESCE(disappeared_at, ?)
     WHERE synced_at < ? AND is_present = 1`,
  ).bind(at, at).run();

  // ربط الغائبين بالعملاء — الجوال أوّلاً ثم البريد، وكلاهما بعد التوحيد.
  const orphans = await env.DB.prepare(
    `SELECT id, phone, email FROM crm_leads WHERE is_present = 0 AND converted_client_id IS NULL`,
  ).all<{ id: string; phone: string | null; email: string | null }>();

  let converted = 0;
  if (orphans.results.length) {
    const clients = await env.DB.prepare(`SELECT id, phone, email FROM crm_clients`).all<{
      id: string; phone: string | null; email: string | null;
    }>();
    const byPhone = new Map<string, string>();
    const byEmail = new Map<string, string>();
    for (const c of clients.results) {
      const p = phoneKey(c.phone);
      if (p) byPhone.set(p, c.id);
      const e = emailKey(c.email);
      if (e) byEmail.set(e, c.id);
    }
    for (const o of orphans.results) {
      const match = byPhone.get(phoneKey(o.phone)) ?? byEmail.get(emailKey(o.email));
      if (!match) continue;
      await env.DB.prepare(`UPDATE crm_leads SET converted_client_id = ? WHERE id = ?`).bind(match, o.id).run();
      converted++;
    }
  }

  return { leads: snap.leads.length, clients: snap.clients.length, cases: snap.cases.length, converted };
}

/** يقرأ إعداد المصدر من `integrations` — بلا سرّ. */
export async function crmConfig(env: Env): Promise<CrmConfig> {
  const row = await env.DB.prepare(`SELECT config_json FROM integrations WHERE key = 'crm'`).first<{ config_json: string }>();
  let cfg: Record<string, unknown> = {};
  try {
    cfg = row?.config_json ? JSON.parse(row.config_json) : {};
  } catch {
    cfg = {};
  }
  const baseUrl = String(cfg.base_url ?? '').trim().replace(/\/+$/, '');
  const mode = cfg.mode === 'import' ? 'import' : 'bearer';
  return { baseUrl, mode };
}

/** السحب عبر الشبكة — الوضع `bearer` وحده. */
export async function syncCrm(env: Env): Promise<CrmSyncResult> {
  const cfg = await crmConfig(env);
  if (cfg.mode === 'import') {
    throw new CrmError('المصدر مضبوط على الرفع اليدوي. ارفع ملف التصدير، أو بدّل الوضع إلى السحب الآلي.');
  }
  const snap = await fetchCrmSnapshot(cfg, crmKey(env));
  return applyCrmSnapshot(env, snap);
}
