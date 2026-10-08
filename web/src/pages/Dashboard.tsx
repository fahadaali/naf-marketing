import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../lib/format';
import { api, formatRiyadh, displayStatus } from '../api';
import StatusBadge from '../components/StatusBadge';
import { PlatformIcons, platformsOf } from '../platforms';
import MetricCard, { type MetricReading } from '../components/MetricCard';
import { useAuth } from '../auth';

/* لوحة التحكم — اللوحة المختصرة أوّلاً ثم خطّ الإنتاج ثم أحدث المحتوى.

   كانت تفتح على ستّ بطاقات تعدّ المسودات في مراحلها، ثم أربعة أرقام: الوصول
   والظهور والتفاعل ومعدله. وستّها الأولى تصف كفاءة عمل، وأربعتُها الثانية
   تصف اتساع وصول — ولا واحد منها يقول إن كان الشهر أنتج عملاء.

   فصدرُ الشاشة الآن العشرةُ التي يقول الدليل إنها تُراجَع أسبوعياً، وخطُّ
   الإنتاج تحتها: هو عملُ اليوم لمن يفتح اللوحة، لا مقياسُ نتيجته.

   ثم صارت العشرةُ بتوزيعها ومرجعياتها وقراراتها، وسبعُ بطاقاتٍ للإنتاج،
   شاشةَ تحليلاتٍ ثانية. فالرئيسية تحمل أوّل أربعةٍ مربوطة بترتيبها المعتمد
   — الاسم والرقم واتجاهه — وخطَّ الإنتاج سطراً واحداً. والتفصيل كلّه، وما لم
   يُربط مصدره، في التحليلات. */

/** كم مؤشراً من اللوحة المختصرة تحمله الرئيسية. */
const HOME_METRICS = 4;

const STATUS_ORDER = ['idea', 'draft', 'pending_marketing', 'pending_gm', 'scheduled', 'published', 'rejected'];

/** مرحلة المنشور في خطّ الإنتاج: حالته المعروضة، و«متأخر» داخل «مجدول» كما كان. */
const stageOf = (p: any) => {
  const s = displayStatus(p);
  return s === 'late' ? 'scheduled' : s;
};

