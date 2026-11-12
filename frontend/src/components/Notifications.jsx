import { useState, useEffect } from 'react';
import { getNotifications, markNotificationAsRead, markAllNotificationsAsRead } from '../api/notifications';

function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetchNotifications();
    // Periodically poll for new notifications every 60 seconds
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await getNotifications();
      setNotifications(res.data);
    } catch (err) {
      console.error('Failed to load notifications', err);
    }
  };

  const handleMarkAsRead = async (id) => {
    try {
      await markNotificationAsRead(id);
      setNotifications(notifications.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllNotificationsAsRead();
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error(err);
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div style={{ position: 'relative' }}>
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer', position: 'relative' }}
        title="Notifications"
      >
        🔔
        {unreadCount > 0 && (
          <span style={{ position: 'absolute', top: '-5px', right: '-5px', background: '#ef4444', color: 'white', fontSize: '0.75rem', borderRadius: '50%', minWidth: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div style={{ position: 'absolute', right: 0, top: '120%', width: '320px', background: 'white', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', borderRadius: '12px', zIndex: 1000, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a' }}>Notifications</h3>
            {unreadCount > 0 && <button onClick={handleMarkAllAsRead} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Mark all as read</button>}
          </div>
          
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {notifications.length === 0 ? <p style={{ padding: '1rem', textAlign: 'center', color: '#64748b', margin: 0 }}>No notifications yet.</p> : notifications.map(notification => (
              <div key={notification.id} style={{ padding: '1rem', borderBottom: '1px solid #e2e8f0', background: notification.is_read ? 'white' : '#eff6ff', cursor: 'pointer', transition: 'background 0.2s ease' }} onClick={() => !notification.is_read && handleMarkAsRead(notification.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}><strong style={{ color: '#0f172a', fontSize: '0.9rem' }}>{notification.title}</strong><span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(notification.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: '1.4' }}>{notification.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
export default Notifications;