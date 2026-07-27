import { isolate } from '../lib/format';
import { useEffect, useState } from 'react';
import {
  Plus, Trash2, ArrowUp, ArrowDown, ArrowRight, Eye, Globe, Mail, Save, ExternalLink,
  Heading2, Type, Image as ImageIcon, Link2, Quote, Minus, Send, MousePointerClick, Share2, FlaskConical,
} from 'lucide-react';
import { api, formatRiyadh } from '../api';
import { DeliveryBadge } from '../components/StateBadge';
import StatusBadge from '../components/StatusBadge';

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
    }).catch((e) => setMsg(e.message));
  }, [id]);

  function field(k: string, v: any) { setNl((n: any) => ({ ...n, [k]: v })); }

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true);
    setMsg('');
    try {
      await api.patch(`/newsletters/${id}`, {
        title: nl.title, subject: nl.subject, preheader: nl.preheader, excerpt: nl.excerpt,
        blocks_json: JSON.stringify(blocks), ...extra,
      });
      setMsg('حُفظت');
      const d = await api.get(`/newsletters/${id}`);
      setNl(d.newsletter);
      setPublicUrl(d.public_url || '');
    } catch (e: any) { setMsg(e.message); } finally { setSaving(false); }
  }

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
  const add = (b: Block) => setBlocks((x) => [...x, b]);
  const upd = (i: number, patch: any) => setBlocks((x) => x.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const del = (i: number) => setBlocks((x) => x.filter((_, j) => j !== i));
  const move = (i: number, d: number) => setBlocks((x) => {
    const j = i + d;
    if (j < 0 || j >= x.length) return x;
    const c = [...x];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });

  if (!nl) return <p className="muted">جارٍ التحميل…</p>;

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn ghost sm" onClick={onBack}><ArrowRight size={20} /> رجوع</button>
        <h1 className="page-title" style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{nl.title}</h1>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        <button className="btn ghost" onClick={showPreview}><Eye size={20} /> معاينة</button>
        <button className="btn ghost" onClick={sendTest}><Mail size={20} /> اختبار</button>
        {['draft', 'scheduled'].includes(nl.status) && (
          <button className="btn" onClick={sendAll}><Send size={20} /> إرسال للمشتركين</button>
        )}
        <button className="btn" disabled={saving} onClick={() => save()}><Save size={20} /> {saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>
      </div>

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
            <button className="btn sm ghost" onClick={() => add({ type: 'button', text: '', url: '' })}><Link2 size={20} /> زر</button>
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
      return <textarea className="input" rows={4} placeholder="نص الفقرة (سطر فارغ يفصل فقرتين)" value={block.text}
                       onChange={(e) => onChange({ text: e.target.value })} />;
    case 'image':
      return (
        <div className="grid" style={{ gap: 6 }}>
          <input className="input" placeholder="رابط الصورة أو /api/media/<id>" value={block.url || ''}
                 onChange={(e) => onChange({ url: e.target.value })} />
          <input className="input" placeholder="وصف بديل (\u2068alt\u2069)" value={block.alt || ''}
                 onChange={(e) => onChange({ alt: e.target.value })} />
          <input className="input" placeholder="تعليق أسفل الصورة (اختياري)" value={block.caption || ''}
                 onChange={(e) => onChange({ caption: e.target.value })} />
        </div>
      );
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
          <textarea className="input" rows={2} placeholder="نص الاقتباس" value={block.text}
                    onChange={(e) => onChange({ text: e.target.value })} />
          <input className="input" placeholder="المصدر (اختياري)" value={block.cite || ''}
                 onChange={(e) => onChange({ cite: e.target.value })} />
        </div>
      );
    default:
      return <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>خط فاصل بين الأقسام.</p>;
  }
}
