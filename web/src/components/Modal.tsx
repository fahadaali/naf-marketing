import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 18 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق">
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
