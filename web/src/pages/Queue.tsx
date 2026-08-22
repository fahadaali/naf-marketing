import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatRiyadh } from '../api';
import StatusBadge from '../components/StatusBadge';

// طابور الاعتماد — المنشورات بانتظار مراجعة/اعتماد.
export default function Queue() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<any[]>([]);
  /* الفشل يُقال ولا يُبتلع: طابورٌ لم يصل يبدو طابوراً فارغاً بالضبط،
     فيقرأ المراجع «لا شيء بانتظاري» وعنده ما ينتظره. */
  const [err, setErr] = useState('');

  function load() {
    setErr('');
    api.get('/posts/queue')
      .then((d) => setPosts(d.posts))
      .catch((e: any) => setErr(e.message));
  }
  useEffect(load, []);

  return (
    <div>
      <h1 className="page-title">طابور الاعتماد</h1>
      <p className="page-sub">المحتوى المنتظر للمراجعة أو الاعتماد النهائي</p>

      {err && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p className="err" style={{ margin: 0 }}>{err}</p>
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={load}>إعادة المحاولة</button>
        </div>
      )}

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
                <td><StatusBadge status={p.status} /></td>
                <td className="muted">{formatRiyadh(p.updated_at)}</td>
                <td><button className="btn sm" onClick={() => navigate(`/editor/${p.id}`)}>مراجعة</button></td>
              </tr>
            ))}
            {posts.length === 0 && !err && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>لا محتوى بانتظار الاعتماد. الطابور فارغ.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
