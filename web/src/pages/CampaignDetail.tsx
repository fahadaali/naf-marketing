import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArrowRight, CopyPlus, FolderMinus, GanttChart, LayoutGrid, Pencil, Plus, RotateCcw,
} from 'lucide-react';
import { api, STATUS_LABELS, STATUS_BADGE, displayStatus } from '../api';
import { useAuth } from '../auth';
import { formatDate, formatNumber, isolate } from '../lib/format';
import { targetStatus } from '../metrics';
import type { TargetStatus } from '../metrics';
import { CampaignBadge } from '../components/StateBadge';
import StatusBadge from '../components/StatusBadge';
import TargetBadge from '../components/TargetBadge';
import PostKanban, { moveAction } from '../components/PostKanban';
import Bar from '../components/Bar';
import Modal from '../components/Modal';
import ConfirmModal, { FieldModal } from '../components/ConfirmModal';
import CampaignForm from '../components/CampaignForm';
import { Money } from '../components/Money';
import { PlatformIcon, platformLabel } from '../platforms';
import { CAMPAIGN_STATUS_LABELS, daysRemaining, parsePlatforms } from '../campaigns';

/* صفحة الحملة.

   كانت نافذةً داخل القائمة: لا رابط يُشارَك، ولا رجوع، ولا بقاء بعد
   تحديث الصفحة. وصارت مساراً — والمحتوى يُدار من داخلها، والأداء يُقاس
   أمام مستهدفٍ مسجَّل لا رقماً مجرّداً. */

const ARCHIVE_MESSAGE = 'ستخرج الحملة من القائمة ويبقى محتواها وأرقامها كما هي. يمكن استعادتها لاحقاً.';

