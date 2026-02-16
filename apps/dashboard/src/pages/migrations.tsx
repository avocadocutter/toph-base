import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, Play, Trash2, Eye } from 'lucide-react';
import { DataTable } from '../components/data-table/data-table';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { api, projectAdminPath } from '../lib/api-client';
import { useProjectStore } from '../stores/project-store';
import { toast } from 'sonner';
import type { Migration, MigrationListResponse, ApplyMigrationsResponse } from '../types';

export function MigrationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [selectedMigrations, setSelectedMigrations] = useState<Set<string>>(new Set());

  // Fetch migrations
  const { data, isLoading } = useQuery({
    queryKey: ['admin-migrations', currentProject?.ref],
    queryFn: () => api.get<MigrationListResponse>(projectAdminPath('/migrations')),
    enabled: !!currentProject,
  });

  // Apply selected mutations
  const applyMutation = useMutation({
    mutationFn: (names: string[]) =>
      api.post<ApplyMigrationsResponse>(projectAdminPath('/migrations/apply'), { names }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-migrations'] });
      queryClient.invalidateQueries({ queryKey: ['admin-tables'] });

      if (result.applied.length > 0) {
        toast.success(`Applied ${result.applied.length} migration(s)`);
      }

      if (result.failed.length > 0) {
        result.failed.forEach(f => {
          toast.error(`${f.name}: ${f.error}`);
        });
      }

      setSelectedMigrations(new Set());
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete migration
  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.delete(projectAdminPath(`/migrations/${name}`)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-migrations'] });
      toast.success('Migration deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const toggleMigration = (name: string) => {
    const newSet = new Set(selectedMigrations);
    if (newSet.has(name)) {
      newSet.delete(name);
    } else {
      newSet.add(name);
    }
    setSelectedMigrations(newSet);
  };

  const toggleAll = () => {
    if (!data?.data) return;
    const pendingMigrations = data.data.filter(m => m.status === 'pending');
    if (selectedMigrations.size === pendingMigrations.length) {
      setSelectedMigrations(new Set());
    } else {
      setSelectedMigrations(new Set(pendingMigrations.map(m => m.name)));
    }
  };

  const columns: ColumnDef<Migration>[] = [
    {
      id: 'select',
      header: () => (
        <Checkbox
          checked={selectedMigrations.size > 0}
          onCheckedChange={toggleAll}
          disabled={!data?.data.some(m => m.status === 'pending')}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selectedMigrations.has(row.original.name)}
          onCheckedChange={() => toggleMigration(row.original.name)}
          disabled={row.original.status !== 'pending'}
        />
      ),
    },
    {
      accessorKey: 'name',
      header: 'Migration',
      cell: ({ row }) => (
        <div className="font-mono text-sm font-medium">{row.original.name}</div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.status === 'applied'
              ? 'default'
              : row.original.status === 'failed'
              ? 'destructive'
              : 'secondary'
          }
        >
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: 'appliedAt',
      header: 'Applied At',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.appliedAt ? new Date(row.original.appliedAt).toLocaleString() : '-'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.status === 'pending' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteMutation.mutate(row.original.name)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Migrations</h1>
          <p className="text-sm text-muted-foreground">
            Manage database migrations for {currentProject?.name}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => applyMutation.mutate(Array.from(selectedMigrations))}
            disabled={selectedMigrations.size === 0 || applyMutation.isPending}
          >
            <Play size={14} />
            Apply Selected ({selectedMigrations.size})
          </Button>
          <Button onClick={() => navigate('/migrations/new')}>
            <Plus size={14} />
            New Migration
          </Button>
        </div>
      </div>

      {data && data.pendingCount > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm">
          <strong>{data.pendingCount}</strong> pending migration(s) waiting to be applied
        </div>
      )}

      <DataTable columns={columns} data={data?.data || []} loading={isLoading} />
    </div>
  );
}
