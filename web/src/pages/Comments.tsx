import { useEffect, useState } from 'react';
import { RefreshCw, Send, MessageCircle, Mail, AtSign, Star, EyeOff, Eye, Trash2, ThumbsUp, Lock, Sparkles, Pencil } from 'lucide-react';
import { api, formatRiyadh } from '../api';
import { PlatformIcon, platformLabel } from '../platforms';

// إدارة التعليقات والرسائل والإشارات والتقييمات — مزامنة من المزوّد مع الرد والاقتراحات الذكية والإشراف.
type Caps = Record<string, boolean>;
function parseCaps(v: any): Caps {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v) || {}; } catch { return {}; }
}

function kindMeta(kind: string) {
  switch (kind) {
    case 'dm': return { icon: <Mail size={12} />, label: 'رسالة مباشرة' };
    case 'mention': return { icon: <AtSign size={12} />, label: 'إشارة' };
    case 'review': return { icon: <Star size={12} />, label: 'تقييم' };
    default: return { icon: <MessageCircle size={12} />, label: 'تعليق' };
  }
}

export default function Comments() {
  const [comments, setComments] = useState<any[]>([]);
  const [counts, setCounts] = useState<{ all: number; unreplied: number; replied: number }>({ all: 0, unreplied: 0, replied: 0 });
  const [filter, setFilter] = useState<'' | '0' | '1'>('');
  const [msg, setMsg] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [privateMode, setPrivateMode] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<Record<string, string>>({}); // id → نص التعديل
  const [busy, setBusy] = useState<string>('');

  function load() {
    const q = filter ? `?replied=${filter}` : '';
    api.get(`/comments${q}`).then((d) => { setComments(d.comments); if (d.counts) setCounts(d.counts); });
  }
  useEffect(load, [filter]);

  async function refresh() {
    setMsg('جارٍ الجلب…');
    try {
      const d = await api.post('/comments/refresh');
      setMsg(`تم جلب ${d.added} عنصراً`);
      load();
    } catch (e: any) { setMsg(e.message); }
  }

  async function reply(id: string) {
    const text = replyDrafts[id];
    if (!text?.trim()) return;
    setBusy(id);
    try {
      const path = privateMode[id] ? `/comments/${id}/private-reply` : `/comments/${id}/reply`;
      await api.post(path, { text: text.trim() });
      setReplyDrafts((d) => ({ ...d, [id]: '' }));
      setSuggestions((s) => ({ ...s, [id]: [] }));
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  async function suggest(id: string) {
    setBusy(`sg:${id}`);
    setMsg('');
    try {
      const d = await api.post(`/comments/${id}/suggest`);
      setSuggestions((s) => ({ ...s, [id]: d.suggestions || [] }));
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  async function moderate(id: string, action: 'hide' | 'unhide' | 'delete' | 'like') {
    if (action === 'delete' && !confirm('حذف هذا التعليق نهائياً؟')) return;
    setBusy(id);
    try {
      await api.post(`/comments/${id}/moderate`, { action });
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  async function saveEdit(id: string) {
    const text = editing[id];
    if (!text?.trim()) return;
    setBusy(id);
    try {
      await api.patch(`/comments/${id}/reply`, { text: text.trim() });
      setEditing((e) => { const n = { ...e }; delete n[id]; return n; });
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  async function removeReply(id: string) {
    if (!confirm('حذف ردّك من المنصة؟')) return;
    setBusy(id);
    try {
      await api.del(`/comments/${id}/reply`);
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  const tab = (key: '' | '0' | '1', label: string, n: number) => (
    <button className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
      {label} <span className="count-pill">{n}</span>
    </button>
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">التعليقات والرسائل</h1>
          <p className="page-sub" style={{ margin: 0 }}>تعليقات ورسائل وإشارات وتقييمات على منصات التواصل</p>
        </div>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        <button className="btn ghost" onClick={refresh}><RefreshCw size={15} /> جلب الآن</button>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <div className="seg">
          {tab('', 'الكل', counts.all)}
          {tab('0', 'بلا رد', counts.unreplied)}
          {tab('1', 'تم الرد', counts.replied)}
        </div>
      </div>

      <div className="grid" style={{ gap: 12 }}>
        {comments.map((c) => {
          const caps = parseCaps(c.capabilities_json);
          const km = kindMeta(c.kind);
          const isComment = c.kind === 'comment';
          const canPrivate = !!caps.can_private_reply;
          const canEditReply = isComment || c.kind === 'review'; // الرسائل/الإشارات لا تُعدَّل بعد الإرسال
          const sugg = suggestions[c.id] || [];
          return (
            <div className="card" key={c.id} style={c.is_hidden ? { opacity: 0.6 } : undefined}>
              <div className="row" style={{ marginBottom: 8 }}>
                <PlatformIcon platform={c.platform} size={22} />
                <div>
                  <div style={{ fontWeight: 600 }}>{c.author_name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {platformLabel(c.platform)} · <span className="row" style={{ display: 'inline-flex', gap: 4 }}>{km.icon} {km.label}</span>
                    {c.is_hidden ? ' · (مخفي)' : ''}{c.post_title ? ` · ${c.post_title}` : ''}
                  </div>
                </div>
                <div className="spacer" />
                <span className="muted" style={{ fontSize: 12 }}>{formatRiyadh(c.created_at)}</span>
              </div>
              <p style={{ margin: '0 0 12px' }}>{c.body}</p>

              {isComment && (caps.can_hide || caps.can_delete || caps.can_like) && (
                <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                  {caps.can_like && <button className="btn sm ghost" disabled={busy === c.id} onClick={() => moderate(c.id, 'like')} title="إعجاب"><ThumbsUp size={14} /></button>}
                  {caps.can_hide && (c.is_hidden
                    ? <button className="btn sm ghost" disabled={busy === c.id} onClick={() => moderate(c.id, 'unhide')} title="إظهار"><Eye size={14} /></button>
                    : <button className="btn sm ghost" disabled={busy === c.id} onClick={() => moderate(c.id, 'hide')} title="إخفاء"><EyeOff size={14} /></button>)}
                  {caps.can_delete && <button className="btn sm ghost" disabled={busy === c.id} onClick={() => moderate(c.id, 'delete')} title="حذف"><Trash2 size={14} /></button>}
                </div>
              )}

              {c.reply_body && editing[c.id] === undefined ? (
                <div className="card" style={{ background: 'hsl(var(--primary-soft))', padding: 10 }}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <div className="muted" style={{ fontSize: 12 }}>ردّ {c.replier_name || ''} — {formatRiyadh(c.replied_at)}</div>
                    <div className="spacer" />
                    {/* التعديل/الحذف مدعومان للتعليقات والتقييمات فقط — الرسائل والإشارات لا تُعدَّل بعد الإرسال */}
                    {canEditReply && (
                      <>
                        <button className="btn sm ghost" disabled={busy === c.id} onClick={() => setEditing((e) => ({ ...e, [c.id]: c.reply_body }))} title="تعديل الرد"><Pencil size={13} /></button>
                        <button className="btn sm ghost" disabled={busy === c.id} onClick={() => removeReply(c.id)} title="حذف الرد"><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                  {c.reply_body}
                </div>
              ) : editing[c.id] !== undefined ? (
                <div className="row">
                  <input
                    className="input" style={{ flex: 1 }} value={editing[c.id]}
                    onChange={(e) => setEditing((d) => ({ ...d, [c.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(c.id)}
                  />
                  <button className="btn sm" disabled={busy === c.id || !editing[c.id]?.trim()} onClick={() => saveEdit(c.id)}>حفظ</button>
                  <button className="btn sm ghost" onClick={() => setEditing((e) => { const n = { ...e }; delete n[c.id]; return n; })}>إلغاء</button>
                </div>
              ) : (
                <div>
                  {sugg.length > 0 && (
                    <div className="grid" style={{ gap: 6, marginBottom: 8 }}>
                      {sugg.map((s, i) => (
                        <button key={i} className="suggest-chip" onClick={() => setReplyDrafts((d) => ({ ...d, [c.id]: s }))} title="استخدام هذا الاقتراح">
                          <Sparkles size={12} style={{ flexShrink: 0, opacity: 0.7 }} /> <span>{s}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="row">
                    <input
                      className="input" style={{ flex: 1 }}
                      placeholder={privateMode[c.id] ? 'رد خاص لصاحب التعليق…' : 'اكتب رداً…'}
                      value={replyDrafts[c.id] || ''}
                      onChange={(e) => setReplyDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && reply(c.id)}
                    />
                    <button className="btn sm ghost" disabled={busy === `sg:${c.id}`} onClick={() => suggest(c.id)} title="اقتراحات ذكية للرد">
                      <Sparkles size={14} /> {busy === `sg:${c.id}` ? '…' : 'اقتراح'}
                    </button>
                    <button className="btn sm" disabled={busy === c.id || !replyDrafts[c.id]?.trim()} onClick={() => reply(c.id)}>
                      <Send size={14} /> إرسال
                    </button>
                  </div>
                  {isComment && canPrivate && (
                    <label className="muted" style={{ fontSize: 12, display: 'inline-flex', gap: 6, marginTop: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!privateMode[c.id]} onChange={(e) => setPrivateMode((d) => ({ ...d, [c.id]: e.target.checked }))} />
                      <Lock size={12} /> رد خاص (رسالة مباشرة لصاحب التعليق)
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {comments.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>لا توجد عناصر بعد — جرّب «جلب الآن».</p>}
      </div>
    </div>
  );
}
