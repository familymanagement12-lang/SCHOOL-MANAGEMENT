import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import TeacherDashboard from './pages/TeacherDashboard';
import Students from './pages/Students';
import Classes from './pages/Classes';
import Subjects from './pages/Subjects';
import Timetable from './pages/Timetable';
import Attendance from './pages/Attendance';
import Fees from './pages/Fees';
import Results from './pages/Results';
import ReportCard from './pages/ReportCard';
import Announcements from './pages/Announcements';
import Users from './pages/Users';
import ChangePassword from './pages/ChangePassword';
import Receipt from './pages/Receipt';
import Settings from './pages/Settings';
import Transactions from './pages/Transactions';
import Inventory from './pages/Inventory';
import Employees from './pages/Employees';
import Payroll from './pages/Payroll';
import Library from './pages/Library';
import McCarthyAI from './pages/McCarthyAI';
import FinanceDashboard from './pages/FinanceDashboard';
import FinanceAudit from './pages/FinanceAudit';
import Feeding from './pages/Feeding';
import PaymentReceipt from './pages/PaymentReceipt';
import OperationsRegisters from './pages/OperationsRegisters';
import {
  StudentPortalLayout, StudentDashboard, StudentProfile, StudentSubjects, StudentTimetable,
  StudentResults, StudentAttendance, StudentAnnouncements, StudentNotifications,
  StudentUnavailableModule, StudentAccountSettings,
} from './pages/StudentPortal';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('sms_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

const StaffRoute = ({ children }) => {
  let user;
  const { pathname } = useLocation();
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  if (user?.role === 'student') return <Navigate to="/student" replace />;
  if (user?.role === 'accountant'
      && !['/', '/fees', '/feeding', '/operations', '/transactions', '/finance-audit', '/payroll'].includes(pathname)
      && !pathname.startsWith('/receipt/')
      && !pathname.startsWith('/payment-receipt/')) {
    return <Navigate to="/" replace />;
  }
  return children;
};

const StudentRoute = ({ children }) => {
  let user;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  return user?.role === 'student' ? children : <Navigate to="/" replace />;
};

const AllowedRoles = ({ roles, children }) => {
  let user;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  return roles.includes(user?.role) ? children : <Navigate to="/" replace />;
};

// Helper component to resolve the correct dashboard based on role
const RoleBasedDashboard = () => {
  const userStr = localStorage.getItem('user');
  let user = null;
  try { user = userStr ? JSON.parse(userStr) : null; } catch { user = null; }
  const role = user?.role;

  if (role === 'student') return <Navigate to="/student" replace />;
  if (role === 'accountant') return <FinanceDashboard />;
  if (role === 'feeding_tuckshop_officer') return <Feeding />;
  if (role === 'teacher') return <TeacherDashboard />;
  if (role === 'inventory' || role === 'store' || role === 'storekeeper') return <Inventory />;
  if (role === 'librarian') return <Library />;
  return <Dashboard />;
};

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/report-card/:studentId" element={<ReportCard />} />
      <Route path="/receipt/:studentId/:feeId" element={<Receipt />} />
      <Route path="/payment-receipt/:receiptId" element={<ProtectedRoute><AllowedRoles roles={['admin', 'accountant', 'feeding_tuckshop_officer']}><PaymentReceipt /></AllowedRoles></ProtectedRoute>} />
      <Route path="/student" element={<ProtectedRoute><StudentRoute><StudentPortalLayout /></StudentRoute></ProtectedRoute>}>
        <Route index element={<StudentDashboard />} />
        <Route path="profile" element={<StudentProfile />} />
        <Route path="subjects" element={<StudentSubjects />} />
        <Route path="timetable" element={<StudentTimetable />} />
        <Route path="assignments" element={<StudentUnavailableModule title="Assignments and Homework" />} />
        <Route path="materials" element={<StudentUnavailableModule title="Learning Materials" />} />
        <Route path="results" element={<StudentResults />} />
        <Route path="attendance" element={<StudentAttendance />} />
        <Route path="announcements" element={<StudentAnnouncements />} />
        <Route path="notifications" element={<StudentNotifications />} />
        <Route path="account" element={<StudentAccountSettings />} />
      </Route>
      <Route path="/" element={<ProtectedRoute><StaffRoute><Layout /></StaffRoute></ProtectedRoute>}>
        <Route index element={<RoleBasedDashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="classes" element={<Classes />} />
        <Route path="subjects" element={<Subjects />} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="fees" element={<AllowedRoles roles={['admin', 'accountant']}><Fees /></AllowedRoles>} />
        <Route path="feeding" element={<AllowedRoles roles={['admin', 'accountant', 'feeding_tuckshop_officer']}><Feeding /></AllowedRoles>} />
        <Route path="operations" element={<AllowedRoles roles={['admin', 'accountant', 'inventory', 'store', 'storekeeper', 'feeding_tuckshop_officer']}><OperationsRegisters /></AllowedRoles>} />
        <Route path="results" element={<Results />} />
        <Route path="transactions" element={<AllowedRoles roles={['admin', 'accountant']}><Transactions /></AllowedRoles>} />
        <Route path="finance-audit" element={<AllowedRoles roles={['admin', 'accountant']}><FinanceAudit /></AllowedRoles>} />
        <Route path="inventory" element={<AllowedRoles roles={['admin', 'inventory', 'store', 'storekeeper', 'teacher']}><Inventory /></AllowedRoles>} />
        <Route path="employees" element={<Employees />} />
        <Route path="payroll" element={<AllowedRoles roles={['admin', 'accountant']}><Payroll /></AllowedRoles>} />
        <Route path="library" element={<Library />} />
        <Route path="ai" element={<McCarthyAI />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="users" element={<Users />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
