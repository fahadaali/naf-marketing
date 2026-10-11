// بناء HTML لإدراج وسيط داخل المحتوى كبطاقة مدمجة متمركزة، والضغط عليها يفتح نافذة الاستعراض.
// يُخزَّن ضمن جسم المنشور فيظهر بنفس الشكل في المحرر والعرض النهائي.

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'file';
export type MediaInfo = { id: string; url: string; name: string; mime: string; kind: MediaKind };

function esc(s: string) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function mediaKind(mime: string, filename = ''): MediaKind {
  const m = (mime || '').toLowerCase();
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'file';
}

const KIND_LABEL: Record<MediaKind, string> = { image: 'صورة', video: 'فيديو', audio: 'صوت', pdf: 'مستند \u2068PDF\u2069', file: 'ملف' };

function badge(kind: MediaKind, name: string): string {
  const ext = (name.split('.').pop() || '').toUpperCase();
  if (ext && ext.length <= 4 && kind === 'file') return ext;
  return { image: 'IMG', video: 'VID', audio: 'AUD', pdf: 'PDF', file: ext || 'FILE' }[kind];
}

export function mediaEmbedHtml(m: { id: string; url?: string; filename?: string; mime_type?: string }): string {
  const url = m.url || `/api/media/${m.id}`;
  const name = m.filename || 'ملف';
  const kind = mediaKind(m.mime_type || '', name);
  const data =
    `data-media-id="${esc(m.id)}" data-media-url="${esc(url)}" data-media-name="${esc(name)}" ` +
    `data-media-mime="${esc(m.mime_type || '')}" data-media-kind="${kind}"`;

  if (kind === 'image') {
    return `<div class="media-embed media-img" contenteditable="false" ${data}><img class="media-thumb" src="${url}" alt="${esc(name)}" loading="lazy"/><div class="media-cap">${esc(name)}</div></div>`;
  }
  /* المقطع مشغّلٌ بعرض المحتوى، لا بطاقة ملفٍ صغيرة — يُشاهَد في مكانه.
     والاسم تحته في `.media-cap` كما في الصورة: به يحذفه `htmlToText` من نصّ
     المنشور، وبالسمات `data-media-*` يقرؤه الخادم وبيسكامب كما كانا. */
  if (kind === 'video') {
    return `<div class="media-embed media-video" contenteditable="false" ${data}><video class="media-player" src="${url}" controls preload="metadata" playsinline></video><div class="media-cap">${esc(name)}</div></div>`;
  }
  return (
    `<div class="media-embed media-card k-${kind}" contenteditable="false" ${data}>` +
    `<span class="media-ic">${esc(badge(kind, name))}</span>` +
    `<span class="media-meta"><span class="media-cap">${esc(name)}</span><span class="media-sub">${KIND_LABEL[kind]} • اضغط للاستعراض</span></span>` +
    `</div>`
  );
}

// قراءة معلومات الوسيط من عنصر تم النقر عليه (أو أحد أجداده)
export function mediaFromEl(target: EventTarget | null): MediaInfo | null {
  // الضغط على المشغّل تشغيلٌ في مكانه، لا فتحٌ لنافذة الاستعراض
  if (target instanceof Element && target.closest('video')) return null;
  const el = target instanceof Element ? target.closest('.media-embed') : null;
  if (!el) return null;
  const d = (el as HTMLElement).dataset;
  if (!d.mediaId) return null;
  return {
    id: d.mediaId,
    url: d.mediaUrl || `/api/media/${d.mediaId}`,
    name: d.mediaName || 'ملف',
    mime: d.mediaMime || '',
    kind: (d.mediaKind as MediaKind) || 'file',
  };
}

/* بطاقات المقاطع القديمة (`media-card k-video`) تصير مشغّلاً حين يُفتح
   المحتوى في المحرر، ويُحفظ الشكل الجديد مع أوّل حفظ. وما سواها لا يُمسّ. */
export function upgradeVideoEmbeds(html: string): string {
  if (!html || !/\bk-video\b/.test(html) || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const cards = doc.querySelectorAll<HTMLElement>('.media-embed.media-card.k-video');
  if (!cards.length) return html;
  cards.forEach((el) => {
    const d = el.dataset;
    if (!d.mediaId) return;
    el.outerHTML = mediaEmbedHtml({ id: d.mediaId, url: d.mediaUrl, filename: d.mediaName, mime_type: d.mediaMime || 'video/mp4' });
  });
  return doc.body.innerHTML;
}
