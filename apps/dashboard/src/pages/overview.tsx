import { useQuery } from '@tanstack/react-query';
import { api, projectAdminPath } from '@/lib/api-client';
import { useProjectStore } from '@/stores/project-store';
import type { TableSummary, PaginatedResponse, UserRecord } from '@/types';
import { Database, Users, Shield, Activity, Copy, Check } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useState } from 'react';

export function OverviewPage() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const tables = useQuery({
    queryKey: ['admin-tables', currentProject?.ref],
    queryFn: () => api.get<TableSummary[]>(projectAdminPath('/tables')),
    enabled: !!currentProject,
  });

  const users = useQuery({
    queryKey: ['admin-users', currentProject?.ref],
    queryFn: () => api.get<PaginatedResponse<UserRecord>>(projectAdminPath('/users?limit=1')),
    enabled: !!currentProject,
  });

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ status: string; database: { connected: boolean; version: string } }>('/health'),
  });

  if (!currentProject) return <Navigate to="/projects" replace />;

  const stats = [
    {
      icon: Database,
      label: 'Tables',
      value: tables.data?.length ?? '-',
    },
    {
      icon: Users,
      label: 'Users',
      value: users.data?.count ?? '-',
    },
    {
      icon: Shield,
      label: 'RLS Enabled',
      value: tables.data?.filter((t) => t.rlsEnabled).length ?? '-',
    },
    {
      icon: Activity,
      label: 'Database',
      value: health.data?.status === 'healthy' ? 'Connected' : 'Disconnected',
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-center gap-4 rounded-lg border border-border bg-card p-4"
          >
            <div className="rounded-md bg-muted p-2">
              <stat.icon size={20} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-xl font-bold">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Project Info */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Project Information</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Project Reference</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-1.5 text-xs font-mono">
                {currentProject.ref}
              </code>
              <button
                onClick={() => copyToClipboard(currentProject.ref, 'ref')}
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Copy project ref"
              >
                {copiedField === 'ref' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Database Name</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-1.5 text-xs font-mono">
                {currentProject.dbName}
              </code>
              <button
                onClick={() => copyToClipboard(currentProject.dbName, 'dbName')}
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Copy database name"
              >
                {copiedField === 'dbName' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {health.data?.database?.version && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-1 text-xs text-muted-foreground">PostgreSQL Version</p>
          <p className="text-xs">{health.data.database.version}</p>
        </div>
      )}

      {tables.data && tables.data.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Tables</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tables.data.map((table) => (
              <a
                key={table.name}
                href={`/tables/${table.name}`}
                className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-2">
                  <Database size={14} className="text-muted-foreground" />
                  <span>{table.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">{table.columnCount} cols</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
