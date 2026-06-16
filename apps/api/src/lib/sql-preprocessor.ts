/**
 * SQL preprocessor for Supabase → toph-base migration compatibility.
 *
 * Rules are derived directly from the Supabase CLI source:
 *   apps/cli-go/pkg/migration/dump.go        (InternalSchemas list)
 *   apps/cli-go/pkg/migration/scripts/dump_schema.sh  (sed substitutions)
 *
 * The Supabase CLI applies these transforms when producing a migration file.
 * For migrations produced by older CLI versions or tools like pg_dump directly,
 * toph-base applies them at apply-time so the user never has to touch the file.
 */

// ── Supabase InternalSchemas (verbatim from dump.go) ─────────────────────────
// Any trigger, grant, or DDL referencing one of these schemas is platform
// infrastructure and should be dropped.
const INTERNAL_SCHEMA_PATTERNS: RegExp[] = [
  /^information_schema$/i,
  /^pg_/i,             // pg_* wildcard
  /^_analytics$/i,
  /^_realtime$/i,
  /^_supavisor$/i,
  /^auth$/i,
  /^etl$/i,
  /^extensions$/i,
  /^pgbouncer$/i,
  /^realtime$/i,
  /^storage$/i,
  /^supabase_functions$/i,
  /^supabase_migrations$/i,
  /^cron$/i,
  /^dbdev$/i,
  /^graphql$/i,
  /^graphql_public$/i,
  /^net$/i,
  /^pgmq$/i,
  /^pgsodium$/i,
  /^pgsodium_masks$/i,
  /^pgtle$/i,
  /^repack$/i,
  /^tiger$/i,
  /^tiger_data$/i,
  /^timescaledb_/i,    // timescaledb_* wildcard
  /^_timescaledb_/i,   // _timescaledb_* wildcard
  /^topology$/i,
  /^vault$/i,
];

function isInternalSchema(schema: string): boolean {
  return INTERNAL_SCHEMA_PATTERNS.some(p => p.test(schema));
}

// ── Extensions stubbed by toph-base bootstrap ─────────────────────────────────
const STUBBED_EXTENSIONS = new Set([
  'pgjwt', 'supabase_vault', 'vault', 'pg_net', 'pg_graphql', 'pg_jsonschema',
  'pg_cron', 'pgsodium', 'supautils', 'pg_safeupdate', 'pgaudit', 'rum',
  'plv8', 'pgroonga', 'wrappers', 'pg_partman', 'pg_repack', 'pg_tle',
  'orioledb', 'http', 'pg_stat_monitor', 'hypopg', 'index_advisor',
  'pg_stat_statements',
]);

// ── Statement splitter ────────────────────────────────────────────────────────
// Walks character-by-character understanding PostgreSQL quoting so semicolons
// inside string literals and function bodies are not treated as terminators.
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // Line comment
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      if (end === -1) { current += sql.slice(i); i = sql.length; }
      else { current += sql.slice(i, end + 1); i = end + 1; }
      continue;
    }

    // Block comment (PostgreSQL supports nesting)
    if (ch === '/' && sql[i + 1] === '*') {
      let depth = 1, j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      current += sql.slice(i, j); i = j;
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") { j++; break; }
        else j++;
      }
      current += sql.slice(i, j); i = j;
      continue;
    }

    // Dollar-quoted string  $$...$$  or  $tag$...$tag$
    if (ch === '$') {
      const tagEnd = sql.indexOf('$', i + 1);
      if (tagEnd !== -1) {
        const tag = sql.slice(i, tagEnd + 1);
        const closeTag = sql.indexOf(tag, tagEnd + 1);
        if (closeTag !== -1) {
          current += sql.slice(i, closeTag + tag.length);
          i = closeTag + tag.length;
          continue;
        }
      }
      current += ch; i++;
      continue;
    }

    // Double-quoted identifier
    if (ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') { j++; break; }
        else j++;
      }
      current += sql.slice(i, j); i = j;
      continue;
    }

    // Semicolon — end of statement
    if (ch === ';') {
      current += ch;
      const trimmed = current.trim();
      if (trimmed && trimmed !== ';') statements.push(trimmed);
      current = ''; i++;
      continue;
    }

    current += ch; i++;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

