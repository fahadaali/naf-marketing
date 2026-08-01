/* ============================================================
   منصة إدارة المكتب (`naf-manger`) — مصدر الطبقة الرابعة كلها.

   العميل المحتمل ومساره إلى التعاقد سجلٌّ هناك لا هنا، وكلُّ ما في الطبقات
   الرابعة والخامسة والسادسة يُحسب منه: نسبة التأهيل، والتحويل على كل مرحلة،
   ومعدل الإغلاق، وزمن دورة البيع، وتكلفة الاكتساب، ومتوسط قيمة العقد،
   ونسبة الإحالات.

   ═══ القراءة وحدها ═══

   هذا العميل يقرأ ولا يكتب. مصدر الحقيقة هناك، ومنصةُ تسويقٍ تكتب في سجلّ
   العملاء تُنتج نسختين تفترقان — ثم لا يُعرف أيّهما الصحيحة.

   ═══ المصادقة ═══

   منصة إدارة المكتب محميّة بحارس الدخول الموحّد: كل مسار فيها يمرّ بـ
   `authenticate` من `naf-auth`، وهو يقرأ كوكي جلسةٍ من متصفّح. وهذا الطلب
   يخرج من `Worker` لا من متصفّح، فلا كوكي معه ولا جلسة.

   فوضعان لا ثالث لهما:

   **`bearer`** — ترويسة `Authorization: Bearer` بمفتاح خدمةٍ يُخزَّن في
   `CRM_API_KEY` عبر `wrangler secret`. وهو الوضع المقصود، ويحتاج من تلك
   المنصة سطراً واحداً يقبل المفتاح قبل `authenticate` كما تقبل `‎/health`.
   وحتى يُضاف، يردّ النداءُ ٤٠١ وتُسجَّل الحالة «تعذّر السحب» بسببها.

   **`import`** — لا نداء شبكة. المدير يُنزّل `‎/api/export` من تلك المنصة
   ويرفع الملف هنا. يعمل اليوم بلا تغيير في أي مستودع، ويُغني عن الانتظار.

   ولا وضعَ ثالث بلصق كوكي جلسة: الكوكي رمزُ دخولِ إنسانٍ بعينه، وتخزينُه
   في إعدادات منصةٍ أخرى يجعل كل ما تفعله المنصة منسوباً إليه، وينتهي
   صلاحيةً في وقتٍ لا يعلمه أحد فيسقط السحب بلا سبب ظاهر.
   ============================================================ */

import type { Env } from '../types';

