import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Eye, EyeOff } from 'lucide-react';
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
  secretKey: string;
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

function ResetDangerZone() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [includeAuth, setIncludeAuth] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ droppedTables: string[]; authCleared: boolean } | null>(null);

  const handleReset = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ droppedTables: string[]; authCleared: boolean }>('/admin/db/reset', { includeAuth });
      setResult(res);
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setError(null);
    setResult(null);
    setIncludeAuth(false);
  };

  return (
    <section className="space-y-3 rounded-lg border border-destructive/40 bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Irreversible actions that wipe data from your local database.
        </p>
      </div>

      <div className="flex items-center justify-between rounded border border-border bg-muted/30 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">Reset database</p>
          <p className="text-xs text-muted-foreground">Drop all tables in the public schema and clear migration history.</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
        >
          Reset
        </button>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
        <DialogContent>
          {result ? (
            <>
              <DialogHeader>
                <DialogTitle>Database reset complete</DialogTitle>
                <DialogDescription>
                  {result.droppedTables.length === 0
                    ? 'No tables were found in the public schema.'
                    : `Dropped ${result.droppedTables.length} table${result.droppedTables.length !== 1 ? 's' : ''}: ${result.droppedTables.join(', ')}.`}
                  {result.authCleared ? ' Auth users and sessions cleared.' : ''}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <button
                  onClick={handleClose}
                  className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Done
                </button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Reset database?</DialogTitle>
                <DialogDescription>
                  This will drop all tables in the <code className="font-mono text-xs">public</code> schema and erase migration history. This cannot be undone.
                </DialogDescription>
              </DialogHeader>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeAuth}
                  onChange={(e) => setIncludeAuth(e.target.checked)}
                  className="rounded border-border"
                />
                Also clear auth users and sessions
              </label>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <DialogFooter>
                <DialogClose asChild>
                  <button className="rounded border border-border px-4 py-1.5 text-sm hover:bg-accent">
                    Cancel
                  </button>
                </DialogClose>
                <button
                  onClick={handleReset}
                  disabled={loading}
                  className="rounded bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                >
                  {loading ? 'Resetting…' : 'Yes, reset database'}
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function SettingsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tophbase-status'],
    queryFn: () => api.get<TophbaseStatus>('/tophbase/status'),
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

      {/* Connection */}
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

          <ApiKeyRow
            label="Secret key — server-side only, bypasses RLS"
            value={data.secretKey}
          />
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

      {/* Version */}
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

      <ResetDangerZone />
    </div>
  );
}
