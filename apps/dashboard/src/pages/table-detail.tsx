import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, projectAdminPath } from '@/lib/api-client';
import { useProjectStore } from '@/stores/project-store';
import type { TableDetail, PaginatedResponse, RlsPolicy } from '@/types';
import { DataTable } from '@/components/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import { toast } from 'sonner';
import { Shield, Table, Rows3, Key } from 'lucide-react';

type Tab = 'data' | 'structure' | 'rls';

export function TableDetailPage() {
  const { table = '' } = useParams();
  const [activeTab, setActiveTab] = useState<Tab>('data');
  const queryClient = useQueryClient();
  const currentProject = useProjectStore((s) => s.currentProject);

  const tableInfo = useQuery({
    queryKey: ['admin-table', currentProject?.ref, table],
    queryFn: () => api.get<TableDetail>(projectAdminPath(`/tables/${table}`)),
    enabled: !!currentProject,
  });

  const tableData = useQuery({
    queryKey: ['table-data', currentProject?.ref, table],
    queryFn: () => api.get<PaginatedResponse<Record<string, unknown>>>(projectAdminPath(`/tables/${table}/rows?limit=50`)),
    enabled: activeTab === 'data' && !!currentProject,
  });

  const policies = useQuery({
    queryKey: ['policies', currentProject?.ref, table],
    queryFn: () => api.get<RlsPolicy[]>(projectAdminPath(`/rls/${table}/policies`)),
    enabled: activeTab === 'rls' && !!currentProject,
  });

  const toggleRls = useMutation({
    mutationFn: (enable: boolean) =>
      api.post(projectAdminPath(`/rls/${table}/${enable ? 'enable' : 'disable'}`)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-table', currentProject?.ref, table] });
      toast.success('RLS updated');
    },
    onError: (err) => toast.error(err.message),
  });

  const info = tableInfo.data;

  // Build dynamic columns from table metadata
  const dataColumns: ColumnDef<Record<string, unknown>, unknown>[] =
    info?.columns.map((col) => ({
      accessorKey: col.name,
      header: col.name,
      cell: ({ getValue }) => {
        const val = getValue();
        if (val === null) return <span className="text-muted-foreground italic">null</span>;
        if (typeof val === 'object') return <span className="text-muted-foreground">{JSON.stringify(val)}</span>;
        return String(val);
      },
    })) ?? [];

  const structureColumns: ColumnDef<TableDetail['columns'][number], unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Column',
      cell: ({ row }) => (
        <div className="flex items-center gap-2 font-medium">
          {row.original.isPrimaryKey && <Key size={12} className="text-yellow-500" />}
          {row.original.name}
        </div>
      ),
    },
    { accessorKey: 'dataType', header: 'Type' },
    {
      accessorKey: 'isNullable',
      header: 'Nullable',
      cell: ({ row }) => <Badge variant={row.original.isNullable ? 'secondary' : 'outline'}>{row.original.isNullable ? 'YES' : 'NO'}</Badge>,
    },
    { accessorKey: 'columnDefault', header: 'Default', cell: ({ getValue }) => getValue() ?? <span className="text-muted-foreground">-</span> },
  ];

  const policyColumns: ColumnDef<RlsPolicy, unknown>[] = [
    { accessorKey: 'name', header: 'Policy Name' },
    { accessorKey: 'command', header: 'Command' },
    {
      accessorKey: 'permissive',
      header: 'Type',
      cell: ({ row }) => <Badge variant={row.original.permissive ? 'default' : 'destructive'}>{row.original.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}</Badge>,
    },
    { accessorKey: 'roles', header: 'Roles', cell: ({ row }) => row.original.roles.join(', ') },
    { accessorKey: 'using', header: 'USING', cell: ({ getValue }) => <code className="text-xs">{(getValue() as string) ?? '-'}</code> },
    { accessorKey: 'withCheck', header: 'WITH CHECK', cell: ({ getValue }) => <code className="text-xs">{(getValue() as string) ?? '-'}</code> },
  ];

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'data', label: 'Data', icon: <Rows3 size={14} /> },
    { key: 'structure', label: 'Structure', icon: <Table size={14} /> },
    { key: 'rls', label: 'RLS Policies', icon: <Shield size={14} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{table}</h1>
          <p className="text-xs text-muted-foreground">
            {info?.rowCount ?? 0} rows / {info?.columns.length ?? 0} columns
          </p>
        </div>
        {activeTab === 'rls' && info && (
          <Button
            size="sm"
            variant={info.rlsEnabled ? 'destructive' : 'default'}
            onClick={() => toggleRls.mutate(!info.rlsEnabled)}
          >
            <Shield size={14} />
            {info.rlsEnabled ? 'Disable RLS' : 'Enable RLS'}
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'data' && (
        <DataTable
          data={tableData.data?.data ?? []}
          columns={dataColumns}
          loading={tableData.isLoading}
        />
      )}

      {activeTab === 'structure' && (
        <DataTable
          data={info?.columns ?? []}
          columns={structureColumns}
          loading={tableInfo.isLoading}
        />
      )}

      {activeTab === 'rls' && (
        <div className="space-y-4">
          {info && (
            <Badge variant={info.rlsEnabled ? 'success' : 'secondary'}>
              RLS {info.rlsEnabled ? 'Enabled' : 'Disabled'}
              {info.rlsForced && ' (Forced)'}
            </Badge>
          )}
          <DataTable
            data={policies.data ?? []}
            columns={policyColumns}
            loading={policies.isLoading}
          />
        </div>
      )}
    </div>
  );
}
