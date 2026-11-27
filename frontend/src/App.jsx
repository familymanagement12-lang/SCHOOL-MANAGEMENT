import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

const pageModules = import.meta.glob(['./pages/*.jsx','./components/*.jsx']);
const modulePath = (path) => path.endsWith('.jsx') ? path : `${path}.jsx`;
const lazyPage = (path) => lazy(pageModules[modulePath(path)]);
const lazyNamedPage = (path, name) => lazy(() => pageModules[modulePath(path)]().then((module) => ({ default: module[name] })));
const Layout = lazyPage('./components/Layout');
const Login = lazyPage('./pages/Login');
const ForgotPassword = lazyPage('./pages/ForgotPassword');
const ResetPassword = lazyPage('./pages/ResetPassword');
const Dashboard = lazyPage('./pages/Dashboard');
const TeacherDashboard = lazyPage('./pages/TeacherDashboard');
const Students = lazyPage('./pages/Students');
const Classes = lazyPage('./pages/Classes');
const Subjects = lazyPage('./pages/Subjects');
const Timetable = lazyPage('./pages/Timetable');
const Attendance = lazyPage('./pages/Attendance');
const Fees = lazyPage('./pages/Fees');
const Results = lazyPage('./pages/Results');
const ReportCard = lazyPage('./pages/ReportCard');
const Announcements = lazyPage('./pages/Announcements');
const Users = lazyPage('./pages/Users');
const ChangePassword = lazyPage('./pages/ChangePassword');
const Receipt = lazyPage('./pages/Receipt');
const Settings = lazyPage('./pages/Settings');
const Transactions = lazyPage('./pages/Transactions');
const Inventory = lazyPage('./pages/Inventory');
const Employees = lazyPage('./pages/Employees');
const Payroll = lazyPage('./pages/Payroll');
const Library = lazyPage('./pages/Library');
const McCarthyAI = lazyPage('./pages/McCarthyAI');
const FinanceDashboard = lazyPage('./pages/FinanceDashboard');
const FinanceAudit = lazyPage('./pages/FinanceAudit');
const Feeding = lazyPage('./pages/Feeding');
const PaymentReceipt = lazyPage('./pages/PaymentReceipt');
const OperationsRegisters = lazyPage('./pages/OperationsRegisters');
const Assignments = lazyPage('./pages/Assignments');
const StudentAssignments = lazyPage('./pages/StudentAssignments');
const LearningMaterials = lazyPage('./pages/LearningMaterials');
const StudentMaterials = lazyPage('./pages/StudentMaterials');
const ParentPortalLayout = lazyNamedPage('./pages/ParentPortal','ParentPortalLayout');
const ParentDashboard = lazyNamedPage('./pages/ParentPortal','ParentDashboard');
const ParentCurriculumSelection = lazyNamedPage('./pages/ParentPortal','ParentCurriculumSelection');
const ParentFees = lazyNamedPage('./pages/ParentPortal','ParentFees');
const ParentFeeding = lazyNamedPage('./pages/ParentPortal','ParentFeeding');
const ParentResults = lazyNamedPage('./pages/ParentPortal','ParentResults');
const ParentAttendance = lazyNamedPage('./pages/ParentPortal','ParentAttendance');
const ParentTimetable = lazyNamedPage('./pages/ParentPortal','ParentTimetable');
const ParentAnnouncements = lazyNamedPage('./pages/ParentPortal','ParentAnnouncements');
const ParentAssignments = lazyNamedPage('./pages/ParentPortal','ParentAssignments');
const ParentCommunication = lazyNamedPage('./pages/ParentPortal','ParentCommunication');
const ParentNotifications = lazyNamedPage('./pages/ParentPortal','ParentNotifications');
const ParentProfile = lazyNamedPage('./pages/ParentPortal','ParentProfile');
const ParentManagement = lazyPage('./pages/ParentManagement');
const CurriculumSelectionsAdmin = lazyPage('./pages/CurriculumSelectionsAdmin');
const StudentPortalLayout = lazyNamedPage('./pages/StudentPortal','StudentPortalLayout');
const StudentDashboard = lazyNamedPage('./pages/StudentPortal','StudentDashboard');
const StudentProfile = lazyNamedPage('./pages/StudentPortal','StudentProfile');
const StudentSubjects = lazyNamedPage('./pages/StudentPortal','StudentSubjects');
const StudentTimetable = lazyNamedPage('./pages/StudentPortal','StudentTimetable');
const StudentResults = lazyNamedPage('./pages/StudentPortal','StudentResults');
const StudentAttendance = lazyNamedPage('./pages/StudentPortal','StudentAttendance');
const StudentAnnouncements = lazyNamedPage('./pages/StudentPortal','StudentAnnouncements');
const StudentNotifications = lazyNamedPage('./pages/StudentPortal','StudentNotifications');
const StudentUnavailableModule = lazyNamedPage('./pages/StudentPortal','StudentUnavailableModule');
const StudentAccountSettings = lazyNamedPage('./pages/StudentPortal','StudentAccountSettings');

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
  if (user?.role === 'parent') return <Navigate to="/parent" replace />;
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
  if (user?.role === 'student' && user?.must_change_password) return <Navigate to="/change-password" replace />;
  return user?.role === 'student' ? children : <Navigate to="/" replace />;
};

