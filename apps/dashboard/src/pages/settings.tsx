import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { RefreshCw, Plug } from 'lucide-react';

export function SettingsPage() {
  const queryClient = useQueryClient();

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
    queryFn: () => api.get<Record<string, unknown>>('/admin/settings'),
  });

  const extensions = useQuery({
    queryKey: ['admin-extensions'],
    queryFn: () =>
      api.get<{
        installed: { name: string; version: string }[];
        available: { name: string; default_version: string; comment: string }[];
      }>('/admin/extensions'),
  });

  const enableExtension = useMutation({
    mutationFn: (name: string) => api.post(`/admin/extensions/${name}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-extensions'] });
      toast.success('Extension enabled');
    },
    onError: (err) => toast.error(err.message),
  });

  const refreshSchema = useMutation({
    mutationFn: () => api.post('/admin/schema/refresh'),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success('Schema cache refreshed');
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">Settings</h1>

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
        <Button size="sm" variant="outline" onClick={() => refreshSchema.mutate()}>
          <RefreshCw size={14} />
          Refresh Schema Cache
        </Button>
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
