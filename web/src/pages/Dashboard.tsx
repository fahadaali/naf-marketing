import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, STATUS_LABELS, STATUS_BADGE, formatRiyadh, displayStatus } from '../api';
import { useAuth } from '../auth';

export default function Dashboard() {
  const { user, can } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [dash, setDash] = useState<any>(null);

  useEffect(() => {
    api.get('/posts').then((d) => setPosts(d.posts));
    if (can('analytics.view')) api.get('/analytics/dashboard').then(setDash).catch(() => {});
  }, []);

  const pipeline = STATUS_ORDER.map((s) => ({
    status: s,
    count: posts.filter((p) => p.status === s).length,
  }));

  return (
    <div>
      <h1 className="page-title">مرحباً، {user?.name}</h1>
      <p className="page-sub">نظرة عامة على خط إنتاج المحتوى والأداء</p>

      {/* حالة خط الإنتاج */}
      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        {pipeline.map((p) => (
          <div className="card stat" key={p.status}>
            <div className="num">{p.count}</div>
            <div className="label">
              <span className={`badge ${STATUS_BADGE[p.status]}`}>{STATUS_LABELS[p.status]}</span>
            </div>
          </div>
        ))}
      </div>

      {can('analytics.view') && dash && (
        <div className="grid cols-4" style={{ marginBottom: 20 }}>
          <Stat label="إجمالي الوصول" value={dash.totals?.reach ?? 0} />
          <Stat label="الانطباعات" value={dash.totals?.impressions ?? 0} />
          <Stat label="التفاعل" value={dash.totals?.engagement ?? 0} />
          <Stat label="معدل التفاعل" value={`${dash.totals?.engagement_rate ?? 0}%`} />
        </div>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>أحدث المحتوى</h3>
          <div className="spacer" />
          <Link to="/posts" className="btn ghost sm">الكل</Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>العنوان</th>
              <th>الحالة</th>
              <th>الكاتب</th>
              <th>آخر تحديث</th>
            </tr>
          </thead>
          <tbody>
            {posts.slice(0, 8).map((p) => (
              <tr key={p.id}>
                <td><Link to={`/editor/${p.id}`}>{p.title}</Link></td>
                <td><span className={`badge ${STATUS_BADGE[displayStatus(p)]}`}>{STATUS_LABELS[displayStatus(p)]}</span></td>
                <td>{p.author_name}</td>
                <td className="muted">{formatRiyadh(p.updated_at)}</td>
              </tr>
            ))}
            {posts.length === 0 && (
              <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>لا يوجد محتوى بعد</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STATUS_ORDER = ['draft', 'pending_marketing', 'pending_gm', 'scheduled', 'published', 'rejected'];

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card stat">
      <div className="num">{typeof value === 'number' ? value.toLocaleString('ar-EG') : value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
