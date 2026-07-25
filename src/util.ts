// أدوات مساعدة عامة

export function newId(prefix = ''): string {
  const id = crypto.randomUUID().replace(/-/g, '');
  return prefix ? `${prefix}_${id}` : id;
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// تجزئة كلمة المرور عبر PBKDF2 (WebCrypto — متوافق مع Workers)
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt);
  return `pbkdf2$${toHex(salt)}$${toHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const salt = fromHex(parts[1]);
  const bits = await deriveBits(password, salt);
  return timingSafeEqual(toHex(new Uint8Array(bits)), parts[2]);
}

async function deriveBits(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

// ===== تحويل محتوى المحرر (HTML) إلى نص صالح للنشر على المنصات =====
// المحرر غنيّ ويُخزّن HTML؛ نشره كما هو يُظهر الوسوم حرفياً في المنشور.
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

export function htmlToText(html: string): string {
  if (!html) return '';
  // لا وسوم أصلاً — نصّ عادي كما هو
  if (!/<[a-z!/]/i.test(html)) return html.trim();
  let s = html;
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ''); // محتوى غير مرئي
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|figure|figcaption|blockquote|tr)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, ''); // بقية الوسوم
  for (const [ent, ch] of Object.entries(HTML_ENTITIES)) s = s.split(ent).join(ch);
  s = s.replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)));
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'); // تنظيف الفراغات
  return s.trim();
}

// يستخرج معرّفات الوسائط المضمّنة في محتوى المحرر (روابط /api/media/<id>)
export function extractMediaIds(html: string): string[] {
  const out: string[] = [];
  const re = /\/api\/media\/([A-Za-z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || '')) !== null) {
    const id = m[1];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
