import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import Login from './pages/Login';
import { ForgotPassword, ResetPassword } from './pages/Recover';
import { useAuth } from './store/auth';

// Pages load on demand so the chart library only downloads when a chart page is opened.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Machines = lazy(() => import('./pages/Machines'));
const Workers = lazy(() => import('./pages/Workers'));
const Production = lazy(() => import('./pages/Production'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Analyst = lazy(() => import('./pages/Analyst'));
const Maintenance = lazy(() => import('./pages/Maintenance'));
const Handover = lazy(() => import('./pages/Handover'));
const Purchasing = lazy(() => import('./pages/Purchasing'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Users = lazy(() => import('./pages/Users'));

const Loading = () => <div className="grid h-64 place-items-center text-sm text-muted" role="status">Loading…</div>;

function Protected() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="grid h-full place-items-center text-sm text-muted">Loading…</div>;
  return user ? <AppShell /> : <Navigate to="/login" replace />;
}

function StaffOnly({ children }: { children: ReactNode }) {
  const role = useAuth((s) => s.user?.role);
  return role === 'worker' ? <Navigate to="/workers" replace /> : <>{children}</>;
}

export default function App() {
  const refresh = useAuth((s) => s.refresh);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<Protected />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/machines" element={<Machines />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/production" element={<Production />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/maintenance" element={<Maintenance />} />
            <Route path="/handover" element={<Handover />} />
            <Route path="/purchasing" element={<StaffOnly><Purchasing /></StaffOnly>} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/analytics" element={<StaffOnly><Analytics /></StaffOnly>} />
            <Route path="/analyst" element={<StaffOnly><Analyst /></StaffOnly>} />
            <Route path="/users" element={<StaffOnly><Users /></StaffOnly>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
