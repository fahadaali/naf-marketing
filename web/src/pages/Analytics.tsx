import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, PLATFORM_LABELS, STATUS_LABELS, STATUS_BADGE } from '../api';

// الداشبورد الموحّد للتحليلات مع فلاتر: النطاق الزمني، المنصة، الحملة.
export default function Analytics() {
  const [data, setData] = useState<any>(null);
  const [platform, setPlatform] = useState('');
  const [campaign, setCampaign] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  function load() {
    const q = new URLSearchParams();
    if (platform) q.set('platform', platform);
    if (campaign) q.set('campaign_id', campaign);
    if (from) q.set('from', new Date(from).toISOString());
    if (to) q.set('to', new Date(to).toISOString());
    api.get('/analytics/dashboard?' + q.toString()).then(setData).catch((e) => setMsg(e.message));
  }

  useEffect(() => {
    api.get('/settings').then((d) => setPlatforms(d.settings?.enabled_platforms || []));
    api.get('/campaigns').then((d) => setCampaigns(d.campaigns));
  }, []);
  useEffect(load, [platform, campaign, from, to]);

  async function refresh() {
    setMsg('جارٍ السحب…');
    try {
      const d = await api.post('/analytics/refresh');
      setMsg(`تم سحب ${d.captured} لقطة`);
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  const t = data?.totals || {};
  const maxImp = Math.max(1, ...(data?.byPlatform || []).map((p: any) => p.impressions || 0));

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 className="page-title">التحليلات</h1>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        <button className="btn ghost" onClick={refresh}><RefreshCw size={15} /> سحب التحليلات</button>
      </div>

      {/* الفلاتر */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="grid cols-4">
          <div className="field" style={{ margin: 0 }}>
            <label>من</label>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>إلى</label>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>المنصة</label>
            <select className="select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">كل المنصات</option>
              {platforms.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p] || p}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>الحملة</label>
            <select className="select" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">كل الحملات</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* المؤشرات */}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="الوصول" value={t.reach ?? 0} />
        <Stat label="الانطباعات" value={t.impressions ?? 0} />
        <Stat label="التفاعل" value={t.engagement ?? 0} />
        <Stat label="معدل التفاعل" value={`${t.engagement_rate ?? 0}%`} />
      </div>

      <div className="grid cols-2">
        {/* تفصيل المنصات */}
        <div className="card">
          <h4 style={{ marginTop: 0 }}>الأداء حسب المنصة</h4>
          {(data?.byPlatform || []).map((p: any) => (
            <div key={p.platform} style={{ marginBottom: 10 }}>
              <div className="row" style={{ fontSize: 13 }}>
                <span>{PLATFORM_LABELS[p.platform] || p.platform}</span>
                <div className="spacer" />
                <span className="muted">{(p.impressions || 0).toLocaleString('ar-EG')} انطباع</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(p.impressions / maxImp) * 100}%` }} />
              </div>
            </div>
          ))}
          {(data?.byPlatform || []).length === 0 && <p className="muted">لا توجد بيانات — اسحب التحليلات بعد نشر محتوى.</p>}
        </div>

        {/* أفضل المنشورات */}
        <div className="card">
          <h4 style={{ marginTop: 0 }}>أفضل المنشورات</h4>
          <table className="table">
            <thead><tr><th>المنشور</th><th>تفاعل</th><th>انطباعات</th></tr></thead>
            <tbody>
              {(data?.topPosts || []).map((p: any) => (
                <tr key={p.post_id}><td>{p.title}</td><td>{p.engagement}</td><td>{p.impressions}</td></tr>
              ))}
              {(data?.topPosts || []).length === 0 && <tr><td colSpan={3} className="muted">—</td></tr>}
            </tbody>
          </table>
        </div>

        {/* حالة خط الإنتاج */}
        <div className="card">
          <h4 style={{ marginTop: 0 }}>حالة خط الإنتاج</h4>
          <div className="row">
            {(data?.pipeline || []).map((s: any) => (
              <div key={s.status} style={{ marginLeft: 12 }}>
                <span className={`badge ${STATUS_BADGE[s.status] || 'gray'}`}>{STATUS_LABELS[s.status] || s.status}</span>
                <strong style={{ marginRight: 6 }}>{s.count}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* أداء الحملات */}
        <div className="card">
          <h4 style={{ marginTop: 0 }}>أداء الحملات</h4>
          <table className="table">
            <thead><tr><th>الحملة</th><th>انطباعات</th><th>تفاعل</th></tr></thead>
            <tbody>
              {(data?.campaigns || []).map((c: any) => (
                <tr key={c.id}><td>{c.name}</td><td>{c.impressions}</td><td>{c.engagement}</td></tr>
              ))}
              {(data?.campaigns || []).length === 0 && <tr><td colSpan={3} className="muted">—</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card stat">
      <div className="num">{typeof value === 'number' ? value.toLocaleString('ar-EG') : value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
