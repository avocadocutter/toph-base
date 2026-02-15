import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, projectAdminPath } from '@/lib/api-client';
import { useProjectStore } from '@/stores/project-store';
import type { UserRecord, PaginatedResponse } from '@/types';
import { DataTable } from '@/components/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils';
import { Search, UserX, UserCheck } from 'lucide-react';

export function UsersPage() {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const currentProject = useProjectStore((s) => s.currentProject);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', currentProject?.ref, search],
    queryFn: () =>
      api.get<PaginatedResponse<UserRecord>>(
        projectAdminPath(`/users?limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`),
      ),
    enabled: !!currentProject,
  });

  const toggleDisable = useMutation({
    mutationFn: ({ id, isDisabled }: { id: string; isDisabled: boolean }) =>
      api.patch(projectAdminPath(`/users/${id}`), { isDisabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User updated');
    },
    onError: (err) => toast.error(err.message),
  });

  const columns: ColumnDef<UserRecord, unknown>[] = [
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => <span className="font-medium">{row.original.email}</span>,
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => (
        <Badge variant="secondary">
          {row.original.role}
        </Badge>
      ),
    },
    {
      accessorKey: 'isDisabled',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.isDisabled ? 'destructive' : 'success'}>
          {row.original.isDisabled ? 'Disabled' : 'Active'}
        </Badge>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => <span className="text-muted-foreground">{formatDate(row.original.createdAt)}</span>,
    },
    {
      accessorKey: 'lastSignInAt',
      header: 'Last Sign In',
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatDate(row.original.lastSignInAt)}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          title={row.original.isDisabled ? 'Enable user' : 'Disable user'}
          onClick={() =>
            toggleDisable.mutate({
              id: row.original.id,
              isDisabled: !row.original.isDisabled,
            })
          }
        >
          {row.original.isDisabled ? <UserCheck size={14} /> : <UserX size={14} />}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Users</h1>
        <span className="text-sm text-muted-foreground">{data?.count ?? 0} total</span>
      </div>

      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <DataTable data={data?.data ?? []} columns={columns} loading={isLoading} />
    </div>
  );
}
