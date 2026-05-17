import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { BookOpen, Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface TophbaseStatus {
  configured: boolean;
  dialect: string | null;
  version: string;
  url: string;
  publishableKey: string;
}

export function DocsPage() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['tophbase-status'],
    queryFn: () => api.get<TophbaseStatus>('/tophbase/status'),
  });

  const apiUrl = status?.url ? `${status.url}/rest/v1` : 'http://localhost:8000/rest/v1';
  const publishableKey = status?.publishableKey ?? 'YOUR_PUBLISHABLE_KEY';

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const CodeBlock = ({ code, id }: { code: string; id: string }) => (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-4 text-sm">
        <code>{code}</code>
      </pre>
      <button
        onClick={() => copyToClipboard(code, id)}
        className="absolute right-2 top-2 rounded-md bg-background p-2 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
      >
        {copiedId === id ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-8 flex items-center gap-3">
          <BookOpen size={32} className="text-primary" />
          <div>
            <h1 className="text-3xl font-bold">API Documentation</h1>
            <p className="text-sm text-muted-foreground">
              Connect to your Tophbase database using the Supabase-compatible REST API
            </p>
          </div>
        </div>

        {/* Quickstart */}
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Quickstart</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Use the <code className="rounded bg-muted px-1">@supabase/supabase-js</code> client to connect:
          </p>
          <CodeBlock
            code={`import { createClient } from '@supabase/supabase-js'

const supabase = createClient('${status?.url ?? 'http://localhost:8000'}', '${publishableKey}')`}
            id="quickstart"
          />
        </section>

        {/* Base URL */}
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">REST API Base URL</h2>
          <CodeBlock code={apiUrl} id="base-url" />
        </section>

        {/* Authentication */}
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Authentication</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Include your publishable key in the <code className="rounded bg-muted px-1">apikey</code> header for every request.
          </p>
          <CodeBlock code={publishableKey} id="publishable-key" />
        </section>

        {/* CRUD Operations */}
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">CRUD Operations</h2>

          <div className="mb-6">
            <h3 className="mb-2 text-lg font-medium">Read (GET)</h3>
            <CodeBlock
              code={`curl '${apiUrl}/todos' \\
  -H 'apikey: ${publishableKey}'`}
              id="get-all"
            />
          </div>

          <div className="mb-6">
            <h3 className="mb-2 text-lg font-medium">Read with Filter</h3>
            <CodeBlock
              code={`curl '${apiUrl}/todos?done=eq.false' \\
  -H 'apikey: ${publishableKey}'`}
              id="get-filter"
            />
          </div>

          <div className="mb-6">
            <h3 className="mb-2 text-lg font-medium">Create (POST)</h3>
            <CodeBlock
              code={`curl -X POST '${apiUrl}/todos' \\
  -H 'apikey: ${publishableKey}' \\
  -H 'Content-Type: application/json' \\
  -d '{"task": "Build something awesome", "done": false}'`}
              id="post"
            />
          </div>

          <div className="mb-6">
            <h3 className="mb-2 text-lg font-medium">Update (PATCH)</h3>
            <CodeBlock
              code={`curl -X PATCH '${apiUrl}/todos?id=eq.1' \\
  -H 'apikey: ${publishableKey}' \\
  -H 'Content-Type: application/json' \\
  -d '{"done": true}'`}
              id="patch"
            />
          </div>

          <div className="mb-6">
            <h3 className="mb-2 text-lg font-medium">Delete (DELETE)</h3>
            <CodeBlock
              code={`curl -X DELETE '${apiUrl}/todos?id=eq.1' \\
  -H 'apikey: ${publishableKey}'`}
              id="delete"
            />
          </div>
        </section>

        {/* Query Parameters */}
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Query Parameters</h2>

          <div className="mb-4">
            <h3 className="mb-2 text-base font-medium">Filtering operators</h3>
            <div className="space-y-2 text-sm">
              {[
                ['eq', 'Equal to'],
                ['neq', 'Not equal to'],
                ['gt', 'Greater than'],
                ['gte', 'Greater than or equal'],
                ['lt', 'Less than'],
                ['lte', 'Less than or equal'],
                ['like', 'Pattern matching (case-sensitive)'],
                ['ilike', 'Pattern matching (case-insensitive)'],
                ['in', 'In a list of values'],
                ['is', 'Checking for null/true/false'],
              ].map(([op, desc]) => (
                <div key={op} className="flex gap-4">
                  <code className="w-20 rounded bg-muted px-2 py-1">{op}</code>
                  <span className="text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <h3 className="mb-2 text-base font-medium">Ordering, pagination, and selection</h3>
            <CodeBlock
              code={`# Order + paginate + select columns
curl '${apiUrl}/todos?order=id.desc&limit=10&offset=0&select=id,task' \\
  -H 'apikey: ${publishableKey}'`}
              id="order-page"
            />
          </div>
        </section>

        {/* Footer */}
        <section className="border-t border-border pt-6">
          <p className="text-sm text-muted-foreground">
            Tophbase v{status?.version ?? '0.1.0'} — Supabase-compatible REST API running locally.
          </p>
        </section>
      </div>
    </div>
  );
}
