import { formatDate, formatTime } from './lib/format';
// عميل API موحّد — كل النداءات تمر عبر Workers (لا مفاتيح في المتصفح).

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: options.body && !(options.body instanceof FormData)
      ? { 'content-type': 'application/json', ...(options.headers || {}) }
      : options.headers,
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  // انتهاء الجلسة: الحارس يفحص رمز المركز في كل طلب، وعمر الرمز ربع ساعة —
  // فالجلسة تنتهي أثناء العمل لا قبل بدئه. والحارس يردّ على طلبات fetch
  // بـ401 ومعها رابط الباب، لا بتحويل ٣٠٢: التحويل يتبعه المتصفح إلى نطاق
  // المركز، ولا ترويسات CORS عليه عمداً، فيسقط الطلب بخطأ شبكة لا يُقرأ.
  //
  // ونقل النافذة كلّها لا نداء داخلي: الدخول يقع في المركز لا هنا.
  if (res.status === 401 && typeof data.login === 'string') {
    window.location.assign(data.login);
    // وعدٌ لا يُحلّ: الصفحة تُغادر، وردّ خطأ هنا يومض رسالةً قبل المغادرة.
    return new Promise<T>(() => {});
  }

  // ومنعُ الدخول من المركز يُعرض في شاشة الرفض بمصطلحها المسجَّل، لا برمزه
  // التقني في رسالة خطأ. والفحص على حقل `denied` لأن المنصة نفسها تردّ 403
  // على من لا صلاحية له بجملة عربية لا برمز — وهاتان حالتان مختلفتان.
  if (res.status === 403 && typeof data.denied === 'string') {
    window.location.assign(data.denied);
    return new Promise<T>(() => {});
  }

  if (!res.ok) throw new Error(data.error || `خطأ (${res.status})`);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>(p),
  post: <T = any>(p: string, body?: unknown) =>
    request<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T = any>(p: string, body?: unknown) =>
    request<T>(p, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T = any>(p: string, body?: unknown) =>
    request<T>(p, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T = any>(p: string) => request<T>(p, { method: 'DELETE' }),
  upload: <T = any>(p: string, form: FormData) => request<T>(p, { method: 'POST', body: form }),
};

// ===== ثوابت العرض =====
export const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  pending_marketing: 'بانتظار المراجعة',
  pending_gm: 'بانتظار الاعتماد',
  approved: 'معتمد',
  scheduled: 'مجدول',
  late: 'متأخر',
  published: 'منشور',
  archived: 'مؤرشف',
  rejected: 'مرفوض',
};

export const STATUS_BADGE: Record<string, string> = {
  draft: 'gray',
  pending_marketing: 'amber',
  pending_gm: 'amber',
  approved: 'green',
  scheduled: 'blue',
  late: 'red',
  published: 'green',
  archived: 'gray',
  rejected: 'red',
};

// الحالة المعروضة: المنشور المجدول الذي فات موعده دون نشر يدوي يظهر «متأخر».
export function displayStatus(post: { status: string; pending_at?: string | null }): string {
  if (post.status === 'scheduled' && post.pending_at && new Date(post.pending_at).getTime() < Date.now()) {
    return 'late';
  }
  return post.status;
}

export const ROLE_LABELS: Record<string, string> = {
  writer: 'كاتب محتوى',
  marketing_manager: 'مدير تسويق',
  general_manager: 'مدير عام',
};

// تنسيق الوقت بتوقيت الرياض
export function formatRiyadh(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // إزاحة إلى توقيت الرياض (‏+3 ثابت بلا توقيت صيفي) ثم التنسيق بدوال naf-format
  const riyadh = new Date(d.getTime() + (180 + d.getTimezoneOffset()) * 60_000);
  // عزل اتجاهي (FSI…PDI) وإلا انقلب ترتيب التاريخ والوقت داخل النص العربي
  return `\u2068${formatDate(riyadh)} ${formatTime(riyadh)}\u2069`;
}
