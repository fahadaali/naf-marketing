import { isolate } from '../lib/format';
import { useEffect, useRef, useState } from 'react';
import {
  Plus, Trash2, ArrowUp, ArrowDown, ArrowRight, Eye, Globe, Mail, Save, ExternalLink,
  Heading2, Type, Image as ImageIcon, SquareMousePointer, Quote, Minus, Send, MousePointerClick, Share2, FlaskConical,
  Images, CalendarClock,
} from 'lucide-react';
import { api, formatRiyadh } from '../api';
import { DeliveryBadge } from '../components/StateBadge';
import StatusBadge from '../components/StatusBadge';
import InlineToolbar from '../components/InlineToolbar';
import MediaPicker from '../components/MediaPicker';
import { DateTimePicker } from '../components/DatePicker';
import Modal from '../components/Modal';

/* قيم قالب البريد الحرفية — نسخة طبق الأصل من src/services/emailTheme.ts.
   لا يمكن استيراد ملف الخادم هنا (حزمتان منفصلتان)، فالنسخ مقصود
   وموضعه واحد. أي تغيير هناك يُنسخ هنا، وإلا كذبت المعاينة على المحرّر.
   استثناء قوالب البريد — CLAUDE.md §1. */
const EMAIL_PREVIEW = {
  background: '#E8EBED',
  card: '#FFFFFF',
  foreground: '#333333',
  radius: '12px',
  fontStack: "system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif",
} as const;

/* مهلة الحفظ التلقائي بعد آخر تغيير. ثانيتان: أقصر منها يحفظ في وسط
   الكلمة فيغرق D1 بكتابات، وأطول منها يجعل «تم الحفظ تلقائياً» تصل
   بعد أن ينصرف الكاتب عن الشاشة. */
const AUTOSAVE_MS = 2000;

// ===== النشرات والمقالات — مصدر واحد يُنشر بريداً وصفحةً عامة (ولاحقاً إكس/لينكدإن) =====

type Block =
  | { type: 'heading'; text: string; level?: 2 | 3 }
  | { type: 'text'; text: string }
  | { type: 'image'; mediaId?: string; url?: string; alt?: string; caption?: string }
  | { type: 'button'; text: string; url: string }
  | { type: 'quote'; text: string; cite?: string }
  | { type: 'divider' };


