import { formatNumber } from '../lib/format';
import { StarValue } from '../components/Rating';
import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, AlertTriangle, ExternalLink, FileDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, STATUS_LABELS, STATUS_BADGE } from '../api';
import { PlatformIcon, platformLabel } from '../platforms';
import { DateRangePicker } from '../components/DatePicker';

// تسميات عربية لأنواع مقاييس Buffer (PostMetricType) — غير المعروف يُعرض باسمه من Buffer
const METRIC_LABELS: Record<string, string> = {
  impressions: 'الانطباعات', reach: 'الوصول', reactions: 'التفاعلات', comments: 'التعليقات',
  shares: 'المشاركات', reposts: 'إعادات النشر', retweets: 'إعادات التغريد', saves: 'الحفظ',
  clicks: 'النقرات', likes: 'الإعجابات', quotes: 'الاقتباسات', follows: 'متابعون جدد',
  views: 'المشاهدات', view_count: 'مرات المشاهدة', viewers: 'المشاهدون', totaltimewatched: 'وقت المشاهدة (دقائق)',
  engagementrate: 'معدل التفاعل', engagement: 'التفاعل', postcount: 'عدد المنشورات',
};
// ترتيب العرض المفضّل (الأهم أولاً)؛ الباقي يأتي بعده
const METRIC_ORDER = ['impressions', 'reach', 'views', 'view_count', 'reactions', 'likes', 'comments', 'shares', 'reposts', 'retweets', 'quotes', 'saves', 'clicks', 'follows', 'viewers', 'totaltimewatched', 'engagementrate'];
function metricLabel(m: { type?: string; name?: string }): string {
  const key = String(m.type || m.name || '').toLowerCase();
  return METRIC_LABELS[key] || m.name || m.type || key;
}
function metricRank(m: { type?: string; name?: string }): number {
  const i = METRIC_ORDER.indexOf(String(m.type || m.name || '').toLowerCase());
  return i < 0 ? 999 : i;
}

// الداشبورد الموحّد للتحليلات مع فلاتر: النطاق الزمني، المنصة، الحملة.
export default function Analytics() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [platform, setPlatform] = useState('');
  const [campaign, setCampaign] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  function load() {
    const q = new URLSearchParams();
    if (platform) q.set('platform', platform);
    if (campaign) q.set('campaign_id', campaign);
    if (source) q.set('source', source);
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
  useEffect(load, [platform, campaign, source, from, to]);

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
          <div className="field" style={{ margin: 0, minWidth: 160 }}>
            <label>المصدر</label>
            <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">كل المنشورات</option>
              <option value="platform">عبر المنصة فقط</option>
            </select>
          </div>
        </div>
      </div>

      <BestTimesCard platform={platform} />

      <ReputationCard />

      <VideoAnalyticsExport onImported={load} />

      {/* المؤشرات — ديناميكية: كل مقاييس المنصات (المتشابهة مجمّعة). صفِّ بالمنصة لرؤية مقاييسها وحدها. */}
      {(() => {
        const metrics = [...(data?.metrics || [])].sort((a: any, b: any) => metricRank(a) - metricRank(b) || (b.value - a.value));
        const shown = metrics.length ? metrics : [
          { type: 'impressions', value: t.impressions ?? 0, unit: 'count' },
          { type: 'reach', value: t.reach ?? 0, unit: 'count' },
          { type: 'engagement', value: t.engagement ?? 0, unit: 'count' },
          { type: 'engagementrate', value: t.engagement_rate ?? 0, unit: 'percentage' },
        ];
        return (
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            {shown.map((m: any, i: number) => (
              <Stat
                key={i}
                label={metricLabel(m)}
                value={m.unit === 'percentage' ? `${m.value}%` : m.value}
              />
            ))}
          </div>
        );
      })()}

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
                <span className="muted"><bdi>{formatNumber(p.impressions || 0)}</bdi> انطباع</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(p.impressions / maxImp) * 100}%` }} />
              </div>
            </div>
          ))}
          {(data?.byPlatform || []).length === 0 && <p className="muted">لا تحليلات بعد. انشر محتوى ثم اسحب التحليلات.</p>}
        </div>

        {/* أفضل المنشورات */}
        <div className="card">
          <h4 style={{ marginTop: 0 }}>أفضل المنشورات</h4>
          <table className="table">
            <thead><tr><th>المنشور</th><th>المنصة</th><th>المصدر</th><th>تفاعل</th><th>انطباعات</th></tr></thead>
            <tbody>
              {(data?.topPosts || []).map((p: any, i: number) => (
                <tr
                  key={i}
                  onClick={() => p.external_url && window.open(p.external_url, '_blank', 'noopener,noreferrer')}
                  style={p.external_url ? { cursor: 'pointer' } : undefined}
                  title={p.external_url ? 'فتح المنشور على المنصة' : undefined}
                >
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {p.external_url && <ExternalLink size={13} style={{ opacity: 0.55, flexShrink: 0 }} />}
                      {p.title}
                    </span>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <PlatformIcon platform={p.platform} size={18} /> {platformLabel(p.platform)}
                    </span>
                  </td>
                  <td><span className={`badge ${p.via_platform ? 'green' : 'gray'}`}>{p.via_platform ? 'المنصة' : 'خارجي'}</span></td>
                  <td>{p.engagement}</td>
                  <td>{p.impressions}</td>
                </tr>
              ))}
              {(data?.topPosts || []).length === 0 && <tr><td colSpan={5} className="muted">—</td></tr>}
            </tbody>
          </table>
        </div>

        {/* حالة خط الإنتاج */}
        <div className="card">
          <h4 style={{ marginTop: 0 }}>حالة خط الإنتاج</h4>
          <div className="row">
            {(data?.pipeline || []).map((s: any) => (
              <div key={s.status} style={{ marginInlineEnd: 12 }}>
                <span className={`badge ${STATUS_BADGE[s.status] || 'gray'}`}>{STATUS_LABELS[s.status] || s.status}</span>
                <strong style={{ marginInlineStart: 6 }}>{s.count}</strong>
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
                <span className="muted"><bdi>{formatNumber(c.impressions || 0)}</bdi> انطباع · <bdi>{formatNumber(c.engagement || 0)}</bdi> تفاعل</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(c.impressions / maxCampImp) * 100}%` }} />
              </div>
            </div>
          ))}
          {(data?.campaigns || []).length === 0 && <p className="muted">لا حملة لها بيانات بعد. اربط المحتوى بحملة لتظهر هنا.</p>}
        </div>
      </div>

      {/* تنبيهات المحتوى المتأخر */}
      {alerts.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderColor: 'var(--warning)' }}>
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
          {(perf?.writers || []).length === 0 && <p className="muted">لا أداء مسجّل بعد. انشر محتوى ليظهر هنا.</p>}
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

