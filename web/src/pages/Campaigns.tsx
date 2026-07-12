import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, PLATFORM_LABELS, STATUS_LABELS, STATUS_BADGE } from '../api';
import { useAuth } from '../auth';
import Modal from '../components/Modal';

export default function Campaigns() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);

  function load() {
    api.get('/campaigns').then((d) => setCampaigns(d.campaigns));
  }
  useEffect(load, []);

  async function openCampaign(id: string) {
    const d = await api.get(`/campaigns/${id}`);
    setSelected(d.campaign);
    setPosts(d.posts);
  }

  const KANBAN_COLS = ['draft', 'pending_marketing', 'pending_gm', 'scheduled', 'published'];

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 className="page-title">الحملات</h1>
        <div className="spacer" />
        {can('content.schedule') && <button className="btn" onClick={() => setShowNew(true)}>+ حملة جديدة</button>}
      </div>

      <div className="grid cols-3">
        {campaigns.map((c) => (
          <div className="card" key={c.id} style={{ cursor: 'pointer' }} onClick={() => openCampaign(c.id)}>
            <div className="row">
              <strong>{c.name}</strong>
              <div className="spacer" />
              <span className={`badge ${c.status === 'active' ? 'green' : 'gray'}`}>{CAMP_STATUS[c.status] || c.status}</span>
            </div>
            <p className="muted" style={{ fontSize: 13, minHeight: 40 }}>{c.objective || 'بدون هدف محدد'}</p>
            <div className="row" style={{ fontSize: 12 }}>
              <span className="muted">{c.posts_count} منشور</span>
              <div className="spacer" />
              <span className="muted">{c.start_date || '؟'} ← {c.end_date || '؟'}</span>
            </div>
          </div>
        ))}
        {campaigns.length === 0 && <p className="muted">لا توجد حملات بعد</p>}
      </div>

      {selected && (
        <Modal title={`حملة: ${selected.name}`} onClose={() => setSelected(null)}>
          <p className="muted">{selected.objective}</p>
          <p style={{ fontSize: 13 }}>
            المنصات: {(JSON.parse(selected.target_platforms || '[]') as string[]).map((p) => PLATFORM_LABELS[p] || p).join('، ') || '—'}
          </p>
          <h4>لوحة Kanban</h4>
          <div className="kanban">
            {KANBAN_COLS.map((col) => (
              <div className="kanban-col" key={col}>
                <h4><span className={`badge ${STATUS_BADGE[col]}`}>{STATUS_LABELS[col]}</span></h4>
                {posts.filter((p) => p.status === col).map((p) => (
                  <div className="kanban-card" key={p.id} onClick={() => navigate(`/editor/${p.id}`)}>{p.title}</div>
                ))}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {showNew && <NewCampaign onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

const CAMP_STATUS: Record<string, string> = { planned: 'مخطّطة', active: 'نشطة', completed: 'مكتملة', archived: 'مؤرشفة' };

function NewCampaign({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [avail, setAvail] = useState<string[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/settings').then((d) => setAvail(d.settings?.enabled_platforms || []));
  }, []);

  async function save() {
    setErr('');
    try {
      await api.post('/campaigns', { name, objective, start_date: start, end_date: end, target_platforms: platforms });
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <Modal title="حملة جديدة" onClose={onClose}>
      <div className="field"><label>الاسم</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>الهدف</label><textarea className="textarea" value={objective} onChange={(e) => setObjective(e.target.value)} /></div>
      <div className="grid cols-2">
        <div className="field"><label>من</label><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="field"><label>إلى</label><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>
      <div className="field">
        <label>المنصات المستهدفة</label>
        <div className="row">
          {avail.map((p) => (
            <button key={p} type="button" className={`btn sm ${platforms.includes(p) ? '' : 'ghost'}`}
              onClick={() => setPlatforms((s) => s.includes(p) ? s.filter((x) => x !== p) : [...s, p])}>
              {PLATFORM_LABELS[p] || p}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <button className="btn" disabled={!name} onClick={save}>حفظ الحملة</button>
    </Modal>
  );
}