/** تسمية زرّ الانتقال — الفعل باسمه من naf-terms.md §١. */
const TRANSITION_LABEL: Record<string, string> = {
  active: 'بدء الحملة',
  completed: 'إنهاء الحملة',
  archived: 'أرشفة',
};

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [campaign, setCampaign] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [transitions, setTransitions] = useState<string[]>([]);
  const [rollup, setRollup] = useState<any>(null);
  const [view, setView] = useState<'board' | 'timeline'>('board');
  const [showEdit, setShowEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [rejecting, setRejecting] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [notFound, setNotFound] = useState(false);

  const canWrite = can('content.schedule');
  const canSeeNumbers = can('analytics.view');

  const load = useCallback(() => {
    if (!id) return;
    api.get(`/campaigns/${id}`)
      .then((d) => {
        setCampaign(d.campaign);
        setPosts(d.posts);
        setTransitions(d.allowed_transitions || []);
      })
      .catch((e) => { setNotFound(true); setErr(e.message); });
    if (canSeeNumbers) {
      api.get(`/campaigns/${id}/rollup`).then(setRollup).catch(() => {});
    }
  }, [id, canSeeNumbers]);

  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of posts) { const s = displayStatus(p); c[s] = (c[s] || 0) + 1; }
    return c;
  }, [posts]);

  const published = posts.filter((p) => p.status === 'published').length;

  async function changeStatus(to: string) {
    setErr(''); setMsg('');
    try {
      await api.patch(`/campaigns/${id}`, { status: to });
      setMsg(to === 'archived' ? 'تمت أرشفة الحملة' : 'تم تحديث الحملة');
      setConfirmArchive(false);
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function duplicate() {
    setErr('');
    try {
      const r = await api.post(`/campaigns/${id}/duplicate`, {});
      navigate(`/campaigns/${r.id}`);
    } catch (e: any) { setErr(e.message); }
  }

  async function unlink(postId: string) {
    setErr('');
    try {
      await api.del(`/campaigns/${id}/posts/${postId}`);
      setMsg('تم فصل المحتوى عن الحملة');
      load();
    } catch (e: any) { setErr(e.message); }
  }

  // نقل بطاقةٍ بين أعمدة المحتوى — الحارس نفسه الذي تستعمله قائمة المحتوى.
  async function onMovePost(post: any, toCol: string) {
    setErr(''); setMsg('');
    const action = moveAction(post.status, toCol);
    if (!action) {
      setErr('انتقال غير مسموح — تُدار الجدولة والنشر من المحرر، ولا يمكن تجاوز مراحل الاعتماد.');
      return;
    }
    if (action === 'reject') { setRejecting({ post, toCol }); return; }
    await applyMove(post, toCol, action);
  }

  async function applyMove(post: any, toCol: string, action: string, note?: string) {
    const target = action === 'reject' ? 'rejected' : toCol;
    setPosts((ps) => ps.map((p) => (p.id === post.id ? { ...p, status: target } : p)));
    try {
      await api.post(`/posts/${post.id}/action`, { action, note });
      setMsg('تم نقل المحتوى');
      load();
    } catch (e: any) {
      setErr(e.message);
      load();
    }
  }

  if (notFound) {
    return (
      <div>
        <BackLink onClick={() => navigate('/campaigns')} />
        <p className="muted">غير موجودة</p>
      </div>
    );
  }
  if (!campaign) return <p className="muted">جارٍ التحميل…</p>;

  const platforms = parsePlatforms(campaign.target_platforms);
  const days = daysRemaining(campaign.end_date);

  return (
    <div>
      <BackLink onClick={() => navigate('/campaigns')} />

      <div className="row">
        <h1 className="page-title">{campaign.name}</h1>
        <CampaignBadge state={campaign.status} />
        <div className="spacer" />
        {canWrite && (
          <>
            <button className="btn ghost sm" onClick={() => setShowEdit(true)}>
              <Pencil size={20} /> تعديل
            </button>
            <button className="btn ghost sm" onClick={duplicate}>
              <CopyPlus size={20} /> إنشاء نسخة
            </button>
            {transitions.filter((t) => t !== 'archived').map((t) => (
              <button key={t} className="btn sm" onClick={() => changeStatus(t)}>
                {TRANSITION_LABEL[t] || CAMPAIGN_STATUS_LABELS[t]}
              </button>
            ))}
            {transitions.includes('archived') && (
              <button className="btn ghost sm" onClick={() => setConfirmArchive(true)}>
                <Archive size={20} /> أرشفة
              </button>
            )}
            {campaign.status === 'archived' && transitions.includes('completed') && (
              <button className="btn ghost sm" onClick={() => changeStatus('completed')}>
                <RotateCcw size={20} /> استعادة
              </button>
            )}
          </>
        )}
      </div>

      <div className="row meta-row page-back">
        <span className="muted">
          من <bdi>{campaign.start_date ? formatDate(campaign.start_date) : '—'}</bdi>
          {' '}إلى <bdi>{campaign.end_date ? formatDate(campaign.end_date) : '—'}</bdi>
        </span>
        {days !== null && campaign.status !== 'completed' && campaign.status !== 'archived' && (
          <span className="muted">
            {days < 0 ? 'انتهت المدة' : <>متبقٍ <bdi>{formatNumber(days)}</bdi> يوماً</>}
          </span>
        )}
        <span className="muted">مسؤول الحملة: {campaign.owner_name || '—'}</span>
        {campaign.budget != null && (
          <span className="muted">الميزانية: <Money value={campaign.budget} /></span>
        )}
        {platforms.map((p) => (
          <span key={p} className="row platform-row">
            <PlatformIcon platform={p} size={16} /> {platformLabel(p)}
          </span>
        ))}
      </div>

      {campaign.objective && <p className="muted">{campaign.objective}</p>}

      {msg && <p className="ok">{msg}</p>}
      {err && <p className="err">{err}</p>}

      {canSeeNumbers && <Performance rollup={rollup} />}

      {/* التقدّم — شريطٌ ورقمٌ، والشرائح تقول أين وقف المحتوى. */}
      <div className="card section-gap">
        <div className="row meta-row">
          <strong>التقدّم</strong>
          <div className="spacer" />
          <span className="muted">
            <bdi>{formatNumber(published)}</bdi> من <bdi>{formatNumber(posts.length)}</bdi> منشور
          </span>
        </div>
        <Bar value={published} max={Math.max(posts.length, 1)} />
        <div className="row toolbar-row">
          {Object.keys(counts).length === 0 && (
            <span className="muted">لا محتوى في هذه الحملة بعد. أضف أول محتوى.</span>
          )}
          {Object.entries(counts).map(([s, n]) => (
            <span key={s} className="row platform-row">
              <StatusBadge status={s} /> <b><bdi>{formatNumber(n)}</bdi></b>
            </span>
          ))}
        </div>
      </div>

      <div className="row section-gap">
        <div className="seg">
          <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>
            <LayoutGrid size={20} /> كانبان
          </button>
          <button className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>
            <GanttChart size={20} /> جانت
          </button>
        </div>
        <div className="spacer" />
        {canWrite && (
          <button className="btn sm" onClick={() => setShowAdd(true)}>
            <Plus size={20} /> إضافة محتوى
          </button>
        )}
      </div>

      <div className="toolbar-row">
        {view === 'board' ? (
          <PostKanban
            rows={posts}
            showCampaign={false}
            onOpen={(p) => navigate(`/editor/${p.id}`)}
            onMove={onMovePost}
            cardAction={canWrite ? (p) => (
              <button className="btn ghost sm" onClick={() => unlink(p.id)}>
                <FolderMinus size={16} /> إزالة من الحملة
              </button>
            ) : undefined}
          />
        ) : (
          <Timeline posts={posts} campaign={campaign} late={rollup?.late ?? 0} />
        )}
      </div>

      {showEdit && (
        <CampaignForm
          campaign={campaign}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); setMsg('تم تحديث الحملة'); load(); }}
        />
      )}

      {showAdd && (
        <AddPostsModal
          campaignId={campaign.id}
          onClose={() => setShowAdd(false)}
          onDone={(n) => {
            setShowAdd(false);
            setMsg(`تم ربط المحتوى بالحملة — ${isolate(n)}`);
            load();
          }}
        />
      )}

      {confirmArchive && (
        <ConfirmModal
          title="أرشفة الحملة"
          message={ARCHIVE_MESSAGE}
          actionLabel="أرشفة"
          onConfirm={() => changeStatus('archived')}
          onClose={() => setConfirmArchive(false)}
        />
      )}

      {rejecting && (
        <FieldModal
          title="رفض المحتوى"
          label="سبب الرفض"
          actionLabel="رفض"
          hint="السبب إلزامي — ويظهر لصاحب المحتوى في سجلّ الاعتماد."
          onSubmit={(value) => {
            if (!value) return;
            const { post, toCol } = rejecting;
            setRejecting(null);
            applyMove(post, toCol, 'reject', value);
          }}
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  );
}

