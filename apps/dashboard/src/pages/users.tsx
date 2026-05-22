import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, projectAdminPath } from '@/lib/api-client';
import type { UserRecord, PaginatedResponse } from '@/types';
import { DataTable } from '@/components/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { type ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils';
import { Search, UserX, UserCheck, UserPlus, KeyRound, RefreshCw } from 'lucide-react';
import { RecordSidebar } from '@/components/ui/record-sidebar';

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordEmail, setResetPasswordEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () =>
      api.get<PaginatedResponse<UserRecord>>(
        projectAdminPath(`/users?limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`),
      ),
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

  const createUser = useMutation({
    mutationFn: (data: { email: string; password: string; emailConfirmed: boolean }) =>
      api.post(projectAdminPath('/users'), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User created successfully');
      setCreateDialogOpen(false);
      setNewUserEmail('');
      setNewUserPassword('');
      setEmailConfirmed(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.patch(projectAdminPath(`/users/${id}`), { password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Password reset successfully');
      setResetPasswordDialogOpen(false);
      setResetPasswordUserId(null);
      setResetPasswordEmail('');
      setNewPassword('');
    },
    onError: (err) => toast.error(err.message),
  });

  const columns: ColumnDef<UserRecord, unknown>[] = [
    {
      accessorKey: 'id',
      header: 'ID',
      cell: ({ row }) => (
        <span
          className="font-mono text-xs text-muted-foreground"
          title={row.original.id}
        >
          {row.original.id.slice(0, 8)}…
        </span>
      ),
    },
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
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            title="Reset password"
            onClick={() => {
              setResetPasswordUserId(row.original.id);
              setResetPasswordEmail(row.original.email);
              setResetPasswordDialogOpen(true);
            }}
          >
            <KeyRound size={14} />
          </Button>
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
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Users</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{data?.count ?? 0} total</span>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw size={14} className={isRefetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus size={14} className="mr-1.5" />
                Create User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
                <DialogDescription>
                  Add a new user to your project. They will be able to sign in with the credentials you provide.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@example.com"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Min 8 characters"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="emailConfirmed"
                    checked={emailConfirmed}
                    onCheckedChange={(checked) => setEmailConfirmed(checked === true)}
                  />
                  <Label
                    htmlFor="emailConfirmed"
                    className="text-sm font-normal cursor-pointer"
                  >
                    Email confirmed
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (!newUserEmail || !newUserPassword) {
                      toast.error('Email and password are required');
                      return;
                    }
                    if (newUserPassword.length < 8) {
                      toast.error('Password must be at least 8 characters');
                      return;
                    }
                    createUser.mutate({
                      email: newUserEmail,
                      password: newUserPassword,
                      emailConfirmed,
                    });
                  }}
                  disabled={createUser.isPending}
                >
                  {createUser.isPending ? 'Creating...' : 'Create User'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
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

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        loading={isLoading}
        onRowClick={(row) => setSelectedUser(row)}
      />
      <RecordSidebar
        title="User details"
        record={selectedUser as Record<string, unknown> | null}
        onClose={() => setSelectedUser(null)}
      />

      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {resetPasswordEmail}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="Min 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResetPasswordDialogOpen(false);
                setResetPasswordUserId(null);
                setResetPasswordEmail('');
                setNewPassword('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!newPassword) {
                  toast.error('Password is required');
                  return;
                }
                if (newPassword.length < 8) {
                  toast.error('Password must be at least 8 characters');
                  return;
                }
                if (!resetPasswordUserId) return;
                resetPassword.mutate({
                  id: resetPasswordUserId,
                  password: newPassword,
                });
              }}
              disabled={resetPassword.isPending}
            >
              {resetPassword.isPending ? 'Resetting...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