function Stat({ label, value }: { label: string; value: number | string | ReactNode }) {
  return (
    <div className="card stat">
      <div className="num">{typeof value === 'number' ? formatNumber(value) : value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

// ===== تصدير تحليلات الفيديو (يوتيوب/تيك توك) — تحليلات أعمق عبر SocialAPI Analytics Export =====
function VideoAnalyticsExport({ onImported }: { onImported: () => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [exports, setExports] = useState<any[]>([]);
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);

  function load() {
    api.get('/analytics/exports').then((d) => {
      setAccounts(d.accounts || []);
      setExports(d.exports || []);
      if (!account && d.accounts?.[0]) setAccount(d.accounts[0].id);
    }).catch(() => {});
  }
  useEffect(() => { if (open) load(); }, [open]);

  async function create() {
    if (!account) return;
    setBusy('create'); setMsg('جارٍ إنشاء التصدير…');
    try {
      await api.post('/analytics/export', { account_id: account });
      setMsg('تم إنشاء مهمة التصدير — قد تستغرق دقائق. حدّث الحالة ثم استورد عند الاكتمال.');
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  async function ingest(id: string) {
    setBusy(id); setMsg('');
    try {
      const d = await api.post(`/analytics/exports/${id}/ingest`);
      if (d.pending) { setMsg(`التصدير لم يكتمل بعد (${d.status}). أعد المحاولة لاحقاً.`); }
      else { setMsg(`تم استيراد ${d.imported} فيديو إلى اللوحة.`); onImported(); }
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  const done = (s: string) => ['completed', 'complete', 'done'].includes(s);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <h4 style={{ margin: 0 }}><FileDown size={16} style={{ verticalAlign: -3, marginInlineEnd: 6 }} /> تصدير تحليلات الفيديو (يوتيوب/تيك توك)</h4>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>{open ? 'إخفاء' : 'عرض'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            تحليلات فيديو أعمق (مشاهدات/تفاعل لكل فيديو) عبر SocialAPI. خاضع لحدود خطتك (المجانية: تصديران/شهر، حتى 30 فيديو، تهدئة 7 أيام).
          </p>
          {accounts.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>لا توجد حسابات فيديو مربوطة (يوتيوب/تيك توك).</p>
          ) : (
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <select className="select" style={{ maxWidth: 280 }} value={account} onChange={(e) => setAccount(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{platformLabel(a.platform)} — {a.name}</option>)}
              </select>
              <button className="btn sm" disabled={busy === 'create'} onClick={create}><FileDown size={14} /> إنشاء تصدير</button>
              <button className="btn sm ghost" onClick={load}><RefreshCw size={14} /> تحديث الحالة</button>
            </div>
          )}
          {msg && <p className="muted" style={{ fontSize: 12 }}>{msg}</p>}
          {exports.length > 0 && (
            <table className="table">
              <thead><tr><th>المعرّف</th><th>الحالة</th><th>فيديوهات</th><th></th></tr></thead>
              <tbody>
                {exports.map((x) => (
                  <tr key={x.id}>
                    <td className="muted" style={{ fontSize: 12 }}>{String(x.id).slice(0, 10)}…</td>
                    <td>{x.status}</td>
                    <td>{x.videoCount ?? '—'}</td>
                    <td>
                      {done(x.status)
                        ? <button className="btn sm" disabled={busy === x.id} onClick={() => ingest(x.id)}>استيراد</button>
                        : <button className="btn sm ghost" disabled={busy === x.id} onClick={() => ingest(x.id)}>فحص/استيراد</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ===== السمعة: متوسط التقييم وتوزيع النجوم ومعدل الرد والاتجاه =====
function ReputationCard() {
  const [rep, setRep] = useState<any>(null);
  useEffect(() => { api.get('/analytics/reputation').then(setRep).catch(() => {}); }, []);
  if (!rep || !rep.totals?.count) return null;

  const t = rep.totals;
  const dist: any[] = rep.distribution || [];
  const maxDist = Math.max(1, ...dist.map((d) => d.count || 0));
  const trend: any[] = rep.trend || [];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h4 style={{ marginTop: 0 }}>السمعة والتقييمات</h4>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Stat label="متوسط التقييم" value={<StarValue value={t.avg_rating} size={16} />} />
        <Stat label="عدد التقييمات" value={t.count} />
        <Stat label="تقييمات سلبية (≤2)" value={t.negative} />
        <Stat label="نسبة الرد على التقييمات" value={`${t.reply_rate}%`} />
      </div>

      <div className="grid cols-2">
        <div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>توزيع النجوم</div>
          {[5, 4, 3, 2, 1].map((star) => {
            const row = dist.find((d) => Number(d.rating) === star);
            const n = row?.count || 0;
            return (
              <div key={star} style={{ marginBottom: 6 }}>
                <div className="row" style={{ fontSize: 12 }}>
                  <span><StarValue value={star} size={12} /></span>
                  <div className="spacer" />
                  <span className="muted">{n}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(n / maxDist) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>اتجاه المتوسط الشهري</div>
          {trend.length === 0 && <p className="muted" style={{ fontSize: 12 }}>التقييمات لا تكفي لرسم اتجاه بعد.</p>}
          {trend.map((m) => (
            <div key={m.month} style={{ marginBottom: 6 }}>
              <div className="row" style={{ fontSize: 12 }}>
                <span>{m.month}</span>
                <div className="spacer" />
                <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><StarValue value={m.avg_rating} size={12} /> · <bdi>{m.count}</bdi></span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(Number(m.avg_rating) / 5) * 100}%` }} />
              </div>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            معدل الرد على كل التفاعلات: <strong>{rep.engagement?.reply_rate}%</strong>
            {' '}({rep.engagement?.replied} من {rep.engagement?.total})
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== أفضل أوقات النشر — من الأداء الفعلي (بتوقيت الرياض) =====
const DAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
// الوقت بنظام ٢٤ ساعة مع عزل اتجاهي — قاعدة التنسيق في naf-terms
function hourLabel(h: number): string {
  return `\u2068${String(h).padStart(2, '0')}:00\u2069`;
}

function BestTimesCard({ platform }: { platform: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    const q = platform ? `?platform=${encodeURIComponent(platform)}` : '';
    api.get(`/analytics/best-times${q}`).then(setData).catch(() => {});
  }, [platform]);
  if (!data || !data.sample) return null;

  const days: any[] = data.byDay || [];
  const hours: any[] = data.byHour || [];
  const maxDay = Math.max(1, ...days.map((d) => d.avg_engagement || 0));
  const topHours = hours.slice(0, 5);
  const maxHour = Math.max(1, ...topHours.map((h) => h.avg_engagement || 0));

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row">
        <h4 style={{ marginTop: 0, marginBottom: 0 }}>أفضل أوقات النشر</h4>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>
          بتوقيت الرياض · من {data.sample} منشوراً
        </span>
      </div>
      {!data.enough && (
        <p className="muted" style={{ fontSize: 12 }}>
          البيانات محدودة — التوصية تزداد دقّة كلما نُشر محتوى أكثر.
        </p>
      )}
      <div className="grid cols-2" style={{ marginTop: 10 }}>
        <div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>حسب اليوم</div>
          {days.map((d) => (
            <div key={d.day} style={{ marginBottom: 6 }}>
              <div className="row" style={{ fontSize: 12 }}>
                <span>{DAY_AR[d.day] || d.day}</span>
                <div className="spacer" />
                <span className="muted">{d.avg_engagement} تفاعل · {d.posts}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(d.avg_engagement / maxDay) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>أفضل الساعات</div>
          {topHours.map((h) => (
            <div key={h.hour} style={{ marginBottom: 6 }}>
              <div className="row" style={{ fontSize: 12 }}>
                <span>{hourLabel(h.hour)}</span>
                <div className="spacer" />
                <span className="muted">{h.avg_engagement} تفاعل · {h.posts}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(h.avg_engagement / maxHour) * 100}%` }} />
              </div>
            </div>
          ))}
          {days[0] && topHours[0] && (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              الأفضل: <strong>{DAY_AR[days[0].day]}</strong> عند <strong>{hourLabel(topHours[0].hour)}</strong>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
