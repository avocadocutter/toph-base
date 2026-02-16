import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, projectAdminPath } from '@/lib/api-client';
import { useProjectStore } from '@/stores/project-store';
import type { Project } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { RefreshCw, Plug, Copy, Check, Eye, EyeOff, RotateCcw } from 'lucide-react';

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
          {visible ? value : '•'.repeat(40)}
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
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const currentProject = useProjectStore((s) => s.currentProject);

  const projectDetail = useQuery({
    queryKey: ['project-detail', currentProject?.ref],
    queryFn: () => api.get<Project>(`/platform/projects/${currentProject!.ref}`),
    enabled: !!currentProject?.ref,
  });

  const regenerateKeys = useMutation({
    mutationFn: () =>
      api.post<{ anonKey: string; serviceRoleKey: string }>(
        `/platform/projects/${currentProject!.ref}/regenerate-keys`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-detail', currentProject?.ref] });
      toast.success('API keys regenerated. Previous keys are now invalid.');
    },
    onError: (err) => toast.error(err.message),
  });

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () =>
      api.get<{
        status: string;
        database: { connected: boolean; version: string };
        timestamp: string;
      }>('/health'),
  });

  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get<Record<string, unknown>>('/platform/admin/settings'),
  });

  const extensions = useQuery({
    queryKey: ['admin-extensions'],
    queryFn: () =>
      api.get<{
        installed: { name: string; version: string }[];
        available: { name: string; default_version: string; comment: string }[];
      }>('/platform/admin/extensions'),
  });

  const enableExtension = useMutation({
    mutationFn: (name: string) => api.post(`/platform/admin/extensions/${name}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-extensions'] });
      toast.success('Extension enabled');
    },
    onError: (err) => toast.error(err.message),
  });

  const refreshSchema = useMutation({
    mutationFn: () => api.post(projectAdminPath('/schema/refresh')),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success('Schema cache refreshed');
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">Settings</h1>

      {/* API Keys */}
      {currentProject && projectDetail.data && (
        <section className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">API Keys</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use these keys to authenticate client requests to your project.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm('Regenerate all API keys? Existing keys will stop working immediately.')) {
                  regenerateKeys.mutate();
                }
              }}
              disabled={regenerateKeys.isPending}
            >
              <RotateCcw size={14} />
              Regenerate
            </Button>
          </div>
          <div className="space-y-3">
            {projectDetail.data.anonKey && (
              <ApiKeyRow
                label="Publishable key (anon) — safe for browsers and client-side code"
                value={projectDetail.data.anonKey}
              />
            )}
            {projectDetail.data.serviceRoleKey && (
              <ApiKeyRow
                label="Secret key (service_role) — server-side only, bypasses RLS"
                value={projectDetail.data.serviceRoleKey}
              />
            )}
          </div>
          <div className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <strong>Project ref:</strong> {currentProject.ref} &nbsp;·&nbsp;
            <strong>API URL:</strong> <code>/project/{currentProject.ref}/rest/v1</code>
          </div>
        </section>
      )}

      {/* Database Status */}
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Database</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Status</span>
            <Badge variant={health.data?.status === 'healthy' ? 'success' : 'destructive'}>
              {health.data?.status ?? 'Unknown'}
            </Badge>
          </div>
          {health.data?.database?.version && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Version</span>
              <span className="text-xs">{health.data.database.version.split(',')[0]}</span>
            </div>
          )}
        </div>
        {currentProject && (
          <Button size="sm" variant="outline" onClick={() => refreshSchema.mutate()}>
            <RefreshCw size={14} />
            Refresh Schema Cache
          </Button>
        )}
      </section>

      {/* Settings */}
      {settings.data && (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Configuration</h2>
          <div className="space-y-2">
            {Object.entries(settings.data).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{key}</span>
                <code className="rounded bg-muted px-2 py-0.5 text-xs">{JSON.stringify(value)}</code>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Extensions */}
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Installed Extensions</h2>
        <div className="space-y-1">
          {extensions.data?.installed.map((ext) => (
            <div key={ext.name} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Plug size={12} className="text-success" />
                <span>{ext.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">v{ext.version}</span>
            </div>
          ))}
        </div>
      </section>

      {extensions.data && extensions.data.available.length > 0 && (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Available Extensions</h2>
          <div className="space-y-1">
            {extensions.data.available.slice(0, 20).map((ext) => (
              <div key={ext.name} className="flex items-center justify-between text-sm">
                <div>
                  <span>{ext.name}</span>
                  {ext.comment && (
                    <p className="text-xs text-muted-foreground">{ext.comment}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => enableExtension.mutate(ext.name)}
                >
                  Enable
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
