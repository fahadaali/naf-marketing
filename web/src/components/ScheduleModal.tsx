import { useState } from 'react';
import { api } from '../api';
import Modal from './Modal';
import { DateTimePicker } from './DatePicker';
import { PlatformIcon, platformLabel } from '../platforms';
import { ensureTikTokVideo } from '../tiktokVideo';

export type ScheduleIssue = { platform: string; error: string };

/** يجهّز مقطع تيك توك إن احتاجه — ويردّ سبب التعذّر نصّاً، أو '' إن لم يتعذّر. */
export async function prepareTikTok(postId: string, progress: (m: string) => void): Promise<string> {
  try {
    progress('جارٍ تجهيز مقطع تيك توك…');
    await ensureTikTokVideo(postId);
    return '';
  } catch (e: any) {
    return String(e?.message || e);
  } finally {
    progress('');
  }
}

/* نافذة «جدولة النشر» — من المحرر ومن نافذة «منصات المنشور».

   تبدأ بمنصات الخطة ويومها المستهدف إن لم يمضِ — والوقت يُدخل يدوياً: اليوم
   المستهدف يومٌ لا ساعة، وساعةٌ مقترحة تُجدول ما لم يقصده أحد. */
export default function ScheduleModal({ postId, platforms, labels, initialPlatforms = [], initialDay = '', onClose, onDone }: {
  postId: string;
  platforms: string[];
  labels: Record<string, string>;
  initialPlatforms?: string[];
  initialDay?: string;
  onClose: () => void;
  onDone: (issues: ScheduleIssue[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialPlatforms);
  const [when, setWhen] = useState(initialDay ? `${initialDay}T` : '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  function toggle(p: string) {
    setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  }

  async function submit() {
    setErr('');
    try {
      // الموعد يُدخل بتوقيت الرياض (UTC+3، بلا توقيت صيفي) بصرف النظر عن توقيت جهاز المستخدم.
      // نثبّت الإزاحة +03:00 ثم نحوّل إلى UTC ISO كي لا ينشر قبل وقته.
      // ووقتٌ مُسح من حقله يترك «2026-10-04T» فيرمي التحويل «Invalid time value».
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return setErr('هذا الحقل مطلوب');
      const iso = new Date(`${when}:00+03:00`).toISOString();
      /* تيك توك بصورةٍ واحدة: يُجهَّز مقطعه قبل الجدولة، فيمرّ فحصُها. وإن
         تعذّر قيل سببه مكان سبب الفحص — هو الأصل وما بعده نتيجته. */
      const tiktokErr = selected.includes('tiktok') ? await prepareTikTok(postId, setBusy) : '';
      setBusy('');
      const d = await api.post<{ issues?: ScheduleIssue[] }>('/schedules', { post_id: postId, platforms: selected, scheduled_at: iso });
      onDone((d.issues || []).map((i) => (i.platform === 'tiktok' && tiktokErr ? { ...i, error: tiktokErr } : i)));
    } catch (e: any) {
      setBusy('');
      setErr(e.message);
    }
  }

  return (
    <Modal title="جدولة النشر" onClose={onClose}>
      <div className="field">
        <label>المنصات</label>
        <div className="row">
          {platforms.map((p) => (
            <button key={p} type="button" className={`btn sm ${selected.includes(p) ? '' : 'ghost'}`} aria-pressed={selected.includes(p)} onClick={() => toggle(p)}>
              <PlatformIcon platform={p} size={20} /> {platformLabel(p, labels)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>الموعد (بتوقيت الرياض)</label>
        <DateTimePicker value={when} onChange={setWhen} inline />
      </div>
      {err && <p className="err">{err}</p>}
      {busy && <p className="muted" role="status">{busy}</p>}
      <button className="btn gold" disabled={!selected.length || !when || !!busy} onClick={submit}>تأكيد الجدولة</button>
    </Modal>
  );
}
