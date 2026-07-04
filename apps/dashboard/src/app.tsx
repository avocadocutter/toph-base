import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useEffect, useState } from 'react';
import { useResolvedTheme } from './stores/ui-store';
import { DashboardLayout } from './components/layout/dashboard-layout';
import { SetupPage } from './pages/setup';
import { TablesPage } from './pages/tables';
import { TableDetailPage } from './pages/table-detail';
import { SqlEditorPage } from './pages/sql-editor';
import { MigrationsPage } from './pages/migrations';
import { MigrationNewPage } from './pages/migration-new';
import { UsersPage } from './pages/users';
import { PoliciesPage } from './pages/policies';
import { SettingsPage } from './pages/settings';
import { DocsPage } from './pages/docs';
import { OverviewPage } from './pages/overview';
import { StoragePage } from './pages/storage';
import { StorageBucketPage } from './pages/storage-bucket';
import { FunctionsPage } from './pages/functions';
import { JobsPage } from './pages/jobs';
import { LoginPage } from './pages/login';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

interface TophbaseStatus {
  configured: boolean;
  dialect: string | null;
  version: string;
  url: string;
  publishableKey: string;
}

function AppGate({ children, requireConfigured = true }: { children: React.ReactNode; requireConfigured?: boolean }) {
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/tophbase/status')
      .then(async (r) => {
        if (r.status === 401) {
          navigate('/login', { replace: true });
          return;
        }
        const status = await r.json() as TophbaseStatus;
        if (requireConfigured && !status.configured) {
          navigate('/setup', { replace: true });
        }
      })
      .catch(() => {
        // Server not ready yet — stay put
      })
      .finally(() => setChecked(true));
  }, [navigate, requireConfigured]);

  if (!checked) return null;
  return <>{children}</>;
}

export function App() {
  const resolvedTheme = useResolvedTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/setup"
            element={
              <AppGate requireConfigured={false}>
                <SetupPage />
              </AppGate>
            }
          />
          <Route
            path="/"
            element={
              <AppGate>
                <DashboardLayout />
              </AppGate>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="tables" element={<TablesPage />} />
            <Route path="tables/:table" element={<TableDetailPage />} />
            <Route path="sql" element={<SqlEditorPage />} />
            <Route path="migrations" element={<MigrationsPage />} />
            <Route path="migrations/new" element={<MigrationNewPage />} />
            <Route path="storage" element={<StoragePage />} />
            <Route path="storage/:bucket" element={<StorageBucketPage />} />
            <Route path="functions" element={<FunctionsPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="docs" element={<DocsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster theme={resolvedTheme} position="bottom-right" richColors />
    </QueryClientProvider>
  );
}