export type CrmLead = {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: string | null;
  clientType: string | null;
  expectedValue: number | null; // بالريال
  assignedTo: string | null;
  followUpDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CrmClient = {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  clientType: string | null;
  status: string | null;
  joinDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CrmCase = {
  id: string;
  caseNumber: string | null;
  caseType: string | null;
  clientId: string | null;
  status: string | null;
  outcome: string | null;
  feeAmount: number | null;
  collectedAmount: number | null;
  marketerId: string | null;
  marketerName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CrmSnapshot = { leads: CrmLead[]; clients: CrmClient[]; cases: CrmCase[] };

export type CrmConfig = {
  /** عنوان منصة إدارة المكتب — بلا خطّ مائل في آخره. */
  baseUrl: string;
  mode: 'bearer' | 'import';
};

/** خطأ يحمل سببه للعرض في شاشة التكاملات — الرسالة تقول ما حدث وما العمل. */
export class CrmError extends Error {}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * المبلغ من بنية `fee_structure` أو `payment_status`.
 *
 * البنيتان تكتبهما شاشة القضية بالريالات، وشكلُهما غير مضمون: منها ما يحمل
 * `{type:'fixed_amount', value}` ومنها ما يحمل `amount` أو `totalAmount`.
 * فتُقرأ المفاتيح المحتملة بالترتيب، وما لم يُقرأ يبقى `null` — لا صفراً.
 * الصفر رقمٌ يدخل المتوسط ويجرّه إلى أسفل، والغياب يُستثنى منه.
 */
function amountFrom(raw: unknown, keys: string[]): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  for (const k of keys) {
    const n = num(o[k]);
    if (n !== null) return n;
  }
  return null;
}

function mapLead(row: Record<string, unknown>): CrmLead {
  return {
    id: String(row.id),
    fullName: str(row.fullName),
    phone: str(row.phone),
    email: str(row.email),
    source: str(row.source),
    status: str(row.prospectStatus),
    clientType: str(row.clientType),
    expectedValue: num(row.expectedValue),
    assignedTo: str(row.assignedTo),
    followUpDate: str(row.followUpDate),
    createdAt: str(row.createdAt) ?? str(row.createdDate),
    updatedAt: str(row.updatedAt) ?? str(row.updatedDate),
  };
}

function mapClient(row: Record<string, unknown>): CrmClient {
  return {
    id: String(row.id),
    fullName: str(row.fullName),
    phone: str(row.phone),
    email: str(row.email),
    clientType: str(row.clientType),
    status: str(row.status),
    joinDate: str(row.joinDate),
    createdAt: str(row.createdAt) ?? str(row.createdDate),
    updatedAt: str(row.updatedAt) ?? str(row.updatedDate),
  };
}

function mapCase(row: Record<string, unknown>): CrmCase {
  return {
    id: String(row.id),
    caseNumber: str(row.caseNumber),
    caseType: str(row.caseType),
    clientId: str(row.clientId),
    status: str(row.status),
    outcome: str(row.outcome),
    feeAmount: amountFrom(row.feeStructure, ['value', 'amount', 'totalAmount', 'fixedAmount']),
    collectedAmount: amountFrom(row.paymentStatus, ['collectedAmount', 'collected', 'paidAmount']),
    marketerId: str(row.marketerId),
    marketerName: str(row.marketerName),
    createdAt: str(row.createdAt) ?? str(row.createdDate),
    updatedAt: str(row.updatedAt) ?? str(row.updatedDate),
  };
}

/* ═══ صفوف القاعدة الخام ═══
   `‎/api/export` يعيد صفوف الجداول كما هي — أعمدةُ `snake_case` وأوقاتٌ
   بالثواني ومبالغُ هللات — لا صيغةَ الواجهة التي يعيدها `‎/api/{resource}`.
   فالوضعان يحتاجان مُحوّلين لا واحداً، وخلطُهما يعطي مبالغَ ×١٠٠ وتواريخَ
   في سنة ١٩٧٠. */

function fromEpoch(v: unknown): string | null {
  const n = num(v);
  if (n === null) return null;
  return new Date(n * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseJson(raw: unknown): unknown {
  if (!raw || typeof raw !== 'string') return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mapLeadRow(row: Record<string, unknown>): CrmLead {
  const halalas = num(row.expected_value);
  return {
    id: String(row.id),
    fullName: str(row.full_name),
    phone: str(row.phone),
    email: str(row.email),
    source: str(row.source),
    status: str(row.prospect_status),
    clientType: str(row.client_type),
    expectedValue: halalas === null ? null : halalas / 100,
    assignedTo: str(row.assigned_to),
    followUpDate: str(row.follow_up_date),
    createdAt: fromEpoch(row.created_at),
    updatedAt: fromEpoch(row.updated_at),
  };
}

function mapClientRow(row: Record<string, unknown>): CrmClient {
  return {
    id: String(row.id),
    fullName: str(row.full_name),
    phone: str(row.phone),
    email: str(row.email),
    clientType: str(row.client_type),
    status: str(row.status),
    joinDate: str(row.join_date),
    createdAt: fromEpoch(row.created_at),
    updatedAt: fromEpoch(row.updated_at),
  };
}

function mapCaseRow(row: Record<string, unknown>): CrmCase {
  return {
    id: String(row.id),
    caseNumber: str(row.case_number),
    caseType: str(row.case_type),
    clientId: str(row.client_id),
    status: str(row.status),
    outcome: str(row.outcome),
    feeAmount: amountFrom(parseJson(row.fee_structure), ['value', 'amount', 'totalAmount', 'fixedAmount']),
    collectedAmount: amountFrom(parseJson(row.payment_status), ['collectedAmount', 'collected', 'paidAmount']),
    marketerId: str(row.marketer_id),
    marketerName: str(row.marketer_name),
    createdAt: fromEpoch(row.created_at),
    updatedAt: fromEpoch(row.updated_at),
  };
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((r) => r && typeof r === 'object') as Record<string, unknown>[]) : [];
}

/**
 * يقرأ لقطةً من ملفّ `‎/api/export` المرفوع — الوضع `import`.
 * ويقبل الغلاف `{ok, data:{...}}` والجسم المجرّد معاً: من ينزّل الملفّ من
 * المتصفّح يحصل على الأول، ومن ينسخ محتواه قد يلصق الثاني.
 */
export function parseCrmExport(payload: unknown): CrmSnapshot {
  if (!payload || typeof payload !== 'object') throw new CrmError('الملف غير صالح. ارفع ملف التصدير كما نزّلته.');
  const body = payload as Record<string, unknown>;
  const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;

  const leads = rows(data.prospects).map(mapLeadRow);
  const clients = rows(data.clients).map(mapClientRow);
  const cases = rows(data.cases).map(mapCaseRow);

  if (!leads.length && !clients.length && !cases.length) {
    throw new CrmError('الملف لا يحمل عملاء ولا محتملين ولا قضايا. تأكّد أنه ملف التصدير من منصة إدارة المكتب.');
  }
  return { leads, clients, cases };
}

async function getJson(cfg: CrmConfig, token: string, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
  } catch (e) {
    throw new CrmError(`تعذّر الوصول إلى منصة إدارة المكتب على ${cfg.baseUrl} — ${String((e as Error)?.message || e)}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new CrmError(
      'رفضت منصة إدارة المكتب المفتاح. تأكّد من ضبط CRM_API_KEY، وأن تلك المنصة تقبل مفتاح الخدمة على مسارات القراءة.',
    );
  }
  if (!res.ok) {
    throw new CrmError(`ردّت منصة إدارة المكتب بالحالة ${res.status} على ${path}`);
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.ok === false) {
    throw new CrmError(`ردّ غير مفهوم من ${path}: ${String(body?.error ?? 'بلا تفصيل')}`);
  }
  return body.data;
}

/** يسحب لقطةً كاملة عبر الشبكة — الوضع `bearer`. */
export async function fetchCrmSnapshot(cfg: CrmConfig, token: string): Promise<CrmSnapshot> {
  if (!cfg.baseUrl) throw new CrmError('عنوان منصة إدارة المكتب غير مضبوط. اضبطه من التكاملات.');
  if (!token) throw new CrmError('مفتاح منصة إدارة المكتب غير مضبوط (CRM_API_KEY).');

  const [prospects, clients, cases] = await Promise.all([
    getJson(cfg, token, '/api/prospects'),
    getJson(cfg, token, '/api/clients'),
    getJson(cfg, token, '/api/cases'),
  ]);

  return {
    leads: rows(prospects).map(mapLead),
    clients: rows(clients).map(mapClient),
    cases: rows(cases).map(mapCase),
  };
}

export function crmKey(env: Env): string {
  return (env.CRM_API_KEY || '').trim();
}
