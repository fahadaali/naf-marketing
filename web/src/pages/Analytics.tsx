import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { isolate } from '../lib/format';
import MetricCard, { type MetricReading } from '../components/MetricCard';
import { CADENCE_LABELS, LAYERS, PERIOD_LABELS } from '../metrics';
import { DateRangePicker } from '../components/DatePicker';
import { platformLabel } from '../platforms';
import Catalogue from './analytics/Catalogue';
import Spend from './analytics/Spend';
import {
  BestTimesCard, CampaignPerformance, HeatmapLink, PipelineStatus, PlatformBreakdown,
  ReputationCard, StaleAlerts, TeamPerformance, TopPosts, VideoAnalyticsExport,
  type DashboardData,
} from './analytics/panels';

/* ============================================================
   التحليلات — مبنيّةٌ على «دليل مؤشرات التسويق والتحليل».

   كانت شاشةً واحدة طويلة تعرض ما يعرفه مزوّد النشر عن المنشورات: الوصول
   والظهور والتفاعل وأفضل المنشورات. وهي الطبقتان الأوليان من عشر، وأخفُّهما
   أثراً في قرار الإيراد.

   وهي الآن اثنتا عشرة تبويبة بترتيب الدليل — من الأعلى ظهوراً إلى الأعمق
   أثراً — تصدّرها اللوحة المختصرة: عشرة أرقام تُراجَع أسبوعياً وما عداها
   شهرياً أو ربعياً. وألواحُ المنصة القديمة لم تسقط، بل نزل كلٌّ منها إلى
   طبقته: الأداء حسب المنصة في «الوصول»، وأفضل المنشورات والأوقات والسمعة
   في «التفاعل»، وخطُّ الإنتاج وأداء الفريق في «التشغيل».

   والتبويبات نصٌّ بلا أيقونة — القرار مكتوب في `naf-icons.md`.
   ============================================================ */

const PERIODS = ['weekly', 'monthly', 'quarterly', 'annual'] as const;
type PeriodKind = (typeof PERIODS)[number];

/** الطبقات التي تحمل ألواحاً من بيانات المنصة نفسها إضافةً إلى مؤشراتها. */
const PANEL_LAYERS = new Set(['reach', 'engagement', 'operations', 'cost']);

