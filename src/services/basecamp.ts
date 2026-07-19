import type { Env } from '../types';

// عميل بيسكامب (Basecamp 3/4): مصادقة OAuth عبر refresh token (أسرار Cloudflare)،
// وأدوات قراءة (مركز المعرفة) وكتابة (مزامنة مشروع إدارة التسويق + رفع التقارير).

const TOKEN_URL = 'https://launchpad.37signals.com/authorization/token';
const AUTH_URL = 'https://launchpad.37signals.com/authorization/new';
const IDENTITY_URL = 'https://launchpad.37signals.com/authorization.json';
const UA = 'NAF Marketing Platform (naflaw.sa)';

let tokenCache: { token: string; exp: number } = { token: '', exp: 0 };

export async function setting(env: Env, key: string): Promise<string | null> {
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
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`فشل مصادقة بيسكامب: ${data?.error || res.status}`);
  tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in ? data.expires_in * 1000 : 20 * 60 * 1000) };
  return tokenCache.token;
}

async function apiBase(env: Env): Promise<string> {
  const acct = await setting(env, 'basecamp_account_id');
  if (!acct) throw new Error('لم يُضبط معرّف حساب بيسكامب في الإعدادات');
  return `https://3.basecampapi.com/${acct}`;
}

// نداء بمسار نسبي على الحساب
async function bcFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const base = await apiBase(env);
  return bcFetchAbs(env, `${base}${path}`, init);
}
// نداء بمسار مطلق (بيسكامب يعيد روابط مطلقة)
async function bcFetchAbs(env: Env, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(env);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('user-agent', UA);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(url, { ...init, headers });
}
async function bcJson<T = any>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await bcFetch(env, path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`Basecamp ${init.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// ======================= قراءة (مركز المعرفة) =======================
export type KbFile = { id: number; type: 'Document' | 'Upload'; title: string; updated_at: string; url: string };

export async function listFiles(env: Env): Promise<KbFile[]> {
  const project = await setting(env, 'basecamp_project_id');
  if (!project) throw new Error('لم يُضبط معرّف مشروع «مركز المعرفة» في الإعدادات');
  const out: KbFile[] = [];
  for (const type of ['Document', 'Upload'] as const) {
    try {
      const items = await bcJson<any[]>(env, `/projects/recordings.json?type=${type}&bucket=${project}`);
      for (const it of items || []) {
        out.push({ id: it.id, type, title: it.title || it.filename || `#${it.id}`, updated_at: it.updated_at || it.created_at || '', url: it.url });
      }
    } catch { /* تجاوز */ }
  }
  out.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return out;
}

function stripHtml(html: string): string {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

export async function getFileText(env: Env, type: string, id: number): Promise<{ title: string; text: string }> {
  const project = await setting(env, 'basecamp_project_id');
  const base = await apiBase(env);
  if (type === 'Document') {
    const res = await bcFetchAbs(env, `${base}/buckets/${project}/documents/${id}.json`);
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`تعذّر جلب المستند (${res.status})`);
    return { title: data.title || '', text: stripHtml(data.content || '').slice(0, 12000) };
  }
  const res = await bcFetchAbs(env, `${base}/buckets/${project}/uploads/${id}.json`);
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`تعذّر جلب المرفق (${res.status})`);
  const title = data.title || data.filename || '';
  const ctype = String(data.content_type || '');
  const desc = stripHtml(data.description || '');
  if (data.download_url && /text\/|json|csv|markdown/i.test(ctype)) {
    const f = await bcFetchAbs(env, data.download_url);
    if (f.ok) return { title, text: (desc ? desc + '\n\n' : '') + (await f.text()).slice(0, 12000) };
  }
  return { title, text: desc || `ملف بعنوان «${title}» (${ctype}).` };
}

