import { useProjectStore } from '@/stores/project-store';
import { BookOpen, Copy, Check } from 'lucide-react';
import { useState } from 'react';

/**
 * Formats the project API URL in Supabase-compatible subdomain format.
 * Format: https://{ref}.example.com
 */
function formatProjectApiUrl(projectRef: string): string {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;

  // API gateway runs on port 8000, not the dashboard port (3000)
  const apiPort = '8000';

  // Subdomain format: https://{ref}.example.com
  const subdomain = `${projectRef}.${hostname}`;

  return `${protocol}//${subdomain}:${apiPort}`;
}

export function DocsPage() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Generate Supabase-compatible project URL
  const projectUrl = currentProject?.ref
    ? formatProjectApiUrl(currentProject.ref)
    : `${window.location.protocol}//${window.location.host}`;
  const apiUrl = `${projectUrl}/rest/v1`;

  const publishableKey = currentProject?.publishableKey || 'YOUR_PUBLISHABLE_KEY';
  const secretKey = currentProject?.secretKey || 'YOUR_SECRET_KEY';

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
              Learn how to connect and interact with your database via REST API
            </p>
          </div>
        </div>

        {!currentProject && (
          <div className="mb-6 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4 text-sm text-yellow-600 dark:text-yellow-400">
            Please select a project to see project-specific examples with your API keys.
          </div>
        )}

        {/* Base URL */}
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Project URL</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Your project has a unique subdomain URL in Supabase-compatible format:
          </p>
          <CodeBlock code={projectUrl} id="project-url" />
          {currentProject?.ref && (
            <div className="mt-3 rounded-md border border-blue-500/50 bg-blue-500/10 p-3 text-sm">
              <p className="mb-2 font-medium text-blue-600 dark:text-blue-400">
                Subdomain Format
              </p>
              <p className="text-xs text-blue-600/80 dark:text-blue-400/80">
                Each project gets a unique subdomain:{' '}
                <code className="rounded bg-blue-500/20 px-1">https://{'{ref}'}.{window.location.hostname}</code>
                <br />
                <span className="mt-1 inline-block">
                  Your project ref: <code className="rounded bg-blue-500/20 px-1">{currentProject.ref}</code>
                </span>
              </p>
            </div>
          )}

          <h3 className="mb-2 mt-6 text-lg font-semibold">API Base URL</h3>
          <p className="mb-3 text-sm text-muted-foreground">
            All REST API requests should be made to:
          </p>
          <CodeBlock code={apiUrl} id="base-url" />
        </section>

        {/* Authentication */}
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Authentication</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Include your API key in the <code className="rounded bg-muted px-1">apikey</code> header
            for every request. Use the <strong>publishable key</strong> for client-side requests and the{' '}
            <strong>secret key</strong> for server-side requests with elevated privileges.
          </p>

          <div className="mb-4 rounded-md border border-blue-500/50 bg-blue-500/10 p-3 text-sm">
            <p className="mb-2 font-medium text-blue-600 dark:text-blue-400">
              Project Identification
            </p>
            <p className="text-xs text-blue-600/80 dark:text-blue-400/80">
              Your project is identified by the <strong>API key</strong>, not the subdomain in the URL.
              The subdomain format is for Supabase compatibility, but project resolution happens via
              the API key lookup. You can use any subdomain as long as the API key is correct.
            </p>
          </div>

          <div className="mb-4">
            <h3 className="mb-2 text-sm font-medium">
              Publishable Key (Client-side)
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Safe for browsers, mobile apps, and public repositories. Subject to Row Level Security policies.
            </p>
            <CodeBlock code={publishableKey} id="publishable-key" />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">
              Secret Key (Server-side only)
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Never expose in client code. Bypasses Row Level Security. Automatically blocked from browsers.
            </p>
            <CodeBlock code={secretKey} id="secret-key" />
          </div>
        </section>

        {/* CRUD Operations */}
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">CRUD Operations</h2>

          {/* Read */}
          <div className="mb-6">
            <h3 className="mb-2 text-lg font-medium">Read (GET)</h3>
            <p className="mb-3 text-sm text-muted-foreground">Fetch all rows from a table:</p>
            <CodeBlock
              code={`# First, create a table in the SQL Editor
# CREATE TABLE todos (id SERIAL PRIMARY KEY, task TEXT, done BOOLEAN DEFAULT false);

curl '${apiUrl}/todos' \\
  -H 'apikey: ${publishableKey}'`}
              id="get-all"
            />
          </div>

          {/* Read with filter */}
          <div className="mb-6">
            <h3 className="mb-2 text-lg font-medium">Read with Filter</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Use query parameters to filter results:
            </p>
            <CodeBlock
              code={`curl '${apiUrl}/todos?done=eq.false' \\
  -H 'apikey: ${publishableKey}'`}
              id="get-filter"
            />
          </div>

          {/* Create */}
          <div className="mb-6">
            <h3 className="mb-2 text-lg font-medium">Create (POST)</h3>
            <p className="mb-3 text-sm text-muted-foreground">Insert a new row:</p>
            <CodeBlock
              code={`curl -X POST '${apiUrl}/todos' \\
  -H 'apikey: ${secretKey}' \\
  -H 'Content-Type: application/json' \\
  -d '{"task": "Build something awesome", "done": false}'`}
              id="post"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Note: Using secret key for write operations. Publishable key can be used if RLS policies allow.
            </p>
          </div>

          {/* Update */}
          <div className="mb-6">
            <h3 className="mb-2 text-lg font-medium">Update (PATCH)</h3>
            <p className="mb-3 text-sm text-muted-foreground">Update rows matching a filter:</p>
            <CodeBlock
              code={`curl -X PATCH '${apiUrl}/todos?id=eq.1' \\
  -H 'apikey: ${secretKey}' \\
  -H 'Content-Type: application/json' \\
  -d '{"done": true}'`}
              id="patch"
            />
          </div>

          {/* Delete */}
          <div className="mb-6">
            <h3 className="mb-2 text-lg font-medium">Delete (DELETE)</h3>
            <p className="mb-3 text-sm text-muted-foreground">Delete rows matching a filter:</p>
            <CodeBlock
              code={`curl -X DELETE '${apiUrl}/todos?id=eq.1' \\
  -H 'apikey: ${secretKey}'`}
              id="delete"
            />
          </div>
        </section>

        {/* Query Parameters */}
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Query Parameters</h2>

          <div className="mb-4">
            <h3 className="mb-2 text-base font-medium">Filtering</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Filter results using column operators:
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex gap-4">
                <code className="w-20 rounded bg-muted px-2 py-1">eq</code>
                <span className="text-muted-foreground">Equal to</span>
              </div>
              <div className="flex gap-4">
                <code className="w-20 rounded bg-muted px-2 py-1">neq</code>
                <span className="text-muted-foreground">Not equal to</span>
              </div>
              <div className="flex gap-4">
                <code className="w-20 rounded bg-muted px-2 py-1">gt</code>
                <span className="text-muted-foreground">Greater than</span>
              </div>
              <div className="flex gap-4">
                <code className="w-20 rounded bg-muted px-2 py-1">gte</code>
                <span className="text-muted-foreground">Greater than or equal</span>
              </div>
              <div className="flex gap-4">
                <code className="w-20 rounded bg-muted px-2 py-1">lt</code>
                <span className="text-muted-foreground">Less than</span>
              </div>
              <div className="flex gap-4">
                <code className="w-20 rounded bg-muted px-2 py-1">lte</code>
                <span className="text-muted-foreground">Less than or equal</span>
              </div>
              <div className="flex gap-4">
                <code className="w-20 rounded bg-muted px-2 py-1">like</code>
                <span className="text-muted-foreground">Pattern matching (case-sensitive)</span>
              </div>
              <div className="flex gap-4">
                <code className="w-20 rounded bg-muted px-2 py-1">ilike</code>
                <span className="text-muted-foreground">Pattern matching (case-insensitive)</span>
              </div>
              <div className="flex gap-4">
                <code className="w-20 rounded bg-muted px-2 py-1">in</code>
                <span className="text-muted-foreground">In a list of values</span>
              </div>
              <div className="flex gap-4">
                <code className="w-20 rounded bg-muted px-2 py-1">is</code>
                <span className="text-muted-foreground">Checking for null/true/false</span>
              </div>
            </div>
            <div className="mt-3">
              <CodeBlock
                code={`# Multiple filters (AND logic)
curl '${apiUrl}/todos?done=eq.false&created_at=gte.2025-01-01' \\
  -H 'apikey: ${publishableKey}'`}
                id="filter-multi"
              />
            </div>
          </div>

          <div className="mb-4">
            <h3 className="mb-2 text-base font-medium">Ordering</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Sort results using the <code className="rounded bg-muted px-1">order</code> parameter:
            </p>
            <CodeBlock
              code={`# Ascending order
curl '${apiUrl}/todos?order=id.asc' \\
  -H 'apikey: ${publishableKey}'

# Descending order
curl '${apiUrl}/todos?order=id.desc' \\
  -H 'apikey: ${publishableKey}'`}
              id="order"
            />
          </div>

          <div className="mb-4">
            <h3 className="mb-2 text-base font-medium">Pagination</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Use <code className="rounded bg-muted px-1">limit</code> and{' '}
              <code className="rounded bg-muted px-1">offset</code> for pagination:
            </p>
            <CodeBlock
              code={`curl '${apiUrl}/todos?limit=10&offset=20' \\
  -H 'apikey: ${publishableKey}'`}
              id="pagination"
            />
          </div>

          <div className="mb-4">
            <h3 className="mb-2 text-base font-medium">Column Selection</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Select specific columns using the <code className="rounded bg-muted px-1">select</code>{' '}
              parameter:
            </p>
            <CodeBlock
              code={`curl '${apiUrl}/todos?select=id,task,done' \\
  -H 'apikey: ${publishableKey}'`}
              id="select"
            />
          </div>
        </section>

        {/* Response Format */}
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Response Format</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            All responses are returned as JSON arrays:
          </p>
          <CodeBlock
            code={`[
  {
    "id": 1,
    "task": "Build something awesome",
    "done": false
  },
  {
    "id": 2,
    "task": "Write documentation",
    "done": true
  }
]`}
            id="response"
          />
        </section>

        {/* Footer */}
        <section className="border-t border-border pt-6">
          <p className="text-sm text-muted-foreground">
            The REST API is built into toph-base. See{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">apps/api/src/plugins/rest-api/README.md</code>
            {' '}for supported features, gaps, and how to extend it.
          </p>
        </section>
      </div>
    </div>
  );
}
