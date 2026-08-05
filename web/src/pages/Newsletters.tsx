import { isolate } from '../lib/format';
import { useEffect, useRef, useState } from 'react';
import {
  Plus, Trash2, ArrowUp, ArrowDown, ArrowRight, Eye, Globe, Mail, Save, ExternalLink,
  Heading2, Type, Image as ImageIcon, SquareMousePointer, Quote, Minus, Send, MousePointerClick, Share2, FlaskConical,
  Images, CalendarClock, StickyNote, Table2, Superscript, TableOfContents, Code,
  Video, AudioLines, FileDown, Columns2, ListTodo, Upload, SpellCheck, FileOutput, Printer,
  Palette, LayoutTemplate,
} from 'lucide-react';
import { api, formatRiyadh } from '../api';
import { DeliveryBadge } from '../components/StateBadge';
import StatusBadge from '../components/StatusBadge';
import InlineToolbar from '../components/InlineToolbar';
import MediaPicker from '../components/MediaPicker';
import { DateTimePicker } from '../components/DatePicker';
import Modal from '../components/Modal';
import ConfirmModal, { FieldModal } from '../components/ConfirmModal';
import BlockStyleBar, { BLOCK_STYLE_CAPS } from '../components/BlockStyleBar';
import NewsletterThemePanel from '../components/NewsletterThemePanel';
import { NewNewsletterModal, TemplatesModal } from '../components/NewsletterTemplates';
import {
  DEFAULT_THEME, EMAIL, RADIUS_PX, WIDTH_PX, BODY_PX, parseTheme,
} from '../lib/newsletterTheme';
import type { BlockStyle, NewsletterTheme } from '../lib/newsletterTheme';
import { highlightMarks } from '../lib/markHighlight';
import { PlatformIcon, platformLabel } from '../platforms';

/* قيم قالب البريد الحرفية تعيش في `lib/newsletterTheme.ts` — نسخة طبق
   الأصل من src/services/emailTheme.ts و blockStyle.ts. لا يمكن استيراد
   ملفات الخادم هنا (حزمتان منفصلتان)، فالنسخ مقصود وموضعه واحد.
   استثناء قوالب البريد — CLAUDE.md §1. */

/* مهلة الحفظ التلقائي بعد آخر تغيير. ثانيتان: أقصر منها يحفظ في وسط
   الكلمة فيغرق D1 بكتابات، وأطول منها يجعل «تم الحفظ تلقائياً» تصل
   بعد أن ينصرف الكاتب عن الشاشة. */
const AUTOSAVE_MS = 2000;

// ===== النشرات والمقالات — مصدر واحد يُنشر بريداً وصفحةً عامة (ولاحقاً إكس/لينكدإن) =====

type CalloutTone = 'info' | 'warning' | 'primary';

type Block = ({ style?: BlockStyle }) & (
  | { type: 'heading'; text: string; level?: 2 | 3 }
  | { type: 'text'; text: string }
  | { type: 'image'; mediaId?: string; url?: string; alt?: string; caption?: string }
  | { type: 'button'; text: string; url: string }
  | { type: 'quote'; text: string; cite?: string }
  | { type: 'divider' }
  | { type: 'callout'; text: string; tone?: CalloutTone; title?: string }
  | { type: 'table'; rows: string[][]; header?: boolean }
  | { type: 'code'; text: string }
  | { type: 'footnote'; text: string }
  | { type: 'toc' }
  | { type: 'audio'; mediaId?: string; url?: string; title?: string }
  | { type: 'file'; mediaId?: string; url?: string; title?: string; note?: string }
  | { type: 'video'; mediaId?: string; url?: string }
  | { type: 'embed'; url: string; title?: string }
  | { type: 'columns'; start: string; end: string }
  | { type: 'checklist'; items: { text: string; done?: boolean }[] }
);

/* عناوين النغمات — من naf-terms.md §١٤.

   ونسخةٌ ثانية من CALLOUT في src/services/newsletter.ts بالضرورة:
   حزمتان منفصلتان لا تستوردان من بعضهما، كما في EMAIL_PREVIEW أعلاه.
   أي تغيير هناك يُنقل هنا وإلا اختلف ما يختاره الكاتب عمّا يُطبع.

   و«تمييز» تظهر هنا خياراً في القائمة ولا عنوانَ افتراضيَّ لها في
   الخادم — إبرازٌ بلا حكم لا يحمل عنواناً على البطاقة. */
const TONE_LABEL: Record<CalloutTone, string> = {
  info: 'معلومة',
  warning: 'تحذير',
  primary: 'تمييز',
};


