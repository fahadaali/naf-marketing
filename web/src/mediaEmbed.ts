// بناء HTML لإدراج وسيط داخل المحتوى مع استعراض مباشر ورابط تنزيل.
// يُخزَّن ضمن جسم المنشور فيظهر بنفس الشكل في المحرر والعرض النهائي.

function esc(s: string) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function mediaKind(mime: string, filename = ''): 'image' | 'video' | 'audio' | 'pdf' | 'file' {
  const m = (mime || '').toLowerCase();
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'file';
}

function extBadge(filename: string, mime: string): string {
  const ext = (filename.split('.').pop() || '').toUpperCase();
  if (ext) return ext.slice(0, 4);
  if (mime.includes('word')) return 'DOC';
  if (mime.includes('sheet') || mime.includes('excel')) return 'XLS';
  return 'ملف';
}

export function mediaEmbedHtml(m: { id: string; url: string; filename?: string; mime_type?: string }): string {
  const url = m.url || `/api/media/${m.id}`;
  const dl = `${url}?download=1`;
  const name = m.filename || 'ملف';
  const kind = mediaKind(m.mime_type || '', name);
  const bar = `<div class="media-bar"><span class="media-name">${esc(name)}</span><a href="${dl}" download class="media-dl">تنزيل</a></div>`;

  switch (kind) {
    case 'image':
      return `<div class="media-embed" contenteditable="false" data-media="${m.id}"><img src="${url}" alt="${esc(name)}" loading="lazy"/>${bar}</div>`;
    case 'video':
      return `<div class="media-embed" contenteditable="false" data-media="${m.id}"><video src="${url}" controls preload="metadata"></video>${bar}</div>`;
    case 'audio':
      return `<div class="media-embed media-audio" contenteditable="false" data-media="${m.id}"><audio src="${url}" controls preload="metadata"></audio>${bar}</div>`;
    case 'pdf':
      return `<div class="media-embed" contenteditable="false" data-media="${m.id}"><iframe class="media-pdf" src="${url}" title="${esc(name)}"></iframe>${bar}</div>`;
    default:
      return `<div class="media-embed media-file" contenteditable="false" data-media="${m.id}"><span class="media-ext">${esc(extBadge(name, m.mime_type || ''))}</span><span class="media-name">${esc(name)}</span><a href="${dl}" download class="media-dl">تنزيل</a></div>`;
  }
}
