// رفع وسيطٍ إلى المكتبة — ومعه أبعاد المقطع ومدّته.
//
// الخادم يقرأ أبعاد الصورة بنفسه، ولا يملك ما يقرأ به ملف فيديو. فيقرؤها
// المتصفح هنا من `<video>` قبل الرفع: بها يُعرف هل المقطع طوليّ يصير ريلز
// أو شورتس، وهل مدّته في حدود سبوتلايت سناب. وما تعذّرت قراءته يُرفع بلا
// أبعاد، فيُنشر كما كان يُنشر.

import { api } from './api';

export type VideoMeta = { width: number; height: number; duration_ms: number };

/** أبعاد المقطع ومدّته من ملفٍّ محلّي أو رابط — `null` إن تعذّرت قراءتها. */
export function readVideoMeta(src: Blob | string): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const v = document.createElement('video');
    const done = (meta: VideoMeta | null) => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      resolve(meta);
    };
    const timer = window.setTimeout(() => done(null), 15000);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const ok = v.videoWidth > 0 && v.videoHeight > 0 && Number.isFinite(v.duration);
      done(ok ? { width: v.videoWidth, height: v.videoHeight, duration_ms: Math.round(v.duration * 1000) } : null);
    };
    v.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    v.src = url;
  });
}

export async function uploadMedia<T = any>(file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  if (file.type.startsWith('video/')) {
    const meta = await readVideoMeta(file);
    if (meta) {
      form.append('width', String(meta.width));
      form.append('height', String(meta.height));
      form.append('duration_ms', String(meta.duration_ms));
    }
  }
  return api.upload<T>('/media', form);
}
