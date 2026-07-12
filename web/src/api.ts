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
  pending_marketing: 'بانتظار مراجعة التسويق',
  pending_gm: 'بانتظار اعتماد المدير العام',
  approved: 'معتمد',
  scheduled: 'مجدول',
  published: 'منشور',
  archived: 'مؤرشف',
  rejected: 'مرفوض',
};

export const STATUS_BADGE: Record<string, string> = {
  draft: 'gray',
  pending_marketing: 'amber',
  pending_gm: 'purple',
  approved: 'blue',
  scheduled: 'blue',
  published: 'green',
  archived: 'gray',
  rejected: 'red',
};

export const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'لينكدإن',
  x: 'إكس',
  instagram: 'إنستغرام',
  snapchat: 'سناب شات',
  tiktok: 'تيك توك',
};

export const ROLE_LABELS: Record<string, string> = {
  writer: 'كاتب محتوى',
  marketing_manager: 'مدير تسويق',
  general_manager: 'مدير عام',
};

// تنسيق الوقت بتوقيت الرياض
export function formatRiyadh(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
      timeZone: 'Asia/Riyadh',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
