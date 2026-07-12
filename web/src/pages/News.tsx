import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatRiyadh } from '../api';
import { useAuth } from '../auth';

// خلاصة الأخبار — عرض العناصر المجلوبة مع «تحويل إلى مسودة» وخيار الصياغة عبر Claude.
export default function News() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [news, setNews] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get('/rss/news').then((d) => setNews(d.news));
  }
  useEffect(load, []);

  async function refresh() {
    setMsg('');
    try {
      const d = await api.post('/rss/refresh');
      setMsg(`تم جلب ${d.added} خبراً جديداً`);
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function toDraft(item: any, rewrite: boolean) {
    setBusy(item.id);
    try {
      let body = `<p>${(item.summary || '').replace(/\n/g, '<br/>')}</p><p><a href="${item.link}">${item.link}</a></p>`;
      if (rewrite) {
        const d = await api.post(`/rss/news/${item.id}/rewrite`, { tone: 'formal', length: 'medium' });
        body = `<p>${d.text.replace(/\n/g, '<br/>')}</p>`;
      }
      const params = new URLSearchParams({ news: item.id, title: item.title || 'خبر', body });
      navigate(`/editor?${params.toString()}`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">خلاصة الأخبار</h1>
          <p className="page-sub" style={{ margin: 0 }}>أخبار من خلاصات RSS المعتمدة</p>
        </div>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        {can('settings.manage') && <button className="btn ghost" onClick={refresh}>🔄 تحديث الآن</button>}
      </div>

      <div className="grid cols-2">
        {news.map((n) => (
          <div className="card" key={n.id}>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className="badge gray">{n.feed_title || 'RSS'}</span>
              <div className="spacer" />
              <span className="muted" style={{ fontSize: 12 }}>{formatRiyadh(n.published_at || n.created_at)}</span>
            </div>
            <a href={n.link} target="_blank" rel="noreferrer"><strong>{n.title}</strong></a>
            <p className="muted" style={{ fontSize: 13, maxHeight: 66, overflow: 'hidden' }}>{stripHtml(n.summary)}</p>
            <div className="row">
              {n.converted_post_id ? (
                <span className="badge green">حوّل إلى مسودة</span>
              ) : can('draft.edit') ? (
                <>
                  <button className="btn sm" disabled={!!busy} onClick={() => toDraft(n, false)}>تحويل إلى مسودة</button>
                  {can('ai.generate') && (
                    <button className="btn gold sm" disabled={busy === n.id} onClick={() => toDraft(n, true)}>
                      {busy === n.id ? '…' : '✨ صياغة ثم تحويل'}
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </div>
        ))}
        {news.length === 0 && <p className="muted">لا توجد أخبار — أضِف خلاصات RSS من الإعدادات ثم حدّث.</p>}
      </div>
    </div>
  );
}

function stripHtml(s: string) {
  return (s || '').replace(/<[^>]+>/g, '').slice(0, 220);
}
