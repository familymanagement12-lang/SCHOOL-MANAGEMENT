import { useEffect, useState } from 'react';
import { getAnnouncements, createAnnouncement } from '../api/announcements';
import { getClasses } from '../api/classes';

const getCurrentUser = () => {
  try {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch (e) {
    return null;
  }
};

function Announcements() {
  const [announcements, setAnnouncements] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const user = getCurrentUser();
  const [formData, setFormData] = useState({
    title: '',
    message: '',
    audience: user?.role === 'admin' ? 'everyone' : 'class',
    class_id: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [annRes, classRes] = await Promise.all([
        getAnnouncements(),
        (user?.role === 'admin' || user?.role === 'teacher') ? getClasses() : Promise.resolve({ data: [] })
      ]);
      setAnnouncements(annRes.data);
      setClasses(classRes.data);
      setLoading(false);
    } catch (err) {
      setError('Failed to load announcements');
      setLoading(false);
    }
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await createAnnouncement(formData);
      await fetchData();
      setShowModal(false);
      setFormData({
        title: '',
        message: '',
        audience: user?.role === 'admin' ? 'everyone' : 'class',
        class_id: ''
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send announcement');
    }
  };

  if (loading) return <div className="page"><p>Loading...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero" style={{
          background: 'linear-gradient(135deg, #6366f1 0%, #d946ef 100%)',
          color: '#ffffff',
          borderRadius: '16px',
          border: 'none',
          boxShadow: '0 10px 25px -5px rgba(217, 70, 239, 0.25)'
        }}>
          <div>
            <p className="eyebrow" style={{ color: '#fbcfe8', fontWeight: '600' }}>Communication</p>
            <h1 style={{ color: '#ffffff', fontSize: '2.5rem', marginTop: '0.25rem', marginBottom: '0.5rem' }}>Announcements</h1>
            <p style={{ color: '#fdf4ff', fontSize: '1.1rem', opacity: 0.9 }}>School-wide updates and class-specific notifications.</p>
          </div>
          {(user?.role === 'admin' || user?.role === 'teacher') && (
            <button className="btn-primary" onClick={() => setShowModal(true)} style={{ backgroundColor: '#ffffff', color: '#c026d3', border: 'none', fontWeight: 'bold' }}>
              New Message
            </button>
          )}
        </section>

        <section className="data-panel">
          {error && <div className="error">{error}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem 0' }}>
            {announcements.map((item) => (
              <div key={item.id} style={{
                background: '#ffffff',
                borderRadius: '12px',
                padding: '1.5rem',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
                border: '1px solid #e2e8f0',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '4px', backgroundColor: item.audience === 'everyone' ? '#3b82f6' : '#10b981' }} />
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', paddingLeft: '0.5rem' }}>
                  <div>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', color: '#0f172a', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {item.audience === 'everyone' ? '🔔' : '📌'} {item.title}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#64748b' }}>
                      <strong style={{ color: '#475569' }}>{item.sender_name}</strong>
                      <span>•</span>
                      <span>{new Date(item.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                  </div>
                  <span style={{
                    padding: '0.35rem 0.85rem',
                    borderRadius: '9999px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    backgroundColor: item.audience === 'everyone' ? '#dbeafe' : '#d1fae5',
                    color: item.audience === 'everyone' ? '#1e40af' : '#065f46',
                    whiteSpace: 'nowrap'
                  }}>
                    {item.audience === 'everyone' ? '📢 School-Wide' : `🏫 Class: ${item.class_name}`}
                  </span>
                </div>
                <p style={{ margin: 0, paddingLeft: '0.5rem', color: '#334155', lineHeight: '1.6', fontSize: '0.95rem', whiteSpace: 'pre-wrap' }}>
                  {item.message}
                </p>
              </div>
            ))}
            {announcements.length === 0 && <p className="empty-state">No announcements yet.</p>}
          </div>
        </section>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Announcement</h2>
              <button className="btn-close" onClick={() => setShowModal(false)}>x</button>
            </div>
            <form onSubmit={handleSubmit}>
              {user?.role === 'admin' && (
                <>
                  <label>Audience</label>
                  <select name="audience" value={formData.audience} onChange={handleInputChange}>
                    <option value="everyone">Everyone (School-Wide)</option>
                    <option value="class">Specific Class</option>
                  </select>
                </>
              )}
              
              {formData.audience === 'class' && (
                <>
                  <label>Select Class *</label>
                  <select name="class_id" value={formData.class_id} onChange={handleInputChange} required>
                    <option value="">-- Choose Class --</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </>
              )}

              <label>Title *</label>
              <input type="text" name="title" value={formData.title} onChange={handleInputChange} required placeholder="e.g. Tomorrow's Field Trip" />

              <label>Message *</label>
              <textarea name="message" value={formData.message} onChange={handleInputChange} required rows="4" placeholder="Type your message here..."></textarea>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Send Message</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Announcements;