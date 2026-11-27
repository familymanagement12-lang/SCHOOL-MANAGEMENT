import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity, Archive, BookOpen, CalendarDays, CircleDollarSign, ClipboardCheck, FileText,
  FileBarChart2, GraduationCap, LayoutDashboard, Megaphone, Settings, Users, Sparkles,
  WalletCards, X, Boxes
} from 'lucide-react';
import { getSettings } from '../api/settings';

const sections = [
  {
    label: 'Workspace',
    links: [
      { path: '/', label: 'Overview', icon: LayoutDashboard },
      { path: '/ai', label: 'McCarthy AI', icon: Sparkles, roles: ['admin', 'teacher', 'librarian', 'inventory'] },
      { path: '/students', label: 'Students', icon: GraduationCap, roles: ['admin'] },
      { path: '/classes', label: 'Classes', icon: Archive, roles: ['admin', 'teacher'] },
      { path: '/subjects', label: 'Subjects', icon: BookOpen, roles: ['admin'] },
      { path: '/timetable', label: 'Timetable', icon: CalendarDays, roles: ['admin', 'teacher'] },
      { path: '/assignments', label: 'Assignments', icon: FileText, roles: ['admin', 'teacher'] },
      { path: '/learning-materials', label: 'Learning Materials', icon: BookOpen, roles: ['admin', 'teacher'] },
      { path: '/attendance', label: 'Attendance', icon: ClipboardCheck, roles: ['admin', 'teacher'] },
      { path: '/results', label: 'Results', icon: FileBarChart2, roles: ['admin', 'teacher'] },
      { path: '/library', label: 'Library', icon: BookOpen, roles: ['admin', 'librarian', 'teacher'] },
      { path: '/announcements', label: 'Announcements', icon: Megaphone, roles: ['admin', 'teacher'] },
    ],
  },
  {
    label: 'Operations',
    links: [
      { path: '/inventory', label: 'School store', icon: Boxes, roles: ['admin', 'inventory', 'store', 'storekeeper', 'teacher'] },
      { path: '/fees', label: 'Fees', icon: WalletCards, roles: ['admin', 'accountant'] },
      { path: '/feeding', label: 'Lunch & Feeding', icon: WalletCards, roles: ['admin', 'accountant', 'feeding_tuckshop_officer'] },
      { path: '/operations', label: 'Market Stock & Weekly Registers', icon: CalendarDays, roles: ['admin', 'accountant', 'inventory', 'store', 'storekeeper', 'feeding_tuckshop_officer'] },
      { path: '/transactions', label: 'Finance', icon: CircleDollarSign, roles: ['admin', 'accountant'] },
      { path: '/finance-audit', label: 'Finance audit trail', icon: FileBarChart2, roles: ['admin', 'accountant'] },
      { path: '/employees', label: 'Staff', icon: Users, roles: ['admin'] },
      { path: '/payroll', label: 'Payroll', icon: Activity, roles: ['admin', 'accountant'] },
      { path: '/users', label: 'Teachers & roles', icon: Users, roles: ['admin', 'teacher'] },
      { path: '/parents', label: 'Parent accounts', icon: Users, roles: ['admin'] },
      { path: '/curriculum-selections', label: 'Curriculum selections', icon: GraduationCap, roles: ['admin'] },
      { path: '/settings', label: 'Settings', icon: Settings, roles: ['admin'] },
    ],
  },
];

const roleLabels = {
  admin: 'Administrator',
  librarian: 'Librarian',
  inventory: 'Inventory',
  store: 'Inventory',
  storekeeper: 'Storekeeper',
  teacher: 'Teacher',
  accountant: 'Accountant',
  feeding_tuckshop_officer: 'Feeding Officer',
};

function Sidebar({ mobileOpen = false, onNavigate = () => {} }) {
  const [school, setSchool] = useState(null);
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  useEffect(() => {
    if (['accountant', 'feeding_tuckshop_officer'].includes(user?.role)) return;
    getSettings().then((response) => setSchool(response.data)).catch(() => {});
  }, [user?.role]);

  return (
    <>
      {mobileOpen && <button className="sidebar-scrim" aria-label="Dismiss navigation backdrop" onClick={onNavigate} />}
      <aside className={`app-sidebar${mobileOpen ? ' is-open' : ''}`}>
        <div className="sidebar-brand">
          <img src={school?.logo_url || '/mccarthy-hill-school-crest.png'} alt="" />
          <div className="sidebar-brand-copy">
            <strong>{school?.name || 'McCarthy Hill'}</strong>
            <span>School operations</span>
          </div>
          <button className="sidebar-close" onClick={onNavigate} aria-label="Close navigation"><X size={18} /></button>
        </div>

        <div className="sidebar-profile">
          <div className="sidebar-avatar">{user?.name?.charAt(0)?.toUpperCase() || 'U'}</div>
          <div className="sidebar-profile-copy">
            <strong>{user?.name || 'School user'}</strong>
            <span>{roleLabels[user?.role] || 'Staff account'}</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {sections.map((section) => {
            const visibleLinks = section.links.filter((link) => (
              !link.roles || link.roles.includes(user?.role)
            ));
            if (!visibleLinks.length) return null;
            return (
              <div className="sidebar-section" key={section.label}>
                <p>{section.label}</p>
                {visibleLinks.map(({ path, label, icon: Icon }) => (
                  <NavLink
                    key={path}
                    to={path}
                    end={path === '/'}
                    className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                    onClick={onNavigate}
                  >
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footnote"><span className="service-dot" /> School workspace</div>
      </aside>
    </>
  );
}

export default Sidebar;
