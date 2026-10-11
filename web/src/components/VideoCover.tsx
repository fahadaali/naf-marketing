// «صورة الغلاف» — الصورة التي تظهر قبل تشغيل المقطع في المنصات التي تقبلها
// (إنستغرام وتيك توك ولينكدإن وإكس ويوتيوب؛ وشورتس يوتيوب لا يقبلها).
//
// تُختار من المقطع نفسه بإيقافه عند اللحظة المطلوبة، أو تُرفع صورة. وتُحفظ
// للمحتوى (`video_cover_id`)، ويضعها الخادم عند النشر في إطارٍ بأبعاد المقطع.
// وبلا غلافٍ تختار كل منصةٍ إطاراً بنفسها، كما كان.
//
// وفيها يُكمَّل ما لم يُحفظ من أبعاد المقطع ومدّته (مقطعٌ رُفع قبلها) — بها
// يُعرف هل يصير ريلز أو شورتس.

import { useEffect, useRef, useState } from 'react';
import { Upload, Video } from 'lucide-react';
import { api } from '../api';
import { readVideoMeta, uploadMedia } from '../mediaUpload';
import { useAssetInfo } from './PlatformVariants';
import { bodyMediaIds } from '../mediaPlan';

type Props = {
  postId: string;
  body: string;
  coverId: string | null;
  onChange: (id: string | null) => void;
  onError: (m: string) => void;
  onMsg: (m: string) => void;
};

export default function VideoCover({ postId, body, coverId, onChange, onError, onMsg }: Props) {
  const ids = bodyMediaIds(body);
  const assets = useAssetInfo(ids);
  const videoId = ids.find((id) => (assets[id]?.mime_type || '').startsWith('video/')) || '';
  const video = videoId ? assets[videoId] : undefined;
  const player = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const filled = useRef(new Set<string>());

  // أبعاد مقطعٍ قديم ومدّته — تُقرأ مرّةً وتُحفظ له
  useEffect(() => {
    if (!video || (video.width && video.duration_ms) || filled.current.has(video.id)) return;
    filled.current.add(video.id);
    readVideoMeta(`/api/media/${video.id}`).then((meta) => {
      if (meta) api.patch(`/media/${video.id}/meta`, meta).catch(() => { /* تبقى كما كانت */ });
    });
  }, [video?.id]);

  // غلافٌ واحدٌ لمقطعٍ واحد: منشورٌ بأكثر من وسيط لا يُعرض فيه
  if (!videoId || ids.length !== 1) return null;

  async function save(id: string | null, done: string) {
    await api.patch(`/posts/${postId}`, { video_cover_id: id });
    onChange(id);
    onMsg(done);
  }

  async function fromFrame() {
    const v = player.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    onError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext('2d')!.drawImage(v, 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('تعذّر التقاط الإطار من المقطع. أعد المحاولة');
      const up = await uploadMedia<{ id: string }>(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
      await save(up.id, 'تم الحفظ');
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function fromFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    onError('');
    try {
      const up = await uploadMedia<{ id: string }>(file);
      await save(up.id, 'تم الرفع');
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card vc-card">
      <h4 className="vc-title">صورة الغلاف</h4>
      <p className="muted vc-hint">
        أوقف المقطع عند اللحظة التي تريدها غلافاً ثم اضغط «اختيار من الفيديو»، أو ارفع صورة. تظهر قبل التشغيل في المنصات التي تقبلها.
      </p>
      <div className="vc-row">
        <video ref={player} className="vc-player" src={`/api/media/${videoId}`} controls preload="metadata" playsInline muted />
        {coverId && <img className="vc-thumb" src={`/api/media/${coverId}`} alt="صورة الغلاف" />}
      </div>
      <div className="row vc-actions">
        <button type="button" className="btn sm" disabled={busy} onClick={fromFrame}>
          <Video size={16} /> اختيار من الفيديو
        </button>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={16} /> رفع صورة
        </button>
        {coverId && (
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => save(null, 'تم الحفظ').catch((e) => onError(e.message))}>
            إعادة الافتراضي
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            fromFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
