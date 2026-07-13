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

const KIND_LABEL: Record<MediaKind, string> = { image: 'صورة', video: 'فيديو', audio: 'صوت', pdf: 'مستند PDF', file: 'ملف' };

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
  return (
    `<div class="media-embed media-card k-${kind}" contenteditable="false" ${data}>` +
    `<span class="media-ic">${esc(badge(kind, name))}</span>` +
    `<span class="media-meta"><span class="media-cap">${esc(name)}</span><span class="media-sub">${KIND_LABEL[kind]} • اضغط للاستعراض</span></span>` +
    `</div>`
  );
}

// قراءة معلومات الوسيط من عنصر تم النقر عليه (أو أحد أجداده)
export function mediaFromEl(target: EventTarget | null): MediaInfo | null {
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
