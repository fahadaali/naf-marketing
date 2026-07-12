import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api, STATUS_LABELS, STATUS_BADGE, PLATFORM_LABELS, formatRiyadh } from '../api';
import { useAuth } from '../auth';
import RichEditor from '../components/RichEditor';
import Modal from '../components/Modal';

export default function Editor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [postId, setPostId] = useState<string | undefined>(id);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [contentType, setContentType] = useState('text');
  const [campaignId, setCampaignId] = useState('');
  const [status, setStatus] = useState('draft');
  const [rejectReason, setRejectReason] = useState('');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [showAI, setShowAI] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  async function loadPost(pid: string) {
    const d = await api.get(`/posts/${pid}`);
    setTitle(d.post.title);
    setBody(d.post.body);
    setContentType(d.post.content_type);
    setCampaignId(d.post.campaign_id || '');
    setStatus(d.post.status);
    setRejectReason(d.post.reject_reason || '');
    setApprovals(d.approvals);
    setSchedules(d.schedules);
  }

  useEffect(() => {
    api.get('/campaigns').then((d) => setCampaigns(d.campaigns));
    api.get('/settings').then((d) => setPlatforms(d.settings?.enabled_platforms || []));
    if (id) loadPost(id);
    // تحويل خبر إلى مسودة: يأتي عبر ?news=<id>&title=&body=
    if (!id && sp.get('news')) {
      setTitle(sp.get('title') || '');
      setBody(sp.get('body') || '');
    }
  }, [id]);

  const readOnly = !['draft', 'rejected'].includes(status) && !can('content.review');

  async function save() {
    setErr(''); setMsg('');
    try {
      if (!postId) {
        const d = await api.post('/posts', {
          title,
          body,
          content_type: contentType,
          campaign_id: campaignId || null,
          source: sp.get('news') ? 'rss' : 'manual',
          news_item_id: sp.get('news') || undefined,
        });
        setPostId(d.id);
        navigate(`/editor/${d.id}`, { replace: true });
      } else {
        await api.patch(`/posts/${postId}`, { title, body, content_type: contentType, campaign_id: campaignId || null });
      }
      setMsg('تم الحفظ');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function doAction(action: string, note?: string) {
    setErr(''); setMsg('');
    try {
      if (!postId) { await save(); }
      const pid = postId;
      if (!pid) return;
      const d = await api.post(`/posts/${pid}/action`, { action, note });
      setStatus(d.status);
      await loadPost(pid);
      setMsg('تم تنفيذ الإجراء');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function publishNow() {
    if (!postId) return;
    const pending = schedules.filter((s) => ['pending', 'failed'].includes(s.status));
    const earliest = pending
      .map((s) => new Date(s.scheduled_at).getTime())
      .sort((a, b) => a - b)[0];
    const isEarly = earliest && earliest > Date.now();
    const when = earliest ? formatRiyadh(new Date(earliest).toISOString()) : '';
    const confirmMsg = isEarly
      ? `تنبيه: الموعد المجدول لم يحن بعد (${when}).\nهل تريد النشر الآن فوراً على أي حال؟`
      : 'تأكيد النشر الآن؟';
    if (!confirm(confirmMsg)) return;
    setErr(''); setMsg('');
    try {
      const d = await api.post('/schedules/publish-now', { post_id: postId });
      await loadPost(postId);
      setStatus('published');
      setMsg(`تم النشر الآن (${d.published} منصة)` + (d.early ? ' — قبل الموعد' : ''));
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function deletePost() {
    if (!postId) return;
    if (!confirm('حذف هذا المحتوى نهائياً؟ لا يمكن التراجع.')) return;
    try {
      await api.del(`/posts/${postId}`);
      navigate('/posts');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function uploadMedia(file: File) {
    const form = new FormData();
    form.append('file', file);
    const d = await api.upload('/media', form);
    // إدراج مرجع الوسيط في المحتوى
    if (contentType === 'image') setBody(body + `<p><img src="${d.url}" style="max-width:100%"/></p>`);
    else setBody(body + `<p>📎 وسيط مرفوع: ${d.url}</p>`);
    setMsg('تم رفع الوسيط');
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="page-title">{postId ? 'تحرير المحتوى' : 'محتوى جديد'}</h1>
        <span className={`badge ${STATUS_BADGE[status]}`}>{STATUS_LABELS[status]}</span>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        {err && <span className="err">{err}</span>}
      </div>

      {status === 'rejected' && rejectReason && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 14, background: '#fdf3f2' }}>
          <strong className="err">سبب الرفض:</strong> {rejectReason}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 300px' }}>
        {/* المحرر */}
        <div className="card">
          <div className="field">
            <label>العنوان</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
          </div>

          <div className="row" style={{ marginBottom: 10 }}>
            {can('ai.generate') && (
              <button className="btn gold sm" type="button" onClick={() => setShowAI(true)} disabled={readOnly}>
                ✨ توليد بالذكاء الاصطناعي
              </button>
            )}
            {can('media.upload') && (
              <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
                📎 رفع وسيط
                <input type="file" hidden onChange={(e) => e.target.files?.[0] && uploadMedia(e.target.files[0])} />
              </label>
            )}
          </div>

          <div className="field">
            <label>المحتوى</label>
            {readOnly ? (
              <div className="rte" dangerouslySetInnerHTML={{ __html: body }} />
            ) : (
              <RichEditor value={body} onChange={setBody} placeholder="اكتب المحتوى، أو ولّده بالذكاء الاصطناعي..." />
            )}
          </div>

          {!readOnly && (
            <button className="btn" onClick={save}>💾 حفظ المسودة</button>
          )}
        </div>

        {/* اللوحة الجانبية */}
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>نوع المحتوى</label>
              <select className="select" value={contentType} onChange={(e) => setContentType(e.target.value)} disabled={readOnly}>
                <option value="text">نص</option>
                <option value="image">صورة</option>
                <option value="video">فيديو</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>الحملة</label>
              <select className="select" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={readOnly}>
                <option value="">بدون حملة</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* إجراءات دورة الحياة */}
          <div className="card" style={{ marginBottom: 14 }}>
            <h4 style={{ marginTop: 0 }}>الإجراءات</h4>
            <div className="grid" style={{ gap: 8 }}>
              {['draft', 'rejected'].includes(status) && can('content.submit') && postId && (
                <button className="btn" onClick={() => doAction('submit')}>📤 إرسال للمراجعة</button>
              )}
              {status === 'pending_marketing' && can('content.review') && (
                <>
                  <button className="btn success" onClick={() => doAction('approve')}>✅ اعتماد التسويق</button>
                  <button className="btn danger" onClick={() => setShowReject(true)}>✖ رفض</button>
                </>
              )}
              {status === 'pending_gm' && can('content.approve_final') && (
                <>
                  <button className="btn success" onClick={() => doAction('approve')}>✅ اعتماد نهائي</button>
                  <button className="btn danger" onClick={() => setShowReject(true)}>✖ رفض</button>
                </>
              )}
              {['approved', 'scheduled'].includes(status) && can('content.schedule') && (
                <button className="btn gold" onClick={() => setShowSchedule(true)}>🗓️ جدولة النشر</button>
              )}
              {status === 'scheduled' && can('content.approve_final') && schedules.some((s) => ['pending', 'failed'].includes(s.status)) && (
                <button className="btn success" onClick={publishNow}>🚀 نشر الآن</button>
              )}
              {status === 'published' && can('content.approve_final') && (
                <button className="btn ghost" onClick={() => doAction('archive')}>🗄️ أرشفة</button>
              )}
              {postId && (can('content.approve_final') || (['draft', 'rejected'].includes(status))) && (
                <button className="btn danger" onClick={deletePost}>🗑️ حذف المحتوى</button>
              )}
            </div>
          </div>

          {/* الجداول */}
          {schedules.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h4 style={{ marginTop: 0 }}>مواعيد النشر</h4>
              {schedules.map((s) => (
                <div key={s.id} className="row" style={{ fontSize: 13, marginBottom: 6 }}>
                  <span className="badge blue">{PLATFORM_LABELS[s.platform] || s.platform}</span>
                  <span className="muted">{formatRiyadh(s.scheduled_at)}</span>
                  <span className={`badge ${s.status === 'published' ? 'green' : s.status === 'failed' ? 'red' : 'gray'}`}>
                    {SCHED_STATUS[s.status]}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* سجل الموافقات */}
          {approvals.length > 0 && (
            <div className="card">
              <h4 style={{ marginTop: 0 }}>سجل الاعتماد</h4>
              {approvals.map((a) => (
                <div key={a.id} style={{ fontSize: 12, marginBottom: 8, borderRight: '2px solid var(--border)', paddingRight: 8 }}>
                  <div>{a.actor_name} → <span className={`badge ${STATUS_BADGE[a.to_status] || 'gray'}`}>{STATUS_LABELS[a.to_status] || a.to_status}</span></div>
                  {a.note && <div className="muted">{a.note}</div>}
                  <div className="muted">{formatRiyadh(a.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showAI && <AIModal platforms={platforms} onClose={() => setShowAI(false)} onResult={(t) => { setBody(body + `<p>${t.replace(/\n/g, '<br/>')}</p>`); setShowAI(false); }} />}
      {showReject && (
        <RejectModal
          onClose={() => setShowReject(false)}
          onReject={async (reason) => { setShowReject(false); await doAction('reject', reason); }}
        />
      )}
      {showSchedule && postId && (
        <ScheduleModal
          postId={postId}
          platforms={platforms}
          onClose={() => setShowSchedule(false)}
          onDone={async () => { setShowSchedule(false); await loadPost(postId); setStatus('scheduled'); }}
        />
      )}
    </div>
  );
}

const SCHED_STATUS: Record<string, string> = { pending: 'معلّق', processing: 'قيد النشر', published: 'منشور', failed: 'فشل' };

function AIModal({ platforms, onClose, onResult }: { platforms: string[]; onClose: () => void; onResult: (t: string) => void }) {
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState(platforms[0] || 'linkedin');
  const [tone, setTone] = useState('formal');
  const [length, setLength] = useState('medium');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function run() {
    setBusy(true); setErr('');
    try {
      const d = await api.post('/posts/ai/generate', { topic, platform, tone, length, language: 'العربية' });
      onResult(d.text);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="توليد نص بالذكاء الاصطناعي (Claude)" onClose={onClose}>
      <div className="field">
        <label>الموضوع / الفكرة</label>
        <textarea className="textarea" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="مثال: أهمية توثيق العقود التجارية للشركات الناشئة" />
      </div>
      <div className="grid cols-3">
        <div className="field">
          <label>المنصة</label>
          <select className="select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {platforms.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p] || p}</option>)}
          </select>
        </div>
        <div className="field">
          <label>النبرة</label>
          <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
            <option value="formal">رسمي</option>
            <option value="educational">تعليمي</option>
            <option value="teaser">تشويقي</option>
          </select>
        </div>
        <div className="field">
          <label>الطول</label>
          <select className="select" value={length} onChange={(e) => setLength(e.target.value)}>
            <option value="short">قصير</option>
            <option value="medium">متوسط</option>
            <option value="long">مطوّل</option>
          </select>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <button className="btn gold" onClick={run} disabled={busy || !topic}>{busy ? 'جارٍ التوليد…' : '✨ توليد وحقن في المحرر'}</button>
    </Modal>
  );
}

function RejectModal({ onClose, onReject }: { onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="رفض المحتوى" onClose={onClose}>
      <div className="field">
        <label>سبب الرفض (إلزامي)</label>
        <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <button className="btn danger" disabled={!reason.trim()} onClick={() => onReject(reason)}>تأكيد الرفض</button>
    </Modal>
  );
}

function ScheduleModal({ postId, platforms, onClose, onDone }: { postId: string; platforms: string[]; onClose: () => void; onDone: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [when, setWhen] = useState('');
  const [err, setErr] = useState('');

  function toggle(p: string) {
    setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  }

  async function submit() {
    setErr('');
    try {
      // الموعد يُدخل بتوقيت الرياض (UTC+3، بلا توقيت صيفي) بصرف النظر عن توقيت جهاز المستخدم.
      // نثبّت الإزاحة +03:00 ثم نحوّل إلى UTC ISO كي لا ينشر قبل وقته.
      const iso = new Date(`${when}:00+03:00`).toISOString();
      await api.post('/schedules', { post_id: postId, platforms: selected, scheduled_at: iso });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <Modal title="جدولة النشر" onClose={onClose}>
      <div className="field">
        <label>المنصات</label>
        <div className="row">
          {platforms.map((p) => (
            <button key={p} type="button" className={`btn sm ${selected.includes(p) ? '' : 'ghost'}`} onClick={() => toggle(p)}>
              {PLATFORM_LABELS[p] || p}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>الموعد (بتوقيت الرياض)</label>
        <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      {err && <p className="err">{err}</p>}
      <button className="btn gold" disabled={!selected.length || !when} onClick={submit}>تأكيد الجدولة</button>
    </Modal>
  );
}
