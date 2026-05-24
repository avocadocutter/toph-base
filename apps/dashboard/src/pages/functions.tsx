import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Copy, Check, Zap } from 'lucide-react';
import { useState } from 'react';
import { FunctionViewer } from '@/components/functions/function-viewer';
import { cn } from '@/lib/utils';
import { useResolvedTheme } from '@/stores/ui-store';

interface EdgeFunction {
  name: string;
  url: string;
}

interface FunctionsResponse {
  functionsDir: string | null;
  functions: EdgeFunction[];
}

interface FunctionDetail {
  name: string;
  source: string;
  path: string;
}

function CopyButton({ value, title = 'Copy' }: { value: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={title}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export function FunctionsPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const resolvedTheme = useResolvedTheme();

  const { data, isLoading } = useQuery({
    queryKey: ['edge-functions'],
    queryFn: () => api.get<FunctionsResponse>('/tophbase/functions'),
    refetchInterval: 5000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['edge-function-source', selected],
    queryFn: () => api.get<FunctionDetail>(`/tophbase/functions/${encodeURIComponent(selected!)}`),
    enabled: !!selected,
  });

  const functions = data?.functions ?? [];

  return (
    <div className="flex h-full min-h-0 gap-0 -m-6">
      {/* Sidebar list */}
      <div className="flex w-56 shrink-0 flex-col border-r border-border">
        <div className="flex h-12 items-center border-b border-border px-4">
          <h1 className="text-sm font-semibold">Edge Functions</h1>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading && (
            <div className="space-y-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}

          {!isLoading && !functions.length && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Zap size={24} className="mb-2 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">No functions found</p>
            </div>
          )}

          {functions.map((fn) => (
            <button
              key={fn.name}
              onClick={() => setSelected(fn.name)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                selected === fn.name
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Zap size={14} className="shrink-0" />
              <span className="truncate">{fn.name}</span>
            </button>
          ))}
        </div>

        {data?.functionsDir && (
          <div className="border-t border-border px-3 py-2">
            <p className="truncate text-[10px] text-muted-foreground" title={data.functionsDir}>
              {data.functionsDir}
            </p>
          </div>
        )}
      </div>

      {/* Detail panel */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a function to view its source
          </div>
        )}

        {selected && (
          <>
            <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
              <p className="shrink-0 text-sm font-medium">{selected}</p>
              {functions.find(f => f.name === selected) && (
                <div className="flex min-w-0 flex-1 items-center gap-1 rounded bg-muted px-2 py-1">
                  <code className="min-w-0 flex-1 truncate text-xs font-mono text-muted-foreground">
                    {functions.find(f => f.name === selected)!.url}
                  </code>
                  <CopyButton value={functions.find(f => f.name === selected)!.url} title="Copy URL" />
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1">
              {detailLoading && (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">Loading…</p>
                </div>
              )}
              {detail && !detailLoading && (
                <FunctionViewer source={detail.source} theme={resolvedTheme} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
