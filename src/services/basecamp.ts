import type { Env } from '../types';

// تكامل بيسكامب (Basecamp 3/4) لمشروع «مركز المعرفة».
// المصادقة: OAuth 2.0 عبر refresh token (أسرار Cloudflare)، وتُحوَّل إلى access token عند الطلب.
// معرّف الحساب والمشروع يُخزَّنان كإعدادات غير سرية.

const TOKEN_URL = 'https://launchpad.37signals.com/authorization/token';
const AUTH_URL = 'https://launchpad.37signals.com/authorization/new';
const IDENTITY_URL = 'https://launchpad.37signals.com/authorization.json';
const UA = 'NAF Marketing Platform (naflaw.sa)';

// كاش بسيط للـ access token على مستوى العزلة (isolate)
let tokenCache: { token: string; exp: number } = { token: '', exp: 0 };

async function setting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function isConfigured(env: Env): Promise<boolean> {
  return !!(env.BASECAMP_CLIENT_ID && env.BASECAMP_CLIENT_SECRET && env.BASECAMP_REFRESH_TOKEN);
}

async function accessToken(env: Env): Promise<string> {
  if (tokenCache.token && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const body = new URLSearchParams({
    type: 'refresh',
    refresh_token: env.BASECAMP_REFRESH_TOKEN || '',
    client_id: env.BASECAMP_CLIENT_ID || '',
    client_secret: env.BASECAMP_CLIENT_SECRET || '',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`فشل مصادقة بيسكامب: ${data?.error || res.status}`);
  tokenCache = {
    token: data.access_token,
    exp: Date.now() + (data.expires_in ? data.expires_in * 1000 : 20 * 60 * 1000),
  };
  return tokenCache.token;
}

// نداء API بمسار مطلق (Basecamp يعيد روابط مطلقة)
async function bcAbs(env: Env, url: string): Promise<Response> {
  const token = await accessToken(env);
  return fetch(url, { headers: { authorization: `Bearer ${token}`, 'user-agent': UA } });
}

async function apiBase(env: Env): Promise<string> {
  const acct = await setting(env, 'basecamp_account_id');
  if (!acct) throw new Error('لم يُضبط معرّف حساب بيسكامب في الإعدادات');
  return `https://3.basecampapi.com/${acct}`;
}

export type KbFile = { id: number; type: 'Document' | 'Upload'; title: string; updated_at: string; url: string };

// قائمة ملفات المشروع (مستندات + مرفوعات)
export async function listFiles(env: Env): Promise<KbFile[]> {
  const project = await setting(env, 'basecamp_project_id');
  if (!project) throw new Error('لم يُضبط معرّف مشروع «مركز المعرفة» في الإعدادات');
  const base = await apiBase(env);

  const out: KbFile[] = [];
  for (const type of ['Document', 'Upload'] as const) {
    const res = await bcAbs(env, `${base}/projects/recordings.json?type=${type}&bucket=${project}`);
    if (!res.ok) continue;
    const items = (await res.json()) as any[];
    for (const it of items || []) {
      out.push({
        id: it.id,
        type,
        title: it.title || it.filename || `(بدون عنوان) #${it.id}`,
        updated_at: it.updated_at || it.created_at || '',
        url: it.url, // رابط API للمورد
      });
    }
  }
  out.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return out;
}

function stripHtml(html: string): string {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// جلب نص ملف: المستند يُقرأ محتواه (HTML)، والمرفوع النصي يُنزَّل.
export async function getFileText(env: Env, type: string, id: number): Promise<{ title: string; text: string }> {
  const project = await setting(env, 'basecamp_project_id');
  const base = await apiBase(env);

  if (type === 'Document') {
    const res = await bcAbs(env, `${base}/buckets/${project}/documents/${id}.json`);
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`تعذّر جلب المستند (${res.status})`);
    return { title: data.title || '', text: stripHtml(data.content || '').slice(0, 12000) };
  }

  // Upload
  const res = await bcAbs(env, `${base}/buckets/${project}/uploads/${id}.json`);
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`تعذّر جلب المرفق (${res.status})`);
  const title = data.title || data.filename || '';
  const ctype = String(data.content_type || '');
  const desc = stripHtml(data.description || '');

  // الملفات النصية فقط تُقرأ محتواها؛ غيرها (PDF/صور) يُكتفى بعنوانها ووصفها.
  if (data.download_url && /text\/|json|csv|markdown/i.test(ctype)) {
    const f = await bcAbs(env, data.download_url);
    if (f.ok) {
      const txt = await f.text();
      return { title, text: (desc ? desc + '\n\n' : '') + txt.slice(0, 12000) };
    }
  }
  return {
    title,
    text: desc || `ملف مرفوع بعنوان «${title}» (${ctype}). لا يمكن قراءة محتواه نصياً؛ استخدم العنوان كموضوع.`,
  };
}

// روابط مساعدة لمخطط OAuth (للحصول على refresh token لأول مرة)
export function authorizeUrl(env: Env, redirectUri: string): string {
  const q = new URLSearchParams({
    type: 'web_server',
    client_id: env.BASECAMP_CLIENT_ID || '',
    redirect_uri: redirectUri,
  });
  return `${AUTH_URL}?${q}`;
}

export async function exchangeCode(env: Env, code: string, redirectUri: string): Promise<any> {
  const body = new URLSearchParams({
    type: 'web_server',
    client_id: env.BASECAMP_CLIENT_ID || '',
    client_secret: env.BASECAMP_CLIENT_SECRET || '',
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`فشل تبادل الرمز: ${data?.error || res.status}`);
  // جلب قائمة الحسابات لعرض account id
  let accounts: any[] = [];
  try {
    const idRes = await fetch(IDENTITY_URL, {
      headers: { authorization: `Bearer ${data.access_token}`, 'user-agent': UA },
    });
    if (idRes.ok) accounts = ((await idRes.json()) as any).accounts || [];
  } catch {}
  return { ...data, accounts };
}
