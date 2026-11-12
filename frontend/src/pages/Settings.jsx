import { useState, useEffect } from 'react';
import { getSettings, updateSettings } from '../api/settings';

function Settings() {
  const [schoolData, setSchoolData] = useState({ name: '', address: '', phone: '', motto: '', logo_url: '', academic_year: '', current_term: '', currency: 'USD', grading_scale: '' });
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await getSettings();
        setSchoolData(res.data);
        setLoading(false);
      } catch (err) {
        console.error('Settings Error:', err);
        setError(err.response?.data?.message || err.message || 'Failed to load settings.');
        setLoading(false);
      }
    })();
  }, []);

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { // 2MB limit to keep database fast
        setError('Logo file size should be less than 2MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setSchoolData({ ...schoolData, logo_url: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      const res = await updateSettings(schoolData);
      setSchoolData(res.data);
      localStorage.setItem('sms_currency', res.data.currency || 'USD'); // Sync currency globally
      
      // Reload to instantly apply the new School Logo and Name to the Sidebar!
      window.location.reload(); 
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return <div className="page"><p>Loading...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero" style={{ background: 'linear-gradient(135deg, #475569 0%, #1e293b 100%)', color: 'white' }}>
          <div>
            <p className="eyebrow" style={{ color: '#cbd5e1' }}>Workspace Settings</p>
            <h1 style={{ color: 'white' }}>System Configuration</h1>
            <p style={{ color: '#f8fafc' }}>Manage your school details and personal profile.</p>
          </div>
        </section>

        {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

        <section className="dashboard-grid">
          <form className="data-panel form-panel" onSubmit={handleSave}>
            <div className="panel-heading">
              <div><p className="eyebrow">Identity</p><h2>Branding</h2></div>
            </div>
            
            <label>School Name</label>
            <input type="text" value={schoolData.name} onChange={(e) => setSchoolData({...schoolData, name: e.target.value})} required />
            
            <label>Motto</label>
            <input type="text" value={schoolData.motto || ''} onChange={(e) => setSchoolData({...schoolData, motto: e.target.value})} placeholder="e.g. Run your school, we handle the rest" />
            
            <label>School Address</label>
            <textarea value={schoolData.address || ''} onChange={(e) => setSchoolData({...schoolData, address: e.target.value})} rows="3" />
            
            <label>Official Phone Number</label>
            <input type="tel" value={schoolData.phone || ''} onChange={(e) => setSchoolData({...schoolData, phone: e.target.value})} />
            
            <label>School Logo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
              {schoolData.logo_url && (
                <div style={{ width: '60px', height: '60px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                  <img src={schoolData.logo_url} alt="School Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
              )}
              <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ flex: 1 }} />
            </div>
            
            <button type="submit" className="btn-primary" disabled={isSaving} style={{ marginTop: '1rem' }}>{isSaving ? 'Saving...' : 'Save Branding'}</button>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <form className="data-panel form-panel" onSubmit={handleSave}>
              <div className="panel-heading">
                <div><p className="eyebrow">Curriculum</p><h2>Academics</h2></div>
              </div>
              
              <label>Academic Year</label>
              <input type="text" value={schoolData.academic_year || ''} onChange={(e) => setSchoolData({...schoolData, academic_year: e.target.value})} placeholder="e.g. 2023/2024" />
              
              <label>Current Term</label>
              <select value={schoolData.current_term || ''} onChange={(e) => setSchoolData({...schoolData, current_term: e.target.value})}>
                <option value="">Select Term</option>
                <option value="Term 1">Term 1</option>
                <option value="Term 2">Term 2</option>
                <option value="Term 3">Term 3</option>
              </select>

              <button type="submit" className="btn-primary" disabled={isSaving} style={{ marginTop: '1rem' }}>{isSaving ? 'Saving...' : 'Save Academics'}</button>
            </form>

            <form className="data-panel form-panel" onSubmit={handleSave}>
              <div className="panel-heading">
                <div><p className="eyebrow">Billing</p><h2>Finance</h2></div>
              </div>
              
              <label>Default Currency</label>
              <select value={schoolData.currency || 'USD'} onChange={(e) => setSchoolData({...schoolData, currency: e.target.value})}>
                <option value="USD">USD ($)</option>
                <option value="GHS">GHS (₵)</option>
                <option value="NGN">NGN (₦)</option>
                <option value="KES">KES (KSh)</option>
                <option value="GBP">GBP (£)</option>
                <option value="EUR">EUR (€)</option>
              </select>

              <button type="submit" className="btn-primary" disabled={isSaving} style={{ marginTop: '1rem' }}>{isSaving ? 'Saving...' : 'Save Finance'}</button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Settings;