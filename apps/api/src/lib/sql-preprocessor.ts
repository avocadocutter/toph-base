// Extensions handled by Tophbase's compatibility layer (SQL stubs or not available).
// CREATE EXTENSION calls for these are stripped from migrations — the schema/functions
// are already set up at bootstrap, or a clear runtime error is provided.
const STUBBED_EXTENSIONS = new Set([
  'pgjwt',
  'supabase_vault',
  'vault',
  'pg_net',
  'pg_graphql',
  'pg_jsonschema',
  'pg_cron',
  'pgsodium',
  'supautils',
  'pg_safeupdate',
  'pgaudit',
  'rum',
  'plv8',
  'pgroonga',
  'wrappers',
  'pg_partman',
  'pg_repack',
  'pg_tle',
  'orioledb',
  'http',
  'pg_stat_monitor',
  'hypopg',
  'index_advisor',
]);

// Strip CREATE EXTENSION calls for stub-handled extensions.
// Real extensions (pgcrypto, vector, uuid-ossp, etc.) pass through unchanged.
export function preprocessMigrationSql(sql: string): string {
  return sql.replace(
    /CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([\w-]+)["']?(?:\s+WITH\s+SCHEMA\s+\w+)?(?:\s+VERSION\s+['"][\w.]+['"])?(?:\s+CASCADE)?\s*;/gi,
    (match, name: string) => {
      if (STUBBED_EXTENSIONS.has(name.toLowerCase())) {
        return `-- tophbase-compat: "${name}" handled by compatibility layer`;
      }
      return match;
    },
  );
}
