import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api/auth';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsLoading(true);

    try {
      const response = await forgotPassword({ email });
      setMessage(response.data.message || 'If an account exists with that email, a password reset link has been sent.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to process request. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-container auth-split-layout login-page">
      <section className="auth-split-left login-brand-panel">
        <div className="login-brand-content">
          <div className="login-school-brand">
            <img src="/mccarthy-hill-school.svg" alt="" />
            <span>The McCarthy Hill School</span>
          </div>

          <div className="login-brand-copy">
            <p className="login-kicker">Account recovery</p>
            <h1>Need a fresh<br />start?</h1>
            <p>We’ll help you get back into your school account securely.</p>
          </div>

          <div className="login-trust-list">
            <span><b aria-hidden="true">✓</b> Secure recovery</span>
            <span><b aria-hidden="true">✓</b> School access</span>
          </div>
        </div>
      </section>

      <section className="auth-split-right login-form-panel">
        <div className="auth-form-container login-card">
          <div className="auth-header login-header">
            <p className="login-kicker">The McCarthy Hill School</p>
            <h2>Reset password</h2>
            <p>Enter your email address to receive reset instructions.</p>
          </div>

          {error && <div className="error-msg shake login-error" role="alert">{error}</div>}
          {message && <div className="login-error" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}>{message}</div>}

          {!message && (
            <form onSubmit={handleSubmit}>
              <div className="auth-input-group">
                <label htmlFor="forgot-email">Email address</label>
                <input
                  id="forgot-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="username"
                  required
                  placeholder="name@school.edu"
                />
              </div>

              <button className="btn-gradient login-submit" type="submit" disabled={isLoading}>
                {isLoading && <span className="spinner" aria-hidden="true" />}
                {isLoading ? 'Sending...' : 'Send reset instructions'}
              </button>
            </form>
          )}

          <div className="auth-footer login-footer">
            Remember your password? <Link to="/login">Back to login</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
export default ForgotPassword;
