import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import LoginPage from './components/auth/LoginPage';
import AppShell from './components/shell/AppShell';
import DashboardPage from './components/dashboard/DashboardPage';
import DatasetPage from './components/dataset/DatasetPage';
import UsersPage from './components/users/UsersPage';

function RequireAuth() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="h-screen bg-canvas" />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/datasets/:id" element={<DatasetPage />} />
            <Route path="/users" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
