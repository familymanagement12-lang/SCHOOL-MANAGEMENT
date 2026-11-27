import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login } from '../api/auth';
import { setAuthToken } from '../api/api';

function Login() {
  const [loginMode, setLoginMode] = useState('student');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await login({ identifier, password });
      const { token, user } = response.data;
      localStorage.setItem('sms_token', token);
      if (user) localStorage.setItem('user', JSON.stringify(user));
      setAuthToken(token);

      if (user?.must_change_password) navigate('/change-password');
      else if (user?.role === 'parent') navigate('/parent');
      else if (user?.role === 'student') navigate('/student');
      else navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-container auth-split-layout login-page">
      <section className="auth-split-left login-brand-panel">
        <div className="login-brand-content">
          <div className="login-school-brand">
            <img src="/the-mccarthy-hill-school-logo.png" alt="The McCarthy Hill School" />
          </div>
          <div className="login-brand-copy">
            <p className="login-kicker">School management system</p>
            <h1>Welcome to<br />The McCarthy Hill School.</h1>
            <p>School management and library services in one place.</p>
          </div>
          <div className="login-trust-list">
            <span><b aria-hidden="true">✓</b> Secure access</span>
            <span><b aria-hidden="true">✓</b> School community</span>
          </div>
        </div>
      </section>

      <section className="auth-split-right login-form-panel">
        <div className="auth-form-container login-card">
          <div className="auth-header login-header">
            <p className="login-kicker">The McCarthy Hill School</p>
            <h2>{loginMode === 'student' ? 'Student sign in' : greeting}</h2>
            <p>{loginMode === 'student' ? 'Use your personalized school username and password to open your student portal.' : 'Sign in to continue to your account.'}</p>
          </div>

          <div className="login-mode-switch" role="group" aria-label="Choose account type">
            <button type="button" className={loginMode === 'student' ? 'active' : ''} aria-pressed={loginMode === 'student'} onClick={() => { setLoginMode('student'); setError(''); setIdentifier(''); setPassword(''); }}>Student</button>
            <button type="button" className={loginMode === 'other' ? 'active' : ''} aria-pressed={loginMode === 'other'} onClick={() => { setLoginMode('other'); setError(''); setIdentifier(''); setPassword(''); }}>Staff &amp; parents</button>
          </div>

          {error && <div className="error-msg shake login-error" role="alert">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="auth-input-group">
              <label htmlFor="login-identifier">{loginMode === 'student' ? 'Student username' : 'Username, email, or registered phone'}</label>
              <input
                id="login-identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                type="text"
                autoFocus={loginMode === 'student'}
                autoComplete="username"
                required
                placeholder={loginMode === 'student' ? 'e.g. gideon.akussah' : 'Username, email, or phone'}
              />
            </div>

            <div className="auth-input-group">
              <div className="login-password-label">
                <label htmlFor="login-password">Password</label>
                {loginMode === 'other' && <Link to="/forgot-password">Forgot password?</Link>}
              </div>
              <div className="login-password-input">
                <input
                  id="login-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder={loginMode === 'student' ? 'Temporary password or your new password' : 'Enter your password'}
                />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button className="btn-gradient login-submit" type="submit" disabled={isLoading}>
              {isLoading && <span className="spinner" aria-hidden="true" />}
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {loginMode === 'student'
            ? <p className="auth-footer login-footer">First time signing in? Use the temporary password given by the school (usually your date of birth as DDMMYYYY); you will be asked to change it. If you have not received a username or your account is inactive, ask the school office for help.</p>
            : <p className="auth-footer login-footer">Need an account? Contact the school administrator.</p>}
        </div>
      </section>
    </main>
  );
}

export default Login;
