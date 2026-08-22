import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpDown, ChevronDown, CheckSquare, Archive, FileOutput,
  LayoutGrid, Plus, Search, Table2,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatDate, formatNumber, isolate } from '../lib/format';
import { download } from '../lib/download';
import { CampaignBadge } from '../components/StateBadge';
import { PlatformIcon, platformLabel } from '../platforms';
import ConfirmModal from '../components/ConfirmModal';
import { Popover } from '../components/Popover';
import { DateRangePicker } from '../components/DatePicker';
import Bar from '../components/Bar';
import CampaignForm from '../components/CampaignForm';
import {
  CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS, daysRemaining, parsePlatforms,
} from '../campaigns';

/* قائمة الحملات.

   كانت شبكةَ بطاقاتٍ بلا بحثٍ ولا تصفيةٍ ولا فرز، وتفتح نافذةً لا مساراً.
   والمؤرشفة تخرج من العرض الافتراضي وتبقى خلف فلتر الحالة — وهذا ما يجعل
   الأرشفة بديلاً حقيقياً عن الحذف لا مجرّد وسمٍ لا أثر له. */

type Campaign = {
  id: string; name: string; objective: string | null;
  start_date: string | null; end_date: string | null;
  target_platforms: string | null; status: string;
  created_at: string; updated_at: string | null;
  owner_id: string | null; owner_name: string | null;
  budget: number | null;
  posts_count: number; published_count: number;
  impressions: number; engagement: number;
  allowed_transitions: string[];
};

