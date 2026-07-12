import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, STATUS_LABELS, STATUS_BADGE, formatRiyadh } from '../api';

// طابور الاعتماد — المنشورات بانتظار مراجعة/اعتماد.
export default function Queue() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<any[]>([]);

  useEffect(() => {
    api.get('/posts/queue').then((d) => setPosts(d.posts)).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="page-title">طابور الاعتماد</h1>
      <p className="page-sub">المحتوى المنتظر للمراجعة أو الاعتماد النهائي</p>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>العنوان</th>
              <th>الكاتب</th>
              <th>المرحلة</th>
              <th>منذ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td>
                <td>{p.author_name}</td>
                <td><span className={`badge ${STATUS_BADGE[p.status]}`}>{STATUS_LABELS[p.status]}</span></td>
                <td className="muted">{formatRiyadh(p.updated_at)}</td>
                <td><button className="btn sm" onClick={() => navigate(`/editor/${p.id}`)}>مراجعة</button></td>
              </tr>
            ))}
            {posts.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>لا يوجد محتوى بانتظار الاعتماد</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