export default function Newsletters() {
  const [list, setList] = useState<any[]>([]);
  const [activeSubs, setActiveSubs] = useState(0);
  const [openId, setOpenId] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [creating, setCreating] = useState(false);

  function load() {
    api.get('/newsletters').then((d) => {
      setList(d.newsletters || []);
      setActiveSubs(d.active_subscribers || 0);
    }).catch((e) => setMsg(e.message));
  }
  useEffect(load, []);

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
        <button className="btn" onClick={() => setCreating(true)}><Plus size={20} /> نشرة جديدة</button>
      </div>

      {/* الإنشاء في نافذة المنصة لا في مربّع المتصفح: `prompt` يفتح
          مربّعاً معلّقاً بأعلى النافذة بخطّ النظام وأزراره بلغة
          المتصفح، ولا يقبل عنواناً ولا اختيار قالب ولا رسالة خطأ.
          القاعدة في naf-terms.md §٤. */}
      {creating && (
        <NewNewsletterModal
          onClose={() => setCreating(false)}
          onCreated={(id, message) => { setCreating(false); setMsg(message); load(); setOpenId(id); }}
        />
      )}

      {/* ستة أعمدة لا تتّسع في ٣٧٥ بكسل، فيمرَّر الجدول داخل غلافه لا مع
          الصفحة — نفس ما تفعله بقيّة الجداول العريضة في المنصة. وكان
          يمدّ الصفحة أفقياً ٢١١ بكسل على الجوّال. */}
      <div className="card table-scroll">
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

/* حقول الإعدادات التي تُحفظ. مصدرٌ واحد يقرؤه الحفظ اليدوي والتلقائي
   ونسخة المتصفح معاً.

   و«الشريحة المستهدفة» و«العنوان البديل» كانا يُحرَّران ولا يُرسلان:
   الحمولة كانت أربعة حقول مكتوبة بأيديها في موضعين. فيختار الكاتب
   شريحةً ويقرأ «تم الحفظ» ثم تُرسل النشرة إلى الجميع. */
function settingsPayload(nl: any) {
  return {
    title: nl.title,
    subject: nl.subject,
    subject_b: nl.subject_b ?? null,
    segment_tag: nl.segment_tag ?? null,
    preheader: nl.preheader,
    excerpt: nl.excerpt,
  };
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
  const [exporting, setExporting] = useState(false);
  const [caps, setCaps] = useState<{ pdf: boolean }>({ pdf: false });
  const [proofing, setProofing] = useState(false);
  const [proof, setProof] = useState<{ before: string; after: string; why: string }[] | null>(null);
  const [theme, setTheme] = useState<NewsletterTheme>(DEFAULT_THEME);
  const [previewTheme, setPreviewTheme] = useState<NewsletterTheme>(DEFAULT_THEME);
  const [showTheme, setShowTheme] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testErr, setTestErr] = useState('');
  // الكتلة التي فُتح شريط تخصيصها. واحدةٌ في كل مرة: سبعة عشر شريطاً
  // مفتوحاً يجعلان المحرر جدارَ أزرار.
  const [styling, setStyling] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<'send' | 'social' | 'remove' | null>(null);
  const draftKey = `naf.newsletter.draft.${id}`;

  function loadStats() {
    api.get(`/newsletters/${id}/stats`).then((d) => setStats(d.stats)).catch(() => {});
    api.get(`/newsletters/${id}/ab`).then(setAb).catch(() => {});
  }

  useEffect(() => {
    loadStats();
    api.get('/newsletters/meta/tags').then((d) => setTags(d.tags || [])).catch(() => {});
    api.get('/newsletters/meta/export-capabilities').then(setCaps).catch(() => {});
    api.get(`/newsletters/${id}`).then((d) => {
      setNl(d.newsletter);
      setPublicUrl(d.public_url || '');
      setTheme(parseTheme(d.newsletter.theme_json));
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
        ...settingsPayload(nl),
        blocks_json: JSON.stringify(blocks), theme_json: JSON.stringify(theme), ...extra,
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
    const snapshot = JSON.stringify({ ...settingsPayload(nl), blocks, theme });
    try { localStorage.setItem(draftKey, snapshot); } catch { /* مساحة ممتلئة — النداء يبقى */ }

    const t = setTimeout(async () => {
      setAuto('saving');
      try {
        await api.patch(`/newsletters/${id}`, {
          ...settingsPayload(nl),
          blocks_json: JSON.stringify(blocks), theme_json: JSON.stringify(theme),
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
  }, [nl, blocks, theme, dirty, id, draftKey]);

  async function showPreview() {
    try {
      await save();
      const d = await api.get(`/newsletters/${id}/preview`);
      setPreview(d.html);
      /* السمة من ردّ الخادم لا من حالة الواجهة: هي التي مرّت على
         `parseTheme` هناك، فما يُعرض هو ما سيُرسل فعلاً. */
      if (d.theme) setPreviewTheme(d.theme);
    } catch (e: any) { setMsg(e.message); }
  }

  async function sendTest(email: string) {
    // الرسالة من naf-terms.md — حقلٌ فارغ يُقال له لماذا، لا يُتجاهل صامتاً
    if (!email.trim()) return setTestErr('أدخل بريداً للاختبار');
    setTestErr('');
    setTesting(false);
    try { await save(); await api.post(`/newsletters/${id}/test`, { email: email.trim() }); setMsg('أُرسلت رسالة الاختبار'); }
    catch (e: any) { setMsg(e.message); }
  }

  async function sendAll() {
    setConfirming(null);
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
    setConfirming(null);
    const platforms = Object.keys(socialPick).filter((p) => socialPick[p]);
    if (!platforms.length) return setMsg('اختر منصة واحدة على الأقل');
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
    setConfirming(null);
    await api.del(`/newsletters/${id}`);
    onBack();
  }

  // ===== أدوات الكتل =====
  // كلّها تُعلّم dirty — الحفظ التلقائي يقرؤه، وبدونه تُحفظ الإعدادات
  // وحدها ويبقى المحتوى معلّقاً.
  const touch = () => setDirty(true);
  const add = (b: Block) => { touch(); setBlocks((x) => [...x, b]); };
  const upd = (i: number, patch: any) => { touch(); setBlocks((x) => x.map((b, j) => (j === i ? { ...b, ...patch } : b))); };
  /* الحذف والنقل يحرّكان الفهارس، وشريط التخصيص مفتوحٌ على فهرس لا على
     كتلة. فبلا هذين السطرين يبقى الشريط مفتوحاً على موضعٍ صار لكتلةٍ
     أخرى، فيُخصَّص غيرُ المقصود. */
  const del = (i: number) => {
    touch();
    setStyling((s) => (s === null ? s : s === i ? null : s > i ? s - 1 : s));
    setBlocks((x) => x.filter((_, j) => j !== i));
  };
  const move = (i: number, d: number) => { touch(); return setBlocks((x) => {
    const j = i + d;
    if (j < 0 || j >= x.length) return x;
    setStyling((s) => (s === i ? j : s === j ? i : s));
    const c = [...x];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  }); };

  /* التصدير يحفظ أولاً للسبب نفسه: كلا المسارين يقرأ الكتل من الخادم.

     وWord ينزل ملفاً، وPDF يفتح نسخة الطباعة في نافذة تستدعي print()
     — فيحفظها القارئ PDF من حوار الطباعة. ولا تُولَّد PDF في الخادم:
     Workers بلا محرّك تصيير، والبديل الخفيف يسقط تشكيل العربية. */
  async function exportDoc(fmt: 'pdf' | 'docx' | 'print') {
    setMsg('');
    try {
      await save();
      setExporting(false);
      if (fmt === 'print') window.open(`/api/newsletters/${id}/print`, '_blank', 'noopener');
      else window.location.href = `/api/newsletters/${id}/export.${fmt}`;
      setMsg('تم التصدير');
    } catch (e: any) { setMsg(e.message); }
  }

  /* التدقيق يحفظ أولاً: المدقّق يقرأ الكتل من الخادم، ونصٌّ لم يُحفظ
     بعد يُدقَّق في نسخته القديمة فتصل الملاحظات عن كلامٍ غُيّر. */
  async function proofread() {
    setProofing(true);
    setMsg('');
    try {
      await save();
      const d = await api.post(`/newsletters/${id}/proofread`);
      setProof(d.notes || []);
      if (!(d.notes || []).length) setMsg('لا ملاحظات على النصّ');
    } catch (e: any) { setMsg(e.message); } finally { setProofing(false); }
  }

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
        <button className="btn ghost" disabled={proofing} onClick={proofread}>
          <SpellCheck size={20} /> {proofing ? 'جارٍ التدقيق…' : 'تدقيق لغوي'}
        </button>
        <button className="btn ghost" onClick={() => setShowTheme(true)}>
          <Palette size={20} /> سمة النشرة
        </button>
        <button className="btn ghost" onClick={() => setShowTemplates(true)}>
          <LayoutTemplate size={20} /> القوالب
        </button>
        <button className="btn ghost" onClick={showPreview}><Eye size={20} /> معاينة</button>
        <button className="btn ghost" onClick={() => setExporting(true)}><FileOutput size={20} /> تصدير</button>
        <button className="btn ghost" onClick={() => setTesting(true)}><Mail size={20} /> اختبار</button>
        {nl.status === 'scheduled' ? (
          <button className="btn ghost" onClick={cancelSchedule}><CalendarClock size={20} /> إلغاء الجدولة</button>
        ) : nl.status === 'draft' ? (
          <button className="btn ghost" onClick={() => setScheduling(true)}><CalendarClock size={20} /> جدولة الإرسال</button>
        ) : null}
        {['draft', 'scheduled'].includes(nl.status) && (
          <button className="btn" onClick={() => setConfirming('send')}><Send size={20} /> إرسال للمشتركين</button>
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

      {showTheme && (
        <NewsletterThemePanel
          theme={theme}
          onChange={(next) => { setTheme(next); setDirty(true); }}
          onClose={() => setShowTheme(false)}
        />
      )}

      {showTemplates && (
        <TemplatesModal
          newsletterId={id}
          onClose={() => setShowTemplates(false)}
          onMessage={setMsg}
        />
      )}

      {testing && (
        <FieldModal
          title="اختبار"
          label="بريد الاختبار"
          type="email"
          placeholder="name@example.com"
          actionLabel="إرسال"
          hint="تصل نسخةٌ واحدة بهذا العنوان قبل الإرسال للمشتركين."
          error={testErr}
          onSubmit={sendTest}
          onClose={() => { setTesting(false); setTestErr(''); }}
        />
      )}

      {confirming === 'send' && (
        <ConfirmModal
          title="إرسال للمشتركين"
          message="تُرسَل النشرة لكل المشتركين النشطين في الشريحة المستهدفة. لا يمكن التراجع عن هذا."
          actionLabel="إرسال"
          onConfirm={sendAll}
          onClose={() => setConfirming(null)}
        />
      )}

      {confirming === 'social' && (
        <ConfirmModal
          title="النشر على التواصل"
          message={`تُنشر المقالة على: ${Object.keys(socialPick).filter((p) => socialPick[p]).map((p) => platformLabel(p)).join('، ')}.`}
          actionLabel="نشر"
          onConfirm={publishSocial}
          onClose={() => setConfirming(null)}
        />
      )}

      {confirming === 'remove' && (
        <ConfirmModal
          title="حذف النشرة"
          message="ستُحذف النشرة وكل ما سُجّل من نتائج إرسالها. لا يمكن التراجع عن هذا."
          actionLabel="حذف"
          danger
          onConfirm={remove}
          onClose={() => setConfirming(null)}
        />
      )}

      {exporting && (
        <Modal title="تصدير" onClose={() => setExporting(false)}>
          <div className="grid" style={{ gap: 'var(--space-2)' }}>
            {/* زرّ PDF لا يُعرض إلا إذا كان ربط المتصفح متاحاً فعلاً —
                زرٌّ يفشل عند الضغط أسوأ من زرٍّ غائب. */}
            {caps.pdf && (
              <button className="btn" onClick={() => exportDoc('pdf')}>
                <FileOutput size={20} /> ملف PDF
              </button>
            )}
            <button className={caps.pdf ? 'btn ghost' : 'btn'} onClick={() => exportDoc('docx')}>
              <FileOutput size={20} /> مستند Word
            </button>
            <button className="btn ghost" onClick={() => exportDoc('print')}>
              <Printer size={20} /> نسخة للطباعة
            </button>
            <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
              نسخة الطباعة تُفتح في نافذة جديدة، واحفظها PDF من حوار الطباعة.
            </p>
          </div>
        </Modal>
      )}

      {proof && proof.length > 0 && (
        <Modal title="تدقيق لغوي" onClose={() => setProof(null)}>
          {/* الملاحظات تُقرأ ولا تُطبَّق: نصٌّ يُستبدل كاملاً يُدخل
              تغييرات لم يطلبها الكاتب في مقالٍ تُحسب فيه الكلمة. */}
          <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 0 }}>
            <bdi>{proof.length}</bdi> ملاحظة. صحّحها في الكتل بنفسك — لا تُطبَّق تلقائياً.
          </p>
          <div style={{ display: 'grid', gap: 'var(--space-2)', maxHeight: 420, overflowY: 'auto' }}>
            {proof.map((n, i) => (
              <div key={i} className="card" style={{ padding: 'var(--space-3)' }}>
                <div style={{ fontSize: 'var(--text-sm)', textDecoration: 'line-through', color: 'var(--muted-foreground)' }}>
                  {n.before}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--success-strong)' }}>{n.after}</div>
                {n.why && <div className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}>{n.why}</div>}
              </div>
            ))}
          </div>
        </Modal>
      )}

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
                // كل ما تحفظه `settingsPayload` يُستعاد — وإلا استُعيد
                // بعضُ المسودة وضاع بعضها بلا أن يُقال.
                setNl((n: any) => ({ ...n, ...settingsPayload(recovered) }));
                setBlocks(recovered.blocks || []);
                if (recovered.theme) setTheme(recovered.theme);
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
                {/* المنصات من الخادم لا مكتوبةً هنا: هو من يعرف أيّها
                    تقبل منشوراً نصّياً وأيّها يحتاج وسيطاً. */}
                <div className="row" style={{ gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                  {(social?.targets || ['x', 'linkedin']).map((p: string) => (
                    <label key={p} className="muted" style={{ fontSize: 'var(--text-xs)', display: 'inline-flex', gap: 6, cursor: 'pointer', alignItems: 'center' }}>
                      <input type="checkbox" checked={!!socialPick[p]}
                             onChange={(e) => setSocialPick((v) => ({ ...v, [p]: e.target.checked }))} />
                      <PlatformIcon platform={p} size={16} />
                      {platformLabel(p)}{p === 'x' ? ' (سلسلة)' : ''}
                    </label>
                  ))}
                  <div className="spacer" />
                  <button className="btn sm" onClick={() => setConfirming('social')}><Send size={20} /> نشر</button>
                </div>
                {social && (
                  <div style={{ fontSize: 'var(--text-xs)' }}>
                    <div className="muted" style={{ marginBottom: 4 }}>
                      سلسلة إكس (<bdi>{social.x?.length}</bdi> تغريدة):
                    </div>
                    {(social.x || []).map((t: string, i: number) => (
                      <div key={i} className="card" style={{ padding: 8, marginBottom: 4, whiteSpace: 'pre-wrap' }}>{t}</div>
                    ))}
                    {/* صياغة كل منصة مختارة، مع عدّاد حدّها — الحدّ حدُّ
                        قَبولٍ لا ذوق: تجاوزه يعني بتر المنشور أو رفضه. */}
                    {(social.targets || []).filter((p: string) => p !== 'x' && socialPick[p]).map((p: string) => (
                      <div key={p}>
                        <div className="muted" style={{ margin: '8px 0 4px' }}>
                          {platformLabel(p)} — <bdi>{(social.drafts?.[p] || '').length}</bdi>/<bdi>{social.limits?.[p]}</bdi>
                        </div>
                        <div className="card" style={{ padding: 8, whiteSpace: 'pre-wrap' }}>{social.drafts?.[p]}</div>
                      </div>
                    ))}
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

          <button className="btn danger sm" style={{ marginTop: 12 }} onClick={() => setConfirming('remove')}>
            <Trash2 size={20} /> حذف النشرة
          </button>
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
            <button className="btn sm ghost" onClick={() => add({ type: 'callout', text: '', tone: 'info' })}><StickyNote size={20} /> بطاقة</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'table', rows: [['', ''], ['', '']], header: true })}><Table2 size={20} /> جدول</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'footnote', text: '' })}><Superscript size={20} /> حاشية</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'toc' })}><TableOfContents size={20} /> فهرس المحتويات</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'code', text: '' })}><Code size={20} /> كود</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'video' })}><Video size={20} /> فيديو</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'audio' })}><AudioLines size={20} /> صوت</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'file' })}><FileDown size={20} /> ملف</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'embed', url: '' })}><Globe size={20} /> تضمين</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'columns', start: '', end: '' })}><Columns2 size={20} /> أعمدة</button>
            <button className="btn sm ghost" onClick={() => add({ type: 'checklist', items: [{ text: '', done: false }] })}><ListTodo size={20} /> قائمة مهام</button>
          </div>

          {blocks.map((b, i) => (
            <div key={i} className="card" style={{ padding: 10, marginBottom: 8 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>{blockLabel(b.type)}</span>
                {b.style && (
                  <span className="muted" style={{ fontSize: 'var(--text-xs)' }} title="هذه الكتلة مخصّصة">
                    <Palette size={16} style={{ verticalAlign: -3 }} />
                  </span>
                )}
                <div className="spacer" />
                {/* التخصيص بطيّه لا مفتوحاً: الكاتب في أغلب الفقرات
                    لا يريد إلا أن يكتب. */}
                {BLOCK_STYLE_CAPS[b.type] && (
                  <button
                    className="btn sm ghost"
                    aria-expanded={styling === i}
                    title="التخصيص"
                    onClick={() => setStyling(styling === i ? null : i)}
                  >
                    <Palette size={20} />
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => move(i, -1)} title="أعلى"><ArrowUp size={20} /></button>
                <button className="btn sm ghost" onClick={() => move(i, 1)} title="أسفل"><ArrowDown size={20} /></button>
                <button className="btn sm ghost" onClick={() => del(i)} title="حذف"><Trash2 size={20} /></button>
              </div>
              <BlockFields block={b} onChange={(patch) => upd(i, patch)} />
              {styling === i && (
                <BlockStyleBar
                  blockType={b.type}
                  style={b.style}
                  onChange={(style) => upd(i, { style })}
                />
              )}
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
              القيم من lib/newsletterTheme.ts، وهي نسخة طبق الأصل من
              src/services/emailTheme.ts و blockStyle.ts — الملفّان اللذان
              يبنيان الرسالة فعلاً. وتتبع سمة النشرة: الغلاف يُصبغ في
              الخادم أيضاً، ومعاينةٌ ببطاقةٍ بيضاء حول متنٍ فاتح تُخفي
              عن الكاتب أن رسالته لا تُقرأ. */}
          <div style={{ background: previewTheme.pageBackground, padding: 20, marginTop: 10, borderRadius: 'var(--radius)' }}>
            <div
              style={{
                background: previewTheme.cardBackground,
                color: previewTheme.text,
                fontFamily: EMAIL.fontStack,
                fontSize: BODY_PX[previewTheme.size],
                padding: 28,
                borderRadius: RADIUS_PX[previewTheme.radius],
                border: `1px solid ${previewTheme.border}`,
                maxWidth: WIDTH_PX[previewTheme.width],
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
  // كلّها من naf-terms.md §١٤ — كتل المحتوى.
  return {
    heading: 'عنوان', text: 'فقرة', image: 'صورة', button: 'زر', quote: 'اقتباس', divider: 'فاصل',
    callout: 'بطاقة', table: 'جدول', code: 'كود', footnote: 'حاشية', toc: 'فهرس المحتويات',
    audio: 'صوت', file: 'ملف', video: 'فيديو', embed: 'تضمين', columns: 'أعمدة', checklist: 'قائمة مهام',
  }[t] || t;
}

/* حقل فقرة بشريط تنسيق. مفصول في مكوّن لأن الاقتباس يستعمله أيضاً —
   وكلاهما يمرّ على renderInline في الخادم، فيجب أن يعرض للكاتب نفس
   العلامات. */
function InlineField({ value, rows, placeholder, onChange }: {
  value: string; rows: number; placeholder: string; onChange: (v: string) => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');

  /* الطبقة تتبع تمرير الحقل: نصٌّ أطول من الصندوق يُمرَّر في
     `<textarea>` وحده، فتبقى الطبقة مكانها ويفترق اللون عن كلامه. */
  const syncScroll = () => {
    const a = areaRef.current;
    const m = mirrorRef.current;
    if (!a || !m) return;
    m.scrollTop = a.scrollTop;
    m.scrollLeft = a.scrollLeft;
  };

  return (
    <div>
      <InlineToolbar areaRef={areaRef} value={value} onChange={onChange} onError={setErr} />
      {/* طبقةُ التلوين خلف الحقل — الشرح في lib/markHighlight.ts.
          `aria-hidden` لأنها تكرار بصريّ لنصٍّ يقرؤه قارئ الشاشة من
          الحقل نفسه. */}
      <div className="rte-field">
        <div
          ref={mirrorRef}
          className="rte-mirror"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlightMarks(value) }}
        />
        <textarea
          ref={areaRef}
          className="input rte-input"
          rows={rows}
          placeholder={placeholder}
          value={value}
          spellCheck={false}
          onScroll={syncScroll}
          onChange={(e) => { onChange(e.target.value); if (err) setErr(''); }}
        />
      </div>
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
    case 'callout':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 8 }}>
            <select
              className="select"
              style={{ maxWidth: 140 }}
              value={block.tone || 'primary'}
              onChange={(e) => onChange({ tone: e.target.value as CalloutTone })}
            >
              {(['info', 'warning', 'primary'] as CalloutTone[]).map((t) => (
                <option key={t} value={t}>{TONE_LABEL[t]}</option>
              ))}
            </select>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder={block.tone && block.tone !== 'primary' ? TONE_LABEL[block.tone] : 'عنوان البطاقة'}
              value={block.title || ''}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </div>
          <InlineField value={block.text} rows={2} placeholder="نص البطاقة"
                       onChange={(text) => onChange({ text })} />
        </div>
      );

    case 'table':
      return <TableFields block={block} onChange={onChange} />;

    case 'code':
      return (
        <textarea
          className="input"
          rows={5}
          dir="ltr"
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono)', textAlign: 'start' }}
          placeholder="الكود"
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      );

    case 'footnote':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <InlineField value={block.text} rows={2} placeholder="نص الحاشية"
                       onChange={(text) => onChange({ text })} />
          <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
            يظهر رقمها في موضعها من المقال، ونصّها في «الحواشي» آخره.
          </p>
        </div>
      );

    case 'toc':
      return (
        <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
          فهرس يُبنى من عناوين المقال تلقائياً. رسالة البريد تعرضه قائمةً بلا روابط — صناديق الوارد لا تنتقل داخل الرسالة.
        </p>
      );

    case 'audio':
      return <MediaRefFields block={block} onChange={onChange} accept="audio/*" titlePlaceholder="عنوان المقطع" />;

    case 'file':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <MediaRefFields block={block} onChange={onChange} accept="*/*" titlePlaceholder="اسم الملف كما يراه القارئ" />
          <input className="input" placeholder="وصف مختصر (اختياري)" value={block.note || ''}
                 onChange={(e) => onChange({ note: e.target.value })} />
        </div>
      );

    case 'video':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <MediaRefFields block={block} onChange={onChange} accept="video/*" titlePlaceholder="" hideTitle />
          <input className="input" placeholder="أو رابط يوتيوب أو ڤيميو" value={block.url || ''}
                 onChange={(e) => onChange({ url: e.target.value, mediaId: '' })} />
          <EmbedNote url={block.url || ''} />
        </div>
      );

    case 'embed':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <input className="input" placeholder="رابط الصفحة أو المقطع" value={block.url || ''}
                 onChange={(e) => onChange({ url: e.target.value })} />
          <input className="input" placeholder="عنوان البطاقة (اختياري)" value={block.title || ''}
                 onChange={(e) => onChange({ title: e.target.value })} />
          <EmbedNote url={block.url || ''} />
        </div>
      );

    case 'columns':
      return (
        <div className="grid cols-2" style={{ gap: 8 }}>
          <InlineField value={block.start} rows={3} placeholder="العمود الأول"
                       onChange={(start) => onChange({ start })} />
          <InlineField value={block.end} rows={3} placeholder="العمود الثاني"
                       onChange={(end) => onChange({ end })} />
        </div>
      );

    case 'checklist':
      return <ChecklistFields block={block} onChange={onChange} />;

    default:
      return <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>خط فاصل بين الأقسام.</p>;
  }
}

