import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePassword } from '../api/users';

function ChangePassword() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      return setError('Password must be at least 8 characters long.');
    }
    if (newPassword !== confirmPassword) {
      return setError('Passwords do not match');
    }

    try {
      const response = await changePassword({ newPassword });
      
      // Update local storage so the system knows they have changed their password
      localStorage.setItem('user', JSON.stringify(response.data));
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update password');
    }
  };

  return (
    <div className="page login-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc', padding: '1rem' }}>
      <div className="login-card" style={{ background: '#ffffff', padding: '2.5rem', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '1.75rem', color: '#0f172a' }}>Security Update</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.95rem' }}>Please change your auto-generated password to continue.</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {error && <div className="error" style={{ background: '#fef2f2', color: '#991b1b', padding: '0.75rem 1rem', borderRadius: '8px', textAlign: 'center' }}>{error}</div>}
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: '600', color: '#334155' }}>New Password</label>
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" autoComplete="new-password" required minLength="8" style={{ padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', width: '100%' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: '600', color: '#334155' }}>Confirm New Password</label>
            <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password" autoComplete="new-password" required minLength="8" style={{ padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', width: '100%' }} />
          </div>

          <button type="submit" className="btn-primary" style={{ marginTop: '0.5rem', padding: '0.875rem', borderRadius: '8px', width: '100%' }}>Update & Continue</button>
        </form>
      </div>
    </div>
  );
}

export default ChangePassword;