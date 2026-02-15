import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { TableSummary } from '@/types';
import { DataTable } from '@/components/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ColumnDef } from '@tanstack/react-table';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Database } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

const columns: ColumnDef<TableSummary, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <div className="flex items-center gap-2 font-medium">
        <Database size={14} className="text-muted-foreground" />
        {row.original.name}
      </div>
    ),
  },
  { accessorKey: 'schema', header: 'Schema' },
  { accessorKey: 'type', header: 'Type' },
  { accessorKey: 'columnCount', header: 'Columns' },
  {
    accessorKey: 'rlsEnabled',
    header: 'RLS',
    cell: ({ row }) => (
      <Badge variant={row.original.rlsEnabled ? 'success' : 'secondary'}>
        {row.original.rlsEnabled ? 'Enabled' : 'Disabled'}
      </Badge>
    ),
  },
  {
    accessorKey: 'primaryKey',
    header: 'Primary Key',
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.primaryKey.join(', ') || '-'}</span>
    ),
  },
];

export function TablesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newTableName, setNewTableName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tables'],
    queryFn: () => api.get<TableSummary[]>('/admin/tables'),
  });

  const createTable = useMutation({
    mutationFn: (name: string) =>
      api.post('/admin/tables', {
        name,
        schema: 'public',
        columns: [
          { name: 'id', type: 'uuid DEFAULT gen_random_uuid()', primaryKey: true, nullable: false },
          { name: 'created_at', type: 'timestamptz DEFAULT now()', nullable: false },
        ],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tables'] });
      setShowCreate(false);
      setNewTableName('');
      toast.success('Table created');
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Tables</h1>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus size={14} />
          New Table
        </Button>
      </div>

      {showCreate && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4">
          <Input
            placeholder="table_name"
            value={newTableName}
            onChange={(e) => setNewTableName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newTableName && createTable.mutate(newTableName)}
            className="max-w-xs"
            autoFocus
          />
          <Button
            size="sm"
            onClick={() => newTableName && createTable.mutate(newTableName)}
            disabled={!newTableName || createTable.isPending}
          >
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
            Cancel
          </Button>
        </div>
      )}

      <div
        onClick={(e) => {
          const row = (e.target as HTMLElement).closest('tr');
          if (!row) return;
          const idx = row.rowIndex - 1; // header row is 0
          if (idx >= 0 && data?.[idx]) {
            navigate(`/tables/${data[idx].schema}/${data[idx].name}`);
          }
        }}
        className="cursor-pointer"
      >
        <DataTable data={data ?? []} columns={columns} loading={isLoading} />
      </div>
    </div>
  );
}
