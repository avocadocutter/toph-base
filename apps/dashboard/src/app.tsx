import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useResolvedTheme } from './stores/ui-store';
import { DashboardLayout } from './components/layout/dashboard-layout';
import { LoginPage } from './pages/login';
import { ProjectsPage } from './pages/projects';
import { TablesPage } from './pages/tables';
import { TableDetailPage } from './pages/table-detail';
import { SqlEditorPage } from './pages/sql-editor';
import { UsersPage } from './pages/users';
import { PoliciesPage } from './pages/policies';
import { SettingsPage } from './pages/settings';
import { DocsPage } from './pages/docs';
import { OverviewPage } from './pages/overview';
import { useAuthStore } from './stores/auth-store';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  if (!token) return <Navigate to="/login" replace />;
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
            path="/projects"
            element={
              <ProtectedRoute>
                <ProjectsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="tables" element={<TablesPage />} />
            <Route path="tables/:table" element={<TableDetailPage />} />
            <Route path="sql" element={<SqlEditorPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="docs" element={<DocsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster theme={resolvedTheme} position="bottom-right" richColors />
    </QueryClientProvider>
  );
}