// ── Per-statement rules (mirrors dump_schema.sh sed substitutions) ────────────
function processStatement(stmt: string): string | null {

  // CREATE / DROP / ALTER TRIGGER on an internal schema → drop
  if (/^(CREATE(\s+OR\s+REPLACE)?\s+TRIGGER|DROP\s+TRIGGER)\b/i.test(stmt)) {
    const m = stmt.match(/\bON\s+"?(\w+)"?\."?\w+"?/i);
    if (m && isInternalSchema(m[1])) return null;
  }

  // CREATE / DROP PUBLICATION supabase_realtime → drop
  if (/^(CREATE|DROP)\s+PUBLICATION\s+"?supabase_realtime/i.test(stmt)) return null;

  // ALTER PUBLICATION supabase_realtime → drop
  if (/^ALTER\s+PUBLICATION\s+"?supabase_realtime/i.test(stmt)) return null;

  // CREATE / ALTER / DROP EVENT TRIGGER → drop
  if (/^(CREATE|ALTER|DROP)\s+EVENT\s+TRIGGER\b/i.test(stmt)) return null;

  // COMMENT ON EXTENSION → drop
  if (/^COMMENT\s+ON\s+EXTENSION\b/i.test(stmt)) return null;

  // ALTER TABLE "cron".* → drop
  if (/^ALTER\s+TABLE\s+"?cron"?\./i.test(stmt)) return null;

  // CREATE POLICY "cron_job_... → drop
  if (/^CREATE\s+POLICY\s+"cron_job_/i.test(stmt)) return null;

  // SET transaction_timeout → drop (PostgreSQL 17 only, not broadly supported)
  if (/^SET\s+transaction_timeout\b/i.test(stmt)) return null;

  // SET search_path / set_config('search_path', ...) → drop.
  // pg_dump injects these as session setup for the dump process — they are not
  // part of the schema. In PGlite's single-connection model the setting persists
  // after the migration and breaks all subsequent unqualified table references.
  if (/^SET\s+search_path\b/i.test(stmt)) return null;
  if (/set_config\s*\(\s*'search_path'/i.test(stmt)) return null;

  // OWNER TO "postgres" — whole statement is platform artifact
  if (/\bOWNER\s+TO\s+"?postgres"?/i.test(stmt)) return null;

  // ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" or "supabase_admin"
  if (/^ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+"?(postgres|supabase_admin)"?/i.test(stmt)) return null;

  // GRANT ALL ON FOREIGN DATA WRAPPER ... TO "postgres"
  if (/^GRANT\s+ALL\s+ON\s+FOREIGN\s+DATA\s+WRAPPER\b/i.test(stmt)) return null;

  // ALTER FOREIGN DATA WRAPPER ... OWNER TO
  if (/^ALTER\s+FOREIGN\s+DATA\s+WRAPPER\b/i.test(stmt)) return null;

  // GRANT / REVOKE on an internal schema
  if (/^(GRANT|REVOKE)\b/i.test(stmt)) {
    const m = stmt.match(/\bON\s+\w+\s+"?(\w+)"?\./i) ??
               stmt.match(/\bIN\s+SCHEMA\s+"?(\w+)"?/i);
    if (m && isInternalSchema(m[1])) return null;
    // Also drop any grant to "postgres" specifically
    if (/\bTO\s+"?postgres"?/i.test(stmt)) return null;
  }

  // CREATE EXTENSION for stubbed extensions → drop
  const extMatch = stmt.match(
    /^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([\w-]+)["']?/i,
  );
  if (extMatch && STUBBED_EXTENSIONS.has(extMatch[1].toLowerCase())) return null;

  // extensions.uuid_generate_v4() → gen_random_uuid()
  stmt = stmt.replace(/"?extensions"?\."?uuid_generate_v4"?\(\)/gi, 'gen_random_uuid()');

  return stmt;
}

export function preprocessMigrationSql(sql: string): string {
  return splitStatements(sql)
    .map(processStatement)
    .filter((s): s is string => s !== null)
    .join('\n\n');
}