/* يخبر الكاتب بما سيراه القارئ فعلاً قبل الإرسال، لا بعده.

   الرسالة الأولى من naf-terms.md §١٤، والثانية تصف قاعدة القائمة
   البيضاء في newsletter.ts — مزوّدٌ غير مسجَّل يصير بطاقة رابط في
   الوجهتين، ومنصات التواصل ليست مسجَّلة عمداً. */
function EmbedNote({ url }: { url: string }) {
  if (!url.trim()) return null;
  /* نسخة مبسّطة من القائمة البيضاء في newsletter.ts — تكفي لتمييز
     «سيُضمَّن» من «سيصير بطاقة»، والحكم النهائي للخادم. */
  const framed = new RegExp(
    '^https://(?:www\\.)?(?:' +
    'youtube\\.com/(?:watch\\?v=|shorts/)|youtu\\.be/|vimeo\\.com/\\d|dailymotion\\.com/video/|loom\\.com/share/|' +
    'open\\.spotify\\.com/|soundcloud\\.com/|tiktok\\.com/@|instagram\\.com/(?:p|reel)/|' +
    'facebook\\.com/[\\w.-]+/(?:posts|videos)/|linkedin\\.com/embed/feed/update/|' +
    'google\\.com/maps/embed|docs\\.google\\.com/)',
    'i',
  ).test(url.trim());
  return (
    <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
      {framed
        ? 'هذا التضمين يظهر في الصفحة العامة فقط. رسالة البريد تعرض بطاقة رابط بدلاً منه.'
        : 'هذا الرابط يظهر بطاقة رابط في الصفحة العامة وفي البريد. التضمين المباشر ليوتيوب وڤيميو وديلي موشن ولووم وسبوتيفاي وساوندكلاود وتيك توك وإنستغرام وفيسبوك وخرائط جوجل ومستنداتها، ولينكدإن برابط التضمين وحده.'}
    </p>
  );
}

