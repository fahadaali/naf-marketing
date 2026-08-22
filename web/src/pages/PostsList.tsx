import { isolate, formatDate } from '../lib/format';

// إزاحة الرياض الثابتة (+3 بلا توقيت صيفي) — كما في api.ts
const RIYADH_OFFSET = 3 * 60 * 60 * 1000;
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, Search, LayoutGrid, Table2, GanttChart, Upload, FileOutput,
  FolderInput, ArrowUpDown, ChevronDown, CheckSquare,
} from 'lucide-react';
import { api, STATUS_LABELS, STATUS_BADGE, SOURCE_LABELS, TYPE_LABELS, formatRiyadh, displayStatus } from '../api';
import StatusBadge from '../components/StatusBadge';
import PostKanban, { moveAction } from '../components/PostKanban';
import { useAuth } from '../auth';
import Modal from '../components/Modal';
import ConfirmModal, { FieldModal } from '../components/ConfirmModal';
import { DateRangePicker } from '../components/DatePicker';
import { Popover } from '../components/Popover';
import { saveText } from '../lib/download';

// تاريخ العنصر بصيغة YYYY-MM-DD بتوقيت الرياض (للفلترة الزمنية)
function riyadhYMD(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch {
    return '';
  }
}

// لون شريط مخطّط جانت — رمز كامل لا مكوّنات hsl.
const BADGE_COLOR: Record<string, string> = {
  gray: 'var(--muted-foreground)', blue: 'var(--info)', amber: 'var(--warning)',
  green: 'var(--success)', red: 'var(--destructive)',
};
const statusColor = (st: string) => BADGE_COLOR[STATUS_BADGE[st]] || 'var(--muted-foreground)';

/** علامةُ ترتيب البايتات — بدونها يقرأ Excel العربية محارفَ مبعثرة. */
const BOM = '\uFEFF';

function stripHtml(s: string) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}


