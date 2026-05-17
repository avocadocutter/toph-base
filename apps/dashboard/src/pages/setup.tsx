import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api-client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DialectId = 'supabase' | 'pocketbase' | 'appwrite';

interface DialectOption {
  id: DialectId;
  name: string;
  description: string;
  snippet: string;
  available: boolean;
}

const DIALECTS: DialectOption[] = [
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'PostgreSQL + Auth + REST API',
    snippet: `import { createClient } from '@supabase/supabase-js'`,
    available: true,
  },
  {
    id: 'pocketbase',
    name: 'PocketBase',
    description: 'Embedded database + realtime',
    snippet: `import PocketBase from 'pocketbase'`,
    available: false,
  },
  {
    id: 'appwrite',
    name: 'Appwrite',
    description: 'Multi-database + services',
    snippet: `import { Client } from 'appwrite'`,
    available: false,
  },
];

export function SetupPage() {
  const [selected, setSelected] = useState<DialectId | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleStart = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await api.post('/tophbase/setup', { dialect: selected });
      navigate('/', { replace: true });
    } catch {
      toast.error('Setup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      {/* Branding */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Tophbase</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose the SDK dialect your app will use to connect.
        </p>
      </div>

      {/* Dialect cards */}
      <div className="flex w-full max-w-3xl flex-col gap-4 sm:flex-row">
        {DIALECTS.map((dialect) => (
          <button
            key={dialect.id}
            onClick={() => dialect.available && setSelected(dialect.id)}
            disabled={!dialect.available}
            className={cn(
              'relative flex flex-1 flex-col gap-3 rounded-xl border p-6 text-left transition-all',
              dialect.available
                ? 'cursor-pointer hover:border-foreground/40'
                : 'cursor-not-allowed opacity-50',
              selected === dialect.id
                ? 'border-foreground bg-accent ring-2 ring-foreground/20'
                : 'border-border bg-card',
            )}
          >
            {!dialect.available && (
              <span className="absolute right-3 top-3 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Coming soon
              </span>
            )}

            <div>
              <p className="text-base font-semibold text-foreground">{dialect.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{dialect.description}</p>
            </div>

            <code className="mt-auto block rounded bg-muted px-3 py-2 text-[11px] font-mono text-muted-foreground">
              {dialect.snippet}
            </code>
          </button>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-8 flex flex-col items-center gap-3">
        <Button
          size="lg"
          disabled={!selected || loading}
          onClick={handleStart}
          className="min-w-[180px]"
        >
          {loading ? 'Setting up...' : 'Get started'}
        </Button>
        {selected && (
          <p className="text-xs text-muted-foreground">
            Using the <span className="font-medium text-foreground">{DIALECTS.find(d => d.id === selected)?.name}</span> dialect
          </p>
        )}
      </div>
    </div>
  );
}
