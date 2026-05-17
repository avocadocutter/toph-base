import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Eye, EyeOff } from 'lucide-react';

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
    </div>
  );
}
