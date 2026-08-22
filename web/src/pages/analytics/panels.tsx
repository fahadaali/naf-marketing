import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, FileOutput, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../../api';
import { formatNumber, isolate } from '../../lib/format';
import StatusBadge from '../../components/StatusBadge';
import Bar from '../../components/Bar';
import { RatingValue } from '../../components/Rating';
import { PlatformIcon, platformLabel } from '../../platforms';

/* ألواح المنصة — ما تعرفه المنصة عن نفسها من لقطات المزوّد وسجلّ الاعتماد.
   كانت كلُّها في شاشةٍ واحدة طويلة، وهي هنا موزّعةٌ على طبقاتها من الدليل:
   الأداء حسب المنصة والحملات في «الوصول»، وأفضل المنشورات والأوقات والسمعة
   في «التفاعل»، وخطُّ الإنتاج والمتأخر وأداء الفريق في «التشغيل». */

export type DashboardData = {
  totals?: Record<string, number>;
  byPlatform?: { platform: string; impressions: number; reach: number; engagement: number }[];
  topPosts?: {
    post_id: string | null; title: string; platform: string; external_url: string | null;
    engagement: number; impressions: number; via_platform: number;
  }[];
  pipeline?: { status: string; count: number }[];
  campaigns?: { id: string; name: string; impressions: number; engagement: number }[];
};

export function PlatformBreakdown({ data }: { data: DashboardData | null }) {
  const rows = data?.byPlatform || [];
  const max = Math.max(1, ...rows.map((p) => p.impressions || 0));
  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>الأداء حسب المنصة</h4>
      {rows.map((p) => (
        <div key={p.platform} style={{ marginBottom: 10 }}>
          <div className="row" style={{ fontSize: 'var(--text-xs)' }}>
            <PlatformIcon platform={p.platform} size={16} />
            <span>{platformLabel(p.platform)}</span>
            <div className="spacer" />
            <span className="muted">
              <bdi>{formatNumber(p.impressions || 0)}</bdi> ظهور
            </span>
          </div>
          <Bar value={p.impressions || 0} max={max} />
        </div>
      ))}
      {rows.length === 0 && <p className="muted">لا تحليلات بعد. انشر محتوى ثم اسحب التحليلات.</p>}
    </div>
  );
}

export function CampaignPerformance({ data }: { data: DashboardData | null }) {
  const rows = data?.campaigns || [];
  const max = Math.max(1, ...rows.map((c) => c.impressions || 0));
  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>أداء الحملات</h4>
      {rows.map((c) => (
        <div key={c.id} style={{ marginBottom: 10 }}>
          <div className="row" style={{ fontSize: 'var(--text-xs)' }}>
            <span>{c.name}</span>
            <div className="spacer" />
            <span className="muted">
              <bdi>{formatNumber(c.impressions || 0)}</bdi> ظهور · <bdi>{formatNumber(c.engagement || 0)}</bdi> تفاعل
            </span>
          </div>
          <Bar value={c.impressions || 0} max={max} />
        </div>
      ))}
      {rows.length === 0 && <p className="muted">لا حملة لها بيانات بعد. اربط المحتوى بحملة لتظهر هنا.</p>}
    </div>
  );
}

export function TopPosts({ data }: { data: DashboardData | null }) {
  const rows = data?.topPosts || [];
  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>أفضل المنشورات</h4>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr><th>المنشور</th><th>المنصة</th><th>المصدر</th><th>تفاعل</th><th>ظهور</th></tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr
                key={i}
                onClick={() => p.external_url && window.open(p.external_url, '_blank', 'noopener,noreferrer')}
                style={p.external_url ? { cursor: 'pointer' } : undefined}
                title={p.external_url ? 'فتح المنشور على المنصة' : undefined}
              >
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {p.external_url && <ExternalLink size={16} style={{ opacity: 0.55, flexShrink: 0 }} />}
                    {p.title}
                  </span>
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <PlatformIcon platform={p.platform} size={16} /> {platformLabel(p.platform)}
                  </span>
                </td>
                <td><span className={`badge ${p.via_platform ? 'green' : 'gray'}`}>{p.via_platform ? 'المنصة' : 'خارجي'}</span></td>
                <td><bdi>{formatNumber(p.engagement)}</bdi></td>
                <td><bdi>{formatNumber(p.impressions)}</bdi></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted">لا منشور له أرقام بعد. انشر محتوى ثم اسحب التحليلات.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PipelineStatus({ data }: { data: DashboardData | null }) {
  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>حالة خط الإنتاج</h4>
      <div className="row">
        {(data?.pipeline || []).map((s) => (
          <div key={s.status} style={{ marginInlineEnd: 12 }}>
            <StatusBadge status={s.status} />
            <strong style={{ marginInlineStart: 6 }}><bdi>{formatNumber(s.count)}</bdi></strong>
          </div>
        ))}
        {(data?.pipeline || []).length === 0 && <p className="muted">لا محتوى بعد. ابدأ بأول محتوى.</p>}
      </div>
    </div>
  );
}

