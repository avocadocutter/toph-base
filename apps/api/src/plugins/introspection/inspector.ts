import type { DbPool } from '../../db/pool.js';
import type { TableInfo, ColumnInfo, ForeignKeyInfo, SchemaCache } from './types.js';

const CACHE_TTL_MS = 60_000; // 60 seconds

const cacheMap = new Map<string, SchemaCache>();

export async function introspectSchema(db: DbPool, schemaName: string, cacheKey?: string): Promise<Map<string, TableInfo>> {
  const key = cacheKey ?? schemaName;
  const now = Date.now();
  const cached = cacheMap.get(key);
  if (cached && cached.lastUpdated > 0 && now - cached.lastUpdated < CACHE_TTL_MS) {
    return cached.tables;
  }

  const tables = await fetchTables(db, schemaName);
  const columns = await fetchColumns(db, schemaName);
  const primaryKeys = await fetchPrimaryKeys(db, schemaName);
  const foreignKeys = await fetchForeignKeys(db, schemaName);
  const rlsStatus = await fetchRlsStatus(db, schemaName);

  const tableMap = new Map<string, TableInfo>();

  for (const table of tables) {
    const tableCols = columns
      .filter(c => c.table_name === table.table_name)
      .map((c): ColumnInfo => ({
        name: c.column_name,
        dataType: c.data_type,
        udtName: c.udt_name,
        isNullable: c.is_nullable === 'YES',
        columnDefault: c.column_default,
        maxLength: c.character_maximum_length,
        isIdentity: c.is_identity === 'YES',
        isPrimaryKey: false,
      }));

    const pks = primaryKeys
      .filter(pk => pk.table_name === table.table_name)
      .map(pk => pk.column_name);

    for (const col of tableCols) {
      col.isPrimaryKey = pks.includes(col.name);
    }

    const fks: ForeignKeyInfo[] = foreignKeys
      .filter(fk => fk.table_name === table.table_name)
      .map(fk => ({
        columnName: fk.column_name,
        foreignTable: fk.foreign_table,
        foreignColumn: fk.foreign_column,
        constraintName: fk.constraint_name,
      }));

    const rls = rlsStatus.find(r => r.relname === table.table_name);

    tableMap.set(table.table_name, {
      schema: schemaName,
      name: table.table_name,
      type: table.table_type === 'BASE TABLE' ? 'table' : 'view',
      columns: tableCols,
      primaryKey: pks,
      foreignKeys: fks,
      rlsEnabled: rls?.relrowsecurity ?? false,
      rlsForced: rls?.relforcerowsecurity ?? false,
    });
  }

  cacheMap.set(key, { tables: tableMap, lastUpdated: now });
  return tableMap;
}

export function invalidateCache(schemaName?: string) {
  if (schemaName && schemaName !== '*') {
    const cached = cacheMap.get(schemaName);
    if (cached) {
      cached.lastUpdated = 0;
    }
  } else {
    for (const cached of cacheMap.values()) {
      cached.lastUpdated = 0;
    }
  }
}

export function getCache(schemaName: string): SchemaCache | undefined {
  return cacheMap.get(schemaName);
}

async function fetchTables(db: DbPool, schema: string) {
  const result = await db.query(
    `SELECT table_name, table_type FROM information_schema.tables
     WHERE table_schema = $1 AND table_type IN ('BASE TABLE', 'VIEW')
     ORDER BY table_name`,
    [schema],
  );
  return result.rows;
}

async function fetchColumns(db: DbPool, schema: string) {
  const result = await db.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable,
            column_default, character_maximum_length, is_identity
     FROM information_schema.columns
     WHERE table_schema = $1
     ORDER BY ordinal_position`,
    [schema],
  );
  return result.rows;
}

async function fetchPrimaryKeys(db: DbPool, schema: string) {
  const result = await db.query(
    `SELECT tc.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1`,
    [schema],
  );
  return result.rows;
}

async function fetchForeignKeys(db: DbPool, schema: string) {
  const result = await db.query(
    `SELECT tc.table_name, kcu.column_name,
            ccu.table_name AS foreign_table, ccu.column_name AS foreign_column,
            tc.constraint_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
    [schema],
  );
  return result.rows;
}

async function fetchRlsStatus(db: DbPool, schema: string) {
  const result = await db.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c
     JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE n.nspname = $1 AND c.relkind IN ('r', 'v')`,
    [schema],
  );
  return result.rows;
}

// PGLite doesn't support LISTEN/NOTIFY. Schema change listening is a no-op.
// Cache invalidation happens explicitly after mutations (migrations, RLS changes).
export async function listenForSchemaChanges(_db: DbPool): Promise<void> {
  // no-op in PGLite local mode
}
