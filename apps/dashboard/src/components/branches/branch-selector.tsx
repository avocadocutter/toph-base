import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { GitBranch, Plus, Check, Trash2, RotateCcw, GitMerge, ChevronDown, Loader2 } from 'lucide-react';
import { branchesApi, type BranchInfo } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { BranchMergeDialog } from './branch-merge-dialog';

export function BranchSelector() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list(),
    refetchOnWindowFocus: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['branches'] });

  const switchMut = useMutation({
    mutationFn: (name: string) => branchesApi.switch(name),
    onSuccess: (_, name) => {
      invalidate();
      toast.success(`Switched to branch "${name}"`);
      window.location.reload();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: (name: string) => branchesApi.create(name),
    onSuccess: (branch) => {
      invalidate();
      toast.success(`Branch "${branch.name}" created`);
      setShowCreate(false);
      setNewName('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => branchesApi.delete(name),
    onSuccess: (_, name) => {
      invalidate();
      toast.success(`Branch "${name}" deleted`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: (name: string) => branchesApi.reset(name),
    onSuccess: (_, name) => {
      invalidate();
      toast.success(`Branch "${name}" reset to main`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeBranch = data?.activeBranch ?? 'main';
  const branches = data?.branches ?? [];

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (newName.trim()) createMut.mutate(newName.trim());
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        <span>Loading branches…</span>
      </div>
    );
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <GitBranch size={12} className="text-muted-foreground" />
            <span>{activeBranch}</span>
            <ChevronDown size={11} className="text-muted-foreground" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-[220px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
          >
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Branches</div>

            {branches.map((branch) => (
              <BranchItem
                key={branch.name}
                branch={branch}
                isActive={branch.name === activeBranch}
                onSwitch={() => switchMut.mutate(branch.name)}
                onDelete={() => deleteMut.mutate(branch.name)}
                onReset={() => resetMut.mutate(branch.name)}
                onMerge={() => setMergeTarget(branch.name)}
                switching={switchMut.isPending && switchMut.variables === branch.name}
              />
            ))}

            <DropdownMenu.Separator className="my-1 h-px bg-border" />

            {showCreate ? (
              <form onSubmit={handleCreate} className="px-1 py-1 flex gap-1">
                <Input
                  autoFocus
                  placeholder="branch-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-7 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={createMut.isPending || !newName.trim()}
                >
                  {createMut.isPending ? <Loader2 size={11} className="animate-spin" /> : 'Create'}
                </Button>
              </form>
            ) : (
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none hover:bg-accent"
                onSelect={(e) => { e.preventDefault(); setShowCreate(true); }}
              >
                <Plus size={12} />
                New branch from {activeBranch}
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {mergeTarget && (
        <BranchMergeDialog
          branchName={mergeTarget}
          onClose={() => setMergeTarget(null)}
          onMerged={() => {
            setMergeTarget(null);
            invalidate();
          }}
        />
      )}
    </>
  );
}

interface BranchItemProps {
  branch: BranchInfo;
  isActive: boolean;
  onSwitch: () => void;
  onDelete: () => void;
  onReset: () => void;
  onMerge: () => void;
  switching: boolean;
}

function BranchItem({ branch, isActive, onSwitch, onDelete, onReset, onMerge, switching }: BranchItemProps) {
  return (
    <div className="group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent">
      <button
        className="flex flex-1 items-center gap-2 py-1 px-1 text-xs text-left outline-none"
        onClick={onSwitch}
        disabled={isActive || switching}
      >
        {switching ? (
          <Loader2 size={12} className="animate-spin text-muted-foreground" />
        ) : isActive ? (
          <Check size={12} className="text-primary" />
        ) : (
          <GitBranch size={12} className="text-muted-foreground" />
        )}
        <span className={cn(isActive && 'font-medium')}>{branch.name}</span>
      </button>

      {branch.name !== 'main' && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <ActionButton title="Merge into main" onClick={onMerge}>
            <GitMerge size={11} />
          </ActionButton>
          <ActionButton title="Reset to main" onClick={onReset}>
            <RotateCcw size={11} />
          </ActionButton>
          <ActionButton title="Delete branch" onClick={onDelete} destructive>
            <Trash2 size={11} />
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children,
  title,
  onClick,
  destructive,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        'rounded p-0.5 transition-colors',
        destructive
          ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
