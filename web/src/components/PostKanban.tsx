import { useState } from 'react';
import type { ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { SOURCE_LABELS, displayStatus } from '../api';
import StatusBadge from './StatusBadge';

/* لوحة المحتوى — أعمدةٌ بحالاته الثماني، بالسحب والإفلات.

   كانت داخل pages/PostsList.tsx، ونسخةٌ ثانيةٌ مختصرة داخل صفحة الحملات
   تعرض خمسةً من ثمانية: منشورٌ «معتمد» أو «مرفوض» أو «مؤرشف» لا يظهر في
   أي عمود، والبطاقة تقول «٥ منشور» واللوحة تعرض اثنين بلا إشارة. جدولان
   للحالات في ملفّين هما علّةُ ذلك بعينها، فصارا واحداً هنا. */

export const KANBAN_COLS: { key: string; statuses: string[] }[] = [
  { key: 'draft', statuses: ['draft'] },
  { key: 'rejected', statuses: ['rejected'] },
  { key: 'pending_marketing', statuses: ['pending_marketing'] },
  { key: 'pending_gm', statuses: ['pending_gm'] },
  { key: 'approved', statuses: ['approved'] },
  { key: 'scheduled', statuses: ['scheduled', 'late'] },
  { key: 'published', statuses: ['published'] },
  { key: 'archived', statuses: ['archived'] },
];

/** الأعمدة التي تبقى ظاهرةً وإن خلت — بقيّتها تظهر عند أول عنصر فيها. */
const ALWAYS_SHOWN = ['draft', 'pending_marketing', 'pending_gm', 'scheduled', 'published'];

/**
 * الإجراء الذي يقابل نقل بطاقةٍ من حالةٍ إلى عمود، أو `null` إن كان
 * الانتقال ممنوعاً. يحترم تسلسل الاعتماد — والخادم يتحقّق منه كذلك،
 * وهذا حارسٌ للقارئ لا حاجزٌ أمني.
 */
export function moveAction(from: string, toCol: string): 'submit' | 'approve' | 'reject' | 'archive' | null {
  if (toCol === 'pending_marketing' && ['draft', 'rejected'].includes(from)) return 'submit';
  if (toCol === 'pending_gm' && from === 'pending_marketing') return 'approve';
  if (toCol === 'approved' && from === 'pending_gm') return 'approve';
  if (toCol === 'rejected' && ['pending_marketing', 'pending_gm'].includes(from)) return 'reject';
  if (toCol === 'archived' && from === 'published') return 'archive';
  return null;
}

export default function PostKanban({
  rows,
  onOpen,
  onMove,
  showCampaign = true,
  cardAction,
}: {
  rows: any[];
  onOpen: (post: any) => void;
  onMove: (post: any, toCol: string) => void;
  /** اسم الحملة على البطاقة — يُخفى داخل صفحة الحملة نفسها فهو مكرّر. */
  showCampaign?: boolean;
  cardAction?: (post: any) => ReactNode;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const cols = KANBAN_COLS.map((col) => ({
    ...col,
    items: rows.filter((p) => col.statuses.includes(displayStatus(p))),
  })).filter((c) => c.items.length > 0 || ALWAYS_SHOWN.includes(c.key));

  function handleDrop(colKey: string) {
    const post = rows.find((p) => p.id === dragId);
    setDragId(null);
    setOverCol(null);
    if (post) onMove(post, colKey);
  }

  return (
    <div className="kanban-scroll">
      <p className="muted kanban-hint">
        <Lightbulb size={16} /> اسحب البطاقة إلى العمود التالي لتحريك مرحلتها (ضمن التسلسل المسموح).
      </p>
      <div className="kanban-board">
        {cols.map((col) => (
          <div
            key={col.key}
            className={`kanban-col board-col ${overCol === col.key && dragId ? 'dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => { e.preventDefault(); handleDrop(col.key); }}
          >
            <h4 className="row">
              <StatusBadge status={col.key} />
              <div className="spacer" />
              <span className="muted"><bdi>{col.items.length}</bdi></span>
            </h4>
            {col.items.map((p) => (
              <div
                key={p.id}
                className={`kanban-card ${dragId === p.id ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDragId(p.id)}
                onDragEnd={() => { setDragId(null); setOverCol(null); }}
                onClick={() => onOpen(p)}
              >
                <div className="kanban-card-title">{p.title}</div>
                <div className="row kanban-card-meta">
                  <span className="muted">{SOURCE_LABELS[p.source] || p.source}</span>
                  {showCampaign && p.campaign_name && <span className="badge gray">{p.campaign_name}</span>}
                  <div className="spacer" />
                  <span className="muted">{p.author_name}</span>
                </div>
                {cardAction && (
                  <div className="row kanban-card-meta" onClick={(e) => e.stopPropagation()}>
                    {cardAction(p)}
                  </div>
                )}
              </div>
            ))}
            {col.items.length === 0 && <p className="muted kanban-empty">—</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
