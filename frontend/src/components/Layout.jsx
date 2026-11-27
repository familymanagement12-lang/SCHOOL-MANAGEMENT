import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, Moon, Sun } from 'lucide-react';
import Sidebar from './Sidebar';

function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const userStr = localStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;
  const roleLabel = { admin: 'Administrator', librarian: 'Librarian', inventory: 'Inventory', store: 'Inventory', storekeeper: 'Storekeeper', teacher: 'Teacher', accountant: 'Accountant' }[user?.role] || 'Guest';
  const [theme, setTheme] = useState(localStorage.getItem('sms_theme') || 'light');
  const [mobileOpen, setMobileOpen] = useState(false);
  const pageTitles = {
    '/': 'Overview', '/ai': 'McCarthy AI', '/library': 'Library management', '/inventory': 'School inventory',
    '/students': 'Students', '/classes': 'Classes', '/attendance': 'Attendance', '/assignments': 'Assignments',
    '/results': 'Results', '/timetable': 'Term timetable', '/users': 'Accounts & roles',
    '/announcements': 'Announcements', '/fees': 'Fees', '/transactions': 'Finance', '/finance-audit': 'Finance audit trail',
    '/employees': 'Staff', '/payroll': 'Payroll', '/settings': 'Settings',
    '/curriculum-selections': 'Curriculum selections',
  };

  useEffect(() => {
    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('sms_theme', theme);
  }, [theme]);

  const handleLogout = () => {
    localStorage.removeItem('sms_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // Auto-logout after 30 minutes of inactivity
  useEffect(() => {
    let timeoutId;
    let throttleTimer;

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      // 30 minutes = 30 * 60 * 1000 milliseconds
      timeoutId = setTimeout(() => {
        handleLogout();
      }, 30 * 60 * 1000); 
    };

    const activityHandler = () => {
      if (throttleTimer) return; // Prevent performance drops by limiting resets
      throttleTimer = setTimeout(() => {
        resetTimer();
        throttleTimer = null;
      }, 1000); // Throttle activity checks to once per second
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, activityHandler));
    resetTimer(); // Initialize timer on load

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (throttleTimer) clearTimeout(throttleTimer);
      events.forEach(e => window.removeEventListener(e, activityHandler));
    };
  }, []);

  return (
    <div className={`workspace-shell${theme === 'dark' ? ' theme-dark' : ''}`}>
      
      {/* Dynamic Global Dark Mode CSS Overrides */}
      <style>{`
        body {
          --bg-main: linear-gradient(135deg, #f0f9ff 0%, #e0e7ff 100%);
        }
        body.dark-mode {
          --bg-main: linear-gradient(135deg, #020617 0%, #0f172a 50%, #1e1b4b 100%);
          background: var(--bg-main);
          color: #e2e8f0;
          color-scheme: dark;
        }
        body.dark-mode header {
          background: #0f172a !important;
          border-bottom: 1px solid #1e293b !important;
        }
        body.dark-mode aside {
          background: #020617 !important;
          border-right: 1px solid #1e293b !important;
        }
        
        /* Title & Hero Backgrounds in Dark Mode */
        body.dark-mode .module-hero,
        body.dark-mode .dashboard-hero {
          background: linear-gradient(135deg, #0f172a 0%, #020617 100%) !important;
          border: 1px solid #1e293b !important;
          box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.6) !important;
        }

        body.dark-mode .data-panel,
        body.dark-mode .dashboard-panel,
        body.dark-mode .stat-card,
        body.dark-mode .class-card,
        body.dark-mode .modal,
        body.dark-mode .mini-stat,
        body.dark-mode .insight-list > div {
          background: #0f172a !important;
          border-color: #1e293b !important;
          color: #e2e8f0 !important;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
        }
        body.dark-mode .panel-heading,
        body.dark-mode .modal-header,
        body.dark-mode .modal-actions {
          border-color: #1e293b !important;
        }
        body.dark-mode h1, body.dark-mode h2, body.dark-mode h3, body.dark-mode h4, body.dark-mode strong, body.dark-mode label {
          color: #f8fafc !important;
        }
        body.dark-mode p {
          color: #cbd5e1 !important;
        }
        body.dark-mode td {
          color: #cbd5e1 !important;
          border-bottom-color: #1e293b !important;
        }
        body.dark-mode th {
          background: #1e293b !important;
          color: #94a3b8 !important;
          border-bottom-color: #334155 !important;
        }
        body.dark-mode input, body.dark-mode select, body.dark-mode textarea {
          background: #020617 !important;
          border-color: #334155 !important;
          color: #f8fafc !important;
        }
        body.dark-mode input:focus, body.dark-mode select:focus, body.dark-mode textarea:focus {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3) !important;
        }
        body.dark-mode .btn-secondary {
          background: #1e293b !important;
          color: #f8fafc !important;
          border-color: #334155 !important;
        }
        body.dark-mode .btn-secondary:hover {
          background: #334155 !important;
        }
        body.dark-mode .empty-state, body.dark-mode .eyebrow {
          color: #94a3b8 !important;
        }
        body.dark-mode .id-pill {
          background: #1e293b !important;
          color: #cbd5e1 !important;
          border-color: #334155 !important;
        }
        body.dark-mode .table-wrap {
          border-color: #1e293b !important;
        }
        
        /* Magic Overrides for Inline Styles (Invisible Text Fixes) */
        body.dark-mode [style*="color: #0f172a"], body.dark-mode [style*="color: rgb(15, 23, 42)"],
        body.dark-mode [style*="color: #334155"], body.dark-mode [style*="color: rgb(51, 65, 85)"] {
          color: #f8fafc !important;
        }
        body.dark-mode [style*="color: #475569"], body.dark-mode [style*="color: rgb(71, 85, 105)"],
        body.dark-mode [style*="color: #64748b"], body.dark-mode [style*="color: rgb(100, 116, 139)"] {
          color: #cbd5e1 !important;
        }
        body.dark-mode [style*="background: #f8fafc"], body.dark-mode [style*="background-color: #f8fafc"], body.dark-mode [style*="background: rgb(248, 250, 252)"], body.dark-mode [style*="background-color: rgb(248, 250, 252)"],
        body.dark-mode [style*="background: #f1f5f9"], body.dark-mode [style*="background-color: #f1f5f9"], body.dark-mode [style*="background: rgb(241, 245, 249)"], body.dark-mode [style*="background-color: rgb(241, 245, 249)"] {
          background-color: #1e293b !important;
          border-color: #334155 !important;
        }
        body.dark-mode [style*="background: white"], body.dark-mode [style*="background-color: white"], body.dark-mode [style*="background: #ffffff"], body.dark-mode [style*="background-color: #ffffff"], body.dark-mode [style*="background: rgb(255, 255, 255)"], body.dark-mode [style*="background-color: rgb(255, 255, 255)"] {
          background-color: #0f172a !important;
          border-color: #1e293b !important;
        }
        body.dark-mode [style*="border-bottom: 1px dashed"],
        body.dark-mode [style*="border-bottom: 2px dotted"],
        body.dark-mode [style*="border: 1px solid"] {
          border-color: #334155 !important;
        }
      `}</style>

      <Sidebar mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <div className="workspace-content">
        <header className="workspace-header">
          <div className="workspace-heading">
            <button className="icon-button mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" title="Open navigation"><Menu size={19} /></button>
            <div>
              <span className="workspace-kicker">The McCarthy Hill School</span>
              <h1>{pageTitles[location.pathname] || 'School workspace'}</h1>
            </div>
          </div>
          <div className="workspace-actions">
            <button className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}>
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <div className="header-account">
              <span className="header-avatar">{user?.name?.charAt(0)?.toUpperCase() || 'U'}</span>
              <span className="header-account-copy"><strong>{user?.name || 'User'}</strong><small>{roleLabel}</small></span>
            </div>
            <button onClick={handleLogout} className="icon-button logout-button" title="Sign out" aria-label="Sign out"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="workspace-main">
          <div className="workspace-page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;