export default function Dashboard() {
  const { user, can } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [board, setBoard] = useState<MetricReading[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(true);
  /* الفشل يُقال ولا يُبتلع: مسارُ الإنتاج يُرسم بأصفارٍ في كل مرحلة حين
     لا تصل القائمة — وهو شكلُ «لا محتوى بعد» نفسه بالضبط. */
  const [postsErr, setPostsErr] = useState('');
  // واللوحة كذلك: «لا قيمة مسجّلة» دعوةٌ إلى الربط، وقولُها على انقطاعٍ
  // يرسل القارئ إلى شاشة التكاملات يبحث عن عطلٍ ليس فيها.
  const [boardErr, setBoardErr] = useState('');
  // سلاسل خطّ الاتجاه — نداءٌ واحد بعد وصول اللوحة، ويسقط صامتاً:
  // الخطّ زيادةٌ على الرقم لا شرطٌ لقراءته.
  const [series, setSeries] = useState<Record<string, { period_start: string; value: number }[]>>({});

  function loadPosts() {
    setPostsErr('');
    api.get('/posts').then((d) => setPosts(d.posts)).catch((e: any) => setPostsErr(e.message));
  }

  useEffect(() => {
    loadPosts();
    if (can('analytics.view')) {
      api.get('/metrics/board?period=weekly')
        .then((d) => {
          // الردّ مرتّبٌ بترتيب اللوحة المعتمد — فالأوائل من المربوط هم الأهمّ
          const rows: MetricReading[] = (d.metrics || [])
            .filter((m: MetricReading) => m.connected)
            .slice(0, HOME_METRICS);
          setBoard(rows);
          if (!rows.length) return;
          const keys = rows.map((r) => r.key).join(',');
          // الصمت قرار: خطّ الاتجاه زيادةٌ على الرقم لا شرطٌ لقراءته
          api.get(`/metrics/series?period=weekly&keys=${encodeURIComponent(keys)}`)
            .then((sd) => setSeries(sd.series || {}))
            .catch(() => {});
        })
        .catch((e: any) => setBoardErr(e.message))
        .finally(() => setLoadingBoard(false));
    } else {
      setLoadingBoard(false);
    }
  }, []);

  const pipeline = STATUS_ORDER.map((s) => ({
    status: s,
    count: posts.filter((p) => stageOf(p) === s).length,
  }));

  return (
    <div>
      <h1 className="page-title">مرحباً، {user?.name}</h1>
      <p className="page-sub">نظرة عامة على المؤشرات القيادية وخط إنتاج المحتوى</p>

      {can('analytics.view') && (
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <div className="row" style={{ marginBottom: 'var(--space-3)' }}>
            <h3 style={{ margin: 0 }}>اللوحة المختصرة</h3>
            <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>هذا الأسبوع</span>
            <div className="spacer" />
            <Link to="/analytics" className="btn ghost sm">التحليلات</Link>
          </div>

          {loadingBoard ? (
            <p className="muted">جارٍ التحميل…</p>
          ) : boardErr ? (
            <div className="card">
              <p className="err" style={{ margin: 0 }}>{boardErr}</p>
            </div>
          ) : board.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                لا قيمة مسجّلة لهذه الفترة. اربط مصادر المؤشرات أو سجّل أول قيمة من شاشة التحليلات.
              </p>
            </div>
          ) : (
            <div className="grid cols-4">
              {board.map((m) => (
                <MetricCard key={m.key} m={m} series={series[m.key]?.map((p) => p.value)} compact />
              ))}
            </div>
          )}
        </section>
      )}

      <section style={{ marginBottom: 'var(--space-6)' }}>
        <h3 style={{ marginTop: 0, marginBottom: 'var(--space-3)' }}>خط إنتاج المحتوى</h3>
        {postsErr ? (
          /* لا أصفارٌ حين لا تصل القائمة: صفرٌ في كل مرحلة رقمٌ يُقرأ
             حقيقةً، وهو هنا غيابُ خبرٍ لا خبرُ غياب. */
          <div className="card">
            <p className="err" style={{ margin: 0 }}>{postsErr}</p>
            <button className="btn ghost sm" style={{ marginTop: 'var(--space-2)' }} onClick={loadPosts}>إعادة المحاولة</button>
          </div>
        ) : (
          /* سطرٌ واحد لا سبعُ بطاقات: المراحل تُقرأ متجاورةً كما تجري */
          <div className="card">
            <div className="row pipeline-strip">
              {pipeline.map((p) => (
                <span className="row pipeline-stage" key={p.status}>
                  <StatusBadge status={p.status} />
                  <strong><bdi>{formatNumber(p.count)}</bdi></strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>أحدث المحتوى</h3>
          <div className="spacer" />
          <Link to="/posts" className="btn ghost sm">الكل</Link>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>العنوان</th><th>الحالة</th><th>الكاتب</th><th>آخر تحديث</th></tr>
            </thead>
            <tbody>
              {posts.slice(0, 8).map((p) => (
                <tr key={p.id}>
                  <td>
                    <PlatformIcons platforms={platformsOf(p)} className="platforms-above" />
                    <Link to={`/editor/${p.id}`}>{p.title}</Link>
                  </td>
                  <td><StatusBadge status={displayStatus(p)} /></td>
                  <td>{p.author_name}</td>
                  <td className="muted"><bdi>{formatRiyadh(p.updated_at)}</bdi></td>
                </tr>
              ))}
              {posts.length === 0 && (
                <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>لم تُنشئ أي محتوى بعد. ابدأ بأول محتوى.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
