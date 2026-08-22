import { useEffect, useState } from 'react';
import { api } from '../api';
import Modal from './Modal';
import { DateRangePicker } from './DatePicker';
import { PlatformIcon, platformLabel } from '../platforms';
import { parsePlatforms } from '../campaigns';

/* نموذج الحملة — واحدٌ للإنشاء والتعديل.

   نقطة PATCH كانت في الخادم منذ أول يوم ولا ينادِيها أحد: لا زرّ تعديل
   ولا نموذج. فكانت الحملة تُكتب مرّةً ولا تُصحَّح أبداً. */

type Draft = {
  name: string;
  objective: string;
  start_date: string;
  end_date: string;
  target_platforms: string[];
  owner_id: string;
  budget: string;
  target_impressions: string;
  target_engagement: string;
  target_leads: string;
};

const EMPTY: Draft = {
  name: '', objective: '', start_date: '', end_date: '', target_platforms: [],
  owner_id: '', budget: '', target_impressions: '', target_engagement: '', target_leads: '',
};

function toDraft(campaign: any): Draft {
  return {
    name: campaign.name || '',
    objective: campaign.objective || '',
    start_date: campaign.start_date || '',
    end_date: campaign.end_date || '',
    target_platforms: parsePlatforms(campaign.target_platforms),
    owner_id: campaign.owner_id || '',
    // الفراغ يعني «لا قيمة مسجّلة» ويبقى فراغاً — لا يصير صفراً.
    budget: campaign.budget == null ? '' : String(campaign.budget),
    target_impressions: campaign.target_impressions == null ? '' : String(campaign.target_impressions),
    target_engagement: campaign.target_engagement == null ? '' : String(campaign.target_engagement),
    target_leads: campaign.target_leads == null ? '' : String(campaign.target_leads),
  };
}

export default function CampaignForm({
  campaign,
  onClose,
  onSaved,
}: {
  /** موجودةً يكون النموذج تعديلاً، وغائبةً يكون إنشاءً. */
  campaign?: any;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const editing = !!campaign;
  const [draft, setDraft] = useState<Draft>(() => (campaign ? toDraft(campaign) : EMPTY));
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/settings').then((d) => setPlatforms(d.settings?.enabled_platforms || [])).catch(() => {});
    api.get('/campaigns/meta/owners').then((d) => setOwners(d.owners || [])).catch(() => {});
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    setErr('');
    setBusy(true);
    try {
      const body = { ...draft, owner_id: draft.owner_id || undefined };
      if (editing) {
        await api.patch(`/campaigns/${campaign.id}`, body);
        onSaved(campaign.id);
      } else {
        const r = await api.post('/campaigns', body);
        onSaved(r.id);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? 'تعديل الحملة' : 'حملة جديدة'} onClose={onClose}>
      <div className="field">
        <label htmlFor="camp-name">الاسم</label>
        <input
          id="camp-name"
          className="input"
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          autoFocus
        />
      </div>

      <div className="field">
        <label htmlFor="camp-objective">هدف الحملة</label>
        <textarea
          id="camp-objective"
          className="textarea"
          value={draft.objective}
          onChange={(e) => set('objective', e.target.value)}
        />
      </div>

      <div className="field">
        <label>مدّة الحملة</label>
        <DateRangePicker
          from={draft.start_date}
          to={draft.end_date}
          onChange={(f, t) => setDraft((d) => ({ ...d, start_date: f, end_date: t }))}
          placeholder="بلا مدّة محدّدة"
        />
      </div>

      <div className="field">
        <label htmlFor="camp-owner">مسؤول الحملة</label>
        <select
          id="camp-owner"
          className="select"
          value={draft.owner_id}
          onChange={(e) => set('owner_id', e.target.value)}
        >
          <option value="">—</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      <div className="field">
        <label>المنصات المستهدفة</label>
        <div className="row">
          {platforms.map((p) => {
            const on = draft.target_platforms.includes(p);
            return (
              <button
                key={p}
                type="button"
                className={`btn sm ${on ? '' : 'ghost'}`}
                aria-pressed={on}
                onClick={() => set(
                  'target_platforms',
                  on ? draft.target_platforms.filter((x) => x !== p) : [...draft.target_platforms, p],
                )}
              >
                <PlatformIcon platform={p} size={20} /> {platformLabel(p)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <label htmlFor="camp-budget">الميزانية</label>
        <input
          id="camp-budget"
          className="input"
          type="number"
          inputMode="decimal"
          min="0"
          value={draft.budget}
          onChange={(e) => set('budget', e.target.value)}
          placeholder="بالريال — المخطّط لا المنفَق"
        />
      </div>

      {/* المستهدفات — رقمٌ بلا سقفٍ يُقاس عليه لا يقول شيئاً، وشريطُ
          الأداء يعرض «لا مستهدف» صراحةً لِما يُترك فارغاً هنا. */}
      <div className="grid cols-3">
        <div className="field">
          <label htmlFor="camp-t-imp">مستهدف الظهور</label>
          <input id="camp-t-imp" className="input" type="number" inputMode="numeric" min="0"
                 value={draft.target_impressions} onChange={(e) => set('target_impressions', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="camp-t-eng">مستهدف التفاعل</label>
          <input id="camp-t-eng" className="input" type="number" inputMode="numeric" min="0"
                 value={draft.target_engagement} onChange={(e) => set('target_engagement', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="camp-t-leads">مستهدف العملاء المحتملين</label>
          <input id="camp-t-leads" className="input" type="number" inputMode="numeric" min="0"
                 value={draft.target_leads} onChange={(e) => set('target_leads', e.target.value)} />
        </div>
      </div>

      {err && <p className="err">{err}</p>}

      <div className="row">
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>إلغاء</button>
        <button className="btn" disabled={!draft.name.trim() || busy} onClick={save}>حفظ</button>
      </div>
    </Modal>
  );
}
