import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// نافذة منبثقة جذرية: تُرسم في portal بموضع ثابت واعٍ بحواف الشاشة،
// فلا تُقصّ أبداً بأي حاوية ذات overflow. تُستخدم لكل القوائم والمنتقيات.
export function Popover({
  render,
  children,
}: {
  render: (o: { open: boolean; toggle: () => void; close: () => void }) => ReactNode;
  children: (o: { close: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, opacity: 0, zIndex: 60 });

  function reposition() {
    const a = anchorRef.current?.getBoundingClientRect();
    const p = panelRef.current;
    if (!a || !p) return;
    const pw = p.offsetWidth;
    const ph = p.offsetHeight;
    const M = 8;
    let top = a.bottom + 6;
    // RTL: محاذاة الحافة اليمنى للنافذة مع يمين المُطلِق، ثم القصّ ضمن الشاشة
    let left = a.right - pw;
    if (left < M) left = M;
    if (left + pw > window.innerWidth - M) left = window.innerWidth - M - pw;
    if (top + ph > window.innerHeight - M) {
      const up = a.top - 6 - ph;
      top = up >= M ? up : Math.max(M, window.innerHeight - M - ph);
    }
    setStyle({ position: 'fixed', top, left, opacity: 1, zIndex: 60 });
  }

  useLayoutEffect(() => {
    if (open) reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onMove = () => reposition();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => setOpen(false);
  const toggle = () => setOpen((v) => !v);

  return (
    <>
      <div ref={anchorRef} style={{ display: 'inline-block' }}>{render({ open, toggle, close })}</div>
      {open && createPortal(<div ref={panelRef} style={style}>{children({ close })}</div>, document.body)}
    </>
  );
}
