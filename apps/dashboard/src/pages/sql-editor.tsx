import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, projectAdminPath } from '@/lib/api-client';
import { useProjectStore } from '@/stores/project-store';
import { useResolvedTheme } from '@/stores/ui-store';
import { SqlEditor } from '@/components/sql-editor/sql-editor';
import { DataTable } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import type { SqlResult } from '@/types';
import type { ColumnDef } from '@tanstack/react-table';
import type { EditorView } from '@codemirror/view';
import { Play, Clock } from 'lucide-react';
import { toast } from 'sonner';

export function SqlEditorPage() {
  const [result, setResult] = useState<SqlResult | null>(null);
  const currentProject = useProjectStore((s) => s.currentProject);
  const resolvedTheme = useResolvedTheme();
  const editorViewRef = useRef<EditorView | null>(null);

  const executeSql = useMutation({
    mutationFn: (query: string) => api.post<SqlResult>(projectAdminPath('/sql'), { query }),
    onSuccess: (data) => setResult(data),
    onError: (err) => {
      toast.error(err.message);
      setResult(null);
    },
  });

  const handleExecute = (query: string) => {
    executeSql.mutate(query);
  };

  const resultColumns: ColumnDef<Record<string, unknown>, unknown>[] =
    result?.fields.map((field) => ({
      accessorKey: field.name,
      header: field.name,
      cell: ({ getValue }) => {
        const val = getValue();
        if (val === null) return <span className="text-muted-foreground italic">null</span>;
        if (typeof val === 'object') return <span className="text-muted-foreground">{JSON.stringify(val)}</span>;
        return String(val);
      },
    })) ?? [];

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">SQL Editor</h1>
        <div className="flex items-center gap-2">
          {result && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock size={12} />
              {result.duration}ms / {result.rowCount} row{result.rowCount !== 1 ? 's' : ''}
            </span>
          )}
          <Button
            size="sm"
            onClick={() => {
              const query = editorViewRef.current?.state.doc.toString().trim() ?? '';
              if (query) handleExecute(query);
            }}
            disabled={executeSql.isPending}
          >
            <Play size={14} />
            Run (Cmd+Enter)
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <SqlEditor
          onExecute={handleExecute}
          initialValue={`SELECT * FROM users LIMIT 10;`}
          viewRef={editorViewRef}
          theme={resolvedTheme}
        />
      </div>

      {result && (
        <div className="max-h-[40%] overflow-auto">
          <DataTable data={result.rows} columns={resultColumns} />
        </div>
      )}
    </div>
  );
}
