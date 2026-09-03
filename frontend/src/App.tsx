import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import { PrefsProvider } from './lib/prefs';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Terminal } from './pages/Terminal';

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
      <Route path="/terminal" element={<Protected><Terminal /></Protected>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <I18nProvider>
      {/* basename aus dem Build-Basispfad: nur so stimmen die Routen auch,
          wenn die Oberfläche unter einem Unterpfad ausgeliefert wird. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <PrefsProvider>
            <AppRoutes />
          </PrefsProvider>
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  );
}
