import { useEffect, useState } from 'react';
import { RefreshCw, Send, MessageCircle, Mail } from 'lucide-react';
import { api, formatRiyadh } from '../api';
import { PlatformIcon, platformLabel } from '../platforms';

// إدارة التعليقات والرسائل المباشرة على منصات التواصل — مزامنة من المزوّد مع إمكانية الرد.
export default function Comments() {
  const [comments, setComments] = useState<any[]>([]);
  const [filter, setFilter] = useState<'' | '0' | '1'>('');
  const [msg, setMsg] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>('');

  function load() {
    const q = filter ? `?replied=${filter}` : '';
    api.get(`/comments${q}`).then((d) => setComments(d.comments));
  }
  useEffect(load, [filter]);

  async function refresh() {
    setMsg('جارٍ الجلب…');
    try {
      const d = await api.post('/comments/refresh');
      setMsg(`تم جلب ${d.added} عنصراً جديداً`);
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function reply(id: string) {
    const text = replyDrafts[id];
    if (!text?.trim()) return;
    setBusy(id);
    try {
      await api.post(`/comments/${id}/reply`, { text: text.trim() });
      setReplyDrafts((d) => ({ ...d, [id]: '' }));
      load();
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
          <h1 className="page-title">التعليقات والرسائل</h1>
          <p className="page-sub" style={{ margin: 0 }}>تعليقات ورسائل مباشرة على المنشورات المنشورة عبر المنصات</p>
        </div>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        <button className="btn ghost" onClick={refresh}><RefreshCw size={15} /> جلب الآن</button>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <div className="seg">
          <button className={filter === '' ? 'on' : ''} onClick={() => setFilter('')}>الكل</button>
          <button className={filter === '0' ? 'on' : ''} onClick={() => setFilter('0')}>بلا رد</button>
          <button className={filter === '1' ? 'on' : ''} onClick={() => setFilter('1')}>تم الرد</button>
        </div>
      </div>

      <div className="grid" style={{ gap: 12 }}>
        {comments.map((c) => (
          <div className="card" key={c.id}>
            <div className="row" style={{ marginBottom: 8 }}>
              <PlatformIcon platform={c.platform} size={22} />
              <div>
                <div style={{ fontWeight: 600 }}>{c.author_name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {platformLabel(c.platform)} · {c.kind === 'dm' ? <span className="row" style={{ display: 'inline-flex', gap: 4 }}><Mail size={12} /> رسالة مباشرة</span> : <span className="row" style={{ display: 'inline-flex', gap: 4 }}><MessageCircle size={12} /> تعليق</span>} · {c.post_title}
                </div>
              </div>
              <div className="spacer" />
              <span className="muted" style={{ fontSize: 12 }}>{formatRiyadh(c.created_at)}</span>
            </div>
            <p style={{ margin: '0 0 12px' }}>{c.body}</p>

            {c.reply_body ? (
              <div className="card" style={{ background: 'hsl(var(--primary-soft))', padding: 10 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  ردّ {c.replier_name} — {formatRiyadh(c.replied_at)}
                </div>
                {c.reply_body}
              </div>
            ) : (
              <div className="row">
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="اكتب رداً…"
                  value={replyDrafts[c.id] || ''}
                  onChange={(e) => setReplyDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && reply(c.id)}
                />
                <button className="btn sm" disabled={busy === c.id || !replyDrafts[c.id]?.trim()} onClick={() => reply(c.id)}>
                  <Send size={14} /> إرسال
                </button>
              </div>
            )}
          </div>
        ))}
        {comments.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>لا توجد تعليقات أو رسائل بعد — جرّب «جلب الآن».</p>}
      </div>
    </div>
  );
}
