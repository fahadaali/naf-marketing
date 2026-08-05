import puppeteer from '@cloudflare/puppeteer';
import type { Env } from '../types';
import { parseBlocks, renderBlocks } from './newsletter';
import type { Block } from './newsletter';
import { printDocument } from './printDoc';

/* ===== توليد PDF من المقالة =====

   يُصيَّر في متصفّح Cloudflare (Browser Rendering) لا في مكتبة PDF:
   العربية تحتاج تشكيلاً وربطَ حروفٍ وكسرَ أسطرٍ ثنائيَّ الاتجاه، وأي
   مكتبة خفيفة تُخرجها حروفاً منفصلة مقلوبة. المتصفّح يملك المحرّك.

   والمستند يُبنى **مكتفياً بنفسه** — لا طلب شبكة واحد أثناء التصيير:

     • الصور تُقرأ من R2 وتُحقن data: URI. ولا خيار غيره: مسار
       /api/media محميّ بالمصادقة، ومتصفّحٌ بلا جلسة يبلغه ٤٠١ فيخرج
       المستند بمربّعات فارغة بدل الصور — وهو فشلٌ صامت لا يُرى إلا
       بعد الإرسال.

     • الخط يُقرأ من ربط ASSETS ويُحقن @font-face. الكروم بلا واجهة
       غالباً بلا خط عربي، فيرسم مربّعات tofu. وهو خطّ ناف نفسه لا خطّ
       ثانٍ — §5 محفوظة.

   وحين لا يوجد ربط BROWSER (خطة غير مدفوعة أو تطوير محلّي) ترفع
   الدالة خطأً صريحاً ولا تُخرج ملفاً فارغاً. */

const FONT_PATH = '/fonts/files/ibm-plex-sans-arabic-arabic-400-normal.woff2';
const FONT_PATH_BOLD = '/fonts/files/ibm-plex-sans-arabic-arabic-700-normal.woff2';

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  // على دفعات: String.fromCharCode(...bytes) يتجاوز حدّ المكدّس عند الملفات الكبيرة
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/** يقرأ ملف خطّ من ربط ASSETS ويعيده data: URI، أو '' إن تعذّر. */
async function fontDataUri(env: Env, path: string): Promise<string> {
  try {
    const res = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
    if (!res.ok) return '';
    return `data:font/woff2;base64,${toBase64(await res.arrayBuffer())}`;
  } catch {
    return '';
  }
}

/** يستبدل كل مرجع وسيط في HTML بصورة مضمّنة من R2. */
export async function inlineMedia(env: Env, html: string): Promise<string> {
  const ids = new Set<string>();
  for (const m of html.matchAll(/\/api\/media\/([A-Za-z0-9_-]+)/g)) ids.add(m[1]);
  if (!ids.size) return html;

  const map = new Map<string, string>();
  await Promise.all([...ids].map(async (id) => {
    try {
      const row = await env.DB.prepare('SELECT r2_key, mime_type FROM media_assets WHERE id = ?')
        .bind(id).first<{ r2_key: string; mime_type: string | null }>();
      if (!row) return;
      const obj = await env.MEDIA.get(row.r2_key);
      if (!obj) return;
      const mime = row.mime_type || 'application/octet-stream';
      // الصور وحدها تُضمَّن. الصوت والفيديو لا يُطبعان أصلاً، وتضمينهما
      // ينفخ المستند بعشرات الميغابايتات بلا فائدة.
      if (!mime.startsWith('image/')) return;
      map.set(id, `data:${mime};base64,${toBase64(await obj.arrayBuffer())}`);
    } catch { /* وسيطٌ يتعذّر يُترك كما هو ولا يمنع بقية المستند */ }
  }));

  return html.replace(/(?:https?:\/\/[^"'\s]*)?\/api\/media\/([A-Za-z0-9_-]+)/g,
    (whole, id: string) => map.get(id) || whole);
}

/** يبني مستند الطباعة مكتفياً بنفسه: صور مضمّنة وخطّ مضمّن. */
export async function buildPrintHtml(env: Env, title: string, blocks: Block[]): Promise<string> {
  const [regular, bold] = await Promise.all([
    fontDataUri(env, FONT_PATH),
    fontDataUri(env, FONT_PATH_BOLD),
  ]);
  const body = await inlineMedia(env, renderBlocks(blocks, 'web'));

  /* الخطّ يُحقن قبل </head> بأنماطه. وإن تعذّر تحميله يبقى المستند
     على مكدّس printDoc الاحتياطي — أفضل من مستندٍ لا يُبنى. */
  const face = regular
    ? `<style>
@font-face{font-family:"NAF";src:url("${regular}") format("woff2");font-weight:400;font-style:normal;font-display:block}
${bold ? `@font-face{font-family:"NAF";src:url("${bold}") format("woff2");font-weight:700;font-style:normal;font-display:block}` : ''}
body,.doc{font-family:"NAF","Times New Roman",serif}
</style>`
    : '';

  return printDocument(title, body, { autoPrint: false }).replace('</head>', `${face}</head>`);
}

/**
 * يولّد PDF للمقالة. يرفع خطأً صريحاً إن لم يكن ربط المتصفح متاحاً —
 * ولا يعيد ملفاً فارغاً.
 */
export async function buildArticlePdf(env: Env, title: string, blocksJson: string): Promise<Uint8Array> {
  if (!env.BROWSER) {
    throw new Error('توليد PDF غير متاح على هذه الخطة. استخدم «نسخة للطباعة» واحفظها PDF من حوار الطباعة.');
  }
  const html = await buildPrintHtml(env, title, parseBlocks(blocksJson));

  const browser = await puppeteer.launch(env.BROWSER as any);
  try {
    const page = await browser.newPage();
    /* setContent لا goto: صفحة المقالة خلف المصادقة، ومتصفّحٌ بلا
       جلسة يبلغها ٤٠١. والمستند مكتفٍ بنفسه أصلاً فلا شيء يُنتظر
       من الشبكة. */
    await page.setContent(html, { waitUntil: 'load' });
    // يُنتظر تحميل الخطوط قبل اللقطة، وإلا صُوّرت الصفحة بخطّ احتياطي
    await page.evaluate('document.fonts && document.fonts.ready');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      // نفس هوامش @page في printDoc — القيمتان تصفان صفحة واحدة
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    });
    return pdf as unknown as Uint8Array;
  } finally {
    // الجلسة تُغلق دائماً: جلسةٌ معلّقة تستهلك حصّة الحساب حتى تنتهي مهلتها
    await browser.close();
  }
}
