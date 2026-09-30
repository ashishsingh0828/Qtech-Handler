import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import LoginPage from './components/auth/LoginPage';
import AppShell from './components/shell/AppShell';
import HomePage from './components/workspaces/HomePage';
import RecordsPage from './components/records/RecordsPage';
import DatasetsPage from './components/admin/DatasetsPage';
import TeamPage from './components/admin/TeamPage';
import SchemaPage from './components/admin/SchemaPage';
import ActivityPage from './components/admin/ActivityPage';
import { hasPermission } from '@shared/permissions.ts';

function Gate({ children }: { children: JSX.Element }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="grid h-screen place-items-center text-muted">Loading</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Permit({ permission, children }: { permission: 'manageUsers' | 'alterSchema'; children: JSX.Element }) {
  const { user } = useAuth();
  if (!user || !hasPermission(user.role, permission)) return <Navigate to="/" replace />;
  return children;
}

function Staff({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (!user || (user.role !== 'ADMIN' && user.role !== 'MANAGER')) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Gate><AppShell /></Gate>}>
            <Route index element={<HomePage />} />
            <Route path="records" element={<RecordsPage />} />
            <Route path="datasets" element={<DatasetsPage />} />
            <Route path="team" element={<Permit permission="manageUsers"><TeamPage /></Permit>} />
            <Route path="schema" element={<Permit permission="alterSchema"><SchemaPage /></Permit>} />
            <Route path="activity" element={<Staff><ActivityPage /></Staff>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