export function StaleAlerts() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<any[]>([]);
  useEffect(() => {
    /* الصمت هنا قرار: البطاقة تُخفي نفسها بلا تنبيهات (`return null`
       أدناه)، فالفشل يعني اختفاءها لا شاشةً تكذب. وستّ بطاقاتٍ تعرض
       ستّ رسائل خطأ على انقطاعٍ واحد ضجيجٌ لا خبر. */
    api.get('/analytics/alerts').then((d) => setAlerts(d.stale || [])).catch(() => {});
  }, []);
  if (!alerts.length) return null;

  return (
    <div className="card" style={{ marginTop: 16, borderColor: 'var(--warning)' }}>
      <h4 style={{ marginTop: 0 }} className="row"><TriangleAlert size={16} /> محتوى متأخر بحاجة لمتابعة</h4>
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>المحتوى</th><th>المرحلة</th><th>عدد الأيام</th></tr></thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id}>
                <td><button type="button" className="row-link" onClick={() => navigate(`/editor/${a.id}`)}>{a.title}</button></td>
                <td><StatusBadge status={a.status} /></td>
                <td><bdi>{a.days_stuck}</bdi></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TeamPerformance() {
  const [perf, setPerf] = useState<any>(null);
  /* هذه البطاقة تُرسم دائماً بخلاف بقيّة اللوحات — فالفشل يظهر فيها
     «لا أداء مسجّل بعد. انشر محتوى ليظهر هنا»، وهي دعوةٌ إلى عملٍ قد
     يكون مبذولاً فعلاً ولم يصل خبرُه. */
  const [err, setErr] = useState('');
  function load() {
    setErr('');
    api.get('/analytics/performance').then(setPerf).catch((e: any) => setErr(e.message));
  }
  useEffect(load, []);
  const maxCreated = Math.max(1, ...(perf?.writers || []).map((w: any) => w.created_count || 0));

  if (err) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>أداء الفريق</h4>
        <p className="err" style={{ margin: 0 }}>{err}</p>
        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={load}>إعادة المحاولة</button>
      </div>
    );
  }

  return (
    <div className="grid cols-2" style={{ marginTop: 16 }}>
      <div className="card">
        <h4 style={{ marginTop: 0 }}>إنتاجية الكتّاب</h4>
        {(perf?.writers || []).map((w: any) => (
          <div key={w.id} style={{ marginBottom: 10 }}>
            <div className="row" style={{ fontSize: 'var(--text-xs)' }}>
              <span>{w.name}</span>
              <div className="spacer" />
              <span className="muted">
                <bdi>{w.created_count}</bdi> محتوى · <bdi>{w.published_count}</bdi> منشور · <bdi>{w.rejected_count}</bdi> مرفوض
              </span>
            </div>
            <Bar value={w.created_count} max={maxCreated} />
          </div>
        ))}
        {(perf?.writers || []).length === 0 && <p className="muted">لا أداء مسجّل بعد. انشر محتوى ليظهر هنا.</p>}
      </div>

      <div className="card">
        <h4 style={{ marginTop: 0 }}>سرعة اعتماد المراجعين والمديرين</h4>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>المستخدم</th><th>عدد الإجراءات</th><th>متوسط الوقت (ساعة)</th></tr></thead>
            <tbody>
              {(perf?.approvers || []).map((ap: any) => (
                <tr key={ap.id}>
                  <td>{ap.name}</td>
                  <td><bdi>{ap.actions_count}</bdi></td>
                  <td>{ap.avg_hours === null || ap.avg_hours === undefined ? '—' : <bdi>{ap.avg_hours}</bdi>}</td>
                </tr>
              ))}
              {(perf?.approvers || []).length === 0 && (
                <tr><td colSpan={3} className="muted">لا إجراءات اعتماد بعد.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ===== السمعة: متوسط التقييم وتوزيع النجوم ومعدل الرد والاتجاه ===== */
export function ReputationCard() {
  const [rep, setRep] = useState<any>(null);
  // تُخفي نفسها بلا تقييمات — انظر `StaleAlerts` لسبب الصمت
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
        <div className="card stat"><div className="num"><RatingValue value={t.avg_rating} size={16} /></div><div className="label">متوسط التقييم</div></div>
        <div className="card stat"><div className="num"><bdi>{formatNumber(t.count)}</bdi></div><div className="label">عدد التقييمات</div></div>
        <div className="card stat"><div className="num"><bdi>{formatNumber(t.negative)}</bdi></div><div className="label">تقييمات سلبية</div></div>
        <div className="card stat"><div className="num"><bdi>{t.reply_rate}%</bdi></div><div className="label">نسبة الرد على التقييمات</div></div>
      </div>

      <div className="grid cols-2">
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 8 }}>توزيع النجوم</div>
          {[5, 4, 3, 2, 1].map((star) => {
            const n = dist.find((d) => Number(d.rating) === star)?.count || 0;
            return (
              <div key={star} style={{ marginBottom: 6 }}>
                <div className="row" style={{ fontSize: 'var(--text-xs)' }}>
                  <span><RatingValue value={star} size={16} /></span>
                  <div className="spacer" />
                  <span className="muted"><bdi>{n}</bdi></span>
                </div>
                <Bar value={n} max={maxDist} />
              </div>
            );
          })}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 8 }}>اتجاه المتوسط الشهري</div>
          {trend.length === 0 && (
            <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>العيّنة لا تكفي للاستنتاج. تزداد الدقّة كلما اتّسعت البيانات.</p>
          )}
          {trend.map((m) => (
            <div key={m.month} style={{ marginBottom: 6 }}>
              <div className="row" style={{ fontSize: 'var(--text-xs)' }}>
                <span><bdi>{m.month}</bdi></span>
                <div className="spacer" />
                <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <RatingValue value={m.avg_rating} size={16} /> · <bdi>{m.count}</bdi>
                </span>
              </div>
              <Bar value={Number(m.avg_rating)} max={5} />
            </div>
          ))}
          <div className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 10 }}>
            معدل الرد على كل التفاعلات: <strong><bdi>{rep.engagement?.reply_rate}%</bdi></strong>{' '}
            (<bdi>{rep.engagement?.replied}</bdi> من <bdi>{rep.engagement?.total}</bdi>)
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== خريطة الحرارة =====
   ليست رقماً بل مخرَجٌ بصريّ من أداة قياسٍ خارجية، فلا بطاقةَ رقم لها بل
   زرُّ فتح. والزرّ لا يظهر ما لم يُضبط الرابط: زرٌّ معطَّل يُنقر مرّاتٍ
   قبل أن يُفهم أنه لا يعمل. */