/* «رجوع» بـ ArrowRight: الخريطة تختار الاسم بمظهره في RTL، وهو الأصل. */
function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn ghost sm page-back" onClick={onClick}>
      <ArrowRight size={20} /> رجوع
    </button>
  );
}

/* شريط الأداء — كل رقمٍ وحالتُه أمام مستهدفه.
   واللون وحده لا يقول شيئاً: أيقونةٌ ونصٌّ معه دائماً. ومستهدفٌ غير
   مسجّل يُعرض «لا مستهدف» صراحةً لا فراغاً ولا شرطة. */
function Performance({ rollup }: { rollup: any }) {
  if (!rollup) return null;
  const t = rollup.totals || {};
  const targets = rollup.targets || {};
  const hasNumbers = (t.impressions || 0) + (t.engagement || 0) + (t.reach || 0) > 0;

  return (
    <div className="section-gap">
      <div className="grid cols-4">
        <Kpi label="الظهور" value={t.impressions || 0} target={targets.target_impressions} />
        <Kpi label="التفاعل" value={t.engagement || 0} target={targets.target_engagement} />
        <Kpi label="الوصول" value={t.reach || 0} target={null} />
        <div className="card stat">
          <div className="num"><bdi>{formatNumber(t.engagement_rate || 0)}%</bdi></div>
          <div className="label">معدل التفاعل</div>
        </div>
      </div>

      {!hasNumbers && (
        <p className="muted toolbar-row">لا أرقام لهذه الحملة بعد. انشر محتوى ثم اسحب التحليلات.</p>
      )}

      {rollup.byPlatform?.length > 0 && (
        <div className="card section-gap">
          <div className="row meta-row"><strong>الأداء حسب المنصة</strong></div>
          {rollup.byPlatform.map((p: any) => (
            <div key={p.platform} className="target-line">
              <div className="row meta-row">
                <PlatformIcon platform={p.platform} size={16} />
                <span>{platformLabel(p.platform)}</span>
                <div className="spacer" />
                <span className="muted"><bdi>{formatNumber(p.impressions || 0)}</bdi> ظهور</span>
              </div>
              <Bar value={p.impressions || 0} max={Math.max(1, ...rollup.byPlatform.map((x: any) => x.impressions || 0))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, target }: { label: string; value: number; target: number | null | undefined }) {
  /* كل مستهدفات الحملة `higher_better` بطبعها — الظهور والتفاعل
     والعملاء المحتملون كلّها الأعلى فيها أفضل، فلا عمود اتجاهٍ
     يحمل قيمةً واحدة. */
  const status: TargetStatus = targetStatus(value, target ?? null, 'higher_better', null, null);
  const pct = target ? Math.round((value / target) * 100) : null;
  return (
    <div className="card stat">
      <div className="num"><bdi>{formatNumber(value)}</bdi></div>
      <div className="label">{label}</div>
      <div className="target-line">
        <TargetBadge status={status} />
      </div>
      {target != null && (
        <div className="target-line">
          <span className="muted meta-row">
            <bdi>{formatNumber(pct || 0)}%</bdi> من المستهدف <bdi>{formatNumber(target)}</bdi>
          </span>
          <Bar value={value} max={target} />
        </div>
      )}
    </div>
  );
}

/* الخطّ الزمني — منشورات الحملة على مدّتها المسجّلة.
   وفجواتُ النشر تُقال رقماً لا خلايا ملوّنة: يومٌ هادئ ليس عطلاً. */
function Timeline({ posts, campaign, late }: { posts: any[]; campaign: any; late: number }) {
  const dated = posts
    .map((p) => ({ p, at: p.pending_at || (p.status === 'published' ? p.updated_at : null) }))
    .filter((x) => x.at)
    .map((x) => ({ ...x, t: new Date(x.at).getTime() }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);

  if (dated.length === 0) {
    return <div className="card muted table-empty">لا محتوى مجدول لعرضه على المخطّط الزمني. جدوِل أول محتوى.</div>;
  }

  const start = campaign.start_date ? new Date(`${campaign.start_date}T00:00:00Z`).getTime() : dated[0].t;
  const end = campaign.end_date ? new Date(`${campaign.end_date}T23:59:59Z`).getTime() : dated[dated.length - 1].t;
  const min = Math.min(start, dated[0].t);
  const max = Math.max(end, dated[dated.length - 1].t, min + 86_400_000);
  const range = max - min;
  const pct = (t: number) => ((t - min) / range) * 100;

  // أيامٌ بلا نشرٍ داخل المدّة — عددٌ يُقال، لا خلايا تُصبغ.
  const busyDays = new Set(dated.map((x) => new Date(x.t).toISOString().slice(0, 10)));
  const totalDays = Math.max(1, Math.ceil(range / 86_400_000));
  const quiet = Math.max(0, totalDays - busyDays.size);

  const ticks: { left: number; label: string }[] = [];
  const step = Math.max(1, Math.ceil(totalDays / 8));
  for (let d = 0; d <= totalDays; d += step) {
    const t = min + d * 86_400_000;
    ticks.push({ left: pct(t), label: formatDate(new Date(t)) });
  }
  const todayLeft = pct(Date.now());

  return (
    <div>
      <p className="muted meta-row">
        <bdi>{formatNumber(quiet)}</bdi> يوماً بلا نشر خلال مدّة الحملة
        {late > 0 && <> · <bdi>{formatNumber(late)}</bdi> مجدول متأخر</>}
      </p>
      <div className="gantt">
        <div className="gantt-head">
          <div className="gantt-label">المحتوى</div>
          <div className="gantt-track gantt-head-track">
            {ticks.map((t, i) => (
              <div key={i} className="gantt-tick" style={{ insetInlineStart: `${t.left}%` }}>{t.label}</div>
            ))}
          </div>
        </div>
        {dated.map(({ p, t }) => {
          const st = displayStatus(p);
          return (
            <div className="gantt-row" key={p.id}>
              <div className="gantt-label" title={p.title}>
                <StatusBadge status={st} size={16} iconOnly />
                {p.title}
              </div>
              <div className="gantt-track">
                {todayLeft >= 0 && todayLeft <= 100 && (
                  <div className="gantt-today" style={{ insetInlineStart: `${todayLeft}%` }} />
                )}
                <div
                  className={`gantt-point badge ${STATUS_BADGE[st] || 'gray'}`}
                  style={{ insetInlineStart: `${Math.min(Math.max(pct(t), 0), 100)}%` }}
                  title={`${p.title} — ${STATUS_LABELS[st]}`}
                >
                  {STATUS_LABELS[st]}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* إضافة محتوى قائم إلى الحملة — كان يتمّ من المحرر أو قائمة المحتوى فقط. */
function AddPostsModal({
  campaignId, onClose, onDone,
}: {
  campaignId: string;
  onClose: () => void;
  onDone: (n: number) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/posts')
      .then((d) => setRows((d.posts || []).filter((p: any) => !p.campaign_id)))
      .catch((e) => setErr(e.message));
  }, []);

  const shown = rows.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()));

  async function apply() {
    setBusy(true);
    setErr('');
    try {
      await api.post(`/campaigns/${campaignId}/posts`, { post_ids: Array.from(sel) });
      onDone(sel.size);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="إضافة محتوى إلى الحملة" onClose={onClose}>
      <div className="search-inline field">
        <input className="input" placeholder="بحث في العنوان…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="pick-list">
        {shown.map((p) => (
          <label key={p.id} className="row pick-item">
            <input
              type="checkbox"
              className="chk"
              checked={sel.has(p.id)}
              onChange={() => setSel((s) => {
                const n = new Set(s);
                if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
                return n;
              })}
            />
            <span>{p.title}</span>
            <div className="spacer" />
            <StatusBadge status={displayStatus(p)} />
          </label>
        ))}
        {shown.length === 0 && (
          <p className="muted">{rows.length === 0 ? 'كل المحتوى مرتبط بحملات.' : 'لا نتائج مطابقة لبحثك. جرّب كلمات أخرى.'}</p>
        )}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="row">
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>إلغاء</button>
        <button className="btn" disabled={!sel.size || busy} onClick={apply}>إضافة</button>
      </div>
    </Modal>
  );
}
