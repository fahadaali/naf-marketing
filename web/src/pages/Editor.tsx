import { isolate } from '../lib/format';
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Sparkles,
  Save,
  Send,
  Check,
  CircleX,
  CalendarClock,
  Rocket,
  Archive,
  Trash2,
  PenLine,
  BookOpen,
  ImagePlus,
  Paperclip,
  ArrowLeft,
  ChevronLeft,
  Image as ImageIcon,
  Video,
  Loader,
  LoaderCircle,
  LayoutTemplate,
  History,
  RefreshCw,
} from 'lucide-react';
import { api, formatRiyadh } from '../api';
import StatusBadge from '../components/StatusBadge';
import { useAuth } from '../auth';
import RichEditor, { type RichEditorHandle } from '../components/RichEditor';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import { PlatformIcon, platformLabel } from '../platforms';
import { MediaViewer } from '../components/MediaViewer';
import { mediaFromEl, mediaEmbedHtml, upgradeVideoEmbeds, type MediaInfo } from '../mediaEmbed';
import { uploadMedia } from '../mediaUpload';
import PlatformVariants, { type VariantRow } from '../components/PlatformVariants';
import ScheduleModal, { prepareTikTok } from '../components/ScheduleModal';
import VideoCover from '../components/VideoCover';
import { tonesFrom, DEFAULT_TONES, type Tone } from '../tones';
import { isBlankHtml } from '../contentFlow';
import { splitProviderReason } from '../providerReason';
import { PlanFields, usePlanOptions } from '../components/PlanItemModal';
import { EMPTY_PLAN, planFromPost, planPayload, riyadhToday, type PlanDraft } from '../planning';
import { platformChanges, platformStates, SCHEDULING_STATUSES } from '../postPlatforms';

/* رسالة النجاح تحمل اسم الإجراء نفسه، على صيغة «تم + المصدر»
   من naf-terms.md §4. الزر الذي يقول «رفض» ينتج «تم الرفض». */
const ACTION_DONE: Record<string, string> = {
  submit: 'تم الإرسال للمراجعة',
  approve: 'تم الاعتماد',
  reject: 'تم الرفض',
  archive: 'تمت الأرشفة',
};