export function HeatmapLink() {
  const [url, setUrl] = useState('');
  // تُخفي نفسها بلا رابط — انظر `StaleAlerts` لسبب الصمت
  useEffect(() => { api.get('/analytics/heatmap').then((d) => setUrl(d.url || '')).catch(() => {}); }, []);
  if (!url) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row">
        <h4 style={{ margin: 0 }}>خريطة الحرارة</h4>
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          أين ينقر الزائر وأين يتوقف بصره في صفحة الخدمات
        </span>
        <div className="spacer" />
        <a className="btn sm ghost" href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={20} /> فتح خريطة الحرارة
        </a>
      </div>
    </div>
  );
}

/* ===== أفضل أوقات النشر — من الأداء الفعلي بتوقيت الرياض ===== */
const DAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** الوقت بنظام ٢٤ ساعة مع عزل اتجاهي — قاعدة التنسيق في naf-terms §٥ */
function hourLabel(h: number): string {
  return `⁨${String(h).padStart(2, '0')}:00⁩`;
}

export function BestTimesCard({ platform }: { platform: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    const q = platform ? `?platform=${encodeURIComponent(platform)}` : '';
    // تُخفي نفسها بلا عيّنة — انظر `StaleAlerts` لسبب الصمت
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
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          بتوقيت الرياض · من <bdi>{data.sample}</bdi> منشوراً
        </span>
      </div>
      {!data.enough && (
        <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          العيّنة لا تكفي للاستنتاج. تزداد الدقّة كلما اتّسعت البيانات.
        </p>
      )}
      <div className="grid cols-2" style={{ marginTop: 10 }}>
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 8 }}>حسب اليوم</div>
          {days.map((d) => (
            <div key={d.day} style={{ marginBottom: 6 }}>
              <div className="row" style={{ fontSize: 'var(--text-xs)' }}>
                <span>{DAY_AR[d.day] || d.day}</span>
                <div className="spacer" />
                <span className="muted"><bdi>{d.avg_engagement}</bdi> تفاعل · <bdi>{d.posts}</bdi></span>
              </div>
              <Bar value={d.avg_engagement} max={maxDay} />
            </div>
          ))}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 8 }}>أفضل الساعات</div>
          {topHours.map((h) => (
            <div key={h.hour} style={{ marginBottom: 6 }}>
              <div className="row" style={{ fontSize: 'var(--text-xs)' }}>
                <span>{hourLabel(h.hour)}</span>
                <div className="spacer" />
                <span className="muted"><bdi>{h.avg_engagement}</bdi> تفاعل · <bdi>{h.posts}</bdi></span>
              </div>
              <Bar value={h.avg_engagement} max={maxHour} />
            </div>
          ))}
          {days[0] && topHours[0] && (
            <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 10 }}>
              الأفضل: <strong>{DAY_AR[days[0].day]}</strong> عند <strong>{hourLabel(topHours[0].hour)}</strong>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== تصدير تحليلات الفيديو (يوتيوب/تيك توك) عبر SocialAPI ===== */
