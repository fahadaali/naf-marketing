import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, Search, LayoutGrid, Table2, GanttChart, Upload, Download,
  FolderInput, X, ArrowUpDown, ChevronDown, CheckSquare,
} from 'lucide-react';
import { api, STATUS_LABELS, STATUS_BADGE, formatRiyadh, displayStatus } from '../api';
import { useAuth } from '../auth';
import Modal from '../components/Modal';

const SOURCE: Record<string, string> = { manual: 'يدوي', ai: 'ذكاء اصطناعي', rss: 'خبر RSS' };
const TYPE: Record<string, string> = { text: 'نص', image: 'صورة', video: 'فيديو' };
const BADGE_HSL: Record<string, string> = {
  gray: 'var(--muted-foreground)', blue: 'var(--info)', amber: 'var(--warning)',
  green: 'var(--success)', red: 'var(--destructive)', purple: 'var(--purple)',
};
const statusColor = (st: string) => `hsl(${BADGE_HSL[STATUS_BADGE[st]] || 'var(--muted-foreground)'})`;

function stripHtml(s: string) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function download(name: string, content: string, mime: string) {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function ContentManagement() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [view, setView] = useState<'table' | 'kanban' | 'gantt'>('table');
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fSource, setFSource] = useState('');
  const [fType, setFType] = useState('');
  const [fCampaign, setFCampaign] = useState('');
  const [fAuthor, setFAuthor] = useState('');
  const [sortKey, setSortKey] = useState('updated_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showExport, setShowExport] = useState(false);

  function load() {
    api.get('/posts').then((d) => setPosts(d.posts));
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
  }, [posts, fStatus, fSource, fType, fCampaign, fAuthor, search, sortKey, sortDir]);

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

  async function bulkDelete() {
    const targets = selectedPosts().filter(canDelete);
    if (!targets.length) return setErr('لا يمكنك حذف العناصر المحددة');
    if (!confirm(`حذف ${targets.length} عنصراً نهائياً؟`)) return;
    let ok = 0;
    for (const p of targets) { try { await api.del(`/posts/${p.id}`); ok++; } catch {} }
    setSel(new Set()); setMsg(`تم حذف ${ok} عنصراً`); load();
  }
  async function bulkAssign(campaignId: string) {
    let ok = 0;
    for (const p of selectedPosts()) { try { await api.patch(`/posts/${p.id}`, { campaign_id: campaignId || null }); ok++; } catch {} }
    setShowAssign(false); setSel(new Set()); setMsg(`تم تحديث حملة ${ok} عنصراً`); load();
  }

  function doExport(fmt: 'csv' | 'json' | 'md') {
    setShowExport(false);
    const rows = (sel.size ? selectedPosts() : filtered);
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'json') {
      download(`content-${stamp}.json`, JSON.stringify(rows, null, 2), 'application/json');
    } else if (fmt === 'csv') {
      const cols = ['id', 'title', 'status', 'source', 'content_type', 'campaign_name', 'author_name', 'created_at', 'updated_at', 'body'];
      const head = ['المعرّف', 'العنوان', 'الحالة', 'المصدر', 'النوع', 'الحملة', 'الكاتب', 'أُنشئ', 'حُدّث', 'المحتوى'];
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [head.join(',')];
      for (const p of rows) {
        lines.push(cols.map((c) => esc(c === 'status' ? STATUS_LABELS[displayStatus(p)] : c === 'body' ? stripHtml(p.body) : p[c])).join(','));
      }
      download(`content-${stamp}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
    } else {
      let md = `# تصدير المحتوى — ${stamp}\n\n`;
      for (const p of rows) {
        md += `## ${p.title}\n\n- الحالة: ${STATUS_LABELS[displayStatus(p)]}\n- المصدر: ${SOURCE[p.source] || p.source}\n- الحملة: ${p.campaign_name || '—'}\n- الكاتب: ${p.author_name || '—'}\n\n${stripHtml(p.body)}\n\n---\n\n`;
      }
      download(`content-${stamp}.md`, md, 'text/markdown;charset=utf-8');
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
        <div className={`chip-stat ${fStatus === '' ? 'on' : ''}`} onClick={() => setFStatus('')}>
          الكل <b>{posts.length}</b>
        </div>
        {['draft', 'pending_marketing', 'pending_gm', 'approved', 'scheduled', 'late', 'published', 'rejected', 'archived']
          .filter((s) => counts[s])
          .map((s) => (
            <div key={s} className={`chip-stat ${fStatus === s ? 'on' : ''}`} onClick={() => setFStatus(fStatus === s ? '' : s)}>
              <span className={`badge ${STATUS_BADGE[s]}`}>{STATUS_LABELS[s]}</span> <b>{counts[s]}</b>
            </div>
          ))}
      </div>

      {/* شريط الأدوات */}
      <div className="card" style={{ marginBottom: 16, padding: 14 }}>
        <div className="row">
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, top: 11, color: 'hsl(var(--muted-foreground))' }} />
            <input className="input" style={{ paddingInlineStart: 36 }} placeholder="بحث في العنوان والمحتوى…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" style={{ width: 150 }} value={fSource} onChange={(e) => setFSource(e.target.value)}>
            <option value="">كل المصادر</option>
            {Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" style={{ width: 130 }} value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">كل الأنواع</option>
            {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" style={{ width: 160 }} value={fCampaign} onChange={(e) => setFCampaign(e.target.value)}>
            <option value="">كل الحملات</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" style={{ width: 150 }} value={fAuthor} onChange={(e) => setFAuthor(e.target.value)}>
            <option value="">كل الكُتّاب</option>
            {authors.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <div className="seg">
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}><Table2 size={15} /> جدول</button>
            <button className={view === 'kanban' ? 'on' : ''} onClick={() => setView('kanban')}><LayoutGrid size={15} /> كانبان</button>
            <button className={view === 'gantt' ? 'on' : ''} onClick={() => setView('gantt')}><GanttChart size={15} /> جانت</button>
          </div>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 13 }}>{filtered.length} عنصر</span>
          {can('draft.edit') && <button className="btn ghost sm" onClick={() => setShowImport(true)}><Upload size={15} /> استيراد</button>}
          <div className="menu-wrap">
            <button className="btn ghost sm" onClick={() => setShowExport((v) => !v)}><Download size={15} /> تصدير <ChevronDown size={14} /></button>
            {showExport && (
              <div className="menu">
                <button onClick={() => doExport('csv')}>CSV (إكسل)</button>
                <button onClick={() => doExport('json')}>JSON</button>
                <button onClick={() => doExport('md')}>Markdown</button>
              </div>
            )}
          </div>
          {can('draft.edit') && <button className="btn sm" onClick={() => navigate('/editor')}><Plus size={15} /> محتوى جديد</button>}
        </div>
      </div>

      {/* شريط الإجراءات المجمّعة */}
      {sel.size > 0 && (
        <div className="bulkbar">
          <CheckSquare size={17} />
          <span>محدّد: {sel.size}</span>
          <div className="spacer" />
          {can('content.schedule') && <button className="btn ghost sm" onClick={() => setShowAssign(true)}><FolderInput size={14} /> نقل إلى حملة</button>}
          <button className="btn ghost sm" onClick={() => doExport('csv')}><Download size={14} /> تصدير المحدد</button>
          <button className="btn danger sm" onClick={bulkDelete}><Trash2 size={14} /> حذف</button>
          <button className="btn ghost sm" onClick={() => setSel(new Set())}><X size={14} /> إلغاء</button>
        </div>
      )}

      {view === 'table' && (
        <TableView
          rows={filtered} sel={sel} toggleSel={toggleSel} allSelected={allSelected} selectAll={selectAllFiltered}
          sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} navigate={navigate} canDelete={canDelete}
          onDelete={async (id: string) => { if (confirm('حذف هذا المحتوى نهائياً؟')) { try { await api.del(`/posts/${id}`); load(); } catch (e: any) { setErr(e.message); } } }}
        />
      )}
      {view === 'kanban' && <KanbanView rows={filtered} navigate={navigate} />}
      {view === 'gantt' && <GanttView rows={filtered} navigate={navigate} />}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={(n) => { setShowImport(false); setMsg(`تم استيراد ${n} عنصراً`); load(); }} />}
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
      <span className="row" style={{ gap: 4, display: 'inline-flex' }}>{label} <ArrowUpDown size={12} opacity={sortKey === k ? 1 : 0.35} /></span>
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
              <td style={{ cursor: 'pointer', fontWeight: 500 }} onClick={() => navigate(`/editor/${p.id}`)}>{p.title}</td>
              <td><span className={`badge ${STATUS_BADGE[displayStatus(p)]}`}>{STATUS_LABELS[displayStatus(p)]}</span></td>
              <td className="muted">{SOURCE[p.source] || p.source}</td>
              <td className="muted">{TYPE[p.content_type] || p.content_type}</td>
              <td className="muted">{p.campaign_name || '—'}</td>
              <td className="muted">{p.author_name}</td>
              <td className="muted">{formatRiyadh(p.updated_at)}</td>
              <td onClick={(e) => e.stopPropagation()}>
                {canDelete(p) && <button className="btn danger sm" title="حذف" onClick={() => onDelete(p.id)}><Trash2 size={14} /></button>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>لا يوجد محتوى مطابق</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ===== عرض كانبان ===== */
const KANBAN_COLS: { key: string; statuses: string[] }[] = [
  { key: 'draft', statuses: ['draft'] },
  { key: 'rejected', statuses: ['rejected'] },
  { key: 'pending_marketing', statuses: ['pending_marketing'] },
  { key: 'pending_gm', statuses: ['pending_gm'] },
  { key: 'approved', statuses: ['approved'] },
  { key: 'scheduled', statuses: ['scheduled', 'late'] },
  { key: 'published', statuses: ['published'] },
  { key: 'archived', statuses: ['archived'] },
];
function KanbanView({ rows, navigate }: any) {
  const cols = KANBAN_COLS.map((col) => ({
    ...col,
    items: rows.filter((p: any) => col.statuses.includes(displayStatus(p))),
  })).filter((c) => c.items.length > 0 || ['draft', 'pending_marketing', 'pending_gm', 'scheduled', 'published'].includes(c.key));
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 12, minWidth: 'min-content' }}>
        {cols.map((col) => (
          <div key={col.key} className="kanban-col" style={{ width: 260, flexShrink: 0 }}>
            <h4 className="row">
              <span className={`badge ${STATUS_BADGE[col.key]}`}>{STATUS_LABELS[col.key]}</span>
              <div className="spacer" /><span className="muted">{col.items.length}</span>
            </h4>
            {col.items.map((p: any) => (
              <div key={p.id} className="kanban-card" onClick={() => navigate(`/editor/${p.id}`)}>
                <div style={{ fontWeight: 500, marginBottom: 6 }}>{p.title}</div>
                <div className="row" style={{ fontSize: 11 }} >
                  <span className="muted">{SOURCE[p.source] || p.source}</span>
                  {p.campaign_name && <span className="badge gray">{p.campaign_name}</span>}
                  <div className="spacer" />
                  <span className="muted">{p.author_name}</span>
                </div>
              </div>
            ))}
            {col.items.length === 0 && <p className="muted" style={{ fontSize: 12, textAlign: 'center', padding: 8 }}>—</p>}
          </div>
        ))}
      </div>
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

  if (items.length === 0) return <div className="card muted" style={{ textAlign: 'center' }}>لا يوجد محتوى لعرضه على المخطط الزمني</div>;

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
    ticks.push({ left: pct(t), label: new Intl.DateTimeFormat('ar', { month: 'short', day: 'numeric', timeZone: 'Asia/Riyadh' }).format(new Date(t)) });
  }
  const todayLeft = pct(Date.now());

  return (
    <div className="gantt">
      <div className="gantt-head">
        <div className="gantt-label" style={{ background: 'hsl(var(--muted) / 0.5)' }}>المحتوى</div>
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
              <span className={`badge ${STATUS_BADGE[st]}`} style={{ padding: '1px 6px', fontSize: 10 }}>●</span>
              {p.title}
            </div>
            <div className="gantt-track">
              {todayLeft >= 0 && todayLeft <= 100 && <div className="gantt-today" style={{ insetInlineStart: `${todayLeft}%` }} />}
              <div
                className="gantt-bar"
                style={{ insetInlineStart: `${left}%`, width: `${width}%`, background: statusColor(st) }}
                title={`${p.title} — ${STATUS_LABELS[st]}`}
                onClick={() => navigate(`/editor/${p.id}`)}
              >
                {STATUS_LABELS[st]}
              </div>
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
      <p className="muted" style={{ fontSize: 13 }}>
        ارفع ملف <b>CSV</b> (بأعمدة: العنوان، المحتوى) أو <b>JSON</b> (مصفوفة عناصر فيها title و body).
        تُنشأ العناصر كمسودات.
      </p>
      <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button className="btn ghost" onClick={() => fileRef.current?.click()}><Upload size={15} /> اختيار ملف</button>

      {items.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="ok">جاهز للاستيراد: {items.length} عنصراً</p>
          <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 8 }}>
            {items.slice(0, 20).map((it, i) => <div key={i} style={{ fontSize: 13, padding: '2px 0' }}>• {it.title || '(بدون عنوان)'}</div>)}
            {items.length > 20 && <div className="muted" style={{ fontSize: 12 }}>… و{items.length - 20} غيرها</div>}
          </div>
        </div>
      )}
      {err && <p className="err">{err}</p>}
      <button className="btn" style={{ marginTop: 12 }} disabled={!items.length || busy} onClick={submit}>
        {busy ? 'جارٍ الاستيراد…' : `استيراد ${items.length || ''} عنصراً`}
      </button>
    </Modal>
  );
}