/* حقول كتلةٍ تشير إلى وسيط: صوت أو ملف أو فيديو. المصدر واحد لا اثنان،
   كما في كتلة الصورة. */
function MediaRefFields({ block, onChange, accept, titlePlaceholder, hideTitle }: {
  block: any; onChange: (p: any) => void; accept: string; titlePlaceholder: string; hideTitle?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(f: File) {
    setBusy(true);
    setErr('');
    try {
      const form = new FormData();
      form.append('file', f);
      const d = await api.upload('/media', form);
      onChange({ mediaId: d.id, url: '', title: block.title || d.filename || '' });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm ghost" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={20} /> {busy ? 'جارٍ الرفع…' : 'رفع'}
        </button>
        {block.mediaId && (
          <>
            <span className="muted" style={{ fontSize: 'var(--text-xs)' }}><bdi>{block.title || block.mediaId}</bdi></span>
            <button className="btn sm ghost" type="button" onClick={() => onChange({ mediaId: '' })}>مسح</button>
          </>
        )}
        <div className="spacer" />
        {err && <span className="err" style={{ fontSize: 'var(--text-xs)' }}>{err}</span>}
        <input ref={fileRef} type="file" hidden accept={accept}
               onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      </div>
      {!hideTitle && (
        <input className="input" placeholder={titlePlaceholder} value={block.title || ''}
               onChange={(e) => onChange({ title: e.target.value })} />
      )}
    </div>
  );
}

function ChecklistFields({ block, onChange }: { block: Extract<Block, { type: 'checklist' }>; onChange: (p: any) => void }) {
  const items = Array.isArray(block.items) && block.items.length ? block.items : [{ text: '', done: false }];
  const set = (i: number, patch: any) => onChange({ items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  return (
    <div className="grid" style={{ gap: 6 }}>
      {items.map((it, i) => (
        <div className="row" key={i} style={{ gap: 8 }}>
          <input type="checkbox" checked={!!it.done} onChange={(e) => set(i, { done: e.target.checked })}
                 aria-label={`البند ${i + 1} منجز`} />
          <input className="input" style={{ flex: 1 }} placeholder="نصّ البند" value={it.text}
                 onChange={(e) => set(i, { text: e.target.value })} />
          <button className="btn sm ghost" type="button" title="حذف"
                  onClick={() => onChange({ items: items.length > 1 ? items.filter((_, j) => j !== i) : items })}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <div className="row">
        <button className="btn sm ghost" type="button"
                onClick={() => onChange({ items: [...items, { text: '', done: false }] })}>
          <Plus size={20} /> بند
        </button>
      </div>
    </div>
  );
}

/* محرّر الجدول. شبكة حقول لا محرّر جداول كامل: النشرة القانونية تحمل
   جدول مقارنةٍ صغيراً، ومحرّرٌ بدمج خلايا وتنسيقها بابٌ لا يُغلق. */
function TableFields({ block, onChange }: { block: Extract<Block, { type: 'table' }>; onChange: (p: any) => void }) {
  const rows: string[][] = Array.isArray(block.rows) && block.rows.length ? block.rows : [['', '']];
  const cols = Math.max(...rows.map((r) => r.length), 1);

  const setCell = (ri: number, ci: number, v: string) =>
    onChange({ rows: rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)) });
  const addRow = () => onChange({ rows: [...rows, Array(cols).fill('')] });
  const addCol = () => onChange({ rows: rows.map((r) => [...r, '']) });
  const delRow = (ri: number) => onChange({ rows: rows.length > 1 ? rows.filter((_, i) => i !== ri) : rows });
  const delCol = (ci: number) => onChange({ rows: cols > 1 ? rows.map((r) => r.filter((_, j) => j !== ci)) : rows });

  return (
    <div className="grid" style={{ gap: 6 }}>
      <label className="row" style={{ gap: 6, fontSize: 'var(--text-xs)' }}>
        <input type="checkbox" checked={!!block.header} onChange={(e) => onChange({ header: e.target.checked })} />
        صفّ العناوين
      </label>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {Array.from({ length: cols }).map((_, ci) => (
                  <td key={ci} style={{ padding: 2 }}>
                    <input
                      className="input"
                      style={{ minWidth: 90, fontWeight: block.header && ri === 0 ? 600 : 400 }}
                      value={r[ci] ?? ''}
                      onChange={(e) => setCell(ri, ci, e.target.value)}
                      aria-label={`صف ${ri + 1} عمود ${ci + 1}`}
                    />
                  </td>
                ))}
                <td style={{ padding: 2 }}>
                  <button className="btn sm ghost" type="button" title="حذف الصف" onClick={() => delRow(ri)}>
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              {Array.from({ length: cols }).map((_, ci) => (
                <td key={ci} style={{ padding: 2 }}>
                  <button className="btn sm ghost" type="button" title="حذف العمود" onClick={() => delCol(ci)}>
                    <Trash2 size={16} />
                  </button>
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm ghost" type="button" onClick={addRow}><Plus size={20} /> صف</button>
        <button className="btn sm ghost" type="button" onClick={addCol}><Plus size={20} /> عمود</button>
      </div>
    </div>
  );
}
