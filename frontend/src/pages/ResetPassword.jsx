import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { resetPasswordWithToken } from '../api/auth';

function ResetPassword() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) {
      return setError('Passwords do not match.');
    }

    setIsLoading(true);
    try {
      const response = await resetPasswordWithToken({ id, token, newPassword });
      setMessage(response.data.message || 'Password reset successfully.');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid or expired link.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container auth-split-layout">
      <div className="auth-split-left" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)', color: 'white', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-10%', left: '-10%', opacity: 0.05, transform: 'rotate(-15deg)', pointerEvents: 'none' }}>
          <h1 style={{ fontSize: '15rem', fontWeight: 900, margin: 0, lineHeight: 1 }}>EDU<br/>CORE</h1>
        </div>
        <div style={{ position: 'relative', zIndex: 1, padding: '3rem' }}>
          <div style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-0.025em', marginBottom: '4rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <img src="/mccarthy-hill-school.svg" alt="The McCarthy Hill School Logo" style={{ height: '60px', objectFit: 'contain', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.3))' }} />
            <span style={{ background: 'linear-gradient(to right, #60a5fa, #ffffff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>THE MCCARTHY HILL SCHOOL</span>
          </div>
          <h1 style={{ fontSize: 'clamp(3rem, 4vw, 4.25rem)', fontWeight: 900, margin: '0 0 1.5rem 0', letterSpacing: '-0.025em', lineHeight: 1.05 }}>
            Create New<br/>Password.
          </h1>
          <p style={{ fontSize: '1.25rem', color: 'rgba(255,255,255,0.9)', margin: '0 0 3rem 0', maxWidth: '420px', lineHeight: 1.6, fontWeight: '500' }}>
            Run your school, we handle the rest.
          </p>
        </div>
      </div>

      <div className="auth-split-right">
        <div className="auth-form-container">
          {!id || !token ? (
            <div style={{ textAlign: 'center' }}>
              <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Invalid Link ❌</h2>
              <p style={{ color: '#64748b', marginBottom: '2rem' }}>This password reset link is invalid or incomplete.</p>
              <Link to="/forgot-password" className="btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>Request New Link</Link>
            </div>
          ) : (
            <>
              <div className="auth-header" style={{ textAlign: 'left' }}>
                <h2 style={{ fontSize: '2rem' }}>Set Password 🔑</h2>
                <p>Enter your new secure password below.</p>
              </div>

              {error && <div className="error-msg shake" style={{ background: '#fef2f2', color: '#991b1b', padding: '1rem', borderRadius: '0.75rem', marginBottom: '1.5rem', fontSize: '0.9rem', border: '1px solid #fca5a5' }}>{error}</div>}
              {message && <div style={{ background: '#ecfdf5', color: '#065f46', padding: '1rem', borderRadius: '0.75rem', marginBottom: '1.5rem', fontSize: '0.9rem', border: '1px solid #a7f3d0' }}>{message}</div>}

              {!message ? (
                <form onSubmit={handleSubmit}>
                  <div className="auth-input-group">
                    <label>New Password</label>
                    <div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔒</span><input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" required minLength="6" placeholder="••••••••" style={{ paddingLeft: '2.5rem' }} /></div>
                  </div>
                  <div className="auth-input-group">
                    <label>Confirm Password</label>
                    <div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔒</span><input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password" required minLength="6" placeholder="••••••••" style={{ paddingLeft: '2.5rem' }} /></div>
                  </div>
                  <button className="btn-gradient" type="submit" disabled={isLoading} style={{ marginTop: '1rem' }}>
                    {isLoading ? 'Saving...' : 'Reset Password'}
                  </button>
                </form>
              ) : (
                <div style={{ textAlign: 'center', marginTop: '2rem' }}><Link to="/login" className="btn-gradient" style={{ display: 'inline-block', textDecoration: 'none', padding: '0.75rem 1.5rem' }}>Go to Login</Link></div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
export default ResetPassword;