export default function Editor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { can, user } = useAuth();

  const [postId, setPostId] = useState<string | undefined>(id);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // النصّ كما حُفظ في الخادم — به تُعرف «الفكرة» (مسودةٌ لم يُحفظ لها نصّ)
  const [savedBody, setSavedBody] = useState('');
  // حقول خطة المحتوى — الشكل منها بدل «نوع المحتوى»، والحملة كذلك
  const [plan, setPlan] = useState<PlanDraft>(EMPTY_PLAN);
  // منصات الخطة كما حُفظت — بالفرق بينها وبين الرقائق يُعرف ما يُلغى وما يُجدوَل
  const [savedPlatforms, setSavedPlatforms] = useState<string[]>([]);
  const [assigneeName, setAssigneeName] = useState('');
  const planOptions = usePlanOptions();
  const [status, setStatus] = useState('draft');
  // كاتبُ المحتوى — يُقرأ ليُخفى عنه زرُّ الاعتماد. الخادم هو الحكم
  // (`transition` في `services/workflow.ts`)، وهذا يمنع زرّاً يُردّ عند
  // الضغط: من يراه ثم يقرأ «لا يعتمد المحتوى كاتبُه» يظنّه عطلاً.
  const [authorId, setAuthorId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [approvals, setApprovals] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [basecampSynced, setBasecampSynced] = useState(false);
  const [syncingNotes, setSyncingNotes] = useState(false);
  const [schedules, setSchedules] = useState<any[]>([]);
  // نسخة كل منصة كما في الخادم — النص المخصّص وأول تعليق ووسيطها (`PlatformVariants`)
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [showVariants, setShowVariants] = useState(false);
  const [coverId, setCoverId] = useState<string | null>(null); // غلاف المقطع (`VideoCover`)
  const [versions, setVersions] = useState<any[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [platLabels, setPlatLabels] = useState<Record<string, string>>({});
  const [tones, setTones] = useState<Tone[]>(DEFAULT_TONES);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  /* «نشر الآن» جارٍ. كان الزرّ يبقى كما هو والطلب يجري — وتجهيزُ مقطع تيك
     توك ورفعُ الوسائط إلى المزوّد يأخذان ثوانيَ — فيظنّ الضاغط أن شيئاً لم
     يحدث ويضغط ثانيةً، فيبدأ نشرٌ ثانٍ فوق الأول. والمرجع يمنع الدخول الثاني
     قبل أن يُعاد رسم الزرّ معطّلاً. */
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);

  const [showAI, setShowAI] = useState(false);
  const [showKB, setShowKB] = useState(false);
  const [showMediaGen, setShowMediaGen] = useState(false);
  const [showAIMedia, setShowAIMedia] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  // منصاتٌ بعينها تُفتح بها «جدولة النشر» — منصةٌ حُدّدت ثم حُفظت، أو زرّ سطرها
  const [scheduleFor, setScheduleFor] = useState<string[] | null>(null);
  // `?schedule=1` من سحب البطاقة إلى «مجدول» — تُفتح النافذة مرّةً واحدة لا مع كل تحميل
  const scheduleAsked = useRef(sp.get('schedule') === '1');
  const [showVersions, setShowVersions] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [viewer, setViewer] = useState<MediaInfo | null>(null);
  const editorRef = useRef<RichEditorHandle>(null);

  /* نوافذ المنصة بدل مربّعات المتصفح — العلّة مشروحة في `ConfirmModal`.
     خمسةٌ كانت هنا: النشر الآن، وحذف المحتوى، وإلغاء موعد، واستعادة
     نسخة، وحذف قالب. */
  const [confirming, setConfirming] = useState<
    | { kind: 'publish'; early: boolean; when: string }
    | { kind: 'delete' }
    | { kind: 'cancelSchedule'; id: string }
    | { kind: 'cancelPlatforms'; platforms: string[]; schedule: string[] }
    | { kind: 'deletePublished'; id: string; platform: string }
    | null
  >(null);

  /* الاعتماد ممنوع على الكاتب — والمدير العام مستثنى بحكم موقعه: لا
     معتمِد فوقه، فمنعُه يوقف محتواه عند بابٍ لا يفتحه أحد. القاعدة
     نفسها في `transition` بالخادم، وهي الحكم. */
  const canApprove = !authorId || !user || user.id !== authorId || user.role_name === 'general_manager';

  async function loadPost(pid: string) {
    const d = await api.get(`/posts/${pid}`);
    setTitle(d.post.title);
    // بطاقات المقاطع القديمة تصير مشغّلاً (`upgradeVideoEmbeds`)
    setBody(upgradeVideoEmbeds(d.post.body));
    setSavedBody(d.post.body);
    setPlan(planFromPost(d.post));
    setSavedPlatforms(planFromPost(d.post).planned_platforms);
    setAssigneeName(d.post.assignee_name || '');
    setStatus(d.post.status);
    /* يُستهلك مع أوّل تحميل: محتوى لم يُعتمد بعد لا تُفتح له النافذة، ولا
       تنفتح عليه فجأةً حين يُعتمد لاحقاً في الجلسة نفسها. والشرط شرطُ زرّ
       «جدولة النشر» نفسه — فالمعامل لا يفتح ما لا يفتحه الزرّ. */
    if (scheduleAsked.current) {
      scheduleAsked.current = false;
      if (['approved', 'scheduled'].includes(d.post.status) && can('content.schedule')) setShowSchedule(true);
    }
    setAuthorId(d.post.author_id || '');
    setRejectReason(d.post.reject_reason || '');
    setApprovals(d.approvals);
    setNotes(d.notes || []);
    setBasecampSynced(!!d.basecamp_synced);
    setSchedules(d.schedules);
    setVariants(d.variants || []);
    setCoverId(d.post.video_cover_id || null);
    /* الصمت قرار: النسخ زيادةٌ على المحتوى، وفشلُ جلبها يخفي زرّ
       «سجل النسخ» ولا يمنع التحرير ولا الحفظ. */
    api.get(`/posts/${pid}/versions`).then((v) => setVersions(v.versions)).catch(() => {});
  }

  // مزامنة يدوية فورية لتعليقات بيسكامب لهذا المنشور، ثم تحديث قائمة الملاحظات فقط.
  async function syncNotes() {
    const pid = postId || id;
    if (!pid) return;
    setSyncingNotes(true);
    try {
      const r = await api.post('/basecamp/sync-comments', { post_id: pid });
      const d = await api.get(`/posts/${pid}`);
      setNotes(d.notes || []);
      /* نُقلت البطاقة أو عُدّل نصّها في بيسكامب: تُعرض المرحلة الجديدة دائماً،
         والنصّ الجديد ما لم يكن في المحرر تعديلٌ لم يُحفظ — لا يُكتب فوقه. */
      if (r?.moved || r?.edited) {
        setStatus(d.post.status);
        setRejectReason(d.post.reject_reason || '');
        setApprovals(d.approvals);
        if (body === savedBody) {
          setTitle(d.post.title);
          setBody(upgradeVideoEmbeds(d.post.body));
          setSavedBody(d.post.body);
        }
      }
    } catch { /* تُتجاهل — قد لا يكون بيسكامب مضبوطاً */ }
    finally { setSyncingNotes(false); }
  }

  useEffect(() => {
    api.get('/settings').then((d) => {
      setPlatforms(d.settings?.enabled_platforms || []);
      setPlatLabels(d.settings?.platform_labels || {});
      setTones(tonesFrom(d.settings));
    });
    if (id) loadPost(id);
    // تحويل خبر إلى مسودة: يأتي عبر ?news=<id>&title=&body=
    if (!id && sp.get('news')) {
      setTitle(sp.get('title') || '');
      /* نصّ الخبر مجرّد: أسطره محارفُ سطرٍ لا يرسمها المحرر فتلتصق فيه، وتُنشر
         أسطراً — فيُكتب أسطراً كما يُكتب ما يولّده الذكاء الاصطناعي. */
      const plain = sp.get('body') || '';
      setBody(plain ? `<p>${plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>` : '');
    }
  }, [id]);

  const readOnly = !['draft', 'rejected'].includes(status) && !can('content.review');

  async function save(): Promise<boolean> {
    setErr(''); setMsg('');
    try {
      if (!postId) {
        const d = await api.post('/posts', {
          title,
          body,
          ...planPayload(plan),
          source: sp.get('news') ? 'rss' : 'manual',
          news_item_id: sp.get('news') || undefined,
        });
        setPostId(d.id);
        navigate(`/editor/${d.id}`, { replace: true });
      } else {
        await api.patch(`/posts/${postId}`, { title, body, ...planPayload(plan) });
      }
      // الخادم يطبّع النصّ الفارغ إلى '' — فالفكرة تبقى فكرةً حتى يُحفظ لها نصّ
      setSavedBody(isBlankHtml(body) ? '' : body);
      setMsg('تم الحفظ');
      return true;
    } catch (e: any) {
      setErr(e.message);
      return false;
    }
  }

  // رسالة النجاح تسمّي الإجراء ولا تكون عامة — naf-terms §4:
  // «لا: تمت العملية بنجاح — عامة ولا تخبر بشيء».
  async function doAction(action: string, note?: string) {
    setErr(''); setMsg('');
    try {
      /* الإرسال يحفظ أولاً: ما كُتب ولم يُحفظ كان يُرسَل بنسخته القديمة — وفي
         الفكرة نسختُها القديمة بلا نصّ، فيردّها الخادم. */
      if (!postId || action === 'submit') {
        if (!(await save())) return;
      }
      const pid = postId;
      if (!pid) return;
      const d = await api.post(`/posts/${pid}/action`, { action, note });
      setStatus(d.status);
      await loadPost(pid);
      setMsg(ACTION_DONE[action] || 'تم الحفظ');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function publishNow() {
    if (!postId || publishingRef.current) return;
    const pending = schedules.filter((s) => ['pending', 'failed'].includes(s.status));
    const earliest = pending
      .map((s) => new Date(s.scheduled_at).getTime())
      .sort((a, b) => a - b)[0];
    const isEarly = earliest && earliest > Date.now();
    const when = earliest ? formatRiyadh(new Date(earliest).toISOString()) : '';
    setConfirming({ kind: 'publish', early: !!isEarly, when });
  }

  async function doPublishNow() {
    if (!postId || publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    setConfirming(null);
    setErr(''); setMsg('');
    try {
      // تيك توك بصورةٍ واحدة: يُجهَّز مقطعه قبل النشر (`tiktokVideo.ts`)
      const tiktokDue = schedules.some((s) => s.platform === 'tiktok' && ['pending', 'failed'].includes(s.status));
      const tiktokErr = tiktokDue ? await prepareTikTok(postId, setMsg) : '';
      const d = await api.post('/schedules/publish-now', { post_id: postId });
      // الحالة من الخادم لا من الضغط: منشورٌ رُفض على كل منصاته لم يُنشر
      await loadPost(postId);
      /* وما قبله المزوّد ولم يؤكّد نشره بعد (تيك توك يعالج المقطع مثلاً) يُقال
         بحاله المسجّلة. وكان لا يُقال شيء — لا نجاح ولا خطأ — فيبدو الضغط بلا
         أثر، ويُضغط ثانيةً. وحاله تتحدّث وحدها (`processing` أدناه). */
      const parts: string[] = [];
      if (d.published > 0) parts.push(`تم النشر الآن (${isolate(d.published)} منصة)` + (d.early ? ' — قبل الموعد' : ''));
      if (d.pending > 0) parts.push(`قيد النشر (${isolate(d.pending)} منصة)`);
      if (parts.length) setMsg(parts.join(' · '));
      /* وما رُفض يُقال بمنصّته وسببه. وكان الرفض يُعرض «تم النشر الآن (0
         منصة)» والحالة «منشور»، فلا يعرف أحدٌ أن شيئاً لم يُنشر حتى يُفتح الحساب. */
      if (d.failed > 0) {
        setErr(
          (d.errors || [])
            .map((e: { platform: string; error: string }) =>
              `${platformLabel(e.platform, platLabels)}: ${e.platform === 'tiktok' && tiktokErr ? tiktokErr : e.error}`)
            .join(' · '),
        );
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  /* موعدٌ «قيد النشر» يُحسم في الخادم بعد دقائق (`reconcilePublishing`)، وكانت
     الشاشة لا تعرف حتى يُعاد فتحها — فيبقى الزرّ والحال كما هما، ويُضغط
     ثانيةً. فيُسأل الخادم ما بقي موعدٌ قيد النشر. والمواعيد والحال وحدها تُحدَّث:
     `loadPost` يكتب العنوان والنص فوق ما لم يُحفظ. */
  useEffect(() => {
    if (!postId || !schedules.some((s) => s.status === 'processing')) return;
    const t = setTimeout(() => {
      api.get(`/posts/${postId}`).then((d) => {
        setSchedules(d.schedules);
        setStatus(d.post.status);
        setApprovals(d.approvals);
      }).catch(() => {});
    }, 30_000);
    return () => clearTimeout(t);
  }, [postId, schedules]);

  async function deletePost() {
    if (!postId) return;
    setConfirming(null);
    try {
      await api.del(`/posts/${postId}`);
      navigate('/posts');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  // إلغاء موعد نشر معلّق أو فاشل (الخادم يرفض إلغاء ما نُشر فعلاً)
  async function cancelSchedule(sid: string) {
    if (!postId) return;
    setConfirming(null);
    try {
      await api.del(`/schedules/${sid}`);
      await loadPost(postId);
      setMsg('تم إلغاء الجدولة');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  /* ═══ الحفظ والرقائق ═══

     للمعتمد والمجدول والمنشور، الرقائق تتحكّم بالمواعيد: منصةٌ لها موعدٌ أُلغي
     تحديدها تُلغى جدولتها بعد تأكيد، ومنصةٌ حُدّدت ولا موعد لها تُفتح لها «جدولة
     النشر». والإلغاء قبل الحفظ: إن تعذّر بقيت الخطة كما كانت ولم تخالف المواعيد. */
  const platformControl = !!postId && SCHEDULING_STATUSES.includes(status) && can('content.schedule');
  const states = platformControl ? platformStates(schedules) : {};

  async function saveAll() {
    const changes = platformControl ? platformChanges(states, savedPlatforms, plan.planned_platforms) : { cancel: [], schedule: [] };
    if (changes.cancel.length) {
      setConfirming({ kind: 'cancelPlatforms', platforms: changes.cancel, schedule: changes.schedule });
      return;
    }
    await finishSave(changes.schedule, false);
  }

  async function cancelPlatforms(list: string[], schedule: string[]) {
    if (!postId) return;
    setConfirming(null);
    setErr(''); setMsg('');
    try {
      await api.post('/schedules/cancel', { post_id: postId, platforms: list });
    } catch (e: any) {
      setErr(e.message);
      return;
    }
    await finishSave(schedule, true);
  }

  async function finishSave(schedule: string[], cancelled: boolean) {
    if (!(await save()) || !postId) return;
    setSavedPlatforms(plan.planned_platforms);
    // المسودة تُحفظ كما كانت: لا مواعيد تُعاد قراءتها، ولا يُعاد تحميل نصٍّ يُكتب الآن
    if (!cancelled && !schedule.length) return;
    await loadPost(postId);
    if (cancelled) setMsg('تم إلغاء الجدولة');
    if (schedule.length && can('content.schedule')) setScheduleFor(schedule);
  }

  /* حذفُ المنشور من منصته نفسها — والموعد يبقى بوقت حذفه، فيُجدوَل المحتوى
     عليها من جديد إن شاء الفريق. */
  async function deletePublished(sid: string, platform: string) {
    if (!postId) return;
    setConfirming(null);
    setErr(''); setMsg('');
    try {
      await api.post(`/schedules/${sid}/delete-post`, {});
      setMsg(`تم حذف المنشور من ${platformLabel(platform, platLabels)}`);
      loadPost(postId);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  // يرفع الملف ويُعيد بياناته؛ المحرر يتولّى إدراجه عند موضع المؤشر.
  // وعند اختيار عدّة ملفات يُستدعى لكلٍّ منها بترتيبه (`RichEditor`)، والخطأ يُجمع لا يُمحى،
  // والرسالة الأخيرة تعدّ ما أُدرج فعلاً لا ما اختير.
  const uploadedInBatch = useRef(0);
  async function uploadFn(file: File, index = 0, total = 1) {
    if (index === 0) {
      setErr('');
      uploadedInBatch.current = 0;
    }
    setMsg(total > 1 ? `جارٍ رفع الوسيط ${isolate(index + 1)} من ${isolate(total)}…` : 'جارٍ رفع الوسيط…');
    let d = null;
    try {
      d = await uploadMedia(file);
      uploadedInBatch.current++;
    } catch (e: any) {
      setErr((prev) => [prev, total > 1 ? `«${file.name}»: ${e.message}` : e.message].filter(Boolean).join(' · '));
    }
    if (index === total - 1) {
      const n = uploadedInBatch.current;
      setMsg(!n ? '' : total > 1 ? `تم إدراج الوسائط (${isolate(n)})` : 'تم إدراج الوسيط');
    }
    return d;
  }

  const overdue =
    status === 'scheduled' &&
    schedules.some((s) => ['pending', 'failed'].includes(s.status) && new Date(s.scheduled_at).getTime() < Date.now());
  // ما نُشر عليه من المنصات: لا يُجدوَل ثانيةً، ويجعل المجدولَ «منشوراً جزئياً»
  const publishedOn = schedules.filter((s) => s.status === 'published').map((s) => s.platform);
  const effStatus = overdue
    ? 'late'
    : postId && status === 'draft' && savedBody === ''
      ? 'idea'
      : status === 'scheduled' && publishedOn.length
        ? 'partial'
        : status;
  /* منصةٌ في «منصات التواصل» بلا موعد: الخطة لا تنشر، والجدولة وحدها تُنشئ الموعد.
     وكانت تُنسى صامتةً — لا موعد ولا حالة ولا خطأ — فيُظنّ أن النشر عليها تعطّل. */
  const unscheduled = ['approved', 'scheduled', 'published'].includes(status)
    ? plan.planned_platforms.filter((p) => !schedules.some((s) => s.platform === p))
    : [];
  // المنشور يُجدوَل على ما لم يُنشر عليه بعد من المنصات المفعّلة
  const canScheduleMore = platforms.some((p) => !publishedOn.includes(p));
  // لا إرسال لما لا نصّ فيه بعد — فكرةٌ تُكتب أولاً، والخادم يردّها إن وصلت
  const hasText = !isBlankHtml(body);

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="page-title">{postId ? 'تعديل المحتوى' : 'محتوى جديد'}</h1>
        <StatusBadge status={effStatus} />
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        {err && <span className="err">{err}</span>}
      </div>

      {status === 'rejected' && rejectReason && (
        <div className="card" style={{ borderColor: 'var(--destructive)', marginBottom: 14, background: 'var(--destructive-soft)' }}>
          <strong className="err">سبب الرفض:</strong> {rejectReason}
        </div>
      )}

      <div className="grid editor-grid">
        {/* المحرر */}
        <div className="card">
          <div className="field">
            <label>العنوان</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
          </div>

          {!readOnly && (
            <div className="field">
              <label>مصدر المحتوى</label>
              <div className="row">
                <span className="badge gray"><PenLine size={16} /> يدوي (اكتب أدناه)</span>
                {can('ai.generate') && (
                  <button className="btn gold sm" type="button" onClick={() => setShowAI(true)}>
                    <Sparkles size={20} /> توليد بالذكاء الاصطناعي
                  </button>
                )}
                {can('ai.generate') && (
                  <button className="btn ghost sm" type="button" onClick={() => setShowKB(true)}>
                    <BookOpen size={20} /> مركز المعرفة
                  </button>
                )}
                {can('ai.generate') && (
                  <button className="btn ghost sm" type="button" onClick={() => setShowMediaGen(true)}>
                    <ImagePlus size={20} /> توليد من وسيط
                  </button>
                )}
                {can('ai.generate') && (
                  <button className="btn ghost sm" type="button" onClick={() => setShowAIMedia(true)}>
                    <Sparkles size={20} /> توليد صورة/فيديو بالذكاء الاصطناعي
                  </button>
                )}
                <button className="btn ghost sm" type="button" onClick={() => setShowTemplates(true)}>
                  <LayoutTemplate size={20} /> القوالب
                </button>
              </div>
              <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '6px 0 0' }}>
                لإرفاق وسيط: ضع المؤشر في المكان المطلوب واضغط زر المشبك <Paperclip size={16} style={{ verticalAlign: -2 }} /> في شريط أدوات المحرر — يُدرَج الوسيط في موضعه (صورة/صوت/فيديو/PDF/وورد/إكسل)، ويمكن اختيار عدّة ملفات معاً فتُدرج بترتيبها. واضغط على الوسيط لاحقاً لاستعراضه.
              </p>
            </div>
          )}

          <div className="field">
            <label>المحتوى</label>
            {readOnly ? (
              <div
                className="rte"
                dangerouslySetInnerHTML={{ __html: body }}
                onClick={(e) => { const m = mediaFromEl(e.target); if (m) setViewer(m); }}
              />
            ) : (
              <RichEditor
                ref={editorRef}
                value={body}
                onChange={setBody}
                placeholder="اكتب المحتوى، أو ولّده بالذكاء الاصطناعي..."
                onUpload={can('media.upload') ? uploadFn : undefined}
                onMediaClick={setViewer}
              />
            )}
          </div>

          {!readOnly && (
            <button className="btn" onClick={saveAll}><Save size={20} /> حفظ المسودة</button>
          )}
        </div>

        {/* اللوحة الجانبية */}
        <div>
          {/* خطة المحتوى: يومه المستهدف ومنصاته وشكله ومسؤوله وسلسلته وحملته وملخّصه.
              تُحفظ مع المحتوى بزرّ الحفظ نفسه. */}
          <div className="card" style={{ marginBottom: 14 }}>
            <h4 style={{ marginTop: 0 }}>خطة المحتوى</h4>
            <PlanFields
              draft={plan}
              onChange={setPlan}
              options={planOptions}
              disabled={readOnly}
              idPrefix="plan-edit"
              assigneeName={assigneeName}
              states={states}
            />
          </div>

          {/* إجراءات دورة الحياة */}
          <div className="card" style={{ marginBottom: 14 }}>
            <h4 style={{ marginTop: 0 }}>الإجراءات</h4>
            <div className="grid" style={{ gap: 8 }}>
              {['draft', 'rejected'].includes(status) && can('content.submit') && postId && hasText && (
                <button className="btn" onClick={() => doAction('submit')}><Send size={20} /> إرسال للمراجعة</button>
              )}
              {status === 'pending_marketing' && can('content.review') && (
                <>
                  {canApprove && <button className="btn success" onClick={() => doAction('approve')}><Check size={20} /> اعتماد التسويق</button>}
                  <button className="btn danger" onClick={() => setShowReject(true)}><CircleX size={20} /> رفض</button>
                </>
              )}
              {status === 'pending_gm' && can('content.approve_final') && (
                <>
                  {canApprove && <button className="btn success" onClick={() => doAction('approve')}><Check size={20} /> اعتماد نهائي</button>}
                  <button className="btn danger" onClick={() => setShowReject(true)}><CircleX size={20} /> رفض</button>
                </>
              )}
              {['pending_marketing', 'pending_gm'].includes(status) && !canApprove && (
                <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
                  لا يعتمد المحتوى كاتبُه. يعتمده غيرك ممّن يملك الصلاحية.
                </p>
              )}
              {(['approved', 'scheduled'].includes(status) || (status === 'published' && canScheduleMore)) && can('content.schedule') && (
                <button className="btn gold" onClick={() => setShowSchedule(true)}><CalendarClock size={20} /> جدولة النشر</button>
              )}
              {status === 'scheduled' && can('content.approve_final') && schedules.some((s) => ['pending', 'failed'].includes(s.status)) && (
                <button className="btn success" onClick={publishNow} disabled={publishing} aria-busy={publishing}>
                  {publishing ? <LoaderCircle size={20} className="spin" /> : <Rocket size={20} />} نشر الآن
                </button>
              )}
              {status === 'published' && can('content.approve_final') && (
                <button className="btn ghost" onClick={() => doAction('archive')}><Archive size={20} /> أرشفة</button>
              )}
              {postId && (can('content.approve_final') || (['draft', 'rejected'].includes(status))) && (
                <button className="btn danger" onClick={() => setConfirming({ kind: 'delete' })}><Trash2 size={20} /> حذف المحتوى</button>
              )}
            </div>
          </div>

          {/* غلاف المقطع — يظهر حين يكون وسيط المحتوى مقطعاً واحداً */}
          {postId && can('draft.edit') && (
            <VideoCover postId={postId} body={body} coverId={coverId} onChange={setCoverId} onError={setErr} onMsg={setMsg} />
          )}

          {/* نسخة كل منصة — النص المخصّص وأول تعليق، ومعاينة ما سيصل كل منصة من الوسائط */}
          {postId && platforms.length > 0 && can('draft.edit') && (
            <PlatformVariants
              postId={postId}
              platforms={platforms}
              platLabels={platLabels}
              body={body}
              variants={variants}
              open={showVariants}
              onToggle={setShowVariants}
              onError={setErr}
              onMsg={setMsg}
            />
          )}

          {/* الجداول */}
          {(schedules.length > 0 || unscheduled.length > 0) && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h4 style={{ marginTop: 0 }}>مواعيد النشر</h4>
              {schedules.map((s) => {
                // «متأخر» للمعلّق وحده: الفاشل فات موعده دائماً، وكان يُعرض «متأخراً» فيخفي أنه رُفض
                const late = s.status === 'pending' && new Date(s.scheduled_at).getTime() < Date.now();
                return (
                  <div key={s.id} style={{ marginBottom: 8 }}>
                    {/* المنصة والشارة والإجراء في سطر، والموعد تحته: البطاقة ضيّقة، وكان
                        السطر الواحد يلتفّ في موضعٍ يختلف من منصةٍ إلى منصة */}
                    <div className="row" style={{ fontSize: 'var(--text-xs)', flexWrap: 'nowrap' }}>
                      <PlatformIcon platform={s.platform} size={16} />
                      <span>{platformLabel(s.platform, platLabels)}</span>
                      <div className="spacer" />
                      <span
                        className={`badge ${
                          s.deleted_at ? 'gray' : s.status === 'published' ? 'green' : s.status === 'failed' ? 'red' : late ? 'red' : 'gray'
                        }`}
                      >
                        {s.deleted_at ? 'محذوف' : late ? 'متأخر' : SCHED_STATUS[s.status]}
                      </span>
                      {/* المنشور يُحذف من منصته لمن ينشر الآن — وما حُذف يبقى سطره بشارته */}
                      {s.status === 'published' && !s.deleted_at && s.provider_post_id && can('content.approve_final') && (
                        <button
                          className="btn sm ghost"
                          title={`حذف من ${platformLabel(s.platform, platLabels)}`}
                          aria-label={`حذف من ${platformLabel(s.platform, platLabels)}`}
                          onClick={() => setConfirming({ kind: 'deletePublished', id: s.id, platform: s.platform })}
                        >
                          <Trash2 size={20} />
                        </button>
                      )}
                      {/* الإلغاء متاح للمعلّق والفاشل فقط — المنشور فعلاً لا يُلغى من هنا */}
                      {/* المتعثّر يُجدوَل من سطره، فلا يُعاد معه ما سواه */}
                      {s.status === 'failed' && can('content.schedule') && (
                        <button
                          className="btn sm ghost"
                          title="جدولة النشر"
                          aria-label={`جدولة النشر على ${platformLabel(s.platform, platLabels)}`}
                          onClick={() => setScheduleFor([s.platform])}
                        >
                          <CalendarClock size={20} />
                        </button>
                      )}
                      {['pending', 'failed'].includes(s.status) && can('content.schedule') && (
                        <button
                          className="btn sm ghost"
                          title="إلغاء الجدولة"
                          aria-label={`إلغاء الجدولة على ${platformLabel(s.platform, platLabels)}`}
                          onClick={() => setConfirming({ kind: 'cancelSchedule', id: s.id })}
                        >
                          <Trash2 size={20} />
                        </button>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 'var(--text-xs)' }}><bdi>{formatRiyadh(s.scheduled_at)}</bdi></div>
                    {/* سبب الفشل كما ردّه المزوّد أو المنصة، وما سترفضه المنصة إن فُحص عند الجدولة */}
                    {/* والمنشور قد يحمل ملاحظة: نشرةٌ من نشرات موعده لم تُنشر (سناب) */}
                    {['failed', 'pending', 'published'].includes(s.status) && s.error && (() => {
                      // رسالة المزوّد الإنجليزية في سطرها باتجاهها، لا ملفوفةً في الفقرة العربية
                      const { ar, ltr } = splitProviderReason(s.error);
                      return (
                        <div className={s.status === 'published' ? 'muted' : 'err'} style={{ fontSize: 'var(--text-xs)' }}>
                          <bdi>{ltr ? `${ar}:` : ar}</bdi>
                          {ltr && <div dir="ltr">{ltr}</div>}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
              {unscheduled.map((p) => (
                <div key={p} className="row" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-2)' }}>
                  <PlatformIcon platform={p} size={16} />
                  <span>{platformLabel(p, platLabels)}</span>
                  <span className="muted">— بلا موعد نشر</span>
                  {can('content.schedule') && !publishedOn.includes(p) && (
                    <>
                      <div className="spacer" />
                      <button
                        className="btn sm ghost"
                        title="جدولة النشر"
                        aria-label={`جدولة النشر على ${platformLabel(p, platLabels)}`}
                        onClick={() => setScheduleFor([p])}
                      >
                        <CalendarClock size={20} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* سجل النسخ */}
          {versions.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="row">
                <h4 style={{ marginTop: 0, marginBottom: 0 }}>سجل النسخ</h4>
                <div className="spacer" />
                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}><bdi>{versions.length}</bdi> نسخة</span>
              </div>
              <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setShowVersions(true)}>
                <History size={20} /> عرض واستعادة
              </button>
            </div>
          )}

          {/* سجل الموافقات */}
          {approvals.length > 0 && (
            <div className="card" style={{ marginBottom: notes.length ? 14 : 0 }}>
              <h4 style={{ marginTop: 0 }}>سجل الاعتماد</h4>
              {approvals.map((a) => (
                <div key={a.id} style={{ fontSize: 'var(--text-xs)', marginBottom: 8, borderInlineStart: '2px solid var(--border)', paddingInlineStart: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{a.actor_name} <ArrowLeft size={16} /> <StatusBadge status={a.to_status} /></div>
                  {a.note && <div className="muted">{a.note}</div>}
                  <div className="muted">{formatRiyadh(a.created_at)}</div>
                </div>
              ))}
            </div>
          )}

          {/* ملاحظات مستوردة من تعليقات بطاقة بيسكامب (ربط عكسي) — تظهر لأي منشور مرتبط ببطاقة */}
          {(basecampSynced || notes.length > 0) && (
            <div className="card">
              <div className="row" style={{ marginBottom: 6 }}>
                <h4 style={{ margin: 0 }}>ملاحظات بيسكامب</h4>
                <div className="spacer" />
                <button
                  className="naf-icon-btn"
                  onClick={syncNotes}
                  disabled={syncingNotes}
                  title="تحديث التعليقات من بيسكامب الآن"
                >
                  <RefreshCw size={20} className={syncingNotes ? 'spin' : ''} />
                </button>
              </div>
              {notes.map((n) => (
                <div key={n.id} style={{ fontSize: 'var(--text-xs)', marginBottom: 8, borderInlineStart: '2px solid var(--border)', paddingInlineStart: 8 }}>
                  <div><strong>{n.author_name || 'بيسكامب'}</strong></div>
                  <div className="muted">{n.body}</div>
                  <div className="muted">{formatRiyadh(n.created_at)}</div>
                </div>
              ))}
              {notes.length === 0 && <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>لا توجد تعليقات بعد. اضغط التحديث لجلب أحدث تعليقات بيسكامب.</p>}
            </div>
          )}
        </div>
      </div>

      {showAI && (
        <AIModal
          platforms={platforms}
          tones={tones}
          onClose={() => setShowAI(false)}
          onResult={(t) => { editorRef.current?.insertHtml(`<p>${t.replace(/\n/g, '<br/>')}</p>`); setShowAI(false); }}
        />
      )}
      {showKB && (
        <KBModal
          platforms={platforms}
          tones={tones}
          onClose={() => setShowKB(false)}
          onResult={(t, title) => {
            editorRef.current?.insertHtml(`<p>${t.replace(/\n/g, '<br/>')}</p>`);
            if (title) setTitle((cur) => cur || title);
            setShowKB(false);
          }}
        />
      )}
      {showMediaGen && (
        <MediaGenModal
          platforms={platforms}
          tones={tones}
          onClose={() => setShowMediaGen(false)}
          onResult={(t) => { editorRef.current?.insertHtml(`<p>${t.replace(/\n/g, '<br/>')}</p>`); setShowMediaGen(false); }}
        />
      )}
      {showAIMedia && (
        <AIMediaModal
          onClose={() => setShowAIMedia(false)}
          onResult={(m) => { editorRef.current?.insertHtml(mediaEmbedHtml(m)); setShowAIMedia(false); }}
        />
      )}
      {viewer && (
        <MediaViewer
          media={viewer}
          onClose={() => setViewer(null)}
          onDelete={readOnly ? undefined : () => editorRef.current?.removeMedia(viewer.id)}
        />
      )}
      {showVersions && postId && (
        <VersionsModal
          versions={versions}
          onClose={() => setShowVersions(false)}
          onRestore={async (vId) => {
            await api.post(`/posts/${postId}/versions/${vId}/restore`);
            setShowVersions(false);
            await loadPost(postId);
            setMsg('تمت استعادة النسخة');
          }}
        />
      )}
      {showTemplates && (
        <TemplatesModal
          currentBody={body}
          onClose={() => setShowTemplates(false)}
          onInsert={(tplBody) => { editorRef.current?.insertHtml(tplBody); setShowTemplates(false); }}
        />
      )}
      {showReject && (
        <RejectModal
          onClose={() => setShowReject(false)}
          onReject={async (reason) => { setShowReject(false); await doAction('reject', reason); }}
        />
      )}
      {(showSchedule || scheduleFor) && postId && (
        <ScheduleModal
          postId={postId}
          platforms={[...new Set([...platforms, ...(scheduleFor || [])])].filter((p) => !publishedOn.includes(p))}
          labels={platLabels}
          initialPlatforms={scheduleFor || plan.planned_platforms.filter((p) => platforms.includes(p) && !publishedOn.includes(p))}
          initialDay={plan.planned_on && plan.planned_on >= riyadhToday() ? plan.planned_on : ''}
          onClose={() => { setShowSchedule(false); setScheduleFor(null); }}
          onDone={async (issues) => {
            setShowSchedule(false);
            setScheduleFor(null);
            await loadPost(postId);
            setStatus('scheduled');
            /* ما سترفضه المنصات يُقال الآن — بمنصّته وسببه، كما يُقال رفض «نشر الآن» —
               ويبقى مكتوباً تحت موعده حتى يُصلَح المحتوى وتُعاد الجدولة. */
            setErr(issues.map((e) => `${platformLabel(e.platform, platLabels)}: ${e.error}`).join(' · '));
          }}
        />
      )}

      {confirming?.kind === 'publish' && (
        <ConfirmModal
          title="النشر الآن"
          message={
            confirming.early
              ? <>الموعد المجدول لم يحن بعد (<bdi>{confirming.when}</bdi>). يُنشر المحتوى فوراً على كل منصاته.</>
              : 'يُنشر المحتوى فوراً على كل منصاته المجدولة.'
          }
          actionLabel="نشر"
          busy={publishing}
          onConfirm={doPublishNow}
          onClose={() => setConfirming(null)}
        />
      )}

      {confirming?.kind === 'delete' && (
        <ConfirmModal
          title="حذف المحتوى"
          message="يُحذف المحتوى وكل ما ارتبط به من نسخ ومواعيد ونتائج. لا يمكن التراجع عن هذا."
          actionLabel="حذف"
          danger
          onConfirm={deletePost}
          onClose={() => setConfirming(null)}
        />
      )}

      {confirming?.kind === 'deletePublished' && (() => {
        const name = platformLabel(confirming.platform, platLabels);
        return (
          <ConfirmModal
            title={`حذف المنشور من ${name}`}
            message={DELETE_IN_APP.has(confirming.platform)
              ? `${name} لا تتيح حذف المنشور إلا من تطبيقها: احذفه منه أولاً، ثم احذفه هنا ليُسجَّل محذوفاً ويتوقّف سحب أرقامه. ويبقى المحتوى ويمكن جدولته من جديد.`
              : `يُحذف المنشور من ${name} نفسها ومعه تفاعلاته وتعليقاته هناك. ويبقى المحتوى هنا ويمكن جدولته من جديد. لا يمكن التراجع عن هذا.`}
            actionLabel="حذف"
            danger
            onConfirm={() => deletePublished(confirming.id, confirming.platform)}
            onClose={() => setConfirming(null)}
          />
        );
      })()}

      {confirming?.kind === 'cancelSchedule' && (
        <ConfirmModal
          title="إلغاء الجدولة"
          message="لا يُنشر المحتوى على هذه المنصة. ويبقى كما هو ويمكن جدولته عليها من جديد."
          actionLabel="إلغاء الجدولة"
          danger
          onConfirm={() => cancelSchedule(confirming.id)}
          onClose={() => setConfirming(null)}
        />
      )}

      {confirming?.kind === 'cancelPlatforms' && (
        <ConfirmModal
          title="إلغاء الجدولة"
          message={<>لا يُنشر المحتوى على: <bdi>{confirming.platforms.map((p) => platformLabel(p, platLabels)).join('، ')}</bdi>. ويبقى كما هو ويمكن جدولته عليها من جديد.</>}
          actionLabel="إلغاء الجدولة"
          danger
          onConfirm={() => cancelPlatforms(confirming.platforms, confirming.schedule)}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

const SCHED_STATUS: Record<string, string> = { pending: 'معلّق', processing: 'قيد النشر', published: 'منشور', failed: 'فاشل' };

/** منصاتٌ لا يُحذف منشورها عبر الواجهة: يُحذف من تطبيقها ثم يُسجَّل هنا محذوفاً
    بعد أن يتحقّق المزوّد أنه زال (`deleteFromPlatform` في `adapters/ayrshare.ts`). */
const DELETE_IN_APP = new Set(['instagram', 'tiktok']);

function AIModal({ platforms, tones, onClose, onResult }: { platforms: string[]; tones: Tone[]; onClose: () => void; onResult: (t: string) => void }) {
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState(platforms[0] || 'linkedin');
  const [tone, setTone] = useState(tones[0]?.key || 'formal');
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
    <Modal title="توليد نص بالذكاء الاصطناعي (\u2068Claude\u2069)" onClose={onClose}>
      <div className="field">
        <label>الموضوع / الفكرة</label>
        <textarea className="textarea" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="مثال: أهمية توثيق العقود التجارية للشركات الناشئة" />
      </div>
      <div className="grid cols-3">
        <div className="field">
          <label>المنصة</label>
          <select className="select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>النبرة</label>
          <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
            {tones.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
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
      <button className="btn gold" onClick={run} disabled={busy || !topic}>
        <Sparkles size={20} /> {busy ? 'جارٍ التوليد…' : 'توليد وحقن في المحرر'}
      </button>
    </Modal>
  );
}

// توليد محتوى من وسيط مرفوع (صورة/PDF عبر رؤية Claude؛ غيرها بالاسم)
function MediaGenModal({
  platforms,
  tones,
  onClose,
  onResult,
}: {
  platforms: string[];
  tones: Tone[];
  onClose: () => void;
  onResult: (text: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState(platforms[0] || 'linkedin');
  const [tone, setTone] = useState(tones[0]?.key || 'formal');
  const [length, setLength] = useState('medium');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  async function run() {
    if (!file) return;
    setErr('');
    try {
      setBusy('جارٍ رفع الوسيط…');
      const up = await uploadMedia(file);
      setBusy('جارٍ تحليل الوسيط وتوليد المحتوى…');
      const d = await api.post(`/media/${up.id}/generate`, { platform, tone, length });
      onResult(d.text);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <Modal title="توليد محتوى من وسيط" onClose={onClose}>
      <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
        ارفع صورة أو ملف PDF ليحلّله Claude ويولّد منه منشوراً. الأنواع الأخرى (صوت/فيديو/وورد/إكسل) يُستفاد من اسمها كموضوع.
      </p>
      <label className="btn ghost" style={{ cursor: 'pointer' }}>
        <ImagePlus size={20} /> {file ? file.name : 'اختيار وسيط'}
        <input type="file" hidden accept="image/*,application/pdf,audio/*,video/*,.doc,.docx,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </label>
      <div className="grid cols-3" style={{ marginTop: 14 }}>
        <div className="field">
          <label>المنصة</label>
          <select className="select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>النبرة</label>
          <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
            {tones.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
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
      <button className="btn gold" onClick={run} disabled={!file || !!busy}>
        <Sparkles size={20} /> {busy || 'توليد وحقن في المحرر'}
      </button>
    </Modal>
  );
}

// توليد صورة أو فيديو بالذكاء الاصطناعي من وصف نصّي (prompt) وإدراجه في المحرر
function AIMediaModal({
  onClose,
  onResult,
}: {
  onClose: () => void;
  onResult: (m: { id: string; url: string; filename?: string; mime_type?: string }) => void;
}) {
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  async function pollVideo(jobId: string) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const d = await api.get(`/media/generate/video/${jobId}`);
      if (d.status === 'completed' && d.media) {
        onResult(d.media);
        return;
      }
      if (d.status === 'failed') {
        setErr(d.error || 'فشل توليد الفيديو');
        setBusy(false);
        return;
      }
      setStatus('جارٍ المعالجة… قد يستغرق دقائق');
    }
    setErr('استغرق التوليد وقتاً طويلاً — حاول لاحقاً');
    setBusy(false);
  }

  async function run() {
    if (!prompt.trim()) return;
    setErr(''); setBusy(true); setStatus('جارٍ التوليد…');
    try {
      if (kind === 'image') {
        const d = await api.post('/media/generate/image', { prompt: prompt.trim() });
        onResult(d);
      } else {
        const d = await api.post('/media/generate/video', { prompt: prompt.trim() });
        setStatus('بدأت المهمة… جارٍ الاستقصاء عن النتيجة');
        await pollVideo(d.jobId);
      }
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="توليد صورة أو فيديو بالذكاء الاصطناعي" onClose={onClose}>
      <div className="row" style={{ marginBottom: 14 }}>
        <button type="button" className={`btn sm ${kind === 'image' ? '' : 'ghost'}`} onClick={() => setKind('image')}>
          <ImageIcon size={20} /> صورة
        </button>
        <button type="button" className={`btn sm ${kind === 'video' ? '' : 'ghost'}`} onClick={() => setKind('video')}>
          <Video size={20} /> فيديو
        </button>
      </div>
      <div className="field">
        <label>وصف {kind === 'image' ? 'الصورة' : 'الفيديو'} (Prompt)</label>
        <textarea
          className="textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={kind === 'image' ? 'مثال: مكتب محاماة عصري بإضاءة دافئة' : 'مثال: لقطة قصيرة لمبنى مكاتب عصري عند الغروب'}
        />
      </div>
      {err && <p className="err">{err}</p>}
      {busy && !err && (
        <p className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Loader size={16} className="spin" /> {status}
        </p>
      )}
      <button className="btn gold" onClick={run} disabled={busy || !prompt.trim()}>
        <Sparkles size={20} /> {busy ? 'جارٍ التوليد…' : `توليد ${kind === 'image' ? 'الصورة' : 'الفيديو'} وإدراجه`}
      </button>
    </Modal>
  );
}

// مركز المعرفة — اختيار ملف من بيسكامب وتوليد محتوى منه
function KBModal({
  platforms,
  tones,
  onClose,
  onResult,
}: {
  platforms: string[];
  tones: Tone[];
  onClose: () => void;
  onResult: (text: string, title: string) => void;
}) {
  const [status, setStatus] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [platform, setPlatform] = useState(platforms[0] || 'linkedin');
  const [tone, setTone] = useState(tones[0]?.key || 'formal');
  const [length, setLength] = useState('medium');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const s = await api.get('/basecamp/status');
        setStatus(s);
        if (s.configured && s.project_set) {
          const d = await api.get('/basecamp/files');
          setFiles(d.files || []);
        }
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function generate() {
    if (!selected) return;
    setBusy(true);
    setErr('');
    try {
      const d = await api.post('/basecamp/generate', {
        type: selected.type,
        id: selected.id,
        platform,
        tone,
        length,
      });
      onResult(d.text, d.title || selected.title);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="مركز المعرفة — توليد من ملف بيسكامب" onClose={onClose}>
      {loading && <p className="muted">جارٍ التحميل…</p>}

      {!loading && (!status?.configured || !status?.project_set) && (
        <div className="card" style={{ background: 'var(--warning-soft)' }}>
          <p style={{ margin: 0 }}>
            لم يُضبط تكامل بيسكامب بعد. اذهب إلى <b>الإعدادات<ChevronLeft size={16} style={{ verticalAlign: -2 }} />التكاملات</b> لضبط معرّف الحساب والمشروع،
            واضبط الأسرار عبر Cloudflare. عندها ستظهر ملفات «مركز المعرفة» هنا.
          </p>
        </div>
      )}

      {!loading && status?.configured && status?.project_set && (
        <>
          <div className="field">
            <label>اختر ملفاً من مركز المعرفة</label>
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              {files.length === 0 && <p className="muted" style={{ padding: 12 }}>لا مرفقات في هذا المحتوى. أضف أول مرفق.</p>}
              {files.map((f) => (
                <div
                  key={`${f.type}-${f.id}`}
                  onClick={() => setSelected(f)}
                  style={{
                    padding: '9px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    background: selected?.id === f.id && selected?.type === f.type ? 'var(--primary-soft)' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 'var(--text-sm)' }}>{f.title}</div>
                  <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{f.type === 'Document' ? 'مستند' : 'ملف مرفوع'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid cols-3">
            <div className="field">
              <label>المنصة</label>
              <select className="select" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
              </select>
            </div>
            <div className="field">
              <label>النبرة</label>
              <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
                {tones.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
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

          <button className="btn gold" onClick={generate} disabled={busy || !selected}>
            <Sparkles size={20} /> {busy ? 'جارٍ التوليد…' : 'توليد من الملف المختار'}
          </button>
        </>
      )}

      {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

// سجل نسخ المحتوى — استعراض واستعادة نسخة سابقة
function VersionsModal({
  versions,
  onClose,
  onRestore,
}: {
  versions: any[];
  onClose: () => void;
  onRestore: (versionId: string) => void;
}) {
  /* التأكيد في مكانه لا في نافذةٍ فوق نافذة: `ConfirmModal` يرسم غطاءه
     الخاص، وغطاءٌ داخل غطاء يجعل نقرة الإلغاء تُغلق الاثنين معاً —
     تصعد إلى `onClick` الغطاء الخارجي. والصيغة من naf-terms §٤:
     جملةٌ تقول ما سيحدث، وزرٌّ يحمل اسم الفعل. */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <Modal title="سجل النسخ" onClose={onClose}>
      <div style={{ maxHeight: 400, overflow: 'auto' }}>
        {versions.map((v) => (
          <div key={v.id} className="card" style={{ marginBottom: 10 }}>
            <div className="row">
              <div>
                <div style={{ fontWeight: 600 }}>{v.title}</div>
                <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{v.editor_name} — {formatRiyadh(v.created_at)}</div>
              </div>
              <div className="spacer" />
              {confirmId !== v.id && (
                <button className="btn ghost sm" onClick={() => setConfirmId(v.id)}>
                  <History size={20} /> استعادة
                </button>
              )}
            </div>
            {confirmId === v.id && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '0 0 var(--space-2)' }}>
                  يعود المحتوى إلى هذه النسخة، ويُحفظ الحالي نسخةً قبلها فلا يضيع.
                </p>
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  <div className="spacer" />
                  <button className="btn ghost sm" onClick={() => setConfirmId(null)}>إلغاء</button>
                  <button className="btn sm" onClick={() => { setConfirmId(null); onRestore(v.id); }}>استعادة</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {versions.length === 0 && <p className="muted">لا نسخ سابقة بعد. تُحفظ نسخة مع كل تعديل.</p>}
      </div>
    </Modal>
  );
}

// قوالب/مقتطفات المحتوى — اختيار قالب للإدراج، أو حفظ المحتوى الحالي كقالب جديد
function TemplatesModal({
  currentBody,
  onClose,
  onInsert,
}: {
  currentBody: string;
  onClose: () => void;
  onInsert: (body: string) => void;
}) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [name, setName] = useState('');
  // تأكيد الحذف في مكانه — انظر `VersionsModal` أعلاه لسبب ترك النافذة
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get('/templates').then((d) => setTemplates(d.templates));
  }
  useEffect(load, []);

  async function saveCurrent() {
    setErr(''); setMsg('');
    if (!name.trim()) return setErr('أدخل اسماً للقالب');
    if (!currentBody.trim()) return setErr('اكتب المحتوى أولاً ثم احفظه كقالب');
    try {
      await api.post('/templates', { name: name.trim(), body: currentBody });
      setName(''); setMsg('تم حفظ القالب'); load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function remove(id: string) {
    setConfirmId(null);
    await api.del(`/templates/${id}`);
    load();
  }

  return (
    <Modal title="القوالب والمقتطفات" onClose={onClose}>
      <div className="field">
        <label>حفظ المحتوى الحالي كقالب جديد</label>
        <div className="row">
          <input className="input" style={{ flex: 1 }} placeholder="اسم القالب" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn ghost sm" onClick={saveCurrent}>حفظ</button>
        </div>
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
      </div>

      <div className="field">
        <label>القوالب المتاحة</label>
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          {templates.map((t) => (
            <div key={t.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{t.name}</div>
                <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{t.creator_name}</div>
              </div>
              <div className="spacer" />
              {confirmId === t.id ? (
                <>
                  <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>يُحذف القالب نهائياً.</span>
                  <button className="btn ghost sm" onClick={() => setConfirmId(null)}>إلغاء</button>
                  <button className="btn danger sm" onClick={() => remove(t.id)}>حذف</button>
                </>
              ) : (
                <>
                  <button className="btn sm" onClick={() => onInsert(t.body)}>إدراج</button>
                  <button className="btn danger sm" title="حذف" onClick={() => setConfirmId(t.id)}><Trash2 size={20} /></button>
                </>
              )}
            </div>
          ))}
          {templates.length === 0 && <p className="muted">لا قوالب محفوظة بعد. احفظ المحتوى الحالي كقالب.</p>}
        </div>
      </div>
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

