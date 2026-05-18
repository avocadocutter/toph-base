import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageRequest } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Plus, Trash2, HardDrive } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils';

interface Bucket {
  id: string;
  name: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
  created_at: string;
  updated_at: string;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function StoragePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [bucketId, setBucketId] = useState('');
  const [bucketPublic, setBucketPublic] = useState(false);

  const { data: buckets, isLoading } = useQuery({
    queryKey: ['storage-buckets'],
    queryFn: () => storageRequest<Bucket[]>('/bucket'),
  });

  const createBucket = useMutation({
    mutationFn: (opts: { id: string; name: string; public: boolean }) =>
      storageRequest('/bucket', { method: 'POST', body: JSON.stringify(opts) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-buckets'] });
      setCreateOpen(false);
      setBucketId('');
      setBucketPublic(false);
      toast.success('Bucket created');
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteBucket = useMutation({
    mutationFn: (id: string) =>
      storageRequest(`/bucket/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-buckets'] });
      toast.success('Bucket deleted');
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Storage</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus size={14} />
              New Bucket
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Bucket</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="bucket-id">Bucket name</Label>
                <Input
                  id="bucket-id"
                  placeholder="my-bucket"
                  value={bucketId}
                  onChange={(e) => setBucketId(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="public"
                  checked={bucketPublic}
                  onCheckedChange={(v) => setBucketPublic(v === true)}
                />
                <Label htmlFor="public" className="cursor-pointer font-normal">
                  Public bucket
                </Label>
              </div>
              {bucketPublic && (
                <p className="text-xs text-amber-500">
                  Files in public buckets are accessible without authentication.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                disabled={!bucketId || createBucket.isPending}
                onClick={() => createBucket.mutate({ id: bucketId, name: bucketId, public: bucketPublic })}
              >
                {createBucket.isPending ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {!isLoading && !buckets?.length && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <HardDrive size={32} className="mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">No buckets yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Create a bucket to start storing files.</p>
        </div>
      )}

      {buckets?.map((bucket) => (
        <div
          key={bucket.id}
          className="flex cursor-pointer items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/30"
          onClick={() => navigate(`/storage/${encodeURIComponent(bucket.id)}`)}
        >
          <FolderOpen size={20} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{bucket.name}</span>
              <Badge variant={bucket.public ? 'secondary' : 'outline'} className="text-[10px]">
                {bucket.public ? 'public' : 'private'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Created {formatDate(bucket.created_at)}
              {bucket.file_size_limit != null && ` · limit ${formatBytes(bucket.file_size_limit)}`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete bucket "${bucket.name}"? This cannot be undone.`)) {
                deleteBucket.mutate(bucket.id);
              }
            }}
          >
            <Trash2 size={15} />
          </Button>
        </div>
      ))}
    </div>
  );
}