export default function ContentManagement() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [view, setView] = useState<'table' | 'kanban' | 'gantt'>(
    () => (localStorage.getItem('naf-content-view') as any) || 'table',
  );
  useEffect(() => {
    localStorage.setItem('naf-content-view', view);
  }, [view]);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fSource, setFSource] = useState('');
  const [fType, setFType] = useState('');
  const [fCampaign, setFCampaign] = useState('');
  const [fAuthor, setFAuthor] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [sortKey, setSortKey] = useState('updated_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showAssign, setShowAssign] = useState(false);

  function load() {
    api.get('/posts').then((d) => setPosts(d.posts));
    // الصمت قرار: قائمةُ حملاتٍ لمرشّحٍ اختياري — غيابُها يُسقط خياراً لا شاشة
    api.get('/campaigns').then((d) => setCampaigns(d.campaigns)).catch(() => {});
  }
  useEffect(load, []);

  const authors = useMemo(() => Array.from(new Set(posts.map((p) => p.author_name).filter(Boolean))), [posts]);

  const filtered = useMemo(() => {
    let r = posts.filter((p) => {
      if (fStatus && displayStatus(p) !== fStatus && p.status !== fStatus) return false;
      if (fSource && p.source !== fSource) return false;
      if (fType && p.content_type !== fType) return false;
      if (fCampaign && p.campaign_id !== fCampaign) return false;
      if (fAuthor && p.author_name !== fAuthor) return false;
      if (fFrom || fTo) {
        const d = riyadhYMD(p.updated_at);
        if (fFrom && d < fFrom) return false;
        if (fTo && d > fTo) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!(`${p.title} ${stripHtml(p.body)}`.toLowerCase().includes(q))) return false;
      }
      return true;
    });
    r = [...r].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'title') { av = a.title || ''; bv = b.title || ''; }
      const c = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? c : -c;
    });
    return r;
  }, [posts, fStatus, fSource, fType, fCampaign, fAuthor, fFrom, fTo, search, sortKey, sortDir]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of posts) { const s = displayStatus(p); c[s] = (c[s] || 0) + 1; }
    return c;
  }, [posts]);

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  }
  function canDelete(p: any) {
    return can('content.approve_final') || (['draft', 'rejected'].includes(p.status) && p.author_id === user?.id);
  }
  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAllFiltered() {
    setSel((s) => (s.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id))));
  }
  const selectedPosts = () => posts.filter((p) => sel.has(p.id));

  /* نوافذ المنصة بدل مربّعات المتصفح — العلّة مشروحة في `ConfirmModal`.
     وأشدُّها سبب الرفض: كان يُطلب بـ`prompt`، وهو **إلزامي** يردّه
     الخادم بـ٤٠٠ إن جاء فارغاً، ومربّعٌ بلا تحقّقٍ ولا رسالة خطأ لا
     يصلح لحقلٍ إلزامي. */
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);
  const [rejecting, setRejecting] = useState<{ post: any; toCol: string } | null>(null);
  const [rejectErr, setRejectErr] = useState('');

  function askBulkDelete() {
    const targets = selectedPosts().filter(canDelete);
    if (!targets.length) return setErr('لا يمكنك حذف العناصر المحددة');
    setConfirmDelete({ ids: targets.map((p) => p.id) });
  }

  async function bulkDelete(ids: string[]) {
    setConfirmDelete(null);
    let ok = 0;
    for (const id of ids) { try { await api.del(`/posts/${id}`); ok++; } catch {} }
    setSel(new Set()); setMsg(`تم حذف ${isolate(ok)} عنصراً`); load();
  }
  async function bulkAssign(campaignId: string) {
    let ok = 0;
    for (const p of selectedPosts()) { try { await api.patch(`/posts/${p.id}`, { campaign_id: campaignId || null }); ok++; } catch {} }
    setShowAssign(false); setSel(new Set()); setMsg(`تم تحديث حملة ${isolate(ok)} عنصراً`); load();
  }

  async function onMove(post: any, toCol: string) {
    setErr(''); setMsg('');
    const action = moveAction(post.status, toCol);
    if (!action) {
      setErr('انتقال غير مسموح — تُدار الجدولة والنشر من المحرر، ولا يمكن تجاوز مراحل الاعتماد.');
      return;
    }
    // الرفض يحتاج سبباً إلزامياً — يُطلب في نافذة بحقلٍ وتحقّقٍ ورسالة
    if (action === 'reject') {
      setRejectErr('');
      setRejecting({ post, toCol });
      return;
    }
    await applyMove(post, toCol, action);
  }

  async function applyMove(post: any, toCol: string, action: string, note?: string) {
    // تحديث تفاؤلي ثم تأكيد من الخادم
    const target = action === 'reject' ? 'rejected' : toCol;
    setPosts((ps) => ps.map((p) => (p.id === post.id ? { ...p, status: target } : p)));
    try {
      await api.post(`/posts/${post.id}/action`, { action, note });
      setMsg('تم نقل المحتوى');
      load();
    } catch (e: any) {
      setErr(e.message);
      load(); // تراجع
    }
  }

  function doExport(fmt: 'csv' | 'json' | 'md') {
    const rows = (sel.size ? selectedPosts() : filtered);
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'json') {
      saveText(JSON.stringify(rows, null, 2), `content-${stamp}.json`, 'application/json');
    } else if (fmt === 'csv') {
      const cols = ['id', 'title', 'status', 'source', 'content_type', 'campaign_name', 'author_name', 'created_at', 'updated_at', 'body'];
      const head = ['المعرّف', 'العنوان', 'الحالة', 'المصدر', 'النوع', 'الحملة', 'الكاتب', 'أُنشئ', 'حُدّث', 'المحتوى'];
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [head.join(',')];
      for (const p of rows) {
        lines.push(cols.map((c) => esc(c === 'status' ? STATUS_LABELS[displayStatus(p)] : c === 'body' ? stripHtml(p.body) : p[c])).join(','));
      }
      /* العلامة لـCSV وحده: بها يقرأ Excel العربية سليمةً، وفي JSON
         تكسر `JSON.parse`. والعلّة في `lib/download.ts`. */
      saveText(BOM + lines.join('\n'), `content-${stamp}.csv`, 'text/csv;charset=utf-8');
    } else {
      let md = `# تصدير المحتوى — ${stamp}\n\n`;
      for (const p of rows) {
        md += `## ${p.title}\n\n- الحالة: ${STATUS_LABELS[displayStatus(p)]}\n- المصدر: ${SOURCE_LABELS[p.source] || p.source}\n- الحملة: ${p.campaign_name || '—'}\n- الكاتب: ${p.author_name || '—'}\n\n${stripHtml(p.body)}\n\n---\n\n`;
      }
      saveText(md, `content-${stamp}.md`, 'text/markdown;charset=utf-8');
    }
  }

  const allSelected = filtered.length > 0 && sel.size === filtered.length;

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <div>
          <h1 className="page-title">إدارة المحتوى</h1>
          <p className="page-sub" style={{ margin: 0 }}>عرض وتتبّع ومعالجة كل المحتوى في مختلف مراحله</p>
        </div>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        {err && <span className="err">{err}</span>}
      </div>

      {/* شرائح الحالة (فلترة سريعة) */}
      <div className="row" style={{ margin: '16px 0' }}>
        <button type="button" className={`chip-stat ${fStatus === '' ? 'on' : ''}`}
                aria-pressed={fStatus === ''} onClick={() => setFStatus('')}>
          الكل <b><bdi>{posts.length}</bdi></b>
        </button>
        {['draft', 'pending_marketing', 'pending_gm', 'approved', 'scheduled', 'late', 'published', 'rejected', 'archived']
          .filter((s) => counts[s])
          .map((s) => (
            <button type="button" key={s} className={`chip-stat ${fStatus === s ? 'on' : ''}`}
                    aria-pressed={fStatus === s} onClick={() => setFStatus(fStatus === s ? '' : s)}>
              <StatusBadge status={s} /> <b><bdi>{counts[s]}</bdi></b>
            </button>
          ))}
      </div>

      {/* شريط الأدوات */}
      <div className="card" style={{ marginBottom: 16, padding: 14 }}>
        <div className="row">
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, top: 11, color: 'var(--muted-foreground)' }} />
            <input className="input" style={{ paddingInlineStart: 36 }} placeholder="بحث في العنوان والمحتوى…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" style={{ width: 150 }} value={fSource} onChange={(e) => setFSource(e.target.value)}>
            <option value="">كل المصادر</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" style={{ width: 130 }} value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">كل الأنواع</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" style={{ width: 160 }} value={fCampaign} onChange={(e) => setFCampaign(e.target.value)}>
            <option value="">كل الحملات</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" style={{ width: 150 }} value={fAuthor} onChange={(e) => setFAuthor(e.target.value)}>
            <option value="">كل الكُتّاب</option>
            {authors.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <DateRangePicker from={fFrom} to={fTo} onChange={(f, t) => { setFFrom(f); setFTo(t); }} placeholder="كل التواريخ" />
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <div className="seg">
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}><Table2 size={20} /> جدول</button>
            <button className={view === 'kanban' ? 'on' : ''} onClick={() => setView('kanban')}><LayoutGrid size={20} /> كانبان</button>
            <button className={view === 'gantt' ? 'on' : ''} onClick={() => setView('gantt')}><GanttChart size={20} /> جانت</button>
          </div>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}><bdi>{filtered.length}</bdi> عنصر</span>
          {can('draft.edit') && <button className="btn ghost sm" onClick={() => setShowImport(true)}><Upload size={20} /> استيراد</button>}
          <Popover
            render={({ toggle }) => (
              <button className="btn ghost sm" onClick={toggle}><FileOutput size={20} /> تصدير <ChevronDown size={20} /></button>
            )}
          >
            {({ close }) => (
              <div className="menu">
                <button onClick={() => { doExport('csv'); close(); }}>CSV (إكسل)</button>
                <button onClick={() => { doExport('json'); close(); }}>JSON</button>
                <button onClick={() => { doExport('md'); close(); }}>Markdown</button>
              </div>
            )}
          </Popover>
          {can('draft.edit') && <button className="btn sm" onClick={() => navigate('/editor')}><Plus size={20} /> محتوى جديد</button>}
        </div>
      </div>

      {/* شريط الإجراءات المجمّعة */}
      {sel.size > 0 && (
        <div className="bulkbar">
          <CheckSquare size={16} />
          <span>محدّد: {sel.size}</span>
          <div className="spacer" />
          {can('content.schedule') && <button className="btn ghost sm" onClick={() => setShowAssign(true)}><FolderInput size={20} /> نقل إلى حملة</button>}
          <button className="btn ghost sm" onClick={() => doExport('csv')}><FileOutput size={20} /> تصدير المحدد</button>
          <button className="btn danger sm" onClick={askBulkDelete}><Trash2 size={20} /> حذف</button>
          <button className="btn ghost sm" onClick={() => setSel(new Set())}>إلغاء</button>
        </div>
      )}

      {view === 'table' && (
        <TableView
          rows={filtered} sel={sel} toggleSel={toggleSel} allSelected={allSelected} selectAll={selectAllFiltered}
          sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} navigate={navigate} canDelete={canDelete}
          onDelete={(id: string) => setConfirmDelete({ ids: [id] })}
        />
      )}
      {view === 'kanban' && <PostKanban rows={filtered} onOpen={(p) => navigate(`/editor/${p.id}`)} onMove={onMove} />}
      {view === 'gantt' && <GanttView rows={filtered} navigate={navigate} />}

      {confirmDelete && (
        <ConfirmModal
          title={confirmDelete.ids.length > 1 ? 'حذف المحتوى المحدَّد' : 'حذف المحتوى'}
          message={
            confirmDelete.ids.length > 1
              ? <>سيُحذف <bdi>{isolate(confirmDelete.ids.length)}</bdi> عنصراً وكل ما ارتبط بها من نسخ وجداول. لا يمكن التراجع عن هذا.</>
              : 'سيُحذف المحتوى وكل ما ارتبط به من نسخ وجداول. لا يمكن التراجع عن هذا.'
          }
          actionLabel="حذف"
          danger
          onConfirm={() => bulkDelete(confirmDelete.ids)}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {rejecting && (
        <FieldModal
          title="رفض المحتوى"
          label="سبب الرفض"
          placeholder="ما الذي يلزم تعديله؟"
          actionLabel="رفض"
          hint="يصل السبب إلى كاتبه ويُسجَّل في سجلّ الاعتماد."
          error={rejectErr}
          onSubmit={(value) => {
            if (!value.trim()) { setRejectErr('سبب الرفض إلزامي'); return; }
            const { post, toCol } = rejecting;
            setRejecting(null);
            applyMove(post, toCol, 'reject', value.trim());
          }}
          onClose={() => { setRejecting(null); setRejectErr(''); }}
        />
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={(n) => { setShowImport(false); setMsg(`تم استيراد ${isolate(n)} عنصراً`); load(); }} />}
      {showAssign && (
        <Modal title="نقل العناصر المحددة إلى حملة" onClose={() => setShowAssign(false)}>
          <div className="field">
            <label>الحملة</label>
            <select className="select" id="assign-camp" defaultValue="">
              <option value="">بدون حملة</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button className="btn" onClick={() => bulkAssign((document.getElementById('assign-camp') as HTMLSelectElement).value)}>تطبيق</button>
        </Modal>
      )}
    </div>
  );
}

/* ===== عرض الجدول ===== */
function TableView({ rows, sel, toggleSel, allSelected, selectAll, sortKey, sortDir, toggleSort, navigate, canDelete, onDelete }: any) {
  const Sort = ({ k, label }: { k: string; label: string }) => (
    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort(k)}>
      <span className="row" style={{ gap: 4, display: 'inline-flex' }}>
        {label}
        <ArrowUpDown
          size={16}
          style={{ opacity: sortKey === k ? 1 : 0.35, transform: sortKey === k && sortDir === 'asc' ? 'rotate(180deg)' : 'none' }}
        />
      </span>
    </th>
  );
  return (
    <div className="card" style={{ padding: 0, overflow: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 36 }}><input type="checkbox" className="chk" checked={allSelected} onChange={selectAll} /></th>
            <Sort k="title" label="العنوان" />
            <Sort k="status" label="الحالة" />
            <th>المصدر</th>
            <th>النوع</th>
            <th>الحملة</th>
            <th>الكاتب</th>
            <Sort k="updated_at" label="آخر تحديث" />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p: any) => (
            <tr key={p.id}>
              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="chk" checked={sel.has(p.id)} onChange={() => toggleSel(p.id)} /></td>
              <td style={{ fontWeight: 500 }}>
                <button type="button" className="row-link" onClick={() => navigate(`/editor/${p.id}`)}>{p.title}</button>
              </td>
              <td><StatusBadge status={displayStatus(p)} /></td>
              <td className="muted"><bdi>{SOURCE_LABELS[p.source] || p.source}</bdi></td>
              <td className="muted">{TYPE_LABELS[p.content_type] || p.content_type}</td>
              <td className="muted">{p.campaign_name || '—'}</td>
              <td className="muted">{p.author_name}</td>
              <td className="muted">{formatRiyadh(p.updated_at)}</td>
              <td onClick={(e) => e.stopPropagation()}>
                {canDelete(p) && <button className="btn danger sm" title="حذف" onClick={() => onDelete(p.id)}><Trash2 size={20} /></button>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>لا نتائج مطابقة لبحثك. جرّب كلمات أخرى.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ===== عرض جانت (خط زمني) ===== */
function GanttView({ rows, navigate }: any) {
  const items = rows
    .map((p: any) => {
      const start = new Date(p.created_at).getTime();
      const endRaw = p.pending_at ? new Date(p.pending_at).getTime() : new Date(p.updated_at).getTime();
      const end = Math.max(endRaw, start + 6 * 3600 * 1000);
      return { ...p, _s: start, _e: end };
    })
    .sort((a: any, b: any) => a._s - b._s);

  if (items.length === 0) return <div className="card muted" style={{ textAlign: 'center' }}>لا محتوى مجدول لعرضه على المخطّط الزمني. جدوِل أول محتوى.</div>;

  const min = Math.min(...items.map((i: any) => i._s));
  const max = Math.max(...items.map((i: any) => i._e), Date.now());
  const range = Math.max(max - min, 24 * 3600 * 1000);
  const pct = (t: number) => ((t - min) / range) * 100;

  // علامات زمنية (~8)
  const ticks: { left: number; label: string }[] = [];
  const days = range / (24 * 3600 * 1000);
  const step = Math.max(1, Math.ceil(days / 8));
  for (let d = 0; d <= days; d += step) {
    const t = min + d * 24 * 3600 * 1000;
    ticks.push({ left: pct(t), label: formatDate(new Date(t + RIYADH_OFFSET)) });
  }
  const todayLeft = pct(Date.now());

  return (
    <div className="gantt">
      <div className="gantt-head">
        <div className="gantt-label" style={{ background: 'color-mix(in oklab, var(--muted) 50%, transparent)' }}>المحتوى</div>
        <div className="gantt-track" style={{ height: 26 }}>
          {ticks.map((t, i) => <div key={i} className="gantt-tick" style={{ insetInlineStart: `${t.left}%` }}>{t.label}</div>)}
        </div>
      </div>
      {items.map((p: any) => {
        const left = pct(p._s);
        const width = Math.max(pct(p._e) - left, 1.5);
        const st = displayStatus(p);
        return (
          <div className="gantt-row" key={p.id}>
            <div className="gantt-label" title={p.title}>
              <StatusBadge status={st} size={16} iconOnly />
              {p.title}
            </div>
            <div className="gantt-track">
              {todayLeft >= 0 && todayLeft <= 100 && <div className="gantt-today" style={{ insetInlineStart: `${todayLeft}%` }} />}
              <button
                type="button"
                className="gantt-bar"
                style={{ insetInlineStart: `${left}%`, width: `${width}%`, background: statusColor(st) }}
                title={`${p.title} — ${STATUS_LABELS[st]}`}
                onClick={() => navigate(`/editor/${p.id}`)}
              >
                {STATUS_LABELS[st]}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ===== نافذة الاستيراد ===== */
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function parseCSV(text: string): any[] {
    const rows: string[][] = [];
    let cur: string[] = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') q = false;
        else field += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ',') { cur.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') { if (field !== '' || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ''; } if (ch === '\r' && text[i + 1] === '\n') i++; }
        else field += ch;
      }
    }
    if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
    if (rows.length < 2) return [];
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const ti = head.findIndex((h) => ['title', 'العنوان'].includes(h));
    const bi = head.findIndex((h) => ['body', 'content', 'المحتوى', 'النص'].includes(h));
    return rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => ({
      title: ti >= 0 ? r[ti] : r[0],
      body: bi >= 0 ? r[bi] : '',
    }));
  }

  function onFile(f: File) {
    setErr('');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        let parsed: any[];
        if (f.name.endsWith('.json')) {
          const j = JSON.parse(text);
          parsed = (Array.isArray(j) ? j : j.items || []).map((x: any) => ({ title: x.title, body: x.body || x.content || '', content_type: x.content_type }));
        } else {
          parsed = parseCSV(text);
        }
        if (!parsed.length) return setErr('لم يُعثر على عناصر صالحة (يلزم عمود عنوان)');
        setItems(parsed);
      } catch (e: any) { setErr('تعذّر قراءة الملف: ' + e.message); }
    };
    reader.readAsText(f);
  }

  async function submit() {
    setBusy(true); setErr('');
    try {
      const d = await api.post('/posts/import', { items });
      onDone(d.created);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="استيراد محتوى" onClose={onClose}>
      <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
        ارفع ملف <b>CSV</b> (بأعمدة: العنوان، المحتوى) أو <b>JSON</b> (مصفوفة عناصر فيها title و body).
        تُنشأ العناصر كمسودات.
      </p>
      <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button className="btn ghost" onClick={() => fileRef.current?.click()}><Upload size={20} /> اختيار ملف</button>

      {items.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="ok">جاهز للاستيراد: <bdi>{items.length}</bdi> عنصراً</p>
          <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 8 }}>
            {items.slice(0, 20).map((it, i) => <div key={i} style={{ fontSize: 'var(--text-xs)', padding: '2px 0' }}>• {it.title || '(بدون عنوان)'}</div>)}
            {items.length > 20 && <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>… و<bdi>{items.length - 20}</bdi> غيرها</div>}
          </div>
        </div>
      )}
      {err && <p className="err">{err}</p>}
      <button className="btn" style={{ marginTop: 12 }} disabled={!items.length || busy} onClick={submit}>
        {busy ? 'جارٍ الاستيراد…' : `استيراد ${isolate(items.length || '')} عنصراً`}
      </button>
    </Modal>
  );
}