export default function Campaigns() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [view, setView] = useState<'table' | 'kanban'>(
    () => (localStorage.getItem('naf-campaigns-view') as 'table' | 'kanban') || 'table',
  );
  useEffect(() => { localStorage.setItem('naf-campaigns-view', view); }, [view]);

  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPlatform, setFPlatform] = useState('');
  const [fOwner, setFOwner] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<Campaign[] | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function load() {
    // بلا معالجةٍ للخطأ يُقرأ الفشل «لا حملات» — وهما حالتان مختلفتان تماماً.
    api.get('/campaigns').then((d) => setCampaigns(d.campaigns)).catch((e) => setErr(e.message));
    api.get('/settings').then((d) => setPlatforms(d.settings?.enabled_platforms || [])).catch(() => {});
  }
  useEffect(load, []);

  const owners = useMemo(
    () => Array.from(new Set(campaigns.map((c) => c.owner_name).filter(Boolean))) as string[],
    [campaigns],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const row of campaigns) c[row.status] = (c[row.status] || 0) + 1;
    return c;
  }, [campaigns]);

  const filtered = useMemo(() => {
    const rows = campaigns.filter((c) => {
      // المؤرشفة خارج العرض الافتراضي، وتظهر حين تُطلب بالاسم.
      if (fStatus ? c.status !== fStatus : c.status === 'archived') return false;
      if (fPlatform && !parsePlatforms(c.target_platforms).includes(fPlatform)) return false;
      if (fOwner && c.owner_name !== fOwner) return false;
      if (fFrom && c.end_date && c.end_date < fFrom) return false;
      if (fTo && c.start_date && c.start_date > fTo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${c.name} ${c.objective || ''}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    return [...rows].sort((a, b) => {
      const av = (a as any)[sortKey] ?? '';
      const bv = (b as any)[sortKey] ?? '';
      const c = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? c : -c;
    });
  }, [campaigns, search, fStatus, fPlatform, fOwner, fFrom, fTo, sortKey, sortDir]);

  const canWrite = can('content.schedule');
  const allSelected = filtered.length > 0 && sel.size === filtered.length;
  const selected = () => campaigns.filter((c) => sel.has(c.id));

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  }
  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function archiveSelected() {
    const targets = confirmArchive || [];
    let ok = 0;
    for (const c of targets) {
      try { await api.patch(`/campaigns/${c.id}`, { status: 'archived' }); ok++; } catch { /* يُحصى ما نجح */ }
    }
    setConfirmArchive(null);
    setSel(new Set());
    setMsg(ok === targets.length ? 'تمت أرشفة الحملة' : `تمت أرشفة ${isolate(ok)} من ${isolate(targets.length)}`);
    load();
  }

  async function onMoveStatus(campaign: Campaign, to: string) {
    setErr(''); setMsg('');
    if (!campaign.allowed_transitions.includes(to)) {
      setErr('انتقال غير مسموح لحالة الحملة');
      return;
    }
    setCampaigns((cs) => cs.map((c) => (c.id === campaign.id ? { ...c, status: to } : c)));
    try {
      await api.patch(`/campaigns/${campaign.id}`, { status: to });
      setMsg('تم تحديث الحملة');
      load();
    } catch (e: any) {
      setErr(e.message);
      load();
    }
  }

  function doExport(fmt: 'csv' | 'json' | 'md') {
    const rows = sel.size ? selected() : filtered;
    const stamp = formatDate(new Date()).replace(/\//g, '-');
    if (fmt === 'json') {
      download(`campaigns-${stamp}.json`, JSON.stringify(rows, null, 2), 'application/json');
      return;
    }
    if (fmt === 'csv') {
      const head = ['الاسم', 'الحالة', 'هدف الحملة', 'مسؤول الحملة', 'من', 'إلى', 'المنشورات', 'المنشور منها', 'الظهور', 'التفاعل'];
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [head.join(',')];
      for (const c of rows) {
        lines.push([
          c.name, CAMPAIGN_STATUS_LABELS[c.status] || c.status, c.objective, c.owner_name,
          c.start_date, c.end_date, c.posts_count, c.published_count, c.impressions, c.engagement,
        ].map(esc).join(','));
      }
      download(`campaigns-${stamp}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
      return;
    }
    let md = `# تصدير الحملات — ${stamp}\n\n`;
    for (const c of rows) {
      md += `## ${c.name}\n\n- الحالة: ${CAMPAIGN_STATUS_LABELS[c.status] || c.status}\n`
        + `- هدف الحملة: ${c.objective || '—'}\n- مسؤول الحملة: ${c.owner_name || '—'}\n`
        + `- مدّة الحملة: ${c.start_date ? formatDate(c.start_date) : '—'} إلى ${c.end_date ? formatDate(c.end_date) : '—'}\n`
        + `- التقدّم: ${formatNumber(c.published_count)} من ${formatNumber(c.posts_count)}\n\n`;
    }
    download(`campaigns-${stamp}.md`, md, 'text/markdown;charset=utf-8');
  }

  return (
    <div>
      <div className="row">
        <h1 className="page-title">الحملات</h1>
        <div className="spacer" />
        {canWrite && (
          <button className="btn" onClick={() => setShowNew(true)}>
            <Plus size={20} /> حملة جديدة
          </button>
        )}
      </div>
      <p className="page-sub">كل حملة ومدّتها وتقدّمها وأداؤها أمام مستهدفها.</p>

      {msg && <p className="ok">{msg}</p>}
      {err && <p className="err">{err}</p>}

      {/* شرائح الحالة — تصفيةٌ سريعة، والعدد مع كلٍّ. */}
      <div className="row toolbar-row">
        <button
          type="button"
          className={`chip-stat ${fStatus === '' ? 'on' : ''}`}
          aria-pressed={fStatus === ''}
          onClick={() => setFStatus('')}
        >
          الكل <b><bdi>{formatNumber(campaigns.filter((c) => c.status !== 'archived').length)}</bdi></b>
        </button>
        {CAMPAIGN_STATUSES.filter((s) => counts[s]).map((s) => (
          <button
            type="button"
            key={s}
            className={`chip-stat ${fStatus === s ? 'on' : ''}`}
            aria-pressed={fStatus === s}
            onClick={() => setFStatus(fStatus === s ? '' : s)}
          >
            <CampaignBadge state={s} /> <b><bdi>{formatNumber(counts[s])}</bdi></b>
          </button>
        ))}
      </div>

      {/* شريط الأدوات */}
      <div className="card toolbar">
        <div className="row">
          <div className="search-inline">
            <Search size={16} />
            <input
              className="input"
              placeholder="بحث في الاسم وهدف الحملة…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="select filter-sm" value={fPlatform} onChange={(e) => setFPlatform(e.target.value)}>
            <option value="">كل المنصات</option>
            {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
          </select>
          <select className="select filter-sm" value={fOwner} onChange={(e) => setFOwner(e.target.value)}>
            <option value="">كل المسؤولين</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <DateRangePicker from={fFrom} to={fTo} onChange={(f, t) => { setFFrom(f); setFTo(t); }} />
        </div>

        <div className="row toolbar-row">
          <div className="seg">
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
              <Table2 size={20} /> جدول
            </button>
            <button className={view === 'kanban' ? 'on' : ''} onClick={() => setView('kanban')}>
              <LayoutGrid size={20} /> كانبان
            </button>
          </div>
          <div className="spacer" />
          <span className="muted meta-row"><bdi>{formatNumber(filtered.length)}</bdi> حملة</span>
          <Popover
            render={({ toggle }) => (
              <button className="btn ghost sm" onClick={toggle}>
                <FileOutput size={20} /> تصدير <ChevronDown size={20} />
              </button>
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
        </div>
      </div>

      {sel.size > 0 && (
        <div className="bulkbar">
          <CheckSquare size={16} />
          <span>محدّد: <bdi>{formatNumber(sel.size)}</bdi></span>
          <div className="spacer" />
          {canWrite && (
            <button className="btn ghost sm" onClick={() => setConfirmArchive(selected())}>
              <Archive size={20} /> أرشفة
            </button>
          )}
          <button className="btn ghost sm" onClick={() => doExport('csv')}>
            <FileOutput size={20} /> تصدير المحدد
          </button>
          <button className="btn ghost sm" onClick={() => setSel(new Set())}>إلغاء</button>
        </div>
      )}

      {view === 'table' ? (
        <TableView
          rows={filtered}
          sel={sel}
          toggleSel={toggleSel}
          allSelected={allSelected}
          selectAll={() => setSel(allSelected ? new Set() : new Set(filtered.map((c) => c.id)))}
          sortKey={sortKey}
          sortDir={sortDir}
          toggleSort={toggleSort}
          onOpen={(id: string) => navigate(`/campaigns/${id}`)}
          empty={<EmptyState campaigns={campaigns} filtered={filtered} fStatus={fStatus} />}
        />
      ) : (
        <CampaignBoard
          rows={filtered}
          onOpen={(id: string) => navigate(`/campaigns/${id}`)}
          onMove={canWrite ? onMoveStatus : undefined}
        />
      )}

      {showNew && (
        <CampaignForm
          onClose={() => setShowNew(false)}
          onSaved={(id) => { setShowNew(false); setMsg('تم إنشاء الحملة'); navigate(`/campaigns/${id}`); }}
        />
      )}

      {confirmArchive && (
        <ConfirmModal
          title="أرشفة الحملة"
          message={
            confirmArchive.length === 1
              ? 'ستخرج الحملة من القائمة ويبقى محتواها وأرقامها كما هي. يمكن استعادتها لاحقاً.'
              : <>ستخرج <bdi>{formatNumber(confirmArchive.length)}</bdi> حملات من القائمة ويبقى محتواها وأرقامها كما هي. يمكن استعادتها لاحقاً.</>
          }
          actionLabel="أرشفة"
          onConfirm={archiveSelected}
          onClose={() => setConfirmArchive(null)}
        />
      )}
    </div>
  );
}

/* الشاشة الفارغة ثلاثٌ لا واحدة: لا حملات أصلاً، ولا نتائج للبحث،
   وكلُّ الحملات مؤرشفة. الثلاث مسجّلة في naf-terms.md §٤. */
function EmptyState({ campaigns, filtered, fStatus }: { campaigns: any[]; filtered: any[]; fStatus: string }) {
  if (campaigns.length === 0) return <>لم تُنشئ أي حملة بعد. ابدأ بأول حملة.</>;
  if (filtered.length === 0 && !fStatus && campaigns.every((c) => c.status === 'archived')) {
    return <>لا حملة نشطة. اعرض المؤرشفة أو ابدأ حملة جديدة.</>;
  }
  return <>لا نتائج مطابقة لبحثك. جرّب كلمات أخرى.</>;
}

/** مدّة الحملة — «من … إلى …» بالكلمة لا بسهم (naf-terms.md §٥). */
function Duration({ from, to }: { from: string | null; to: string | null }) {
  if (!from && !to) return <span className="muted">—</span>;
  return (
    <span className="muted">
      من <bdi>{from ? formatDate(from) : '—'}</bdi> إلى <bdi>{to ? formatDate(to) : '—'}</bdi>
    </span>
  );
}

/** المتبقّي من المدة. حملةٌ بلا نهاية لا متبقّى لها — ولا تُعرض صفراً. */
function Remaining({ end, status }: { end: string | null; status: string }) {
  if (status === 'completed' || status === 'archived') return null;
  const days = daysRemaining(end);
  if (days === null) return null;
  if (days < 0) return <span className="muted">انتهت المدة</span>;
  return <span className="muted">متبقٍ <bdi>{formatNumber(days)}</bdi> يوماً</span>;
}

function Progress({ published, total }: { published: number; total: number }) {
  if (!total) return <span className="muted">لا محتوى</span>;
  return (
    <div>
      <span className="muted meta-row">
        <bdi>{formatNumber(published)}</bdi> من <bdi>{formatNumber(total)}</bdi> منشور
      </span>
      <Bar value={published} max={total} />
    </div>
  );
}

function TableView({
  rows, sel, toggleSel, allSelected, selectAll, sortKey, sortDir, toggleSort, onOpen, empty,
}: any) {
  const Sort = ({ k, label }: { k: string; label: string }) => (
    <th onClick={() => toggleSort(k)}>
      <span className="row sort-head">
        {label}
        <ArrowUpDown size={16} className={sortKey === k ? `sort-on ${sortDir}` : 'sort-off'} />
      </span>
    </th>
  );
  return (
    <div className="card table-card">
      <table className="table">
        <thead>
          <tr>
            <th className="col-check">
              <input type="checkbox" className="chk" checked={allSelected} onChange={selectAll} aria-label="تحديد الكل" />
            </th>
            <Sort k="name" label="الاسم" />
            <th>الحالة</th>
            <th>مسؤول الحملة</th>
            <th>المنصات</th>
            <Sort k="end_date" label="مدّة الحملة" />
            <Sort k="published_count" label="التقدّم" />
            <Sort k="impressions" label="الأداء" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c: any) => (
            <tr key={c.id}>
              <td onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="chk" checked={sel.has(c.id)} onChange={() => toggleSel(c.id)} aria-label={c.name} />
              </td>
              <td className="col-name">
                <button type="button" className="row-link" onClick={() => onOpen(c.id)}>{c.name}</button>
              </td>
              <td><CampaignBadge state={c.status} /></td>
              <td className="muted">{c.owner_name || '—'}</td>
              <td>
                <span className="row platform-row">
                  {parsePlatforms(c.target_platforms).map((p) => (
                    <PlatformIcon key={p} platform={p} size={16} />
                  ))}
                  {parsePlatforms(c.target_platforms).length === 0 && <span className="muted">—</span>}
                </span>
              </td>
              <td>
                <Duration from={c.start_date} to={c.end_date} />
                <div className="meta-row"><Remaining end={c.end_date} status={c.status} /></div>
              </td>
              <td><Progress published={c.published_count} total={c.posts_count} /></td>
              <td className="muted meta-row">
                <bdi>{formatNumber(c.impressions)}</bdi> ظهور
                <br />
                <bdi>{formatNumber(c.engagement)}</bdi> تفاعل
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={8} className="muted table-empty">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* لوحة الحملات — أعمدةٌ بحالات الحملة، والسحب يغيّر الحالة.
   والانتقالات المسموحة تأتي مع كل صفٍّ من الخادم، فلا جدول ثانٍ هنا. */
function CampaignBoard({
  rows, onOpen, onMove,
}: {
  rows: Campaign[];
  onOpen: (id: string) => void;
  onMove?: (campaign: Campaign, to: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const dragged = rows.find((c) => c.id === dragId) || null;

  return (
    <div className="kanban-scroll">
      {onMove && (
        <p className="muted kanban-hint">اسحب الحملة إلى العمود التالي لتغيير حالتها.</p>
      )}
      <div className="kanban-board">
        {CAMPAIGN_STATUSES.map((col) => {
          const items = rows.filter((c) => c.status === col);
          const droppable = !!dragged && !!onMove && dragged.allowed_transitions.includes(col);
          return (
            <div
              key={col}
              className={`kanban-col board-col ${overCol === col && droppable ? 'dragover' : ''}`}
              onDragOver={(e) => { if (droppable) { e.preventDefault(); setOverCol(col); } }}
              onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                const c = dragged;
                setDragId(null);
                if (c && droppable && onMove) onMove(c, col);
              }}
            >
              <h4 className="row">
                <CampaignBadge state={col} />
                <div className="spacer" />
                <span className="muted"><bdi>{formatNumber(items.length)}</bdi></span>
              </h4>
              {items.map((c) => (
                <div
                  key={c.id}
                  className={`kanban-card ${dragId === c.id ? 'dragging' : ''}`}
                  draggable={!!onMove}
                  onDragStart={() => setDragId(c.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null); }}
                  onClick={() => onOpen(c.id)}
                >
                  <div className="kanban-card-title">{c.name}</div>
                  <div className="row kanban-card-meta">
                    <span className="muted">
                      <bdi>{formatNumber(c.published_count)}</bdi> من <bdi>{formatNumber(c.posts_count)}</bdi>
                    </span>
                    <div className="spacer" />
                    <Remaining end={c.end_date} status={c.status} />
                  </div>
                </div>
              ))}
              {items.length === 0 && <p className="muted kanban-empty">—</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