// ======================= OAuth =======================
export function authorizeUrl(env: Env, redirectUri: string): string {
  const q = new URLSearchParams({ type: 'web_server', client_id: env.BASECAMP_CLIENT_ID || '', redirect_uri: redirectUri });
  return `${AUTH_URL}?${q}`;
}
export async function exchangeCode(env: Env, code: string, redirectUri: string): Promise<any> {
  const body = new URLSearchParams({
    type: 'web_server', client_id: env.BASECAMP_CLIENT_ID || '', client_secret: env.BASECAMP_CLIENT_SECRET || '',
    redirect_uri: redirectUri, code,
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`فشل تبادل الرمز: ${data?.error || res.status}`);
  let accounts: any[] = [];
  try {
    const idRes = await fetch(IDENTITY_URL, { headers: { authorization: `Bearer ${data.access_token}`, 'user-agent': UA } });
    if (idRes.ok) accounts = ((await idRes.json()) as any).accounts || [];
  } catch { /* */ }
  return { ...data, accounts };
}

// ======================= كتابة (إدارة التسويق) =======================
export async function getMgmtProjectId(env: Env): Promise<string | null> {
  return setting(env, 'basecamp_mgmt_project_id');
}

// أداة من dock المشروع حسب الاسم (todoset / vault ...)
async function getDockTool(env: Env, projectId: string, name: string): Promise<any | null> {
  const proj = await bcJson<any>(env, `/projects/${projectId}.json`);
  return (proj.dock || []).find((d: any) => d.name === name) || null;
}

export async function getProjectPeopleIds(env: Env, projectId: string): Promise<number[]> {
  try {
    const people = await bcJson<any[]>(env, `/projects/${projectId}/people.json`);
    return (people || []).map((p) => p.id).filter(Boolean);
  } catch {
    return [];
  }
}

// ==== جدول البطاقات (Card Table) وأعمدته (المراحل) ====
export async function getCardTableId(env: Env, projectId: string): Promise<string> {
  const tool = await getDockTool(env, projectId, 'kanban_board');
  if (!tool?.id) throw new Error('لا يوجد جدول بطاقات (Card Table) في المشروع — فعّله من أدوات المشروع');
  return String(tool.id);
}

// أعمدة جدول البطاقات (المراحل)
export async function getColumns(env: Env, projectId: string, cardTableId: string): Promise<{ id: string; title: string }[]> {
  const ct = await bcJson<any>(env, `/buckets/${projectId}/card_tables/${cardTableId}.json`);
  return (ct.lists || []).map((l: any) => ({ id: String(l.id), title: l.title || '' }));
}
export async function createColumn(env: Env, projectId: string, cardTableId: string, title: string): Promise<string> {
  const col = await bcJson<any>(env, `/buckets/${projectId}/card_tables/${cardTableId}/columns.json`, {
    method: 'POST', body: JSON.stringify({ title }),
  });
  return String(col.id);
}

// ==== البطاقات ====
export type CardInput = { title: string; content?: string; due_on?: string | null; assignee_ids?: number[] };

export async function createCard(env: Env, projectId: string, columnId: string, input: CardInput): Promise<string> {
  const card = await bcJson<any>(env, `/buckets/${projectId}/card_tables/lists/${columnId}/cards.json`, {
    method: 'POST', body: JSON.stringify({ ...input, notify: false }),
  });
  return String(card.id);
}
export async function updateCard(env: Env, projectId: string, cardId: string, input: CardInput): Promise<void> {
  await bcJson(env, `/buckets/${projectId}/card_tables/cards/${cardId}.json`, { method: 'PUT', body: JSON.stringify(input) });
}
// نقل البطاقة إلى عمود آخر (مدعوم في واجهة Card Table)
export async function moveCard(env: Env, projectId: string, cardId: string, columnId: string): Promise<void> {
  const res = await bcFetch(env, `/buckets/${projectId}/card_tables/cards/${cardId}/moves.json`, {
    method: 'POST', body: JSON.stringify({ column_id: columnId }),
  });
  if (!res.ok) throw new Error(`تعذّر نقل البطاقة (${res.status})`);
}
export async function trashRecording(env: Env, projectId: string, recordingId: string): Promise<void> {
  await bcFetch(env, `/buckets/${projectId}/recordings/${recordingId}/status/trashed.json`, { method: 'PUT' });
}

// تعليقات على بطاقة/تسجيل (تُستخدم لربط عكسي: تعليقات بيسكامب → ملاحظات في تدفّق الاعتماد)
export type BcComment = { id: number; content: string; created_at: string; creator_name: string };
export async function getComments(env: Env, projectId: string, recordingId: string): Promise<BcComment[]> {
  const items = await bcJson<any[]>(env, `/buckets/${projectId}/recordings/${recordingId}/comments.json`);
  return (items || []).map((it) => ({
    id: it.id,
    content: stripHtml(it.content || ''),
    created_at: it.created_at || '',
    creator_name: it.creator?.name || 'بيسكامب',
  }));
}

// ==== المرفقات (attachments) ====
export async function createAttachment(env: Env, name: string, contentType: string, bytes: BufferSource): Promise<string> {
  const base = await apiBase(env);
  const res = await bcFetchAbs(env, `${base}/attachments.json?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': contentType || 'application/octet-stream' },
    body: bytes,
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`فشل رفع المرفق: ${res.status}`);
  return data.attachable_sgid;
}

// ==== ملفات المشروع (vault) ====
export async function getRootVaultId(env: Env, projectId: string): Promise<string> {
  const tool = await getDockTool(env, projectId, 'vault');
  if (!tool?.id) throw new Error('لا يوجد قسم ملفات (vault) في المشروع');
  return String(tool.id);
}
export async function ensureSubVault(env: Env, projectId: string, parentVaultId: string, title: string): Promise<string> {
  const subs = await bcJson<any[]>(env, `/buckets/${projectId}/vaults/${parentVaultId}/vaults.json`).catch(() => []);
  const found = (subs || []).find((v) => (v.title || '').trim() === title.trim());
  if (found) return String(found.id);
  const created = await bcJson<any>(env, `/buckets/${projectId}/vaults/${parentVaultId}/vaults.json`, {
    method: 'POST', body: JSON.stringify({ title }),
  });
  return String(created.id);
}
export async function createUpload(env: Env, projectId: string, vaultId: string, sgid: string, description = ''): Promise<void> {
  await bcJson(env, `/buckets/${projectId}/vaults/${vaultId}/uploads.json`, {
    method: 'POST',
    body: JSON.stringify({ attachable_sgid: sgid, description }),
  });
}
