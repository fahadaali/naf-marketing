import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Save } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import Modal from './Modal';
import ConfirmModal from './ConfirmModal';
import ScheduleModal from './ScheduleModal';
import { PlatformChips } from './PlanItemModal';
import { platformLabel } from '../platforms';
import { planFromPost, riyadhToday } from '../planning';
import { platformChanges, platformStates, type ScheduleRow } from '../postPlatforms';

/* نافذة «منصات التواصل» — من التقويم وإدارة المحتوى والحملة.

   الرقائق نفسها التي في المحرر وبقاعدتها: إلغاء تحديد منصةٍ لها موعدٌ ثم «حفظ»
   يلغي جدولتها بعد تأكيد، وتحديدُ منصةٍ بلا موعد ثم «حفظ» يفتح «جدولة النشر».
   و«تعديل» يفتح المحتوى في المحرر. */
export default function PostPlatformsModal({ postId, onClose, onChanged }: {
  postId: string;
  onClose: () => void;
  /** بعد كل تغيير — لتُقرأ القائمة أو التقويم من جديد. */
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [title, setTitle] = useState('');
  const [plannedOn, setPlannedOn] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ cancel: string[]; schedule: string[] } | null>(null);
  const [scheduleFor, setScheduleFor] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    const d = await api.get(`/posts/${postId}`);
    const plan = planFromPost(d.post);
    setTitle(d.post.title || '');
    setPlannedOn(plan.planned_on);
    setSaved(plan.planned_platforms);
    setSelected(plan.planned_platforms);
    setSchedules(d.schedules || []);
  }

  useEffect(() => {
    load().catch((e) => setErr(e.message));
    api.get('/settings').then((d) => {
      setEnabled(d.settings?.enabled_platforms || []);
      setLabels(d.settings?.platform_labels || {});
    }).catch(() => {});
  }, [postId]);

  const states = platformStates(schedules);
  const published = Object.keys(states).filter((p) => states[p] === 'published');
  // ما نُشر عليه أو جُدوِل يبقى رقاقةً وإن عُطّلت منصته، فلا يختفي ما وقع
  const shown = [...new Set([...enabled, ...selected, ...Object.keys(states)])];

  function submit() {
    setErr(''); setMsg('');
    const changes = platformChanges(states, saved, selected);
    if (changes.cancel.length) setConfirm(changes);
    else finish([], changes.schedule);
  }

  async function finish(cancel: string[], schedule: string[]) {
    setConfirm(null);
    setBusy(true);
    try {
      if (cancel.length) await api.post('/schedules/cancel', { post_id: postId, platforms: cancel });
      await api.patch(`/posts/${postId}`, { planned_platforms: selected.length ? selected : null });
      await load();
      setMsg(cancel.length ? 'تم إلغاء الجدولة' : 'تم الحفظ');
      onChanged();
      if (schedule.length) setScheduleFor(schedule);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (scheduleFor) {
    return (
      <ScheduleModal
        postId={postId}
        platforms={shown.filter((p) => !published.includes(p))}
        labels={labels}
        initialPlatforms={scheduleFor}
        initialDay={plannedOn && plannedOn >= riyadhToday() ? plannedOn : ''}
        onClose={() => setScheduleFor(null)}
        onDone={async (issues) => {
          setScheduleFor(null);
          await load();
          onChanged();
          setMsg('');
          setErr(issues.map((e) => `${platformLabel(e.platform, labels)}: ${e.error}`).join(' · '));
        }}
      />
    );
  }

  if (confirm) {
    return (
      <ConfirmModal
        title="إلغاء الجدولة"
        message={<>لا يُنشر المحتوى على: <bdi>{confirm.cancel.map((p) => platformLabel(p, labels)).join('، ')}</bdi>. ويبقى كما هو ويمكن جدولته عليها من جديد.</>}
        actionLabel="إلغاء الجدولة"
        danger
        onConfirm={() => finish(confirm.cancel, confirm.schedule)}
        onClose={() => setConfirm(null)}
      />
    );
  }

  return (
    <Modal title="منصات التواصل" onClose={onClose}>
      <p className="muted"><bdi>{title}</bdi></p>
      <div className="field">
        <span className="sr-only" id="post-platforms-label">منصات التواصل</span>
        <PlatformChips
          platforms={shown}
          labels={labels}
          selected={selected}
          onChange={setSelected}
          states={states}
          disabled={busy || !can('content.schedule')}
          labelledBy="post-platforms-label"
        />
      </div>
      {err && <p className="err">{err}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}
      <div className="row">
        {can('content.schedule') && (
          <button className="btn gold" disabled={busy} onClick={submit}><Save size={20} /> حفظ</button>
        )}
        <button className="btn ghost" onClick={() => navigate(`/editor/${postId}`)}><Pencil size={20} /> تعديل</button>
      </div>
    </Modal>
  );
}
