/* ============================================================
   رمز وصول من حساب خدمة جوجل — مشترَك بين ثلاثة مصادر.

   تحليلات الموقع وأدوات مشرفي المواقع والملف التجاري كلها خلف `OAuth 2.0`
   نفسه، والحساب الخدمي يوقّع `JWT` بمفتاحه الخاص ويبادله برمز وصول. ولا
   متصفّح في الطريق ولا موافقة مستخدم — وهذا هو المطلوب لسحبٍ يجري في `Cron`.

   والتوقيع `RS256` عبر `WebCrypto` وحده: `Workers` لا تحمل `node:crypto`
   بواجهته الكاملة، واستيراد مكتبة توقيع لهذا الغرض يضيف اعتمادية كاملة
   مقابل ثلاثين سطراً.
   ============================================================ */

export type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export class GoogleAuthError extends Error {}

/** يقرأ ملفّ الحساب الخدمي من السرّ — ويقول ما ينقصه بالضبط. */
export function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw || !raw.trim()) {
    throw new GoogleAuthError('حساب خدمة جوجل غير مضبوط (GOOGLE_SERVICE_ACCOUNT_JSON).');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GoogleAuthError('محتوى GOOGLE_SERVICE_ACCOUNT_JSON ليس JSON صالحاً. الصق ملفّ المفتاح كما نزّلته.');
  }
  const sa = parsed as Partial<ServiceAccount>;
  if (!sa?.client_email || !sa?.private_key) {
    throw new GoogleAuthError('ملفّ حساب الخدمة ينقصه client_email أو private_key.');
  }
  return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeSegment(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/** يحوّل مفتاح `PEM` إلى مفتاح توقيع. الفراغات والأسطر تُزال قبل فكّ الترميز. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  let der: Uint8Array;
  try {
    const binary = atob(body);
    der = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  } catch {
    throw new GoogleAuthError('المفتاح الخاص في ملفّ حساب الخدمة غير قابل للقراءة.');
  }
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * رمز وصولٍ لنطاقٍ واحد أو أكثر.
 *
 * ولا يُخزَّن الرمز: عمره ساعة، وسحبُ المؤشرات يجري مرّةً في اليوم فأقلّ.
 * وتخزينُه في `KV` يضيف مفتاحاً يجب إبطاله عند تبديل المفتاح الخاص، ومن
 * ينسى إبطاله يقرأ من حسابٍ عُزل.
 */
export async function getAccessToken(sa: ServiceAccount, scopes: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';

  const claims = {
    iss: sa.client_email,
    scope: scopes.join(' '),
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${encodeSegment({ alg: 'RS256', typ: 'JWT' })}.${encodeSegment(claims)}`;
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64Url(new Uint8Array(signature))}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const body = (await res.json().catch(() => null)) as { access_token?: string; error_description?: string; error?: string } | null;
  if (!res.ok || !body?.access_token) {
    const reason = body?.error_description || body?.error || `الحالة ${res.status}`;
    throw new GoogleAuthError(`رفضت جوجل حساب الخدمة: ${reason}`);
  }
  return body.access_token;
}

/** نداء JSON موقّع — يرفع خطأً يحمل رسالة جوجل كما وردت. */
export async function googleJson(
  token: string,
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const err = body?.error as { message?: string } | undefined;
    throw new GoogleAuthError(err?.message || `ردّت جوجل بالحالة ${res.status}`);
  }
  return body;
}
