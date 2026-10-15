import type { PublishInput, PublishMedia } from './provider';

/** جسم PUT بطولٍ معلوم — التخزين الموقَّع يرفض جسماً مقطّعاً بلا طول. */
export async function fixedLengthBody(m: PublishMedia, size: number): Promise<ArrayBuffer | ReadableStream<Uint8Array> | null> {
  if (m.data) return m.data;
  const source = m.open ? await m.open() : null;
  if (!source) return null;
  const Fixed = (globalThis as any).FixedLengthStream;
  if (!Fixed) return source;
  const { readable, writable } = new Fixed(size);
  source.pipeTo(writable).catch(() => { /* يسقط الطلب نفسه بخطئه */ });
  return readable as ReadableStream<Uint8Array>;
}

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1);
}

/** طول النص بطريقة عدّ المنصة — `null` لطريقةٍ لا نعرفها فلا يُحكم بها. */
function textLength(text: string, mode: unknown): number | null {
  const m = String(mode || 'chars');
  if (m === 'chars') return [...text].length;
  if (m === 'utf16') return text.length;
  if (m === 'bytes') return new TextEncoder().encode(text).length;
  return null;
}

/** ما سترفضه المنصة من هذا المحتوى بحدودها المعلنة — بنصٍّ عربيٍّ يقول ما العمل. */
export function constraintIssues(c: any, input: PublishInput): string[] {
  const issues: string[] = [];
  const media = input.media || [];
  const mc = c?.media || {};
  for (const m of media) {
    const kind = mediaKind(m.mimeType);
    if (kind !== 'image' && kind !== 'video') continue;
    const types: unknown = kind === 'image' ? mc.supported_image_types : mc.supported_video_types;
    const max: unknown = kind === 'image' ? mc.max_image_size_bytes : mc.max_video_size_bytes;
    const size = m.data ? m.data.byteLength : m.size ?? 0;
    const what = kind === 'image' ? 'الصورة' : 'المقطع';
    if (max === 0) {
      issues.push(`هذه المنصة لا تقبل ${kind === 'image' ? 'الصور' : 'المقاطع'}. احذف «${m.filename}» من نسخة المنصة أو لا تجدولها عليها`);
      continue;
    }
    if (Array.isArray(types) && types.length && !types.includes(m.mimeType)) {
      issues.push(`صيغة ${what} «${m.filename}» (${m.mimeType}) لا تقبلها هذه المنصة. المقبول: ${types.join('، ')}`);
    }
    if (typeof max === 'number' && max > 0 && size > max) {
      issues.push(`حجم ${what} «${m.filename}» (${mb(size)} ميغابايت) أكبر من حدّ هذه المنصة (${mb(max)} ميغابايت). صغّره ثم ضعه مكان القديم`);
    }
  }
  const car = c?.carousel;
  if (media.length > 1 && car && typeof car === 'object') {
    if (car.supported === false) issues.push('هذه المنصة لا تقبل أكثر من وسيطٍ واحد في المنشور');
    else if (typeof car.max_items === 'number' && car.max_items > 0 && media.length > car.max_items) {
      issues.push(`عدد الوسائط (${media.length}) أكثر مما تقبله هذه المنصة في المنشور الواحد (${car.max_items})`);
    }
  }
  const max = c?.text?.max_length;
  const len = textLength(input.text || '', c?.text?.counting_mode);
  if (typeof max === 'number' && max > 0 && len !== null && len > max) {
    issues.push(`النص أطول من حدّ هذه المنصة: ${len} من ${max}. اختصره في نسخة المنصة`);
  }
  return issues;
}

/**
 * عنوان مقطع يوتيوب: مئة حرفٍ أقصاه، ولا يقبل «<» ولا «>». والغائب يُؤخذ من
 * أوّل سطرٍ في النص، فإن غابا معاً فالفراغ — ويقول يوتيوب ما ينقص.
 */
export function youtubeTitle(title: string | undefined, text: string): string {
  const source = (title || '').trim() || (text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return [...source.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 100).join('');
}

/** نوع الوسيط من صيغته. */
export function mediaKind(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}