const ParentRoute = ({ children }) => {
  let user;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  return user?.role === 'parent' ? children : <Navigate to="/" replace />;
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
  if (role === 'parent') return <Navigate to="/parent" replace />;
  if (role === 'accountant') return <FinanceDashboard />;
  if (role === 'feeding_tuckshop_officer') return <Feeding />;
  if (role === 'teacher') return <TeacherDashboard />;
  if (role === 'inventory' || role === 'store' || role === 'storekeeper') return <Inventory />;
  if (role === 'librarian') return <Library />;
  return <Dashboard />;
};

function App() {
  return (
    <Suspense fallback={<div className="page module-page"><div className="module-shell"><p className="data-panel" role="status">Loading page…</p></div></div>}>
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
        <Route path="assignments" element={<StudentAssignments />} />
        <Route path="materials" element={<StudentMaterials />} />
        <Route path="results" element={<StudentResults />} />
        <Route path="attendance" element={<StudentAttendance />} />
        <Route path="announcements" element={<StudentAnnouncements />} />
        <Route path="notifications" element={<StudentNotifications />} />
        <Route path="account" element={<StudentAccountSettings />} />
      </Route>
      <Route path="/parent" element={<ProtectedRoute><ParentRoute><ParentPortalLayout /></ParentRoute></ProtectedRoute>}>
        <Route index element={<ParentDashboard />} />
        <Route path="curriculum" element={<ParentCurriculumSelection />} />
        <Route path="fees" element={<ParentFees />} />
        <Route path="feeding" element={<ParentFeeding />} />
        <Route path="results" element={<ParentResults />} />
        <Route path="attendance" element={<ParentAttendance />} />
        <Route path="timetable" element={<ParentTimetable />} />
        <Route path="announcements" element={<ParentAnnouncements />} />
        <Route path="assignments" element={<ParentAssignments />} />
        <Route path="contact" element={<ParentCommunication />} />
        <Route path="notifications" element={<ParentNotifications />} />
        <Route path="profile" element={<ParentProfile />} />
      </Route>
      <Route path="/" element={<ProtectedRoute><StaffRoute><Layout /></StaffRoute></ProtectedRoute>}>
        <Route index element={<RoleBasedDashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="classes" element={<Classes />} />
        <Route path="subjects" element={<Subjects />} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="assignments" element={<AllowedRoles roles={['admin', 'teacher']}><Assignments /></AllowedRoles>} />
        <Route path="learning-materials" element={<AllowedRoles roles={['admin', 'teacher']}><LearningMaterials /></AllowedRoles>} />
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
        <Route path="parents" element={<AllowedRoles roles={['admin']}><ParentManagement /></AllowedRoles>} />
        <Route path="curriculum-selections" element={<AllowedRoles roles={['admin']}><CurriculumSelectionsAdmin /></AllowedRoles>} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

export default App;
