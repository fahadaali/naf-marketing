import { formatDate, formatTime } from './lib/format';
// عميل API موحّد — كل النداءات تمر عبر Workers (لا مفاتيح في المتصفح).

/* ═══ الفرعان اللذان بدونهما تُعطَّل اللوحة صامتةً ═══

   الوسيط يفرّق بين تصفّحٍ ونداءٍ برمجي بطبيعة الطلب، فنداء `fetch` يأخذ
   ٤٠١ ومعه عنوان الباب، أو ٤٠٣ ومعه مسار الرفض — لا تحويلة يتبعها.

   وهذا يقع كثيراً لا نادراً: الرمز يعيش خمس عشرة دقيقة، ولوحةٌ مفتوحة
   أطول من ذلك تبلغ ٤٠١ في كل مرة. وبلا معالجتهما يقرأ المستخدم خطأ شبكة
   مبهماً عند انتهاء الرمز، و**شاشة خاوية بلا سبب** عند سحب وصوله. */

function withCurrentNext(login: string): string {
  // الوسيط يبني `next` من مسار الطلب، وهو مسار برمجي تحت `/api`. والمتصفّح
  // وحده يعرف موضعه الحقيقي، فبدونه تعود بعد الدخول إلى ردّ JSON خام.
  // ومسار الرفض يُستثنى وإلا دارت الحلقة: يدخل، فيُردّ إلى /denied، فيدخل.
  try {
    const url = new URL(login, window.location.origin);
    if (window.location.pathname === '/denied') url.searchParams.delete('next');
    else url.searchParams.set('next', window.location.pathname + window.location.search);
    return url.toString();
  } catch {
    return login;
  }
}

function handleUnauthorized(res: Response, data: any): boolean {
  if (res.status !== 401) return false;
  if (data && data.login) {
    window.location.href = withCurrentNext(data.login);
    return true;
  }
  return false;
}

function handleDenied(res: Response, data: any): boolean {
  if (res.status === 403 && data && data.denied) {
    window.location.href = data.denied;
    return true;
  }
  return false;
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: options.body && !(options.body instanceof FormData)
      ? { 'content-type': 'application/json', ...(options.headers || {}) }
      : options.headers,
    ...options,
  });
  const text = await res.text();
  // الردّ قد لا يكون JSON — صفحةُ خطأ من الحافة مثلاً. وسقوطُ التحليل هنا
  // يُقرأ خطأً في البيانات وهو خطأ في الطبقة التي تحتها.
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (handleUnauthorized(res, data) || handleDenied(res, data)) {
    // التحويل جارٍ — لا تُكمل ولا تُظهر خطأً. وعدٌ لا يُحلّ أبداً يوقف
    // سلسلة النداء حيث هي، فلا تومض رسالة خطأ قبل أن تغادر الصفحة.
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
