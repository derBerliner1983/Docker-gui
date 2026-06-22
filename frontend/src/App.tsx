import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Containers } from './pages/Containers';
import { TaskManager } from './pages/TaskManager';
import { Automation } from './pages/Automation';
import { VMs } from './pages/VMs';
import { Placeholder } from './pages/Placeholder';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/taskmanager" element={<Protected><TaskManager /></Protected>} />
      <Route path="/containers" element={<Protected><Containers /></Protected>} />
      <Route path="/vms" element={<Protected><VMs /></Protected>} />
      <Route path="/automation" element={<Protected><Automation /></Protected>} />
      <Route path="/shares" element={<Protected><Placeholder title="SMB-Freigaben" icon="📁" /></Protected>} />
      <Route path="/backups" element={<Protected><Placeholder title="Backups" icon="💾" /></Protected>} />
      <Route path="/users" element={<Protected><Placeholder title="Benutzerverwaltung" icon="👥" /></Protected>} />
      <Route path="/settings" element={<Protected><Placeholder title="Einstellungen" icon="🔧" /></Protected>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
