import { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, STATUS_LABELS, STATUS_BADGE } from '../api';
import { PlatformIcon, platformLabel } from '../platforms';
import { DateRangePicker } from '../components/DatePicker';

// الداشبورد الموحّد للتحليلات مع فلاتر: النطاق الزمني، المنصة، الحملة.
export default function Analytics() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
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
    // حدود اليوم بتوقيت الرياض (UTC+3)
    if (from) q.set('from', new Date(`${from}T00:00:00+03:00`).toISOString());
    if (to) q.set('to', new Date(`${to}T23:59:59+03:00`).toISOString());
    api.get('/analytics/dashboard?' + q.toString()).then(setData).catch((e) => setMsg(e.message));
  }

  useEffect(() => {
    api.get('/settings').then((d) => setPlatforms(d.settings?.enabled_platforms || []));
    api.get('/campaigns').then((d) => setCampaigns(d.campaigns));
    api.get('/analytics/performance').then(setPerf).catch(() => {});
    api.get('/analytics/alerts').then((d) => setAlerts(d.stale || [])).catch(() => {});
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
  const maxCampImp = Math.max(1, ...(data?.campaigns || []).map((c: any) => c.impressions || 0));
  const maxCreated = Math.max(1, ...(perf?.writers || []).map((w: any) => w.created_count || 0));

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
        <div className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>النطاق الزمني</label>
            <DateRangePicker from={from} to={to} onChange={(f, t2) => { setFrom(f); setTo(t2); }} />
          </div>
          <div className="field" style={{ margin: 0, minWidth: 160 }}>
            <label>المنصة</label>
            <select className="select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">كل المنصات</option>
              {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 160 }}>
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
                <PlatformIcon platform={p.platform} size={20} />
                <span>{platformLabel(p.platform)}</span>
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
          {(data?.campaigns || []).map((c: any) => (
            <div key={c.id} style={{ marginBottom: 10 }}>
              <div className="row" style={{ fontSize: 13 }}>
                <span>{c.name}</span>
                <div className="spacer" />
                <span className="muted">{(c.impressions || 0).toLocaleString('ar-EG')} انطباع · {(c.engagement || 0).toLocaleString('ar-EG')} تفاعل</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(c.impressions / maxCampImp) * 100}%` }} />
              </div>
            </div>
          ))}
          {(data?.campaigns || []).length === 0 && <p className="muted">لا توجد بيانات حملات بعد.</p>}
        </div>
      </div>

      {/* تنبيهات المحتوى المتأخر */}
      {alerts.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderColor: 'hsl(var(--warning, 38 92% 50%))' }}>
          <h4 style={{ marginTop: 0 }} className="row"><AlertTriangle size={16} /> محتوى متأخر بحاجة لمتابعة</h4>
          <table className="table">
            <thead><tr><th>المحتوى</th><th>المرحلة</th><th>عدد الأيام</th></tr></thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/editor/${a.id}`)}>
                  <td>{a.title}</td>
                  <td><span className={`badge ${STATUS_BADGE[a.status] || 'gray'}`}>{STATUS_LABELS[a.status] || a.status}</span></td>
                  <td>{a.days_stuck}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* أداء الفريق */}
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>إنتاجية الكتّاب</h4>
          {(perf?.writers || []).map((w: any) => (
            <div key={w.id} style={{ marginBottom: 10 }}>
              <div className="row" style={{ fontSize: 13 }}>
                <span>{w.name}</span>
                <div className="spacer" />
                <span className="muted">{w.created_count} محتوى · {w.published_count} منشور · {w.rejected_count} مرفوض</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(w.created_count / maxCreated) * 100}%` }} />
              </div>
            </div>
          ))}
          {(perf?.writers || []).length === 0 && <p className="muted">لا توجد بيانات بعد.</p>}
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>سرعة اعتماد المراجعين/المديرين</h4>
          <table className="table">
            <thead><tr><th>المستخدم</th><th>عدد الإجراءات</th><th>متوسط الوقت (ساعة)</th></tr></thead>
            <tbody>
              {(perf?.approvers || []).map((ap: any) => (
                <tr key={ap.id}><td>{ap.name}</td><td>{ap.actions_count}</td><td>{ap.avg_hours ?? '—'}</td></tr>
              ))}
              {(perf?.approvers || []).length === 0 && <tr><td colSpan={3} className="muted">—</td></tr>}
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
