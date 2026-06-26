import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Copy, Check, Zap, Box } from 'lucide-react';
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

type Runtime = 'deno' | 'node';

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

function FunctionList({
  label,
  icon: Icon,
  functions,
  functionsDir,
  isLoading,
  selected,
  onSelect,
}: {
  label: string;
  icon: React.ElementType;
  functions: EdgeFunction[];
  functionsDir: string | null | undefined;
  isLoading: boolean;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex h-9 items-center gap-2 px-3 pt-2">
        <Icon size={12} className="shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>

      {isLoading && (
        <div className="space-y-1 px-2 pb-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-muted" />
          ))}
        </div>
      )}

      {!isLoading && !functions.length && (
        <p className="px-4 pb-2 text-[11px] text-muted-foreground">No functions found</p>
      )}

      <div className="px-2 pb-1">
        {functions.map((fn) => (
          <button
            key={fn.name}
            onClick={() => onSelect(fn.name)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
              selected === fn.name
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Icon size={14} className="shrink-0" />
            <span className="truncate">{fn.name}</span>
          </button>
        ))}
      </div>

      {functionsDir && (
        <p className="truncate px-3 pb-1 text-[10px] text-muted-foreground" title={functionsDir}>
          {functionsDir}
        </p>
      )}
    </div>
  );
}

export function FunctionsPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedRuntime, setSelectedRuntime] = useState<Runtime>('deno');
  const resolvedTheme = useResolvedTheme();

  const { data: denoData, isLoading: denoLoading } = useQuery({
    queryKey: ['edge-functions'],
    queryFn: () => api.get<FunctionsResponse>('/tophbase/functions'),
    refetchInterval: 5000,
  });

  const { data: nodeData, isLoading: nodeLoading } = useQuery({
    queryKey: ['node-functions'],
    queryFn: () => api.get<FunctionsResponse>('/tophbase/node-functions'),
    refetchInterval: 5000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['function-source', selectedRuntime, selected],
    queryFn: () => {
      const path = selectedRuntime === 'deno'
        ? `/tophbase/functions/${encodeURIComponent(selected!)}`
        : `/tophbase/node-functions/${encodeURIComponent(selected!)}`;
      return api.get<FunctionDetail>(path);
    },
    enabled: !!selected,
  });

  const denoFunctions = denoData?.functions ?? [];
  const nodeFunctions = nodeData?.functions ?? [];

  const allFunctions = [...denoFunctions.map(f => ({ ...f, runtime: 'deno' as Runtime })), ...nodeFunctions.map(f => ({ ...f, runtime: 'node' as Runtime }))];
  const selectedFn = allFunctions.find(f => f.name === selected && f.runtime === selectedRuntime);

  function selectFn(name: string, runtime: Runtime) {
    setSelected(name);
    setSelectedRuntime(runtime);
  }

  return (
    <div className="flex h-full min-h-0 gap-0 -m-6">
      {/* Sidebar list */}
      <div className="flex w-56 shrink-0 flex-col border-r border-border overflow-y-auto">
        <div className="flex h-12 items-center border-b border-border px-4 shrink-0">
          <h1 className="text-sm font-semibold">Functions</h1>
        </div>

        <FunctionList
          label="Edge (Deno)"
          icon={Zap}
          functions={denoFunctions}
          functionsDir={denoData?.functionsDir}
          isLoading={denoLoading}
          selected={selectedRuntime === 'deno' ? selected : null}
          onSelect={(name) => selectFn(name, 'deno')}
        />

        <div className="border-t border-border" />

        <FunctionList
          label="Node.js"
          icon={Box}
          functions={nodeFunctions}
          functionsDir={nodeData?.functionsDir}
          isLoading={nodeLoading}
          selected={selectedRuntime === 'node' ? selected : null}
          onSelect={(name) => selectFn(name, 'node')}
        />
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
              <div className="flex items-center gap-1.5">
                {selectedRuntime === 'deno' ? <Zap size={14} className="text-muted-foreground" /> : <Box size={14} className="text-muted-foreground" />}
                <p className="shrink-0 text-sm font-medium">{selected}</p>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{selectedRuntime === 'deno' ? 'Deno' : 'Node.js'}</span>
              </div>
              {selectedFn && (
                <div className="flex min-w-0 flex-1 items-center gap-1 rounded bg-muted px-2 py-1">
                  <code className="min-w-0 flex-1 truncate text-xs font-mono text-muted-foreground">
                    {selectedFn.url}
                  </code>
                  <CopyButton value={selectedFn.url} title="Copy URL" />
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