export default function Newsletters() {
  const [list, setList] = useState<any[]>([]);
  const [activeSubs, setActiveSubs] = useState(0);
  const [openId, setOpenId] = useState<string>('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get('/newsletters').then((d) => {
      setList(d.newsletters || []);
      setActiveSubs(d.active_subscribers || 0);
    }).catch((e) => setMsg(e.message));
  }
  useEffect(load, []);

  async function create() {
    const title = prompt('عنوان النشرة:');
    if (!title?.trim()) return;
    try {
      const d = await api.post('/newsletters', { title: title.trim() });
      load();
      setOpenId(d.id);
    } catch (e: any) { setMsg(e.message); }
  }

  if (openId) return <NewsletterEditor id={openId} onBack={() => { setOpenId(''); load(); }} />;

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">النشرات والمقالات</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            اكتب مرة واحدة، وانشر بريداً للمشتركين وصفحةً عامة على الموقع · <bdi>{activeSubs}</bdi> مشترك نشط
          </p>
        </div>
        <div className="spacer" />
        {msg && <span className="err">{msg}</span>}
        <button className="btn" onClick={create}><Plus size={20} /> نشرة جديدة</button>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>العنوان</th><th>الحالة</th><th>الصفحة العامة</th><th>أُرسلت إلى</th><th>آخر تحديث</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((n) => (
              <tr key={n.id}>
                <td>{n.title}</td>
                <td><DeliveryBadge state={n.status} /></td>
                <td><StatusBadge status={n.web_published ? 'published' : 'draft'} /></td>
                <td>{n.sent_count || 0}</td>
                <td className="muted">{formatRiyadh(n.updated_at)}</td>
                <td><button className="btn sm" onClick={() => setOpenId(n.id)}>فتح</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} className="muted">لم تُنشئ أي نشرة بعد. ابدأ بأول نشرة.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===== محرّر النشرة بالكتل ===== */
function NewsletterEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const [nl, setNl] = useState<any>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [publicUrl, setPublicUrl] = useState('');
  const [preview, setPreview] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [social, setSocial] = useState<any>(null);
  const [socialPick, setSocialPick] = useState<Record<string, boolean>>({ x: true, linkedin: true });
  const [ab, setAb] = useState<any>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [auto, setAuto] = useState<'' | 'saving' | 'saved' | 'failed'>('');
  const [dirty, setDirty] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [recovered, setRecovered] = useState<any>(null);
  const draftKey = `naf.newsletter.draft.${id}`;

  function loadStats() {
    api.get(`/newsletters/${id}/stats`).then((d) => setStats(d.stats)).catch(() => {});
    api.get(`/newsletters/${id}/ab`).then(setAb).catch(() => {});
  }

  useEffect(() => {
    loadStats();
    api.get('/newsletters/meta/tags').then((d) => setTags(d.tags || [])).catch(() => {});
    api.get(`/newsletters/${id}`).then((d) => {
      setNl(d.newsletter);
      setPublicUrl(d.public_url || '');
      try { setBlocks(JSON.parse(d.newsletter.blocks_json || '[]')); } catch { setBlocks([]); }

      /* مسودة بقيت في المتصفح من جلسة سابقة تعذّر فيها الحفظ. لا تُطبَّق
         تلقائياً: الخادم قد يحمل نسخةً أحدث حُرّرت من جهاز آخر، وتطبيقها
         بلا سؤال يدوس عليها. تُعرض ويُترك الحكم للكاتب. */
      try {
        const raw = localStorage.getItem(`naf.newsletter.draft.${id}`);
        if (!raw) return;
        const saved = JSON.parse(raw);
        const same = JSON.stringify(saved.blocks || []) === (d.newsletter.blocks_json || '[]')
          && (saved.title || '') === (d.newsletter.title || '');
        if (!same) setRecovered(saved);
        else localStorage.removeItem(`naf.newsletter.draft.${id}`);
      } catch { /* مسودة تالفة تُتجاهل — لا تمنع فتح النشرة */ }
    }).catch((e) => setMsg(e.message));
  }, [id]);

  function field(k: string, v: any) { setDirty(true); setNl((n: any) => ({ ...n, [k]: v })); }

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true);
    setMsg('');
    try {
      await api.patch(`/newsletters/${id}`, {
        title: nl.title, subject: nl.subject, preheader: nl.preheader, excerpt: nl.excerpt,
        blocks_json: JSON.stringify(blocks), ...extra,
      });
      // «تم الحفظ» من naf-terms.md §٤ — كانت «حُفظت»، وهي خارج القاموس.
      setMsg('تم الحفظ');
      // بدونها يبقى dirty مرفوعاً بعد الحفظ اليدوي، فيُطلق المؤقّت حفظاً
      // ثانياً بلا تغيير ويكتب «تم الحفظ تلقائياً» فوق «تم الحفظ».
      setDirty(false);
      setAuto('');
      localStorage.removeItem(draftKey);
      const d = await api.get(`/newsletters/${id}`);
      setNl(d.newsletter);
      setPublicUrl(d.public_url || '');
    } catch (e: any) { setMsg(e.message); } finally { setSaving(false); }
  }

  /* ===== الحفظ التلقائي =====

     كل تغيير يؤجّل حفظاً بعد AUTOSAVE_MS من آخر ضغطة. والنسخة تُكتب في
     المتصفح قبل النداء لا بعده: رسالة الفشل تَعِد بأن «النصّ محفوظ في
     المتصفح»، ووعدٌ في رسالة خطأ يجب أن يكون صادقاً وقت قراءته.

     ولا يُشغَّل قبل أول تحميل: useEffect يعمل عند التركيب، فبلا الحارس
     تُحفظ النشرة فور فتحها وتُكتب «تم الحفظ تلقائياً» بلا أن يلمسها أحد. */
  useEffect(() => {
    if (!nl || !dirty) return;
    const snapshot = JSON.stringify({
      title: nl.title, subject: nl.subject, preheader: nl.preheader, excerpt: nl.excerpt, blocks,
    });
    try { localStorage.setItem(draftKey, snapshot); } catch { /* مساحة ممتلئة — النداء يبقى */ }

    const t = setTimeout(async () => {
      setAuto('saving');
      try {
        await api.patch(`/newsletters/${id}`, {
          title: nl.title, subject: nl.subject, preheader: nl.preheader, excerpt: nl.excerpt,
          blocks_json: JSON.stringify(blocks),
        });
        setAuto('saved');
        setDirty(false);
        localStorage.removeItem(draftKey);
      } catch {
        setAuto('failed');
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // nl بأكمله في التبعيات مقصود: أي حقل في الإعدادات يستحق الحفظ
  }, [nl, blocks, dirty, id, draftKey]);

  async function showPreview() {
    try {
      await save();
      const d = await api.get(`/newsletters/${id}/preview`);
      setPreview(d.html);
    } catch (e: any) { setMsg(e.message); }
  }

  async function sendTest() {
    const email = prompt('بريد الاختبار:');
    if (!email?.trim()) return;
    try { await save(); await api.post(`/newsletters/${id}/test`, { email: email.trim() }); setMsg('أُرسلت رسالة الاختبار'); }
    catch (e: any) { setMsg(e.message); }
  }

  async function sendAll() {
    if (!confirm('إرسال النشرة لكل المشتركين النشطين؟ لا يمكن التراجع.')) return;
    try {
      await save();
      const d = await api.post(`/newsletters/${id}/send`);
      setMsg(`بدأ الإرسال إلى ${isolate(d.queued)} مشترك — يكتمل تدريجياً`);
      const r = await api.get(`/newsletters/${id}`);
      setNl(r.newsletter);
      loadStats();
    } catch (e: any) { setMsg(e.message); }
  }

  async function loadSocial() {
    try { await save(); setSocial(await api.get(`/newsletters/${id}/social`)); }
    catch (e: any) { setMsg(e.message); }
  }

  async function publishSocial() {
    const platforms = Object.keys(socialPick).filter((p) => socialPick[p]);
    if (!platforms.length) return setMsg('اختر منصة واحدة على الأقل');
    if (!confirm(`نشر المقالة على: ${platforms.join('، ')}؟`)) return;
    try {
      const d = await api.post(`/newsletters/${id}/social`, { platforms });
      const okAll = d.results.filter((r: any) => r.ok).map((r: any) => r.platform);
      const bad = d.results.filter((r: any) => !r.ok);
      setMsg(bad.length ? `نُشر: ${okAll.join('، ') || 'لا شيء'} · فشل: ${bad.map((b: any) => b.platform + ' (' + b.error + ')').join('، ')}`
                        : `نُشر على ${okAll.join('، ')}`);
    } catch (e: any) { setMsg(e.message); }
  }

  async function decideAb(winner?: 'a' | 'b') {
    try {
      const d = await api.post(`/newsletters/${id}/ab/decide`, winner ? { winner } : {});
      setMsg(`اعتُمد العنوان ${d.winner === 'b' ? '(ب)' : '(أ)'} لبقية القائمة`);
      const r = await api.get(`/newsletters/${id}`);
      setNl(r.newsletter);
      loadStats();
    } catch (e: any) { setMsg(e.message); }
  }

  async function remove() {
    if (!confirm('حذف هذه النشرة نهائياً؟')) return;
    await api.del(`/newsletters/${id}`);
    onBack();
  }

  // ===== أدوات الكتل =====
  // كلّها تُعلّم dirty — الحفظ التلقائي يقرؤه، وبدونه تُحفظ الإعدادات
  // وحدها ويبقى المحتوى معلّقاً.
  const touch = () => setDirty(true);
  const add = (b: Block) => { touch(); setBlocks((x) => [...x, b]); };
  const upd = (i: number, patch: any) => { touch(); setBlocks((x) => x.map((b, j) => (j === i ? { ...b, ...patch } : b))); };
  const del = (i: number) => { touch(); setBlocks((x) => x.filter((_, j) => j !== i)); };
  const move = (i: number, d: number) => { touch(); return setBlocks((x) => {
    const j = i + d;
    if (j < 0 || j >= x.length) return x;
    const c = [...x];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  }); };

  async function schedule(iso: string) {
    try {
      await save(); // المحتوى أولاً — نشرة تُجدول بمحتوى قديم تُرسله قديماً
      await api.post(`/newsletters/${id}/schedule`, { scheduled_at: iso });
      setMsg('تم جدولة الإرسال');
      setScheduling(false);
      const d = await api.get(`/newsletters/${id}`);
      setNl(d.newsletter);
    } catch (e: any) { setMsg(e.message); }
  }

  async function cancelSchedule() {
    try {
      await api.post(`/newsletters/${id}/schedule/cancel`);
      setMsg('تم إلغاء الجدولة');
      const d = await api.get(`/newsletters/${id}`);
      setNl(d.newsletter);
    } catch (e: any) { setMsg(e.message); }
  }

  if (!nl) return <p className="muted">جارٍ التحميل…</p>;

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn ghost sm" onClick={onBack}><ArrowRight size={20} /> رجوع</button>
        <h1 className="page-title" style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{nl.title}</h1>
        <div className="spacer" />
        <AutosaveState state={auto} />
        {msg && <span className="ok">{msg}</span>}
        <button className="btn ghost" onClick={showPreview}><Eye size={20} /> معاينة</button>
        <button className="btn ghost" onClick={sendTest}><Mail size={20} /> اختبار</button>
        {nl.status === 'scheduled' ? (
          <button className="btn ghost" onClick={cancelSchedule}><CalendarClock size={20} /> إلغاء الجدولة</button>
        ) : nl.status === 'draft' ? (
          <button className="btn ghost" onClick={() => setScheduling(true)}><CalendarClock size={20} /> جدولة الإرسال</button>
        ) : null}
        {['draft', 'scheduled'].includes(nl.status) && (
          <button className="btn" onClick={sendAll}><Send size={20} /> إرسال للمشتركين</button>
        )}
        <button className="btn" disabled={saving} onClick={() => save()}><Save size={20} /> {saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>
      </div>

      {nl.status === 'scheduled' && nl.scheduled_at && (
        <p className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 0 }}>
          <CalendarClock size={16} style={{ verticalAlign: -2, marginInlineEnd: 4 }} />
          مجدول — {formatRiyadh(nl.scheduled_at)}
        </p>
      )}

      {scheduling && <ScheduleModal onClose={() => setScheduling(false)} onConfirm={schedule} />}

      {recovered && (
        <div className="card" style={{ background: 'var(--warning-soft)', marginBottom: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <span style={{ color: 'var(--warning-strong)', fontSize: 'var(--text-sm)' }}>
              مسودة لم تُحفظ على الخادم. استعدها أو تجاهلها.
            </span>
            <div className="spacer" />
            <button
              className="btn sm"
              onClick={() => {
                setNl((n: any) => ({
                  ...n,
                  title: recovered.title ?? n.title,
                  subject: recovered.subject ?? n.subject,
                  preheader: recovered.preheader ?? n.preheader,
                  excerpt: recovered.excerpt ?? n.excerpt,
                }));
                setBlocks(recovered.blocks || []);
                setRecovered(null);
                setDirty(true); // تُحفظ تلقائياً بعد لحظة، فتصل الخادم هذه المرة
                setMsg('تمت الاستعادة');
              }}
            >
              استعادة
            </button>
            <button
              className="btn sm ghost"
              onClick={() => { localStorage.removeItem(draftKey); setRecovered(null); }}
            >
              تجاهل
            </button>
          </div>
        </div>
      )}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        {/* الإعدادات */}
        <div className="card">
          <h4 style={{ marginTop: 0 }}>الإعدادات</h4>
          <div className="field">
            <label>العنوان</label>
            <input className="input" value={nl.title || ''} onChange={(e) => field('title', e.target.value)} />
          </div>
          <div className="field">
            <label>عنوان رسالة البريد</label>
            <input className="input" value={nl.subject || ''} onChange={(e) => field('subject', e.target.value)} placeholder="ما يظهر في صندوق الوارد" />
          </div>
          <div className="field">
            <label>عنوان بديل للاختبار (اختياري)</label>
            <input className="input" value={nl.subject_b || ''} onChange={(e) => field('subject_b', e.target.value)}
                   placeholder="اتركه فارغاً لتعطيل اختبار العنوانين" />
            {nl.subject_b && (
              <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '4px 0 0' }}>
                تُرسل عيّنة {nl.ab_percent || 20}% بالعنوان البديل، ثم تعتمد الأفضل فتحاً.
              </p>
            )}
          </div>
          <div className="field">
            <label>الشريحة المستهدفة</label>
            <select className="select" value={nl.segment_tag || ''} onChange={(e) => field('segment_tag', e.target.value)}>
              <option value="">كل المشتركين النشطين</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label>نص المعاينة (preheader)</label>
            <input className="input" value={nl.preheader || ''} onChange={(e) => field('preheader', e.target.value)} placeholder="سطر يظهر بعد العنوان في صندوق الوارد" />
          </div>
          <div className="field">
            <label>المقتطف (للمشاركة والفهرسة)</label>
            <textarea className="input" rows={2} value={nl.excerpt || ''} onChange={(e) => field('excerpt', e.target.value)} />
          </div>

          <div className="card" style={{ background: 'color-mix(in oklab, var(--muted) 40%, transparent)', marginTop: 10 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <strong style={{ fontSize: 'var(--text-sm)' }}><Globe size={16} style={{ verticalAlign: -2, marginInlineEnd: 4 }} /> الصفحة العامة</strong>
              <div className="spacer" />
              <button className="btn sm ghost" disabled={saving} onClick={() => save({ web_published: nl.web_published ? 0 : 1 })}>
                {nl.web_published ? 'إلغاء النشر' : 'نشر الصفحة'}
              </button>
            </div>
            {nl.web_published && publicUrl && (
              <a className="muted" style={{ fontSize: 'var(--text-xs)', wordBreak: 'break-all' }} href={publicUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} style={{ verticalAlign: -2 }} /> {publicUrl}
              </a>
            )}
            {!nl.web_published && <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>غير منشورة — لن تظهر للعامة.</p>}
          </div>

          <div className="card" style={{ background: 'color-mix(in oklab, var(--muted) 40%, transparent)', marginTop: 10 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <strong style={{ fontSize: 'var(--text-sm)' }}><Share2 size={16} style={{ verticalAlign: -2, marginInlineEnd: 4 }} /> النشر على التواصل</strong>
              <div className="spacer" />
              <button className="btn sm ghost" onClick={loadSocial}>معاينة الصياغة</button>
            </div>
            {!nl.web_published && (
              <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>انشر الصفحة العامة أولاً — المنشور يحتاج رابط المقالة.</p>
            )}
            {nl.web_published && (
              <>
                <div className="row" style={{ gap: 12, marginBottom: 8 }}>
                  {['x', 'linkedin'].map((p) => (
                    <label key={p} className="muted" style={{ fontSize: 'var(--text-xs)', display: 'inline-flex', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!socialPick[p]}
                             onChange={(e) => setSocialPick((v) => ({ ...v, [p]: e.target.checked }))} />
                      {p === 'x' ? 'إكس (سلسلة)' : 'لينكدإن'}
                    </label>
                  ))}
                  <div className="spacer" />
                  <button className="btn sm" onClick={publishSocial}><Send size={20} /> نشر</button>
                </div>
                {social && (
                  <div style={{ fontSize: 'var(--text-xs)' }}>
                    <div className="muted" style={{ marginBottom: 4 }}>سلسلة إكس ({social.x?.length} تغريدة):</div>
                    {(social.x || []).map((t: string, i: number) => (
                      <div key={i} className="card" style={{ padding: 8, marginBottom: 4, whiteSpace: 'pre-wrap' }}>{t}</div>
                    ))}
                    <div className="muted" style={{ margin: '8px 0 4px' }}>لينكدإن:</div>
                    <div className="card" style={{ padding: 8, whiteSpace: 'pre-wrap' }}>{social.linkedin}</div>
                  </div>
                )}
              </>
            )}
          </div>

          {ab && (ab.a?.sent > 0 || ab.b?.sent > 0) && nl.subject_b && (
            <div className="card" style={{ background: 'color-mix(in oklab, var(--muted) 40%, transparent)', marginTop: 10 }}>
              <strong style={{ fontSize: 'var(--text-sm)' }}><FlaskConical size={16} style={{ verticalAlign: -2, marginInlineEnd: 4 }} /> اختبار العنوانين</strong>
              <div style={{ fontSize: 'var(--text-xs)', display: 'grid', gap: 4, marginTop: 8 }}>
                <div className="row">
                  <span className="muted">(أ) {nl.subject}</span><div className="spacer" />
                  <span>{ab.a.open_rate}% ({ab.a.opened}/{ab.a.sent})</span>
                </div>
                <div className="row">
                  <span className="muted">(ب) {nl.subject_b}</span><div className="spacer" />
                  <span>{ab.b.open_rate}% ({ab.b.opened}/{ab.b.sent})</span>
                </div>
              </div>
              {nl.ab_winner
                ? <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '8px 0 0' }}>
                    اعتُمد العنوان {nl.ab_winner === 'b' ? '(ب)' : '(أ)'} لبقية القائمة.
                  </p>
                : <div className="row" style={{ gap: 6, marginTop: 8 }}>
                    <button className="btn sm" onClick={() => decideAb()}>اعتماد الأفضل آلياً</button>
                    <button className="btn sm ghost" onClick={() => decideAb('a')}>أ</button>
                    <button className="btn sm ghost" onClick={() => decideAb('b')}>ب</button>
                  </div>}
            </div>
          )}

          {stats && stats.total > 0 && (
            <div className="card" style={{ background: 'color-mix(in oklab, var(--muted) 40%, transparent)', marginTop: 10 }}>
              <strong style={{ fontSize: 'var(--text-sm)' }}><MousePointerClick size={16} style={{ verticalAlign: -2, marginInlineEnd: 4 }} /> نتائج الإرسال</strong>
              <div style={{ fontSize: 'var(--text-xs)', display: 'grid', gap: 4, marginTop: 8 }}>
                <div className="row"><span className="muted">مُسلَّم</span><div className="spacer" /><span>{stats.sent} من {stats.total}</span></div>
                <div className="row"><span className="muted">فُتحت</span><div className="spacer" /><span>{stats.opened} ({pct(stats.opened, stats.sent)}%)</span></div>
                <div className="row"><span className="muted">نُقر فيها</span><div className="spacer" /><span>{stats.clicked} ({pct(stats.clicked, stats.sent)}%)</span></div>
                {stats.queued > 0 && <div className="row"><span className="muted">بانتظار الإرسال</span><div className="spacer" /><span>{stats.queued}</span></div>}
                {stats.failed > 0 && <div className="row"><span className="muted">فشل</span><div className="spacer" /><span className="badge red">{stats.failed}</span></div>}
              </div>
              <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={loadStats}>تحديث النتائج</button>
            </div>
          )}

          <button className="btn danger sm" style={{ marginTop: 12 }} onClick={remove}><Trash2 size={20} /> حذف النشرة</button>
        </div>

        {/* المحتوى */}
        <div className="card">
          <h4 style={{ marginTop: 0 }}>المحتوى</h4>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <button className="btn sm ghost" onClick={() => add({ type: 'heading', text: '', level: 2 })}><Heading2 size={20} /> عنوان</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'text', text: '' })}><Type size={20} /> فقرة</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'image', url: '' })}><ImageIcon size={20} /> صورة</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'button', text: '', url: '' })}><SquareMousePointer size={20} /> زر</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'quote', text: '' })}><Quote size={20} /> اقتباس</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'divider' })}><Minus size={20} /> فاصل</button>
          </div>

          {blocks.map((b, i) => (
            <div key={i} className="card" style={{ padding: 10, marginBottom: 8 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>{blockLabel(b.type)}</span>
                <div className="spacer" />
                <button className="btn sm ghost" onClick={() => move(i, -1)} title="أعلى"><ArrowUp size={20} /></button>
                <button className="btn sm ghost" onClick={() => move(i, 1)} title="أسفل"><ArrowDown size={20} /></button>
                <button className="btn sm ghost" onClick={() => del(i)} title="حذف"><Trash2 size={20} /></button>
              </div>
              <BlockFields block={b} onChange={(patch) => upd(i, patch)} />
            </div>
          ))}
          {blocks.length === 0 && <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>أضف كتلاً من الأزرار أعلاه لبناء النشرة.</p>}
        </div>
      </div>

      {preview && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row">
            <h4 style={{ marginTop: 0, marginBottom: 0 }}><Mail size={16} style={{ verticalAlign: -2, marginInlineEnd: 4 }} /> معاينة البريد</h4>
            <div className="spacer" />
            <button className="btn sm ghost" onClick={() => setPreview('')}>إغلاق</button>
          </div>
          {/* استثناء مقصود — CLAUDE.md §1: هذه معاينة لرسالة بريد، فتحمل
              قيم القالب الحرفية لا رموز الثيم. معاينة تتبع ثيم المنصة تُري
              المحرّر شيئاً لا يصل المشترك أبداً.
              القيم من EMAIL_PREVIEW أدناه، وهي نسخة طبق الأصل من
              src/services/emailTheme.ts — الملف الذي يبني الرسالة فعلاً.
              كانت هذه الكتلة تخالف ما تدّعيه: زاوية var(--radius) بدل 12px،
              وبلا خلفية الصفحة، ولون متن مختلف. */}
          <div style={{ background: EMAIL_PREVIEW.background, padding: 20, marginTop: 10, borderRadius: 'var(--radius)' }}>
            <div
              style={{
                background: EMAIL_PREVIEW.card,
                color: EMAIL_PREVIEW.foreground,
                fontFamily: EMAIL_PREVIEW.fontStack,
                padding: 28,
                borderRadius: EMAIL_PREVIEW.radius,
                maxWidth: 640,
                margin: '0 auto',
              }}
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function blockLabel(t: string): string {
  return { heading: 'عنوان', text: 'فقرة', image: 'صورة', button: 'زر', quote: 'اقتباس', divider: 'فاصل' }[t] || t;
}

/* حقل فقرة بشريط تنسيق. مفصول في مكوّن لأن الاقتباس يستعمله أيضاً —
   وكلاهما يمرّ على renderInline في الخادم، فيجب أن يعرض للكاتب نفس
   العلامات. */
function InlineField({ value, rows, placeholder, onChange }: {
  value: string; rows: number; placeholder: string; onChange: (v: string) => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [err, setErr] = useState('');
  return (
    <div>
      <InlineToolbar areaRef={areaRef} value={value} onChange={onChange} onError={setErr} />
      <textarea
        ref={areaRef}
        className="input"
        style={{ borderStartStartRadius: 0, borderStartEndRadius: 0 }}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); if (err) setErr(''); }}
      />
      {err && <p className="err" style={{ fontSize: 'var(--text-xs)', margin: '4px 0 0' }}>{err}</p>}
    </div>
  );
}

/* حالة الحفظ التلقائي — نصٌّ لا أيقونة.

   naf-icons.md ينصّ على ذلك صراحةً: أيقونة تومض عند كل ضغطة مفتاح
   ضجيجٌ بصريّ لا معلومة. والألفاظ الثلاثة من naf-terms.md §١٤.

   ورسالة الفشل تَعِد بأن النصّ محفوظ في المتصفح، وهو صادق: النسخة
   تُكتب في localStorage قبل النداء لا بعد نجاحه. */
function AutosaveState({ state }: { state: '' | 'saving' | 'saved' | 'failed' }) {
  if (!state) return null;
  if (state === 'saving') return <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>جارٍ الحفظ…</span>;
  if (state === 'saved') return <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>تم الحفظ تلقائياً</span>;
  return (
    <span className="err" style={{ fontSize: 'var(--text-xs)' }}>
      تعذّر الحفظ التلقائي. تحقّق من الاتصال، والنصّ محفوظ في المتصفح.
    </span>
  );
}

/* نافذة جدولة الإرسال. الموعد يُدخل بتوقيت الرياض بصرف النظر عن توقيت
   جهاز المحرر، ثم يُثبَّت +03:00 ويُحوَّل إلى UTC — نفس ما تفعله جدولة
   المنشورات في Editor.tsx حرفياً، فلا توقيتان في منصة واحدة. */
function ScheduleModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (iso: string) => void }) {
  const [when, setWhen] = useState('');
  return (
    <Modal title="جدولة الإرسال" onClose={onClose}>
      <div className="field">
        <label>الموعد (بتوقيت الرياض)</label>
        <DateTimePicker value={when} onChange={setWhen} inline />
      </div>
      <button className="btn" disabled={!when} onClick={() => onConfirm(new Date(`${when}:00+03:00`).toISOString())}>
        <CalendarClock size={20} /> جدولة الإرسال
      </button>
    </Modal>
  );
}

