/**
 * Formats a project-specific API URL in Supabase-compatible subdomain format.
 *
 * Format: https://{ref}.example.com
 *
 * @param projectRef - The project reference ID
 * @param baseUrl - Base URL (e.g., "https://api.example.com" or "http://localhost:8000")
 * @returns The formatted project URL with subdomain
 */
export function formatProjectApiUrl(projectRef: string, baseUrl: string): string {
  const url = new URL(baseUrl);
  const baseDomain = url.hostname;
  const subdomain = `${projectRef}.${baseDomain}`;
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${subdomain}${port}`;
}
