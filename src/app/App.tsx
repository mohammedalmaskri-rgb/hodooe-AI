import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { HomePage } from './HomePage';
import { AdminGate } from '../pages/admin/AdminGate';
import { AdminLayout } from '../pages/admin/AdminLayout';
import { Dashboard } from '../pages/admin/Dashboard';
import { Students } from '../pages/admin/Students';
import { StudentForm } from '../pages/admin/StudentForm';
import { Classes } from '../pages/admin/Classes';
import { SystemSettings } from '../pages/admin/SystemSettings';
import { LiveScan } from '../pages/teacher/LiveScan';

// HashRouter: GitHub Pages serves static files only, so client routes live after "#".
export function App() {
  return (
    <HashRouter>
      <AppHeader />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/admin"
          element={
            <AdminGate>
              <AdminLayout />
            </AdminGate>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="students" element={<Students />} />
          <Route path="students/new" element={<StudentForm />} />
          <Route path="students/:id" element={<StudentForm />} />
          <Route path="classes" element={<Classes />} />
          <Route path="settings" element={<SystemSettings />} />
        </Route>
        <Route path="/teacher" element={<LiveScan />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
