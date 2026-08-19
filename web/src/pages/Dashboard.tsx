import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../lib/format';
import { api, formatRiyadh, displayStatus } from '../api';
import StatusBadge from '../components/StatusBadge';
import MetricCard, { type MetricReading } from '../components/MetricCard';
import { useAuth } from '../auth';

/* لوحة التحكم — اللوحة المختصرة أوّلاً ثم خطّ الإنتاج ثم أحدث المحتوى.

   كانت تفتح على ستّ بطاقات تعدّ المسودات في مراحلها، ثم أربعة أرقام: الوصول
   والظهور والتفاعل ومعدله. وستّها الأولى تصف كفاءة عمل، وأربعتُها الثانية
   تصف اتساع وصول — ولا واحد منها يقول إن كان الشهر أنتج عملاء.

   فصدرُ الشاشة الآن العشرةُ التي يقول الدليل إنها تُراجَع أسبوعياً، وخطُّ
   الإنتاج تحتها: هو عملُ اليوم لمن يفتح اللوحة، لا مقياسُ نتيجته. */

const STATUS_ORDER = ['draft', 'pending_marketing', 'pending_gm', 'scheduled', 'published', 'rejected'];

export default function Dashboard() {
  const { user, can } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [board, setBoard] = useState<MetricReading[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(true);
  // سلاسل خطّ الاتجاه — نداءٌ واحد بعد وصول اللوحة، ويسقط صامتاً:
  // الخطّ زيادةٌ على الرقم لا شرطٌ لقراءته.
  const [series, setSeries] = useState<Record<string, { period_start: string; value: number }[]>>({});

  useEffect(() => {
    api.get('/posts').then((d) => setPosts(d.posts)).catch(() => {});
    if (can('analytics.view')) {
      api.get('/metrics/board?period=weekly')
        .then((d) => {
          const rows: MetricReading[] = d.metrics || [];
          setBoard(rows);
          if (!rows.length) return;
          const keys = rows.map((r) => r.key).join(',');
          api.get(`/metrics/series?period=weekly&keys=${encodeURIComponent(keys)}`)
            .then((sd) => setSeries(sd.series || {}))
            .catch(() => {});
        })
        .catch(() => {})
        .finally(() => setLoadingBoard(false));
    } else {
      setLoadingBoard(false);
    }
  }, []);

  const pipeline = STATUS_ORDER.map((s) => ({
    status: s,
    count: posts.filter((p) => p.status === s).length,
  }));

  return (
    <div>
      <h1 className="page-title">مرحباً، {user?.name}</h1>
      <p className="page-sub">نظرة عامة على المؤشرات القيادية وخط إنتاج المحتوى</p>

      {can('analytics.view') && (
        <section style={{ marginBottom: 24 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>اللوحة المختصرة</h3>
            <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>هذا الأسبوع</span>
            <div className="spacer" />
            <Link to="/analytics" className="btn ghost sm">التحليلات</Link>
          </div>

          {loadingBoard ? (
            <p className="muted">جارٍ التحميل…</p>
          ) : board.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                لا قيمة مسجّلة لهذه الفترة. اربط مصادر المؤشرات أو سجّل أول قيمة من شاشة التحليلات.
              </p>
            </div>
          ) : (
            <div className="grid cols-3">
              {board.map((m) => (
                <MetricCard key={m.key} m={m} series={series[m.key]?.map((p) => p.value)} />
              ))}
            </div>
          )}
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>خط إنتاج المحتوى</h3>
        <div className="grid cols-4">
          {pipeline.map((p) => (
            <div className="card stat" key={p.status}>
              <div className="num"><bdi>{formatNumber(p.count)}</bdi></div>
              <div className="label"><StatusBadge status={p.status} /></div>
            </div>
          ))}
        </div>
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
                  <td><Link to={`/editor/${p.id}`}>{p.title}</Link></td>
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
