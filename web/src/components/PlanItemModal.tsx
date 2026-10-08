import { useEffect, useState } from 'react';
import { api, FORMAT_LABELS } from '../api';
import Modal from './Modal';
import { DayPicker } from './DatePicker';
import { PlatformIcon, platformLabel } from '../platforms';
import { EMPTY_PLAN, pillarsFrom, planPayload, type PlanDraft } from '../planning';

/* حقول خطة المحتوى ونافذة «إضافة فكرة».

   مكوّن ميزةٍ مشترك بين صفحتين — المحرّر وإدارة المحتوى والتقويم — كـ`CampaignForm`،
   لا عنصر سجلّ. والحقول وتسمياتها من naf-terms «حقول خطة المحتوى»، بلا أيقونات:
   كلٌّ منها حقلٌ بعنوانٍ نصّي ظاهر (naf-icons، بعد «حالات الحملة»). */

export type PlanOptions = {
  platforms: string[];
  labels: Record<string, string>;
  assignees: { id: string; name: string }[];
  pillars: string[];
  campaigns: { id: string; name: string }[];
};

/** خيارات الحقول من الإعدادات والمسؤولين والحملات — ثلاثة نداءات تسقط صامتة. */
export function usePlanOptions(): PlanOptions {
  const [opts, setOpts] = useState<PlanOptions>({ platforms: [], labels: {}, assignees: [], pillars: [], campaigns: [] });
  useEffect(() => {
    // الصمت قرار: خيارٌ غائب يُبقي حقله على «بلا …» ولا يمنع الحفظ
    api.get('/settings').then((d) => setOpts((o) => ({
      ...o,
      platforms: d.settings?.enabled_platforms || [],
      labels: d.settings?.platform_labels || {},
      pillars: pillarsFrom(d.settings),
    }))).catch(() => {});
    api.get('/posts/meta/assignees').then((d) => setOpts((o) => ({ ...o, assignees: d.assignees || [] }))).catch(() => {});
    api.get('/campaigns').then((d) => setOpts((o) => ({ ...o, campaigns: d.campaigns || [] }))).catch(() => {});
  }, []);
  return opts;
}

export function PlanFields({
  draft,
  onChange,
  options,
  disabled = false,
  idPrefix,
  assigneeName,
}: {
  draft: PlanDraft;
  onChange: (d: PlanDraft) => void;
  options: PlanOptions;
  disabled?: boolean;
  /** يميّز معرّفات الحقول حين تظهر الحقول في نافذةٍ فوق صفحةٍ فيها مثلها. */
  idPrefix: string;
  /** اسم المسؤول الحالي إن لم يكن بين الخيارات — حسابٌ عُطّل بعد إسناده. */
  assigneeName?: string;
}) {
  const set = <K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) => onChange({ ...draft, [key]: value });
  const id = (k: string) => `${idPrefix}-${k}`;
  // ما سُجّل على المحتوى يبقى خياراً وإن غاب من القائمة، فلا يُمسح بحفظٍ لم يقصده أحد
  const pillars = draft.pillar && !options.pillars.includes(draft.pillar) ? [...options.pillars, draft.pillar] : options.pillars;
  const assignees = draft.assignee_id && !options.assignees.some((a) => a.id === draft.assignee_id)
    ? [...options.assignees, { id: draft.assignee_id, name: assigneeName || draft.assignee_id }]
    : options.assignees;
  const platforms = [...options.platforms, ...draft.planned_platforms.filter((p) => !options.platforms.includes(p))];

  return (
    <>
      <div className="field">
        <label htmlFor={id('day')}>يوم النشر المستهدف</label>
        <DayPicker id={id('day')} value={draft.planned_on} onChange={(v) => set('planned_on', v)} placeholder="بلا يوم محدّد" disabled={disabled} />
      </div>

      <div className="field">
        <label id={id('platforms')}>منصات التواصل</label>
        <div className="plan-platforms" role="group" aria-labelledby={id('platforms')}>
          {platforms.map((p) => {
            const on = draft.planned_platforms.includes(p);
            return (
              <button
                key={p}
                type="button"
                className={`btn sm ${on ? '' : 'ghost'}`}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => set('planned_platforms', on ? draft.planned_platforms.filter((x) => x !== p) : [...draft.planned_platforms, p])}
              >
                <PlatformIcon platform={p} size={20} /> {platformLabel(p, options.labels)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <label htmlFor={id('format')}>الشكل</label>
        <select id={id('format')} className="select" value={draft.format} onChange={(e) => set('format', e.target.value)} disabled={disabled}>
          {Object.entries(FORMAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor={id('assignee')}>مسؤول التنفيذ</label>
        <select id={id('assignee')} className="select" value={draft.assignee_id} onChange={(e) => set('assignee_id', e.target.value)} disabled={disabled}>
          <option value="">بلا مسؤول</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor={id('pillar')}>محور المحتوى</label>
        <select id={id('pillar')} className="select" value={draft.pillar} onChange={(e) => set('pillar', e.target.value)} disabled={disabled}>
          <option value="">بلا محور</option>
          {pillars.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor={id('campaign')}>الحملة</label>
        <select id={id('campaign')} className="select" value={draft.campaign_id} onChange={(e) => set('campaign_id', e.target.value)} disabled={disabled}>
          <option value="">بدون حملة</option>
          {options.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor={id('brief')}>ملخّص الفكرة</label>
        <textarea id={id('brief')} className="textarea" value={draft.brief} onChange={(e) => set('brief', e.target.value)} disabled={disabled} />
      </div>
    </>
  );
}

/** نافذة «إضافة فكرة»: عنوانٌ إلزاميّ وحقول الخطة، بلا نصّ — فتُنشأ فكرةً. */
export default function PlanItemModal({
  day = '',
  onClose,
  onCreated,
}: {
  /** يوم النشر المستهدف مملوءاً سلفاً — من خانة يومه في التقويم. */
  day?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const options = usePlanOptions();
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState<PlanDraft>({ ...EMPTY_PLAN, planned_on: day });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    if (!title.trim()) return setErr('هذا الحقل مطلوب');
    setBusy(true);
    try {
      const r = await api.post('/posts', { title: title.trim(), body: '', source: 'manual', ...planPayload(draft) });
      onCreated(r.id);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="إضافة فكرة" onClose={onClose}>
      <div className="field">
        <label htmlFor="plan-new-title">العنوان</label>
        <input id="plan-new-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
      <PlanFields draft={draft} onChange={setDraft} options={options} idPrefix="plan-new" />
      {err && <p className="err">{err}</p>}
      <div className="row">
        <div className="spacer" />
        <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
        <button type="button" className="btn" disabled={busy} onClick={submit}>إضافة</button>
      </div>
    </Modal>
  );
}
