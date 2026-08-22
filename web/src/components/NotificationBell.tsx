import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { Popover } from './Popover';
import { api, formatRiyadh } from '../api';

// جرس الإشعارات — يُحدَّث دورياً، مع نافذة منبثقة تعرض آخر الإشعارات وزر «تعليم الكل مقروءاً».
export default function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  function load() {
    /* الصمت قرار: الجرس زينةُ ترويسة لا شاشة، ورسالةُ خطأ فيه تلاحق
       المستخدم في كل شاشة. وما يفوته إشعارٌ يصله في الطلب التالي. */
    api.get('/notifications').then((d) => { setItems(d.notifications); setUnread(d.unread); }).catch(() => {});
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 45_000);
    return () => clearInterval(t);
  }, []);

  async function open(n: any, close: () => void) {
    if (!n.read_at) await api.post(`/notifications/${n.id}/read`);
    close();
    load();
    if (n.link) navigate(n.link);
  }

  async function markAll() {
    await api.post('/notifications/read-all');
    load();
  }

  return (
    <Popover
      render={({ toggle }) => (
        <button className="naf-icon-btn" onClick={toggle} title="الإشعارات" style={{ position: 'relative' }}>
          <Bell size={20} />
          {unread > 0 && <span className="notif-dot">{unread > 9 ? '9+' : unread}</span>}
        </button>
      )}
    >
      {({ close }) => (
        <div className="menu notif-menu">
          <div className="row" style={{ padding: '4px 6px 8px' }}>
            <strong style={{ fontSize: 'var(--text-sm)' }}>الإشعارات</strong>
            <div className="spacer" />
            {unread > 0 && (
              <button className="btn ghost sm" onClick={markAll}><CheckCheck size={20} /> تعليم الكل</button>
            )}
          </div>
          <div style={{ maxHeight: 340, overflow: 'auto' }}>
            {items.map((n) => (
              <button
                type="button"
                key={n.id}
                className="notif-item row-link"
                style={{ background: n.read_at ? 'transparent' : 'var(--primary-soft)' }}
                onClick={() => open(n, close)}
              >
                <div style={{ fontWeight: 600, fontSize: 'var(--text-xs)' }}>{n.title}</div>
                {n.body && <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{n.body}</div>}
                <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{formatRiyadh(n.created_at)}</div>
              </button>
            ))}
            {items.length === 0 && <p className="muted" style={{ padding: 16, textAlign: 'center', margin: 0 }}>لا إشعارات جديدة.</p>}
          </div>
        </div>
      )}
    </Popover>
  );
}
