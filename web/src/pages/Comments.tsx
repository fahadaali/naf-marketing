import { isolate } from '../lib/format';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Send, MessageCircle, Mail, AtSign, Star, EyeOff, Eye, Trash2, ThumbsUp, Lock, Sparkles, Pencil, TriangleAlert, ChevronLeft, ChevronRight, BellOff, ExternalLink, Paperclip } from 'lucide-react';
import { uploadMedia } from '../mediaUpload';
import { api, formatRiyadh } from '../api';
import { RatingScale } from '../components/Rating';
import { PlatformIcon, platformLabel } from '../platforms';
import ConfirmModal from '../components/ConfirmModal';
import { DateRangePicker } from '../components/DatePicker';

// إدارة التعليقات والرسائل والإشارات والتقييمات — مزامنة من المزوّد مع الرد والاقتراحات الذكية والإشراف.
type Caps = Record<string, boolean>;
function parseCaps(v: any): Caps {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v) || {}; } catch { return {}; }
}

/** ردٌّ في سلسلة التعليق كما يحفظه الخادم (`services/inboxThread.ts`). */
type ThreadEntry = {
  id: string; author: string; own: boolean; body: string; at: string | null; here?: boolean;
  attachments?: { type: string; url: string }[];
};

/** اسمُ المرفق كما يُعرض — نظيرُ `attachmentLabel` في `src/adapters/ayrshare.ts`. */
function attachmentLabel(type: string): string {
  switch ((type || '').toLowerCase()) {
    case 'image': case 'sticker': return 'صورة مرفقة';
    case 'video': case 'reel': return 'مقطع مرفق';
    case 'audio': return 'تسجيل صوتي';
    case 'file': return 'ملف مرفق';
    default: return 'مرفق';
  }
}

/** ما يظهر من سجلّ المحادثة الخاصة قبل «عرض الرسائل السابقة». */
const DM_VISIBLE = 4;
function parseThread(v: any): ThreadEntry[] {
  if (!v) return [];
  try {
    const a = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(a) ? a.filter((e) => e && typeof e.body === 'string') : [];
  } catch { return []; }
}

function kindMeta(kind: string) {
  switch (kind) {
    case 'dm': return { icon: <Mail size={16} />, label: 'رسالة مباشرة' };
    case 'mention': return { icon: <AtSign size={16} />, label: 'إشارة' };
    case 'review': return { icon: <Star size={16} />, label: 'تقييم' };
    default: return { icon: <MessageCircle size={16} />, label: 'تعليق' };
  }
}

/** تقرير آخر سحبٍ للصندوق كما يحفظه الخادم — ما يلزم الشاشة منه وحده. */
type SyncReport = {
  ok: boolean;
  complete: boolean;
  lastOkAt: string | null;
  errors: string[];
};

/* سطر حالة الصندوق: متى نجح آخر سحب، وسببُ العطل إن وقع، وهل وقف السحب
   دون آخره. وكان الصندوق يُسحب أو يسقط صامتاً، فلا يعرف من فتح الشاشة
   أغاب التعليق لأنه لم يصل، أم لأن السحب لم يبلغه. */
function SyncLine({ sync }: { sync: SyncReport | null }) {
  if (!sync) return null;
  return (
    <div className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-3)', display: 'grid', gap: 'var(--space-1)' }}>
      <span>
        {sync.lastOkAt ? <>آخر سحبٍ ناجح <bdi>{formatRiyadh(sync.lastOkAt)}</bdi></> : 'لم يُسحب بعد'}
        {!sync.ok && sync.errors[0] && <> — {sync.errors[0]}</>}
      </span>
      {sync.ok && !sync.complete && (
        <span className="row" style={{ gap: 'var(--space-2)' }}>
          <TriangleAlert size={16} style={{ color: 'var(--warning-strong)', flexShrink: 0 }} aria-hidden="true" />
          لم يكتمل السحب. يُستكمل الباقي في السحب التالي.
        </span>
      )}
    </div>
  );
}

