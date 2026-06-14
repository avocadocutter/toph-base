import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Eye, EyeOff, Trash2, Download, Upload, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

interface TophbaseStatus {
  configured: boolean;
  dialect: string | null;
  version: string;
  url: string;
  publishableKey: string;
}

function ApiKeyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-muted px-3 py-1.5 text-xs font-mono">
          {visible ? value : '•'.repeat(48)}
        </code>
        <button
          onClick={() => setVisible(!visible)}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={visible ? 'Hide' : 'Reveal'}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          onClick={copy}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Copy"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

function BackupSection() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/admin/backup');
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: { message: 'Backup failed' } }));
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? 'tophbase-backup.zip';
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">Backup</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Download a full backup of your project — database, storage, migrations, config, and secrets. The zip can be restored on any Tophbase instance.
        </p>
      </div>

      <div className="flex items-center justify-between rounded border border-border bg-muted/30 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">Download backup</p>
          <p className="text-xs text-muted-foreground">Includes all tables, auth users, storage files, and migration history.</p>
        </div>
        <button
          onClick={handleDownload}
          disabled={loading}
          className="flex shrink-0 items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {loading ? 'Preparing…' : 'Download'}
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

function RestoreSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ restored: string[] } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setPendingFile(file);
    setError(null);
    setResult(null);
    setConfirmOpen(true);
  };

  const handleRestore = async () => {
    if (!pendingFile) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', pendingFile);
      const response = await fetch('/admin/restore', { method: 'POST', body: form });
      const body = await response.json() as { ok?: boolean; restored?: string[]; error?: { message: string } };
      if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      setResult({ restored: body.restored ?? [] });
      setConfirmOpen(false);
      setPendingFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setConfirmOpen(false);
    setPendingFile(null);
    setError(null);
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">Restore</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Upload a Tophbase backup zip to restore this instance. All current data will be replaced.
        </p>
      </div>

      <div className="flex items-center justify-between rounded border border-border bg-muted/30 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">Upload backup</p>
          <p className="text-xs text-muted-foreground">Restores database, storage, config, secrets, and migrations.</p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
          <Upload size={13} />
          Choose file
          <input type="file" accept=".zip" className="sr-only" onChange={handleFileChange} />
        </label>
      </div>

      {result && (
        <p className="text-xs text-green-600 dark:text-green-400">
          Restored: {result.restored.join(', ')}. A page refresh is recommended.
        </p>
      )}

      {error && !confirmOpen && <p className="text-xs text-destructive">{error}</p>}

      <Dialog open={confirmOpen} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore from backup?</DialogTitle>
            <DialogDescription>
              This will overwrite all current data — database, storage, config, and secrets — with the contents of{' '}
              <span className="font-medium text-foreground">{pendingFile?.name}</span>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <DialogClose asChild>
              <button className="rounded border border-border px-4 py-1.5 text-sm hover:bg-accent" disabled={loading}>
                Cancel
              </button>
            </DialogClose>
            <button
              onClick={handleRestore}
              disabled={loading}
              className="flex items-center gap-1.5 rounded bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {loading && <Loader2 size={13} className="animate-spin" />}
              {loading ? 'Restoring…' : 'Yes, restore'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}


function parseDotEnv(text: string): { key: string; value: string }[] {
  const results: { key: string; value: string }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) results.push({ key, value });
  }
  return results;
}

function SecretsSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['tophbase-secrets'],
    queryFn: () => api.get<{ secrets: Record<string, string> }>('/tophbase/secrets'),
  });

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const addMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api.post('/tophbase/secrets', { key, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tophbase-secrets'] });
      setNewKey('');
      setNewValue('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => api.delete(`/tophbase/secrets/${encodeURIComponent(key)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tophbase-secrets'] }),
  });

  const entries = Object.entries(data?.secrets ?? {});

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim()) return;
    addMutation.mutate({ key: newKey.trim(), value: newValue.trim() });
  };

  const handleBulkSave = async () => {
    setBulkError(null);
    const pairs = parseDotEnv(bulkText);
    if (pairs.length === 0) {
      setBulkError('No valid KEY=value lines found.');
      return;
    }
    setBulkSaving(true);
    try {
      for (const { key, value } of pairs) {
        await api.post('/tophbase/secrets', { key, value });
      }
      queryClient.invalidateQueries({ queryKey: ['tophbase-secrets'] });
      setBulkText('');
      setBulkMode(false);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Failed to save secrets');
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Edge Function Secrets</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Environment variables injected into edge functions. On Railway deploy, these become service variables.
          </p>
        </div>
        <button
          onClick={() => { setBulkMode(v => !v); setBulkError(null); }}
          className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {bulkMode ? 'Single' : 'Bulk import'}
        </button>
      </div>

      {entries.length > 0 && (
        <div className="space-y-1">
          {entries.map(([key]) => (
            <div key={key} className="flex items-center justify-between rounded border border-border bg-muted/30 px-3 py-2">
              <code className="text-xs font-mono">{key}</code>
              <button
                onClick={() => deleteMutation.mutate(key)}
                disabled={deleteMutation.isPending}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                title="Remove"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {bulkMode ? (
        <div className="space-y-2">
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={'KEY_ONE=value1\nKEY_TWO=value2\n# comments are ignored'}
            rows={6}
            className="w-full rounded border border-border bg-muted/30 px-2 py-1.5 text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkSave}
              disabled={bulkSaving || !bulkText.trim()}
              className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {bulkSaving ? 'Saving…' : `Save ${parseDotEnv(bulkText).length || ''} secrets`.trim()}
            </button>
            <button
              onClick={() => { setBulkMode(false); setBulkText(''); setBulkError(null); }}
              className="rounded border border-border px-3 py-1.5 text-xs hover:bg-accent"
            >
              Cancel
            </button>
          </div>
          {bulkError && <p className="text-xs text-destructive">{bulkError}</p>}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="KEY_NAME"
              className="flex-1 rounded border border-border bg-muted/30 px-2 py-1.5 text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="value"
              type="password"
              className="flex-1 rounded border border-border bg-muted/30 px-2 py-1.5 text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={handleAdd}
              disabled={addMutation.isPending || !newKey.trim() || !newValue.trim()}
              className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {addMutation.isPending ? 'Saving…' : 'Add'}
            </button>
          </div>

          {addMutation.isError && (
            <p className="text-xs text-destructive">
              {addMutation.error instanceof Error ? addMutation.error.message : 'Failed to save secret'}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function SettingsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tophbase-status'],
    queryFn: () => api.get<TophbaseStatus>('/tophbase/status'),
  });
  const { data: secretKeyData } = useQuery({
    queryKey: ['tophbase-secret-key'],
    queryFn: () => api.get<{ secretKey: string }>('/tophbase/secret-key'),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-bold">Settings</h1>
        <p className="text-sm text-destructive">Could not load settings. Is the server running?</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">Settings</h1>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Connection</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Use these values to connect your app to Tophbase.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">URL</span>
            <code className="block rounded bg-muted px-3 py-1.5 text-xs font-mono">
              {data.url}
            </code>
          </div>

          <ApiKeyRow
            label="Publishable key — safe for browsers and mobile apps"
            value={data.publishableKey}
          />

          {secretKeyData && (
            <ApiKeyRow
              label="Secret key — server-side only, bypasses RLS"
              value={secretKeyData.secretKey}
            />
          )}
        </div>

        <div className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Quick start:</span>
          <pre className="mt-1 font-mono whitespace-pre-wrap break-all">{`import { createClient } from '@supabase/supabase-js'
const supabase = createClient('${data.url}', '${data.publishableKey}')`}</pre>
        </div>

        {data.dialect && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Dialect:</span>
            <Badge variant="secondary">{data.dialect}</Badge>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">About</h2>
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>Tophbase version</span>
            <span>{data.version}</span>
          </div>
          <div className="flex justify-between">
            <span>Storage</span>
            <span>PGLite (embedded)</span>
          </div>
        </div>
      </section>

      <SecretsSection />

      <BackupSection />

      <RestoreSection />
    </div>
  );
}