export function VideoAnalyticsExport({ onImported }: { onImported: () => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [exports, setExports] = useState<any[]>([]);
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);

  function load() {
    /* هذه فتحها المستخدم بنفسه، فالصمت فيها ليس تخفّياً بل سؤالٌ بلا
       جواب: لوحةٌ خاوية بعد نقرةٍ صريحة تُقرأ «لا حسابات» وقد يكون
       المزوّد متعذّراً. والشاشة تملك `setMsg` أصلاً. */
    api.get('/analytics/exports').then((d) => {
      setAccounts(d.accounts || []);
      setExports(d.exports || []);
      if (!account && d.accounts?.[0]) setAccount(d.accounts[0].id);
    }).catch((e: any) => setMsg(e.message));
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
      if (d.pending) setMsg(`التصدير لم يكتمل بعد (${isolate(d.status)}). أعد المحاولة لاحقاً.`);
      else { setMsg(`تم استيراد ${isolate(d.imported)} فيديو إلى اللوحة.`); onImported(); }
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  const done = (s: string) => ['completed', 'complete', 'done'].includes(s);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <button type="button" className="row row-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <h4 style={{ margin: 0 }}>
          <FileOutput size={16} style={{ verticalAlign: -3, marginInlineEnd: 6 }} /> تصدير تحليلات الفيديو
        </h4>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>{open ? 'إخفاء' : 'عرض'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 0 }}>
            تحليلات فيديو أعمق (مشاهدات وتفاعل لكل فيديو) عبر SocialAPI. خاضع لحدود خطتك.
          </p>
          {accounts.length === 0 ? (
            <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>لا حسابات فيديو مربوطة. اربط يوتيوب أو تيك توك من الإعدادات.</p>
          ) : (
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <select className="select" style={{ maxWidth: 280 }} value={account} onChange={(e) => setAccount(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{platformLabel(a.platform)} — {a.name}</option>)}
              </select>
              <button className="btn sm" disabled={busy === 'create'} onClick={create}><FileOutput size={20} /> إنشاء تصدير</button>
              <button className="btn sm ghost" onClick={load}><RefreshCw size={20} /> تحديث الحالة</button>
            </div>
          )}
          {msg && <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>{msg}</p>}
          {exports.length > 0 && (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>المعرّف</th><th>الحالة</th><th>فيديوهات</th><th /></tr></thead>
                <tbody>
                  {exports.map((x) => (
                    <tr key={x.id}>
                      <td className="muted" style={{ fontSize: 'var(--text-xs)' }}><bdi>{String(x.id).slice(0, 10)}…</bdi></td>
                      <td>{x.status}</td>
                      <td>{x.videoCount ?? '—'}</td>
                      <td>
                        <button className={`btn sm${done(x.status) ? '' : ' ghost'}`} disabled={busy === x.id} onClick={() => ingest(x.id)}>
                          {done(x.status) ? 'استيراد' : 'فحص'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