export default function Analytics() {
  const { can } = useAuth();
  const canManage = can('metrics.manage');

  const [tab, setTab] = useState<string>('board');
  const [period, setPeriod] = useState<PeriodKind>('monthly');
  const [start, setStart] = useState<string>('');
  const [metrics, setMetrics] = useState<MetricReading[]>([]);
  // مفتاح المؤشر ← قيمُه عبر الفترات، أقدمُها أوّلاً
  const [series, setSeries] = useState<Record<string, { period_start: string; value: number }[]>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // ألواح المنصة — فلاترها الخاصة باقية كما كانت
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [platform, setPlatform] = useState('');
  const [campaign, setCampaign] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);

  const isBoard = tab === 'board';
  const isCatalogue = tab === 'catalogue';

  function loadMetrics() {
    setLoading(true);
    const q = new URLSearchParams({ period });
    if (start) q.set('start', start);
    if (!isBoard && !isCatalogue) q.set('layer', tab);
    // والدليل يقرأ اللوحة لا الطبقات: لا يعرض أرقاماً وإنما يلزمه حدّ الفترة،
    // واللوحة عشرة أرقام و«الطبقات كلها» مئةٌ وستّة عشر.
    const path = isBoard || isCatalogue ? '/metrics/board' : '/metrics/layer';
    api.get(`${path}?${q}`)
      .then((d) => {
        const rows = d.metrics || [];
        setMetrics(rows);
        // الخادم يردّ حدود الفترة الفعلية — أيُّ يومٍ أُرسل يُردّ إلى بدايتها
        if (d.period?.start) setStart(d.period.start);
        loadSeries(rows.map((r: MetricReading) => r.key));
      })
      .catch((e) => setMsg(e.message))
      .finally(() => setLoading(false));
  }

  /* سلاسل خطّ الاتجاه — نداءٌ واحد لكل البطاقات لا واحدٌ لكلٍّ منها.
     ويسقط صامتاً: الخطّ زيادةٌ على الرقم لا شرطٌ لقراءته، فتعذّرُه لا
     يمنع اللوحة من الظهور. */
  function loadSeries(keys: string[]) {
    if (!keys.length) { setSeries({}); return; }
    api.get(`/metrics/series?period=${period}&keys=${encodeURIComponent(keys.join(','))}`)
      .then((d) => setSeries(d.series || {}))
      .catch(() => setSeries({}));
  }

  function loadDashboard() {
    const q = new URLSearchParams();
    if (platform) q.set('platform', platform);
    if (campaign) q.set('campaign_id', campaign);
    // حدود اليوم بتوقيت الرياض (UTC+3)
    if (from) q.set('from', new Date(`${from}T00:00:00+03:00`).toISOString());
    if (to) q.set('to', new Date(`${to}T23:59:59+03:00`).toISOString());
    api.get('/analytics/dashboard?' + q).then(setDash).catch(() => {});
  }

  useEffect(() => {
    api.get('/settings').then((d) => setPlatforms(d.settings?.enabled_platforms || [])).catch(() => {});
    api.get('/campaigns').then((d) => setCampaigns(d.campaigns || [])).catch(() => {});
  }, []);

  /* الدليل لا يعرض أرقاماً، لكنه يسجّلها — و«تسجيل» يرسل بداية الفترة مع
     القيمة. وتبديل الفترة يُسقط بدايتها لتُعاد من الخادم، فلو أُعفي الدليل
     من التحميل بقيت البداية فارغة وردّ الخادم «الفترة غير صالحة» على حفظٍ
     يبدو سليماً. فيُحمَّل مرّةً حين تنقصه البداية وحدها. */
  useEffect(() => { if (!isCatalogue || !start) loadMetrics(); }, [tab, period, start]);
  useEffect(() => { if (PANEL_LAYERS.has(tab)) loadDashboard(); }, [tab, platform, campaign, from, to]);

  /** يبدّل نوع الفترة ويُسقط بدايتها — فيعود الخادم بالفترة الجارية من النوع الجديد. */
  function pickPeriod(kind: PeriodKind) {
    setPeriod(kind);
    setStart('');
  }

  async function syncNow() {
    setMsg('جارٍ السحب…');
    try {
      const d = await api.post(`/metrics/sync?period=${period}${start ? `&start=${start}` : ''}`);
      const failed = (d.sources || []).filter((s: any) => !s.ok);
      setMsg(
        failed.length
          ? `تم السحب، وتعذّر السحب من ${isolate(failed.length)} مصدراً. راجع التكاملات.`
          : 'تم السحب',
      );
      loadMetrics();
      if (PANEL_LAYERS.has(tab)) loadDashboard();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">التحليلات</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            عشر طبقات — من الوصول إلى الإيراد. والفئة تُقرأ مع الرقم.
          </p>
        </div>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        {canManage && (
          <button className="btn ghost" onClick={syncNow}><RefreshCw size={20} /> سحب الآن</button>
        )}
      </div>

      {/* الفترة — تحكم كل رقم في الشاشة، فتسبق التبويبات */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>الفترة</label>
            <div className="seg">
              {PERIODS.map((p) => (
                <button key={p} type="button" className={period === p ? 'on' : ''} onClick={() => pickPeriod(p)}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
          <div className="spacer" />
          {start && (
            <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
              تبدأ <bdi>{start}</bdi> · {CADENCE_LABELS[period]}
            </span>
          )}
        </div>
      </div>

      <nav className="metric-tabs" aria-label="طبقات التحليل">
        {LAYERS.map((l) => (
          <button
            key={l.key}
            type="button"
            className={tab === l.key ? 'on' : ''}
            aria-current={tab === l.key ? 'page' : undefined}
            onClick={() => setTab(l.key)}
          >
            {l.label}
          </button>
        ))}
      </nav>

      {isCatalogue ? (
        <Catalogue canManage={canManage} period={period} start={start} onChanged={loadMetrics} />
      ) : (
        <>
          {isBoard && (
            <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 0 }}>
              عشرة أرقام تُراجَع أسبوعياً. وما عداها في تبويبات الطبقات، يُراجَع شهرياً أو ربعياً.
            </p>
          )}

          {loading ? (
            <p className="muted">جارٍ التحميل…</p>
          ) : metrics.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>لا مؤشر في هذه الطبقة بعد. اربط مصدراً أو سجّل أول قيمة.</p>
            </div>
          ) : (
            <div className="grid cols-3">
              {metrics.map((m) => (
                <MetricCard key={m.key} m={m} series={series[m.key]?.map((p) => p.value)} />
              ))}
            </div>
          )}

          {/* ألواح المنصة — فلاترها الخاصة تظهر معها لا فوق الشاشة كلها */}
          {PANEL_LAYERS.has(tab) && (
            <>
              {(tab === 'reach' || tab === 'engagement') && (
                <div className="card" style={{ margin: '16px 0' }}>
                  <div className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label>نطاق ألواح المنصة</label>
                      <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                    </div>
                    <div className="field" style={{ margin: 0, minWidth: 160 }}>
                      <label htmlFor="an-platform">المنصة</label>
                      <select id="an-platform" className="select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                        <option value="">كل المنصات</option>
                        {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
                      </select>
                    </div>
                    <div className="field" style={{ margin: 0, minWidth: 160 }}>
                      <label htmlFor="an-campaign">الحملة</label>
                      <select id="an-campaign" className="select" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
                        <option value="">كل الحملات</option>
                        {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'reach' && (
                <div className="grid cols-2">
                  <PlatformBreakdown data={dash} />
                  <CampaignPerformance data={dash} />
                </div>
              )}

              {tab === 'engagement' && (
                <>
                  <BestTimesCard platform={platform} />
                  <HeatmapLink />
                  <TopPosts data={dash} />
                  <div style={{ marginTop: 16 }}>
                    <ReputationCard />
                    <VideoAnalyticsExport onImported={loadMetrics} />
                  </div>
                </>
              )}

              {tab === 'cost' && (
                <Spend canManage={canManage} period={period} start={start} onSaved={loadMetrics} />
              )}

              {tab === 'operations' && (
                <div style={{ marginTop: 16 }}>
                  <PipelineStatus data={dash} />
                  <StaleAlerts />
                  <TeamPerformance />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
