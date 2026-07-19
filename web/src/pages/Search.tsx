import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon } from 'lucide-react';
import { api } from '../api';

// بحث نصي كامل عبر المحتوى وخلاصة الأخبار (FTS5)
export default function Search() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(sp.get('q') || '');
  const [posts, setPosts] = useState<any[]>([]);
  const [news, setNews] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = sp.get('q') || '';
    setQ(query);
    if (!query) return;
    setLoading(true);
    api.get(`/search?q=${encodeURIComponent(query)}`)
      .then((d) => { setPosts(d.posts || []); setNews(d.news || []); })
      .finally(() => setLoading(false));
  }, [sp]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSp({ q });
  }

  return (
    <div>
      <h1 className="page-title">البحث</h1>
      <p className="page-sub">بحث نصي كامل عبر كل المحتوى وخلاصة الأخبار</p>

      <form className="row" onSubmit={submit} style={{ marginBottom: 20, maxWidth: 480 }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب كلمات البحث…" />
        <button className="btn"><SearchIcon size={15} /> بحث</button>
      </form>

      {loading && <p className="muted">جارٍ البحث…</p>}

      {!loading && sp.get('q') && (
        <div className="grid cols-2">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>المحتوى ({posts.length})</h3>
            {posts.map((p) => (
              <div key={p.id} style={{ padding: '9px 0', borderBottom: '1px solid hsl(var(--border))', cursor: 'pointer' }} onClick={() => navigate(`/editor/${p.id}`)}>
                <div style={{ fontWeight: 600 }}>{p.title}</div>
                <div className="muted" style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: p.snippet }} />
              </div>
            ))}
            {posts.length === 0 && <p className="muted">لا نتائج</p>}
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>الأخبار ({news.length})</h3>
            {news.map((n) => (
              <div key={n.id} style={{ padding: '9px 0', borderBottom: '1px solid hsl(var(--border))' }}>
                <a href={n.link} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{n.title}</a>
                <div className="muted" style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: n.snippet }} />
              </div>
            ))}
            {news.length === 0 && <p className="muted">لا نتائج</p>}
          </div>
        </div>
      )}
    </div>
  );
}
