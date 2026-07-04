import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { RefreshCw, RotateCcw, ListChecks, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { DataTable } from '@/components/data-table/data-table';
import { RecordSidebar } from '@/components/ui/record-sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface Job {
  id: string;
  function_name: string;
  runtime: 'edge' | 'node';
  payload: unknown;
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
  error: string | null;
  result: unknown;
  created_at: string;
  updated_at: string;
}

interface JobsResponse {
  jobs: Job[];
}

interface FunctionsResponse {
  functions: { name: string }[];
}

const STATUS_FILTERS = ['all', 'pending', 'processing', 'done', 'failed'] as const;

const STATUS_VARIANT: Record<Job['status'], 'secondary' | 'default' | 'success' | 'destructive'> = {
  pending: 'secondary',
  processing: 'default',
  done: 'success',
  failed: 'destructive',
};

function CreateJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [runtime, setRuntime] = useState<'edge' | 'node'>('edge');
  const [functionName, setFunctionName] = useState('');
  const [payloadText, setPayloadText] = useState('{}');
  const queryClient = useQueryClient();

  const functionsQuery = useQuery({
    queryKey: ['functions-for-job', runtime],
    queryFn: () =>
      api.get<FunctionsResponse>(runtime === 'edge' ? '/tophbase/functions' : '/tophbase/node-functions'),
    enabled: open,
  });

  const createJob = useMutation({
    mutationFn: () => {
      let payload: unknown;
      try {
        payload = JSON.parse(payloadText || '{}');
      } catch {
        throw new Error('Payload must be valid JSON');
      }
      return api.post('/tophbase/jobs', { function_name: functionName, runtime, payload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success('Job created');
      onOpenChange(false);
      setFunctionName('');
      setPayloadText('{}');
    },
    onError: (err) => toast.error(err.message),
  });

  const functions = functionsQuery.data?.functions ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Job</DialogTitle>
          <DialogDescription>Queue a Deno Edge Function or Node Function to run in the background.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Runtime</label>
            <select
              value={runtime}
              onChange={(e) => {
                setRuntime(e.target.value as 'edge' | 'node');
                setFunctionName('');
              }}
              className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm"
            >
              <option value="edge">Edge Function (Deno)</option>
              <option value="node">Node Function</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Function</label>
            <select
              value={functionName}
              onChange={(e) => setFunctionName(e.target.value)}
              className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm"
            >
              <option value="">
                {functionsQuery.isLoading ? 'Loading...' : 'Select a function...'}
              </option>
              {functions.map((f) => (
                <option key={f.name} value={f.name}>{f.name}</option>
              ))}
            </select>
            {!functionsQuery.isLoading && functions.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">No {runtime} functions found.</p>
            )}
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Payload (JSON)</label>
            <textarea
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              rows={5}
              className="w-full rounded border border-border bg-muted/30 px-2 py-1.5 text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={!functionName || createJob.isPending}
            onClick={() => createJob.mutate()}
          >
            <Plus size={14} />
            Create Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function JobsPage() {
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: ['jobs', statusFilter],
    queryFn: () =>
      api.get<JobsResponse>(`/tophbase/jobs${statusFilter === 'all' ? '' : `?status=${statusFilter}`}`),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const hasActive = jobs.some((j) => j.status === 'pending' || j.status === 'processing');
      return hasActive ? 2000 : 5000;
    },
  });

  const retryJob = useMutation({
    mutationFn: (id: string) => api.post(`/tophbase/jobs/${id}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success('Job requeued');
    },
    onError: (err) => toast.error(err.message),
  });

  const jobs = jobsQuery.data?.jobs ?? [];

  const columns: ColumnDef<Job, unknown>[] = useMemo(
    () => [
      { accessorKey: 'function_name', header: 'Function' },
      {
        accessorKey: 'runtime',
        header: 'Runtime',
        cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge>,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>,
      },
      { accessorKey: 'attempts', header: 'Attempts' },
      {
        accessorKey: 'created_at',
        header: 'Created',
        cell: ({ getValue }) => new Date(String(getValue())).toLocaleString(),
      },
      {
        accessorKey: 'updated_at',
        header: 'Updated',
        cell: ({ getValue }) => new Date(String(getValue())).toLocaleString(),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.status === 'failed' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={retryJob.isPending}
              onClick={(e) => {
                e.stopPropagation();
                retryJob.mutate(row.original.id);
              }}
            >
              <RotateCcw size={12} />
              Retry
            </Button>
          ) : null,
      },
    ],
    [retryJob],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <ListChecks size={18} />
          Jobs
        </h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => jobsQuery.refetch()} disabled={jobsQuery.isRefetching}>
            <RefreshCw size={14} className={jobsQuery.isRefetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            New Job
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${
              statusFilter === status
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      <DataTable
        data={jobs}
        columns={columns}
        loading={jobsQuery.isLoading}
        onRowClick={(job) => setSelectedJob(job)}
      />

      <RecordSidebar
        title={selectedJob ? `Job — ${selectedJob.function_name}` : ''}
        record={selectedJob as unknown as Record<string, unknown> | null}
        onClose={() => setSelectedJob(null)}
      />

      <CreateJobDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
