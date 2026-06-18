import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageRequest, storageSignedDownloadUrl } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronRight,
  File,
  Folder,
  Trash2,
  Upload,
  Download,
  ArrowLeft,
  HardDrive,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

interface StorageObject {
  name: string;
  id: string | null;
  updated_at: string | null;
  created_at: string | null;
  metadata: {
    size: number;
    mimetype: string;
    eTag: string;
    cacheControl: string;
    lastModified: string;
    contentLength: number;
    httpStatusCode: number;
  } | null;
}

interface BucketInfo {
  id: string;
  name: string;
  public: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function mimeIcon(mime: string | undefined) {
  if (!mime) return <File size={16} className="text-muted-foreground" />;
  if (mime.startsWith('image/')) return <File size={16} className="text-blue-400" />;
  if (mime.startsWith('video/')) return <File size={16} className="text-purple-400" />;
  if (mime.includes('pdf')) return <File size={16} className="text-red-400" />;
  return <File size={16} className="text-muted-foreground" />;
}

export function StorageBucketPage() {
  const { bucket } = useParams<{ bucket: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);

  const prefix = searchParams.get('prefix') ?? '';

  const { data: bucketInfo } = useQuery({
    queryKey: ['storage-bucket-info', bucket],
    queryFn: () => storageRequest<BucketInfo>(`/bucket/${encodeURIComponent(bucket!)}`),
    enabled: !!bucket,
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ['storage-objects', bucket, prefix],
    queryFn: () =>
      storageRequest<StorageObject[]>(`/object/list/${encodeURIComponent(bucket!)}`, {
        method: 'POST',
        body: JSON.stringify({ prefix, limit: 200, sortBy: { column: 'name', order: 'asc' } }),
      }),
    enabled: !!bucket,
  });

  const deleteObjects = useMutation({
    mutationFn: (prefixes: string[]) =>
      storageRequest(`/object/${encodeURIComponent(bucket!)}`, {
        method: 'DELETE',
        body: JSON.stringify({ prefixes }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-objects', bucket] });
      setSelected(new Set());
      toast.success('Deleted');
    },
    onError: (err) => toast.error(err.message),
  });

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    let ok = 0;
    let fail = 0;
    for (const file of Array.from(files)) {
      const path = `${prefix}${file.name}`;
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('file', file, file.name);
      try {
        await storageRequest(`/object/${encodeURIComponent(bucket!)}/${path}`, {
          method: 'POST',
          body: form,
          rawBody: true,
          headers: { 'x-upsert': 'true' },
        });
        ok++;
      } catch {
        fail++;
      }
    }
    setUploading(false);
    queryClient.invalidateQueries({ queryKey: ['storage-objects', bucket] });
    if (ok) toast.success(`Uploaded ${ok} file${ok > 1 ? 's' : ''}`);
    if (fail) toast.error(`${fail} file${fail > 1 ? 's' : ''} failed`);
  }

  async function handleDownload(objectName: string) {
    try {
      const url = await storageSignedDownloadUrl(bucket!, objectName);
      const a = document.createElement('a');
      a.href = url;
      a.download = objectName.split('/').pop() ?? objectName;
      a.click();
    } catch {
      toast.error('Could not generate download link');
    }
  }

  function navigateToFolder(folderName: string) {
    setSearchParams({ prefix: prefix + folderName });
    setSelected(new Set());
  }

  function navigateUp() {
    if (!prefix) { navigate('/storage'); return; }
    const parts = prefix.split('/').filter(Boolean);
    parts.pop();
    setSearchParams(parts.length ? { prefix: parts.join('/') + '/' } : {});
    setSelected(new Set());
  }

  const breadcrumbs = prefix
    ? prefix.split('/').filter(Boolean).map((seg, i, arr) => ({
        label: seg,
        prefix: arr.slice(0, i + 1).join('/') + '/',
      }))
    : [];

  const isFolder = (item: StorageObject) => item.id === null;

  const allFileNames = items?.filter((i) => !isFolder(i)).map((i) => prefix + i.name) ?? [];

  const toggleSelect = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); } else { next.add(name); }
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === allFileNames.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allFileNames));
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={navigateUp}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft size={16} />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1 text-sm min-w-0">
            <button
              onClick={() => navigate('/storage')}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <HardDrive size={14} />
            </button>
            <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
            <button
              onClick={() => { setSearchParams({}); setSelected(new Set()); }}
              className={`shrink-0 font-medium ${!prefix ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {bucket}
            </button>
            {breadcrumbs.map((crumb) => (
              <span key={crumb.prefix} className="flex items-center gap-1">
                <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                <button
                  onClick={() => { setSearchParams({ prefix: crumb.prefix }); setSelected(new Set()); }}
                  className={`truncate max-w-[120px] ${crumb.prefix === prefix ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  title={crumb.label}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>

          {bucketInfo && (
            <Badge variant={bucketInfo.public ? 'secondary' : 'outline'} className="text-[10px] shrink-0">
              {bucketInfo.public ? 'public' : 'private'}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {selected.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm(`Delete ${selected.size} item${selected.size > 1 ? 's' : ''}?`)) {
                  deleteObjects.mutate(Array.from(selected));
                }
              }}
              disabled={deleteObjects.isPending}
            >
              <Trash2 size={14} />
              Delete ({selected.size})
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={14} />
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
            onClick={(e) => ((e.target as HTMLInputElement).value = '')}
          />
        </div>
      </div>

      {/* Drop zone + table */}
      <div
        className="rounded-lg border border-border overflow-hidden"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
      >
        {/* Column headers */}
        <div className="grid grid-cols-[24px_1fr_100px_160px_80px] items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            className="accent-primary"
            checked={allFileNames.length > 0 && selected.size === allFileNames.length}
            onChange={toggleAll}
          />
          <span>Name</span>
          <span className="text-right">Size</span>
          <span>Modified</span>
          <span />
        </div>

        {isLoading && (
          <div className="space-y-px">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse bg-muted/30" />
            ))}
          </div>
        )}

        {!isLoading && !items?.length && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Upload size={28} className="mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Drop files here or click Upload</p>
          </div>
        )}

        {items?.map((item) => {
          const fullName = prefix + item.name;
          const isDir = isFolder(item);
          const isChecked = selected.has(fullName);

          return (
            <div
              key={fullName}
              className={`grid grid-cols-[24px_1fr_100px_160px_80px] items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0 hover:bg-accent/20 ${isChecked ? 'bg-accent/30' : ''}`}
            >
              <input
                type="checkbox"
                className="accent-primary"
                checked={isChecked}
                disabled={isDir}
                onChange={() => !isDir && toggleSelect(fullName)}
              />

              <button
                className="flex items-center gap-2 text-left truncate"
                onClick={() => isDir ? navigateToFolder(item.name) : undefined}
                disabled={!isDir}
              >
                {isDir
                  ? <Folder size={16} className="shrink-0 text-amber-400" />
                  : mimeIcon(item.metadata?.mimetype)}
                <span className={`truncate ${isDir ? 'font-medium hover:underline cursor-pointer' : ''}`}>
                  {isDir ? item.name.replace(/\/$/, '') : item.name}
                </span>
              </button>

              <span className="text-right text-xs text-muted-foreground tabular-nums">
                {item.metadata?.size != null ? formatBytes(item.metadata.size) : '—'}
              </span>

              <span className="text-xs text-muted-foreground">
                {formatDate(item.updated_at)}
              </span>

              <div className="flex justify-end">
                {!isDir && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    title="Download"
                    onClick={() => handleDownload(fullName)}
                  >
                    <Download size={14} />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
