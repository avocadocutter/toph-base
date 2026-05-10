import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, FolderOpen, Copy, Check } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useProjectStore } from '@/stores/project-store';
import type { Project } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setProject = useProjectStore((s) => s.setProject);
  const currentProject = useProjectStore((s) => s.currentProject);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<Project[]>('/platform/projects'),
  });

  const createProject = useMutation({
    mutationFn: (body: { name: string; ref?: string }) =>
      api.post<Project>('/platform/projects', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowCreate(false);
      setName('');
      setRef('');
      toast.success('Project created');
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!name) return;
    createProject.mutate({ name, ref: ref || undefined });
  };

  const handleSelect = (project: Project) => {
    setProject(project);
    navigate('/');
  };

  const copyKey = (key: string, label: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {currentProject && (
            <button
              onClick={() => navigate(-1)}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <h1 className="text-lg font-bold">Projects</h1>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus size={14} />
          New Project
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Ref (optional)</label>
              <Input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="my-project"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={!name || createProject.isPending}>
              Create
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading projects...</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {projects?.map((project) => (
          <div
            key={project.id}
            className="cursor-pointer rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent"
            onClick={() => handleSelect(project)}
          >
            <div className="flex items-center gap-2">
              <FolderOpen size={16} className="text-muted-foreground" />
              <span className="font-medium">{project.name}</span>
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {project.status}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">ref: {project.ref}</p>

            {(project.publishableKey || project.secretKey) && (
              <div className="mt-3 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                {project.publishableKey && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-16 shrink-0">publishable</span>
                    <code className="flex-1 truncate rounded bg-muted px-2 py-0.5 text-[10px]">
                      {project.publishableKey}
                    </code>
                    <button
                      onClick={() => copyKey(project.publishableKey!, `pub-${project.id}`)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {copiedKey === `pub-${project.id}` ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                )}
                {project.secretKey && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-16 shrink-0">secret</span>
                    <code className="flex-1 truncate rounded bg-muted px-2 py-0.5 text-[10px]">
                      {project.secretKey}
                    </code>
                    <button
                      onClick={() => copyKey(project.secretKey!, `secret-${project.id}`)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {copiedKey === `secret-${project.id}` ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {projects && projects.length === 0 && !isLoading && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No projects yet. Create one to get started.
        </div>
      )}
    </div>
  );
}
