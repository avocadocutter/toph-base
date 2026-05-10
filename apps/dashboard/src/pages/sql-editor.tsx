import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, projectAdminPath, ApiError } from '@/lib/api-client';
import { useProjectStore } from '@/stores/project-store';
import { useResolvedTheme } from '@/stores/ui-store';
import { SqlEditor } from '@/components/sql-editor/sql-editor';
import { DataTable } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import type { SqlResult } from '@/types';
import type { ColumnDef } from '@tanstack/react-table';
import type { EditorView } from '@codemirror/view';
import { Play, Clock, AlertCircle, CheckCircle2, Terminal, Table2, X, Loader2 } from 'lucide-react';

const INITIAL_QUERY = `SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;`;

interface PgError {
  message?: string;
  position?: string;
  detail?: string;
  hint?: string;
}

export function SqlEditorPage() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const resolvedTheme = useResolvedTheme();
  const editorViewRef = useRef<EditorView | null>(null);

  const executeSql = useMutation({
    mutationFn: (query: string) => api.post<SqlResult>(projectAdminPath('/sql'), { query }),
  });

  const handleExecute = (query?: string) => {
    const q = query ?? editorViewRef.current?.state.doc.toString().trim() ?? '';
    if (!q || executeSql.isPending) return;
    executeSql.mutate(q);
  };

  const handleClear = () => {
    const view = editorViewRef.current;
    if (view) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
    }
    executeSql.reset();
  };

  const result = executeSql.data;
  const apiError = executeSql.error instanceof ApiError ? executeSql.error : null;
  const pgError = apiError?.details as PgError | undefined;
  const errorMessage = pgError?.message || apiError?.message || (executeSql.error as Error | null)?.message;
  const isNonSelect = result && result.fields.length === 0;

  const resultColumns: ColumnDef<Record<string, unknown>, unknown>[] =
    result?.fields.map((field) => ({
      accessorKey: field.name,
      header: field.name,
      cell: ({ getValue }) => {
        const val = getValue();
        if (val === null) return <span className="font-mono text-[11px] italic text-muted-foreground/60">null</span>;
        if (typeof val === 'object') return <code className="font-mono text-[11px] text-muted-foreground">{JSON.stringify(val)}</code>;
        return <span className="font-mono text-[12px]">{String(val)}</span>;
      },
    })) ?? [];

  const showEmpty = executeSql.isIdle;
  const showPending = executeSql.isPending;
  const showError = executeSql.isError && !!errorMessage;
  const showResult = !showError && !!result;

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-background">

      {/* ── Editor pane (55%) ─────────────────────────────── */}
      <div className="flex flex-col border-b border-border" style={{ height: '55%' }}>

        {/* Toolbar */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-3">
          <div className="flex items-center gap-2.5">
            <Terminal size={13} className="text-muted-foreground" />
            <span className="text-xs font-semibold tracking-tight text-foreground">SQL Editor</span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <X size={11} />
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => handleExecute()}
              disabled={executeSql.isPending || !currentProject}
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              {executeSql.isPending
                ? <Loader2 size={11} className="animate-spin" />
                : <Play size={11} />
              }
              {executeSql.isPending ? 'Running…' : 'Run'}
              {!executeSql.isPending && (
                <kbd className="ml-0.5 rounded bg-white/15 px-1 py-px font-mono text-[10px] leading-none">
                  ⌘↵
                </kbd>
              )}
            </Button>
          </div>
        </div>

        {/* CodeMirror */}
        <div className="min-h-0 flex-1">
          <SqlEditor
            onExecute={handleExecute}
            initialValue={INITIAL_QUERY}
            viewRef={editorViewRef}
            theme={resolvedTheme}
          />
        </div>
      </div>

      {/* ── Results pane (flex-1) ──────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col">

        {/* Results header */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-card px-3">
          <div className="flex items-center gap-2">
            <Table2 size={13} className="text-muted-foreground" />
            <span className="text-xs font-semibold tracking-tight text-foreground">Results</span>
            {showError && (
              <span className="rounded-sm bg-destructive/10 px-1.5 py-px text-[10px] font-medium text-destructive">
                Error
              </span>
            )}
          </div>

          {result && !showError && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {isNonSelect ? (
                <>
                  <CheckCircle2 size={11} className="text-emerald-500" />
                  <span>{result.rowCount} row{result.rowCount !== 1 ? 's' : ''} affected</span>
                </>
              ) : (
                <span>{result.rowCount} row{result.rowCount !== 1 ? 's' : ''}</span>
              )}
              <span className="text-border">·</span>
              <Clock size={11} />
              <span>{result.duration}ms</span>
            </div>
          )}
        </div>

        {/* Results body */}
        <div className="min-h-0 flex-1 overflow-auto">

          {showEmpty && (
            <div className="flex h-full items-center justify-center">
              <p className="text-[11px] text-muted-foreground/40">Run a query to see results</p>
            </div>
          )}

          {showPending && (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" />
              Executing query…
            </div>
          )}

          {showError && (
            <div className="border-l-2 border-destructive px-4 py-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={13} className="mt-0.5 shrink-0 text-destructive" />
                <div className="min-w-0 space-y-1">
                  <p className="font-mono text-[13px] text-destructive">{errorMessage}</p>
                  {pgError?.position && (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      <span className="text-muted-foreground/50">position</span> {pgError.position}
                    </p>
                  )}
                  {pgError?.detail && (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      <span className="text-muted-foreground/50">detail</span> {pgError.detail}
                    </p>
                  )}
                  {pgError?.hint && (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      <span className="text-muted-foreground/50">hint</span> {pgError.hint}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {showResult && (
            isNonSelect ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <CheckCircle2 size={14} className="text-emerald-500" />
                Query executed successfully — {result.rowCount} row{result.rowCount !== 1 ? 's' : ''} affected.
              </div>
            ) : (
              <DataTable data={result.rows} columns={resultColumns} />
            )
          )}

        </div>
      </div>
    </div>
  );
}
