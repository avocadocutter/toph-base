import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, projectAdminPath } from '@/lib/api-client';
import { useProjectStore } from '@/stores/project-store';
import type { TableSummary, RlsPolicy } from '@/types';
import { DataTable } from '@/components/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';

export function PoliciesPage() {
  const queryClient = useQueryClient();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [newPolicy, setNewPolicy] = useState({
    name: '',
    command: 'SELECT' as const,
    using: '',
    withCheck: '',
  });

  const tables = useQuery({
    queryKey: ['admin-tables', currentProject?.ref],
    queryFn: () => api.get<TableSummary[]>(projectAdminPath('/tables')),
    enabled: !!currentProject,
  });

  const policies = useQuery({
    queryKey: ['policies', currentProject?.ref, selectedTable],
    queryFn: () => api.get<RlsPolicy[]>(projectAdminPath(`/rls/${selectedTable}/policies`)),
    enabled: !!selectedTable && !!currentProject,
  });

  const createPolicy = useMutation({
    mutationFn: () =>
      api.post(projectAdminPath(`/rls/${selectedTable}/policies`), {
        name: newPolicy.name,
        command: newPolicy.command,
        using: newPolicy.using || undefined,
        withCheck: newPolicy.withCheck || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      setShowCreate(false);
      setNewPolicy({ name: '', command: 'SELECT', using: '', withCheck: '' });
      toast.success('Policy created');
    },
    onError: (err) => toast.error(err.message),
  });

  const deletePolicy = useMutation({
    mutationFn: (name: string) =>
      api.delete(projectAdminPath(`/rls/${selectedTable}/policies/${name}`)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      toast.success('Policy deleted');
    },
    onError: (err) => toast.error(err.message),
  });

  const columns: ColumnDef<RlsPolicy, unknown>[] = [
    { accessorKey: 'name', header: 'Policy Name' },
    { accessorKey: 'command', header: 'Command' },
    {
      accessorKey: 'permissive',
      header: 'Type',
      cell: ({ row }) => (
        <Badge variant={row.original.permissive ? 'default' : 'destructive'}>
          {row.original.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}
        </Badge>
      ),
    },
    {
      accessorKey: 'roles',
      header: 'Roles',
      cell: ({ row }) => row.original.roles.join(', '),
    },
    {
      accessorKey: 'using',
      header: 'USING Expression',
      cell: ({ getValue }) => <code className="text-xs">{(getValue() as string) ?? '-'}</code>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => deletePolicy.mutate(row.original.name)}
        >
          <Trash2 size={14} className="text-destructive" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">RLS Policies</h1>
        {selectedTable && (
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus size={14} />
            New Policy
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">Table:</label>
        <select
          value={selectedTable}
          onChange={(e) => setSelectedTable(e.target.value)}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 text-sm"
        >
          <option value="">Select a table...</option>
          {tables.data?.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
              {t.rlsEnabled ? ' (RLS)' : ''}
            </option>
          ))}
        </select>
      </div>

      {showCreate && selectedTable && (
        <div className="space-y-3 rounded-md border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Create Policy</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                value={newPolicy.name}
                onChange={(e) => setNewPolicy({ ...newPolicy, name: e.target.value })}
                placeholder="policy_name"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Command</label>
              <select
                value={newPolicy.command}
                onChange={(e) => setNewPolicy({ ...newPolicy, command: e.target.value as 'SELECT' })}
                className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm"
              >
                <option value="SELECT">SELECT</option>
                <option value="INSERT">INSERT</option>
                <option value="UPDATE">UPDATE</option>
                <option value="DELETE">DELETE</option>
                <option value="ALL">ALL</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">USING Expression</label>
              <Input
                value={newPolicy.using}
                onChange={(e) => setNewPolicy({ ...newPolicy, using: e.target.value })}
                placeholder="auth_uid() = user_id"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">WITH CHECK Expression</label>
              <Input
                value={newPolicy.withCheck}
                onChange={(e) => setNewPolicy({ ...newPolicy, withCheck: e.target.value })}
                placeholder="auth_uid() = user_id"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => createPolicy.mutate()} disabled={!newPolicy.name}>
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {selectedTable && (
        <DataTable data={policies.data ?? []} columns={columns} loading={policies.isLoading} />
      )}
    </div>
  );
}
