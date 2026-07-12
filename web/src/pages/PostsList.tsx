import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Plus } from 'lucide-react';
import { api, STATUS_LABELS, STATUS_BADGE, formatRiyadh } from '../api';
import { useAuth } from '../auth';

export default function PostsList() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  function load() {
    api.get('/posts' + (status ? `?status=${status}` : '')).then((d) => setPosts(d.posts));
  }
  useEffect(load, [status]);

  function canDelete(p: any) {
    return can('content.approve_final') || (['draft', 'rejected'].includes(p.status) && p.author_id === user?.id);
  }

  async function remove(id: string) {
    if (!confirm('حذف هذا المحتوى نهائياً؟ لا يمكن التراجع.')) return;
    setErr('');
    try {
      await api.del(`/posts/${id}`);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">المحتوى</h1>
          <p className="page-sub" style={{ margin: 0 }}>جميع المنشورات والمسودات</p>
        </div>
        <div className="spacer" />
        {can('draft.edit') && (
          <button className="btn" onClick={() => navigate('/editor')}><Plus size={16} /> محتوى جديد</button>
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
          <div className="spacer" />
          {err && <span className="err">{err}</span>}
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
              <th></th>
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
                <td onClick={(e) => e.stopPropagation()}>
                  {canDelete(p) && (
                    <button className="btn danger sm" onClick={() => remove(p.id)} title="حذف"><Trash2 size={14} /></button>
                  )}
                </td>
              </tr>
            ))}
            {posts.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>لا يوجد محتوى</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SOURCE: Record<string, string> = { manual: 'يدوي', ai: 'ذكاء اصطناعي', rss: 'خبر RSS' };
const TYPE: Record<string, string> = { text: 'نص', image: 'صورة', video: 'فيديو' };
