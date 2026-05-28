import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { branchesApi, type DiffAddition, type DiffWarning } from '@/lib/api-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertTriangle, GitMerge, Loader2, Table2, Columns, Hash } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  branchName: string;
  onClose: () => void;
  onMerged: () => void;
}

export function BranchMergeDialog({ branchName, onClose, onMerged }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: diff, isLoading, error } = useQuery({
    queryKey: ['branch-diff', branchName],
    queryFn: () => branchesApi.diff(branchName),
  });

  const mergeMut = useMutation({
    mutationFn: (sqls: string[]) => branchesApi.merge(branchName, sqls),
    onSuccess: (res) => {
      toast.success(`Merged ${res.applied} change${res.applied !== 1 ? 's' : ''} into main`);
      onMerged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggleAll() {
    if (!diff) return;
    const allSqls = diff.additions.map(a => a.sql);
    if (selected.size === allSqls.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allSqls));
    }
  }

  function toggleItem(sql: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sql)) next.delete(sql);
      else next.add(sql);
      return next;
    });
  }

  const hasAdditions = (diff?.additions.length ?? 0) > 0;
  const hasWarnings = (diff?.warnings.length ?? 0) > 0;
  const canMerge = selected.size > 0 && !mergeMut.isPending;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge size={16} />
            Merge <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">{branchName}</code> into main
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 size={16} className="animate-spin" />
              Computing schema diff…
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive">Failed to load diff: {(error as Error).message}</div>
          )}

          {diff && !hasAdditions && !hasWarnings && (
            <p className="text-sm text-muted-foreground py-4 text-center">No schema differences between <strong>{branchName}</strong> and <strong>main</strong>.</p>
          )}

          {diff && hasAdditions && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">Schema additions</h3>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={toggleAll}
                >
                  {selected.size === diff.additions.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="space-y-2">
                {diff.additions.map((addition, i) => (
                  <AdditionRow
                    key={i}
                    addition={addition}
                    checked={selected.has(addition.sql)}
                    onToggle={() => toggleItem(addition.sql)}
                  />
                ))}
              </div>
            </section>
          )}

          {diff && hasWarnings && (
            <section>
              <h3 className="text-sm font-medium flex items-center gap-1.5 mb-2">
                <AlertTriangle size={14} className="text-yellow-500" />
                Warnings — not applied automatically
              </h3>
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 divide-y divide-yellow-500/10">
                {diff.warnings.map((w, i) => (
                  <WarningRow key={i} warning={w} />
                ))}
              </div>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mergeMut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mergeMut.mutate(Array.from(selected))}
            disabled={!canMerge}
            className="gap-2"
          >
            {mergeMut.isPending && <Loader2 size={14} className="animate-spin" />}
            Apply {selected.size > 0 ? `${selected.size} change${selected.size !== 1 ? 's' : ''}` : 'changes'} to main
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const additionIcon = {
  table: Table2,
  column: Columns,
  index: Hash,
};

function AdditionRow({ addition, checked, onToggle }: { addition: DiffAddition; checked: boolean; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = additionIcon[addition.type];

  return (
    <div className={cn('rounded-lg border transition-colors', checked ? 'border-primary/40 bg-primary/5' : 'border-border bg-card')}>
      <div className="flex items-start gap-3 p-3">
        <Checkbox
          id={`add-${addition.sql}`}
          checked={checked}
          onCheckedChange={onToggle}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <label
            htmlFor={`add-${addition.sql}`}
            className="flex items-center gap-1.5 text-xs font-medium cursor-pointer"
          >
            <Icon size={12} className="text-muted-foreground shrink-0" />
            {addition.description}
          </label>
          <button
            className="text-xs text-muted-foreground hover:text-foreground mt-1"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? 'Hide SQL' : 'Show SQL'}
          </button>
          {expanded && (
            <pre className="mt-2 rounded bg-muted p-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {addition.sql}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function WarningRow({ warning }: { warning: DiffWarning }) {
  return (
    <div className="px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
      {warning.description}
    </div>
  );
}
