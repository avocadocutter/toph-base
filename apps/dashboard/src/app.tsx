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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

interface VibebaseStatus {
  configured: boolean;
  dialect: string | null;
  version: string;
  url: string;
  publishableKey: string;
}

function AppGate({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/vibebase/status')
      .then(r => r.json() as Promise<VibebaseStatus>)
      .then((status) => {
        if (!status.configured) {
          navigate('/setup', { replace: true });
        }
      })
      .catch(() => {
        // Server not ready yet — stay put
      })
      .finally(() => setChecked(true));
  }, [navigate]);

  if (!checked) return null;
  return <>{children}</>;
}

export function App() {
  const resolvedTheme = useResolvedTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
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
