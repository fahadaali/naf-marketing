import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, STATUS_LABELS, STATUS_BADGE, formatRiyadh } from '../api';
import { useAuth } from '../auth';

export default function PostsList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<any[]>([]);
  const [status, setStatus] = useState('');

  function load() {
    api.get('/posts' + (status ? `?status=${status}` : '')).then((d) => setPosts(d.posts));
  }
  useEffect(load, [status]);

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">المحتوى</h1>
          <p className="page-sub" style={{ margin: 0 }}>جميع المنشورات والمسودات</p>
        </div>
        <div className="spacer" />
        {can('draft.edit') && (
          <button className="btn" onClick={() => navigate('/editor')}>+ محتوى جديد</button>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <select className="select" style={{ width: 240 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">كل الحالات</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>العنوان</th>
              <th>الحالة</th>
              <th>المصدر</th>
              <th>النوع</th>
              <th>الحملة</th>
              <th>آخر تحديث</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/editor/${p.id}`)}>
                <td>{p.title}</td>
                <td><span className={`badge ${STATUS_BADGE[p.status]}`}>{STATUS_LABELS[p.status]}</span></td>
                <td className="muted">{SOURCE[p.source] || p.source}</td>
                <td className="muted">{TYPE[p.content_type] || p.content_type}</td>
                <td className="muted">{p.campaign_name || '—'}</td>
                <td className="muted">{formatRiyadh(p.updated_at)}</td>
              </tr>
            ))}
            {posts.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center' }}>لا يوجد محتوى</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SOURCE: Record<string, string> = { manual: 'يدوي', ai: 'ذكاء اصطناعي', rss: 'خبر RSS' };
const TYPE: Record<string, string> = { text: 'نص', image: 'صورة', video: 'فيديو' };