/* التبويبات: «متجاهَل» ما لم يُردّ عليه ولا يحتاج ردّاً — يخرج من «بلا رد»
   ولا يُحذف، ويعود بـ«إلغاء التجاهل». */
type Filter = '' | '0' | '1' | 'ignored';

export default function Comments() {
  const [comments, setComments] = useState<any[]>([]);
  const [counts, setCounts] = useState<{ all: number; unreplied: number; replied: number; ignored: number }>({ all: 0, unreplied: 0, replied: 0, ignored: 0 });
  const [sync, setSync] = useState<SyncReport | null>(null);
  const [filter, setFilter] = useState<Filter>('');
  // المنصة ومصدر الرد — «ردّ من خارج المنصة» ما كتبه الفريق في تطبيق المنصة نفسها
  const [platform, setPlatform] = useState('');
  const [source, setSource] = useState<'' | 'external' | 'platform'>('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  // النطاق يوماً بيوم كما يختاره المنتقي، والصفحة منه — والقديم محفوظٌ يُرى بنطاقه
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [msg, setMsg] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [privateMode, setPrivateMode] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<Record<string, string>>({}); // id → نص التعديل
  const [busy, setBusy] = useState<string>('');
  /* نافذة تأكيدٍ من المنصة لا مربّع المتصفح — العلّة في `ConfirmModal`.
     والحذفان مختلفان: حذفُ تعليقِ قارئٍ من المنصة، وحذفُ ردّنا نحن. */
  const [confirming, setConfirming] = useState<{ kind: 'comment' | 'reply'; id: string } | null>(null);
  // المحادثات الخاصة التي فُتح سجلّها كاملاً
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // مرفق الردّ على رسالةٍ خاصة — يُرفع إلى المكتبة ثم يُرسل معه. وحقل ملفٍّ واحد
  // للصندوق كلّه: الزرّ يُركَّز بلوحة المفاتيح، والحقل مخفيّ
  const [attached, setAttached] = useState<Record<string, { id: string; filename: string }>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef('');

  function load() {
    const q = new URLSearchParams();
    if (filter) q.set('replied', filter);
    if (platform) q.set('platform', platform);
    if (source) q.set('source', source);
    // حدود اليوم بتوقيت الرياض (UTC+3) — كما في لوحة التحليلات
    if (from) q.set('from', new Date(`${from}T00:00:00+03:00`).toISOString());
    if (to) q.set('to', new Date(`${to}T23:59:59+03:00`).toISOString());
    if (page > 1) q.set('page', String(page));
    const qs = q.toString() ? `?${q}` : '';
    api.get(`/comments${qs}`).then((d) => {
      setComments(d.comments);
      setHasMore(!!d.hasMore);
      if (d.counts) setCounts(d.counts);
      if (Array.isArray(d.platforms)) setPlatforms(d.platforms);
      setSync(d.sync ?? null);
    });
  }
  useEffect(load, [filter, platform, source, from, to, page]);

  async function refresh() {
    setMsg('جارٍ الجلب…');
    try {
      const d = await api.post('/comments/refresh');
      setMsg(`تم جلب ${isolate(d.added)} عنصراً`);
      load();
    } catch (e: any) { setMsg(e.message); }
  }

  async function reply(id: string) {
    const text = replyDrafts[id] || '';
    const file = attached[id];
    if (!text.trim() && !file) return;
    setBusy(id);
    try {
      const path = privateMode[id] ? `/comments/${id}/private-reply` : `/comments/${id}/reply`;
      await api.post(path, file ? { text: text.trim(), media_id: file.id } : { text: text.trim() });
      setReplyDrafts((d) => ({ ...d, [id]: '' }));
      setAttached((d) => { const n = { ...d }; delete n[id]; return n; });
      setSuggestions((s) => ({ ...s, [id]: [] }));
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  async function attach(id: string, file: File | undefined) {
    if (!file) return;
    setBusy(`at:${id}`);
    setMsg('');
    try {
      const d = await uploadMedia<{ id: string; filename?: string }>(file);
      setAttached((a) => ({ ...a, [id]: { id: d.id, filename: d.filename || file.name } }));
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
    setConfirming(null);
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
    setConfirming(null);
    setBusy(id);
    try {
      await api.del(`/comments/${id}/reply`);
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  async function setIgnored(id: string, on: boolean) {
    setBusy(id);
    setMsg('');
    try {
      if (on) await api.post(`/comments/${id}/ignore`);
      else await api.del(`/comments/${id}/ignore`);
      if (on) setMsg('تم التجاهل');
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  const tab = (key: Filter, label: string, n: number) => (
    <button className={filter === key ? 'on' : ''} onClick={() => { setFilter(key); setPage(1); }}>
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
        <button className="btn ghost" onClick={refresh}><RefreshCw size={20} /> جلب الآن</button>
      </div>

      <SyncLine sync={sync} />

      <div className="row" style={{ marginBottom: 'var(--space-4)', alignItems: 'flex-end' }}>
        <div className="seg">
          {tab('', 'الكل', counts.all)}
          {tab('0', 'بلا رد', counts.unreplied)}
          {tab('1', 'تم الرد', counts.replied)}
          {tab('ignored', 'متجاهَل', counts.ignored)}
        </div>
        <div className="spacer" />
        <div className="field" style={{ margin: 0, minWidth: 160 }}>
          <label htmlFor="cm-platform">المنصة</label>
          <select id="cm-platform" className="select" value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }}>
            <option value="">كل منصات التواصل</option>
            {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 160 }}>
          <label htmlFor="cm-source">مصدر الرد</label>
          <select id="cm-source" className="select" value={source} onChange={(e) => { setSource(e.target.value as typeof source); setPage(1); }}>
            <option value="">كل الردود</option>
            <option value="external">ردّ من خارج المنصة</option>
            <option value="platform">ردّ من هذه المنصة</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>الفترة</label>
          <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); setPage(1); }} />
        </div>
      </div>

      <div className="grid" style={{ gap: 12 }}>
        {comments.map((c) => {
          const caps = parseCaps(c.capabilities_json);
          const km = kindMeta(c.kind);
          const isComment = c.kind === 'comment';
          const canPrivate = !!caps.can_private_reply;
          const external = c.reply_source === 'external';
          /* الرسائل/الإشارات لا تُعدَّل بعد الإرسال. وردٌّ على تعليقٍ كُتب في تطبيق
             المنصّة لا يُعدَّل من هنا: تعديلُ التعليق إرسالُ ردٍّ جديد وحذفُ القديم،
             وحذفُ ما لم يُكتب من هنا يُسقط ردّاً لا يعرف كاتبُه أنه سقط. والتقييم
             يُعدَّل ردُّه في موضعه أيّاً كان كاتبه. */
          const canEditReply = (isComment && !external) || c.kind === 'review';
          const sugg = suggestions[c.id] || [];
          const thread = parseThread(c.thread_json);
          /* ردٌّ محفوظ لا يظهر في السلسلة — ما قبلها، أو رسالةٌ ومراجعة لا سلسلة لهما —
             يُعرض في فقاعته كما كان. وما في السلسلة يُعرض فيها وحدها. */
          const replyInThread = thread.some((e) => e.own && ((!!e.id && e.id === c.reply_provider_id) || e.body === c.reply_body));
          // يوتيوب وثريدز لا يُردّ عليهما عبر Ayrshare — والغياب نعم: مزوّدٌ لا يُعلن قدراته
          const canReply = caps.can_reply !== false;
          return (
            <div className="card" key={c.id} style={c.is_hidden ? { opacity: 0.6 } : undefined}>
              <div className="row" style={{ marginBottom: 8 }}>
                <PlatformIcon platform={c.platform} size={16} />
                <div>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {c.author_name}
                    {c.rating != null && <RatingScale value={c.rating} size={16} />}
                  </div>
                  <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                    {platformLabel(c.platform)} · <span className="row" style={{ display: 'inline-flex', gap: 4 }}>{km.icon} {km.label}</span>
                    {c.is_hidden ? ' · (مخفي)' : ''}
                    {c.post_title && (c.post_url
                      ? <> · <a href={c.post_url} target="_blank" rel="noreferrer" className="row" style={{ display: 'inline-flex', gap: 4 }}>
                          {c.post_title} <ExternalLink size={16} aria-hidden="true" />
                        </a></>
                      : ` · ${c.post_title}`)}
                  </div>
                </div>
                <div className="spacer" />
                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>{formatRiyadh(c.created_at)}</span>
              </div>
              {/* المحادثة الخاصة يُعرض سجلّها وفيه آخرُ ما كتبه العميل — فلا يتكرّر في سطرٍ فوقه */}
              {!(c.kind === 'dm' && thread.some((e) => !e.own)) && <p style={{ margin: '0 0 var(--space-3)' }}>{c.body}</p>}

              {isComment && (caps.can_hide || caps.can_delete || caps.can_like) && (
                <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                  {caps.can_like && <button className="btn sm ghost" disabled={busy === c.id} onClick={() => moderate(c.id, 'like')} title="إعجاب"><ThumbsUp size={20} /></button>}
                  {caps.can_hide && (c.is_hidden
                    ? <button className="btn sm ghost" disabled={busy === c.id} onClick={() => moderate(c.id, 'unhide')} title="إظهار"><Eye size={20} /></button>
                    : <button className="btn sm ghost" disabled={busy === c.id} onClick={() => moderate(c.id, 'hide')} title="إخفاء"><EyeOff size={20} /></button>)}
                  {caps.can_delete && <button className="btn sm ghost" disabled={busy === c.id} onClick={() => setConfirming({ kind: 'comment', id: c.id })} title="حذف"><Trash2 size={20} /></button>}
                </div>
              )}

              {thread.length > 0 && (
                <div className="grid" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  {c.kind === 'dm' && thread.length > DM_VISIBLE && !expanded[c.id] && (
                    <button type="button" className="btn sm ghost" style={{ justifySelf: 'start' }} aria-expanded={false}
                      onClick={() => setExpanded((d) => ({ ...d, [c.id]: true }))}>
                      <span>عرض الرسائل السابقة (<bdi>{thread.length - DM_VISIBLE}</bdi>)</span>
                    </button>
                  )}
                  {(c.kind === 'dm' && !expanded[c.id] ? thread.slice(-DM_VISIBLE) : thread).map((e, i) => {
                    const current = e.own && !!e.id && e.id === c.reply_provider_id && canEditReply && !!c.reply_body;
                    return (
                      <div key={e.id || i} className="card" style={{ background: e.own ? 'var(--primary-soft)' : 'var(--muted)', padding: 'var(--space-2) var(--space-3)' }}>
                        <div className="row" style={{ marginBottom: 'var(--space-1)' }}>
                          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                            {e.own
                              ? (e.here ? <>ردّ {e.author}</> : 'ردّ من خارج المنصة')
                              : <span style={{ fontWeight: 600 }}>{e.author}</span>}
                            {e.at && <> — <bdi>{formatRiyadh(e.at)}</bdi></>}
                          </div>
                          <div className="spacer" />
                          {current && editing[c.id] === undefined && (
                            <>
                              <button className="btn sm ghost" disabled={busy === c.id} onClick={() => setEditing((d) => ({ ...d, [c.id]: c.reply_body }))} title="تعديل الرد"><Pencil size={20} /></button>
                              <button className="btn sm ghost" disabled={busy === c.id} onClick={() => setConfirming({ kind: 'reply', id: c.id })} title="حذف الرد"><Trash2 size={20} /></button>
                            </>
                          )}
                        </div>
                        {(() => {
                          /* مرفقات الرسالة روابطُ إلى منصتها تُفتح في نافذةٍ جديدة. والرسالة بلا نصٍّ
                             نصُّها اسمُ مرفقها (`attachmentLabel`) — فيُعرض الرابط وحده لا الاسم مرّتين. */
                          const atts = (e.attachments || []).filter((a) => a.url);
                          const onlyAttachment = atts.length > 0 && e.body === attachmentLabel(atts[0].type);
                          return (
                            <>
                              {!onlyAttachment && e.body}
                              {atts.map((a, j) => (
                                <div key={j}>
                                  <a href={a.url} target="_blank" rel="noreferrer" className="row" style={{ display: 'inline-flex', gap: 4 }}>
                                    {attachmentLabel(a.type)} <ExternalLink size={16} aria-hidden="true" />
                                  </a>
                                </div>
                              ))}
                            </>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              )}

              {c.reply_body && replyInThread && editing[c.id] === undefined ? null : c.reply_body && editing[c.id] === undefined ? (
                <div className="card" style={{ background: 'var(--primary-soft)', padding: 10 }}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                      {external ? 'ردّ من خارج المنصة' : <>ردّ {c.replier_name || ''}</>}
                      {c.replied_at && <> — {formatRiyadh(c.replied_at)}</>}
                    </div>
                    <div className="spacer" />
                    {/* التعديل/الحذف مدعومان للتعليقات والتقييمات فقط — الرسائل والإشارات لا تُعدَّل بعد الإرسال */}
                    {canEditReply && (
                      <>
                        <button className="btn sm ghost" disabled={busy === c.id} onClick={() => setEditing((e) => ({ ...e, [c.id]: c.reply_body }))} title="تعديل الرد"><Pencil size={20} /></button>
                        <button className="btn sm ghost" disabled={busy === c.id} onClick={() => setConfirming({ kind: 'reply', id: c.id })} title="حذف الرد"><Trash2 size={20} /></button>
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
              ) : c.ignored_at ? (
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  <span className="muted row" style={{ gap: 'var(--space-1)', fontSize: 'var(--text-xs)' }}>
                    <BellOff size={16} aria-hidden="true" /> متجاهَل
                  </span>
                  <div className="spacer" />
                  <button className="btn sm ghost" disabled={busy === c.id} onClick={() => setIgnored(c.id, false)}>إلغاء التجاهل</button>
                </div>
              ) : !canReply ? (
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                    الردّ على تعليقات {platformLabel(c.platform)} من تطبيقها، ويظهر هنا بعد السحب.
                  </span>
                  <div className="spacer" />
                  <button className="btn sm ghost" disabled={busy === c.id} onClick={() => setIgnored(c.id, true)}>
                    <BellOff size={20} /> تجاهل
                  </button>
                </div>
              ) : (
                <div>
                  {sugg.length > 0 && (
                    <div className="grid" style={{ gap: 6, marginBottom: 8 }}>
                      {sugg.map((s, i) => (
                        <button key={i} className="suggest-chip" onClick={() => setReplyDrafts((d) => ({ ...d, [c.id]: s }))} title="استخدام هذا الاقتراح">
                          <Sparkles size={20} style={{ flexShrink: 0, opacity: 0.7 }} /> <span>{s}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* يلتفّ على الشاشة الضيّقة: كان الحقل ينضغط بين الأزرار الثلاثة إلى حرفين */}
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <input
                      className="input" style={{ flex: '1 1 auto' }}
                      placeholder={privateMode[c.id] ? 'رد خاص لصاحب التعليق…' : 'اكتب رداً…'}
                      value={replyDrafts[c.id] || ''}
                      onChange={(e) => setReplyDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && reply(c.id)}
                    />
                    <button className="btn sm ghost" disabled={busy === `sg:${c.id}`} onClick={() => suggest(c.id)} title="اقتراحات ذكية للرد">
                      <Sparkles size={20} /> {busy === `sg:${c.id}` ? '…' : 'اقتراح'}
                    </button>
                    {/* المرفق للرسالة الخاصة من Ayrshare وحدها — «Send Message» يقبله وتعليق المنشور لا */}
                    {c.kind === 'dm' && String(c.provider_comment_id || '').startsWith('ayd|') && !attached[c.id] && (
                      <button type="button" className="btn sm ghost" disabled={busy === `at:${c.id}`}
                        onClick={() => { pickFor.current = c.id; fileRef.current?.click(); }}>
                        <Paperclip size={20} /> {busy === `at:${c.id}` ? 'جارٍ الرفع…' : 'إرفاق ملف'}
                      </button>
                    )}
                    <button className="btn sm" disabled={busy === c.id || (!replyDrafts[c.id]?.trim() && !attached[c.id])} onClick={() => reply(c.id)}>
                      <Send size={20} /> إرسال
                    </button>
                    <button className="btn sm ghost" disabled={busy === c.id} onClick={() => setIgnored(c.id, true)}>
                      <BellOff size={20} /> تجاهل
                    </button>
                  </div>
                  {attached[c.id] && (
                    <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
                      <Paperclip size={16} aria-hidden="true" />
                      <bdi>{attached[c.id].filename}</bdi>
                      <button className="btn sm ghost" title="حذف المرفق" aria-label="حذف المرفق"
                        onClick={() => setAttached((d) => { const n = { ...d }; delete n[c.id]; return n; })}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                  {isComment && canPrivate && (
                    <label className="muted" style={{ fontSize: 'var(--text-xs)', display: 'inline-flex', gap: 6, marginTop: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!privateMode[c.id]} onChange={(e) => setPrivateMode((d) => ({ ...d, [c.id]: e.target.checked }))} />
                      <Lock size={16} /> رد خاص (رسالة مباشرة لصاحب التعليق)
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <input ref={fileRef} type="file" hidden
          onChange={(e) => { attach(pickFor.current, e.target.files?.[0]); e.target.value = ''; }} />
        {comments.length === 0 && (
          <p className="muted" style={{ textAlign: 'center' }}>
            {from || to ? 'لا عنصر في هذه الفترة. وسّع النطاق الزمني.' : 'لا تعليقات بعد. اضغط «جلب الآن» لسحب أحدث التعليقات.'}
          </p>
        )}
      </div>

      {(page > 1 || hasMore) && (
        <div className="row" style={{ justifyContent: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <button type="button" className="btn ghost sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
            <ChevronRight size={20} className="chev-dir" aria-hidden="true" /> السابق
          </button>
          <button type="button" className="btn ghost sm" disabled={!hasMore} onClick={() => setPage(page + 1)}>
            التالي <ChevronLeft size={20} className="chev-dir" aria-hidden="true" />
          </button>
        </div>
      )}

      {confirming?.kind === 'comment' && (
        <ConfirmModal
          title="حذف التعليق"
          message="يُحذف التعليق من المنصة نفسها، فلا يراه أحد بعدها. لا يمكن التراجع عن هذا."
          actionLabel="حذف"
          danger
          onConfirm={() => moderate(confirming.id, 'delete')}
          onClose={() => setConfirming(null)}
        />
      )}

      {confirming?.kind === 'reply' && (
        <ConfirmModal
          title="حذف الرد"
          message="يُحذف ردّك من المنصة ويبقى التعليق. لا يمكن التراجع عن هذا."
          actionLabel="حذف"
          danger
          onConfirm={() => removeReply(confirming.id)}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
