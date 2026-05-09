import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, projectAdminPath } from '@/lib/api-client';
import { useProjectStore } from '@/stores/project-store';
import type { Project } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { RefreshCw, Plug, Copy, Check, Eye, EyeOff, RotateCcw, Save, AlertCircle, CheckCircle } from 'lucide-react';

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
      api.post<{ publishableKey: string; secretKey: string }>(
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

  const [postgrestUrl, setPostgrestUrl] = useState('');
  const [isEditingPostgrest, setIsEditingPostgrest] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const updatePostgrestUrl = useMutation({
    mutationFn: (url: string | null) =>
      api.patch(`/platform/projects/${currentProject!.ref}`, {
        postgrestUrl: url || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-detail', currentProject?.ref] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setIsEditingPostgrest(false);
      toast.success('PostgREST URL updated');
    },
    onError: (err) => toast.error(err.message),
  });

  const regenerateJwtSecret = useMutation({
    mutationFn: () =>
      api.post<{ jwtSecret: string; message: string }>(
        `/platform/projects/${currentProject!.ref}/regenerate-jwt-secret`,
        {},
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['project-detail', currentProject?.ref] });
      toast.success(data.message);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">Settings</h1>

      {/* Loading State */}
      {projectDetail.isLoading && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading project details...</p>
        </div>
      )}

      {/* Error Display */}
      {projectDetail.isError && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="font-semibold text-red-600 dark:text-red-400">Failed to load project details</h3>
              <p className="text-sm text-red-600/80 dark:text-red-400/80">
                {projectDetail.error?.message || 'An unknown error occurred'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* API Keys */}
      {currentProject && projectDetail.data && (
        <section className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">API Keys</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use these keys to authenticate requests to your project.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm('Regenerate API keys? Existing keys will stop working immediately.')) {
                  regenerateKeys.mutate();
                }
              }}
              disabled={regenerateKeys.isPending}
            >
              <RotateCcw size={14} />
              Regenerate Keys
            </Button>
          </div>

          <div className="space-y-3">
            {projectDetail.data.publishableKey ? (
              <ApiKeyRow
                label="Publishable key — safe for browsers, mobile apps, and public repositories"
                value={projectDetail.data.publishableKey}
              />
            ) : (
              <div className="rounded bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs">
                <strong className="text-yellow-600 dark:text-yellow-400">No publishable key found.</strong>
                <span className="text-muted-foreground">
                  {' '}Click "Regenerate Keys" to generate new API keys.
                </span>
              </div>
            )}
            {projectDetail.data.secretKey ? (
              <ApiKeyRow
                label="Secret key — server-side only, bypasses RLS, automatically blocked from browsers"
                value={projectDetail.data.secretKey}
              />
            ) : (
              <div className="rounded bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs">
                <strong className="text-yellow-600 dark:text-yellow-400">No secret key found.</strong>
                <span className="text-muted-foreground">
                  {' '}Click "Regenerate Keys" to generate new API keys.
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Project Reference:</span>
              <code className="rounded bg-muted px-2 py-1 text-xs font-mono">
                {currentProject.ref}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(currentProject.ref);
                  setCopiedId('project-ref');
                  setTimeout(() => setCopiedId(null), 2000);
                }}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Copy project ref"
              >
                {copiedId === 'project-ref' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Database Name:</span>
              <code className="rounded bg-muted px-2 py-1 text-xs font-mono">
                {currentProject.dbName}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(currentProject.dbName);
                  setCopiedId('db-name');
                  setTimeout(() => setCopiedId(null), 2000);
                }}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Copy schema name"
              >
                {copiedId === 'db-name' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* PostgREST Configuration */}
      {currentProject && projectDetail.data && (
        <section className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div>
            <h2 className="text-sm font-semibold">PostgREST Configuration</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure the PostgREST instance URL for your project's REST API.
            </p>
          </div>

          {/* Health Status */}
          {projectDetail.data.postgrestHealth && (
            <div className="flex items-center gap-2 text-sm">
              {projectDetail.data.postgrestHealth.isHealthy ? (
                <>
                  <CheckCircle size={16} className="text-green-500" />
                  <span className="text-green-600 dark:text-green-400">PostgREST instance is healthy</span>
                </>
              ) : (
                <>
                  <AlertCircle size={16} className="text-red-500" />
                  <span className="text-red-600 dark:text-red-400">
                    PostgREST instance is not responding
                    {projectDetail.data.postgrestHealth.lastError && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({projectDetail.data.postgrestHealth.lastError})
                      </span>
                    )}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Configuration Values */}
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Database Name</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-1.5 text-xs font-mono">
                  {currentProject.dbName}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(currentProject.dbName);
                    setCopiedId('postgrest-db');
                    setTimeout(() => setCopiedId(null), 2000);
                  }}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Copy schema name"
                >
                  {copiedId === 'postgrest-db' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            {projectDetail.data?.jwtSecret && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">JWT Secret</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm(
                        '⚠️ WARNING: Regenerating the JWT secret will:\n\n' +
                        '• Invalidate ALL user sessions immediately\n' +
                        '• Require restarting PostgREST with the new secret\n' +
                        '• Break your application until PostgREST is updated\n\n' +
                        'Are you sure you want to continue?'
                      )) {
                        regenerateJwtSecret.mutate();
                      }
                    }}
                    disabled={regenerateJwtSecret.isPending}
                  >
                    <RotateCcw size={12} />
                    Regenerate
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-1.5 text-xs font-mono truncate">
                    {projectDetail.data.jwtSecret}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(projectDetail.data.jwtSecret!);
                      setCopiedId('jwt-secret');
                      setTimeout(() => setCopiedId(null), 2000);
                    }}
                    className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Copy JWT secret"
                  >
                    {copiedId === 'jwt-secret' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">PostgREST URL</span>
              {isEditingPostgrest ? (
                <div className="space-y-2">
                  <Input
                    type="url"
                    placeholder="http://localhost:9001"
                    value={postgrestUrl}
                    onChange={(e) => setPostgrestUrl(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => updatePostgrestUrl.mutate(postgrestUrl)}
                      disabled={updatePostgrestUrl.isPending}
                    >
                      <Save size={14} />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsEditingPostgrest(false);
                        setPostgrestUrl(projectDetail.data?.postgrestUrl || '');
                      }}
                    >
                      Cancel
                    </Button>
                    {projectDetail.data.postgrestUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm('Remove PostgREST URL? The REST API will not be available until a new URL is configured.')) {
                            updatePostgrestUrl.mutate(null);
                          }
                        }}
                        disabled={updatePostgrestUrl.isPending}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-1.5 text-xs font-mono">
                    {projectDetail.data.postgrestUrl || 'Not configured'}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPostgrestUrl(projectDetail.data?.postgrestUrl || '');
                      setIsEditingPostgrest(true);
                    }}
                  >
                    Edit
                  </Button>
                </div>
              )}
            </div>
          </div>

          {!projectDetail.data.postgrestUrl && (
            <div className="rounded bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs">
              <strong className="text-yellow-600 dark:text-yellow-400">No PostgREST instance configured.</strong>
              <span className="text-muted-foreground">
                {' '}The REST API endpoint (<code>/rest/v1/*</code>) will return a 503 error until you configure a PostgREST URL.
              </span>
            </div>
          )}

          <div className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
            <div><strong>Example docker command:</strong></div>
            <code className="block whitespace-pre-wrap break-all">
              {(() => {
                const hostPort = projectDetail.data?.postgrestUrl
                  ? new URL(projectDetail.data.postgrestUrl).port || '3000'
                  : '3000';
                return `docker run --rm -p ${hostPort}:3000 \\\n` +
                  `  -e PGRST_DB_URI="postgres://authenticator:changeme@host.docker.internal:5432/${currentProject.dbName}" \\\n` +
                  `  -e PGRST_DB_SCHEMAS="public" \\\n` +
                  `  -e PGRST_DB_ANON_ROLE="anon" \\\n` +
                  (projectDetail.data?.jwtSecret ? `  -e PGRST_JWT_SECRET="${projectDetail.data.jwtSecret}" \\\n` : '') +
                  `  postgrest/postgrest`;
              })()}
            </code>
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