/* حقول كتلة الصورة. المصدر أحد اثنين لا كلاهما: وسيطٌ من المكتبة
   (mediaId) أو رابطٌ خارجي (url) — واختيار أحدهما يمسح الآخر، وإلا
   بقيت قيمتان والمصيّر يفضّل url صامتاً فيرى الكاتب غير ما اختار. */
function ImageFields({ block, onChange }: { block: Extract<Block, { type: 'image' }>; onChange: (p: any) => void }) {
  const [picking, setPicking] = useState(false);
  const src = block.mediaId ? `/api/media/${block.mediaId}` : block.url || '';

  return (
    <div className="grid" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm ghost" type="button" onClick={() => setPicking(true)}>
          <Images size={20} /> مكتبة الوسائط
        </button>
        {src && (
          <img
            src={src}
            alt=""
            style={{ height: 40, width: 60, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
          />
        )}
        <div className="spacer" />
        {block.mediaId && (
          <button className="btn sm ghost" type="button" onClick={() => onChange({ mediaId: '' })}>مسح</button>
        )}
      </div>

      {!block.mediaId && (
        <input className="input" placeholder="أو رابط صورة خارجي" value={block.url || ''}
               onChange={(e) => onChange({ url: e.target.value })} />
      )}
      <input className="input" placeholder="وصف بديل" value={block.alt || ''}
             onChange={(e) => onChange({ alt: e.target.value })} />
      <input className="input" placeholder="تعليق أسفل الصورة (اختياري)" value={block.caption || ''}
             onChange={(e) => onChange({ caption: e.target.value })} />

      {picking && (
        <MediaPicker
          onClose={() => setPicking(false)}
          onPick={(m) => {
            // الرابط يُمسح مع الاختيار — مصدر واحد لا اثنان.
            onChange({ mediaId: m.id, url: '', alt: block.alt || m.filename || '' });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

function BlockFields({ block, onChange }: { block: Block; onChange: (p: any) => void }) {
  switch (block.type) {
    case 'heading':
      return (
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder="نص العنوان" value={block.text}
                 onChange={(e) => onChange({ text: e.target.value })} />
          <select className="select" style={{ maxWidth: 110 }} value={block.level || 2}
                  onChange={(e) => onChange({ level: Number(e.target.value) })}>
            <option value={2}>رئيسي</option>
            <option value={3}>فرعي</option>
          </select>
        </div>
      );
    case 'text':
      return <InlineField value={block.text} rows={4} placeholder="نص الفقرة (سطر فارغ يفصل فقرتين)"
                          onChange={(text) => onChange({ text })} />;
    case 'image':
      return <ImageFields block={block} onChange={onChange} />;
    case 'button':
      return (
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder="نص الزر" value={block.text}
                 onChange={(e) => onChange({ text: e.target.value })} />
          <input className="input" style={{ flex: 2 }} placeholder="https://…" value={block.url}
                 onChange={(e) => onChange({ url: e.target.value })} />
        </div>
      );
    case 'quote':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <InlineField value={block.text} rows={2} placeholder="نص الاقتباس"
                       onChange={(text) => onChange({ text })} />
          <input className="input" placeholder="المصدر (اختياري)" value={block.cite || ''}
                 onChange={(e) => onChange({ cite: e.target.value })} />
        </div>
      );
    default:
      return <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>خط فاصل بين الأقسام.</p>;
  }
}
