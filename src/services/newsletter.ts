import type { Env } from '../types';

// ===== تصيير كتل النشرة =====
// مصدر واحد (blocks) يُصيَّر لوجهتين:
//   • بريد: أنماط مضمّنة سطرياً لأن عملاء البريد يتجاهلون <style> الخارجي.
//   • ويب: HTML نظيف يعتمد ورقة أنماط الصفحة.

export type Block =
  | { type: 'heading'; text: string; level?: 2 | 3 }
  | { type: 'text'; text: string }
  | { type: 'image'; mediaId?: string; url?: string; alt?: string; caption?: string }
  | { type: 'button'; text: string; url: string }
  | { type: 'quote'; text: string; cite?: string }
  | { type: 'divider' };

export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// يحوّل أسطر النص إلى فقرات مع دعم الروابط النصية
function paragraphs(text: string, inline: boolean): string {
  const style = inline ? ' style="margin:0 0 14px;line-height:1.9;font-size:16px;color:#1f2430"' : '';
  return String(text || '')
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p${style}>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function parseBlocks(json: string | null): Block[] {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// mediaBase: أصل مطلق لروابط الوسائط (البريد لا يعرض الروابط النسبية)
export function renderBlocks(blocks: Block[], mode: 'email' | 'web', mediaBase = ''): string {
  const out: string[] = [];
  const inline = mode === 'email';
  const mediaUrl = (b: any) => (b.url ? b.url : b.mediaId ? `${mediaBase}/api/media/${b.mediaId}` : '');

  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const lvl = b.level === 3 ? 3 : 2;
        const st = inline
          ? ` style="margin:26px 0 12px;font-size:${lvl === 2 ? 22 : 18}px;font-weight:700;color:#111"`
          : '';
        out.push(`<h${lvl}${st}>${escapeHtml(b.text)}</h${lvl}>`);
        break;
      }
      case 'text':
        out.push(paragraphs(b.text, inline));
        break;
      case 'image': {
        const src = mediaUrl(b);
        if (!src) break;
        const st = inline ? ' style="max-width:100%;height:auto;border-radius:8px;display:block;margin:0 auto"' : '';
        out.push(`<figure${inline ? ' style="margin:18px 0"' : ''}>` +
          `<img src="${escapeHtml(src)}" alt="${escapeHtml(b.alt || '')}"${st}>` +
          (b.caption ? `<figcaption${inline ? ' style="font-size:13px;color:#6b7280;text-align:center;margin-top:6px"' : ''}>${escapeHtml(b.caption)}</figcaption>` : '') +
          `</figure>`);
        break;
      }
      case 'button': {
        if (!b.url) break;
        const st = inline
          ? ' style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600"'
          : ' class="btn"';
        out.push(`<p${inline ? ' style="text-align:center;margin:22px 0"' : ' style="text-align:center"'}>` +
          `<a href="${escapeHtml(b.url)}"${st}>${escapeHtml(b.text || 'اقرأ المزيد')}</a></p>`);
        break;
      }
      case 'quote': {
        const st = inline
          // border-right لا border-inline-start: عملاء البريد المكتبية لا تدعم
          // الخصائص المنطقية. جهة RTL مكتوبة مباشرةً — استثناء CLAUDE.md §1.
          ? ' style="margin:18px 0;padding:12px 16px;border-right:3px solid #4f46e5;background:#f5f5ff;color:#374151"'
          : '';
        out.push(`<blockquote${st}>${escapeHtml(b.text)}${b.cite ? `<cite> — ${escapeHtml(b.cite)}</cite>` : ''}</blockquote>`);
        break;
      }
      case 'divider':
        out.push(inline ? '<hr style="border:none;border-top:1px solid #e5e7eb;margin:26px 0">' : '<hr>');
        break;
    }
  }
  return out.join('\n');
}

// نص عادي مختصر من الكتل (للمقتطف ولمنشورات التواصل)
export function blocksToText(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'heading' || b.type === 'text' || b.type === 'quote') parts.push((b as any).text || '');
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ===== الإعدادات العامة للنشر =====
export async function publicSettings(env: Env, requestUrl: string): Promise<{ base: string; path: string }> {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('public_site_url','public_article_path')",
  ).all<{ key: string; value: string }>();
  const map: Record<string, string> = {};
  for (const r of rows.results) map[r.key] = r.value || '';
  // إن لم يُضبط نطاق عام نستخدم أصل الطلب الحالي — فتعمل الروابط فوراً بلا إعداد
  const base = (map.public_site_url || new URL(requestUrl).origin).replace(/\/$/, '');
  const path = (map.public_article_path || '/articles').replace(/\/$/, '');
  return { base, path };
}

export function articleUrl(base: string, path: string, slug: string): string {
  return `${base}${path}/${slug}`;
}

// يولّد slug عربي/لاتيني صالحاً للرابط
export function slugify(title: string): string {
  const s = String(title || '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return s || `article-${Date.now().toString(36)}`;
}

// ===== تحويل المقالة إلى منشورات تواصل =====
// نفس المصدر يُصاغ لكل منصة بحدودها، مع رابط المقالة دائماً (يقود القارئ للموقع).

const X_LIMIT = 275; // نترك هامشاً لحدّ ٢٨٠

// يقسّم نصاً طويلاً إلى تغريدات متتابعة دون قطع الكلمات
export function splitThread(text: string, limit = X_LIMIT): string[] {
  const parts: string[] = [];
  for (const para of String(text || '').split(/\n{2,}/)) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ((cur + ' ' + word).trim().length > limit) {
        if (cur.trim()) parts.push(cur.trim());
        cur = word;
      } else {
        cur = (cur + ' ' + word).trim();
      }
    }
    if (cur.trim()) parts.push(cur.trim());
  }
  return parts.filter(Boolean);
}

// سلسلة إكس: العنوان أولاً، ثم المحتوى مقسّماً، والرابط في آخر تغريدة
export function toXThread(title: string, blocks: Block[], url: string, maxParts = 6): string[] {
  const body = blocksToText(blocks);
  const chunks = splitThread(body).slice(0, Math.max(1, maxParts - 1));
  const head = splitThread(title, X_LIMIT)[0] || title.slice(0, X_LIMIT);
  const thread = [head, ...chunks];
  // نُلحق الرابط بآخر جزء إن اتسع، وإلا نضيفه جزءاً مستقلاً
  const last = thread[thread.length - 1];
  if ((last + '\n\n' + url).length <= X_LIMIT + 5) thread[thread.length - 1] = `${last}\n\n${url}`;
  else thread.push(url);
  return thread.map((t, i) => (thread.length > 1 ? `${i + 1}/${thread.length} ${t}` : t));
}

// لينكدإن: مقتطف مهني متوسط الطول مع دعوة لقراءة المقالة
export function toLinkedInPost(title: string, blocks: Block[], url: string, excerpt?: string | null): string {
  const body = (excerpt || blocksToText(blocks)).trim();
  const trimmed = body.length > 900 ? `${body.slice(0, 900).replace(/\s+\S*$/, '')}…` : body;
  return `${title}\n\n${trimmed}\n\nاقرأ المقالة كاملة:\n${url}`;
}
