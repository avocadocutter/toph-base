import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import path from 'node:path';
import { PGliteStore, type DbPool } from '@tophbase/api';

type Provider = 'railway' | 'supabase' | 'neon' | 'postgres';

const PROVIDER_HINTS: Record<Provider, string> = {
  railway:  'Railway dashboard → your project → Variables tab → DATABASE_URL',
  supabase: 'Supabase dashboard → project → Settings → Database → Connection string (URI mode)',
  neon:     'Neon console → your project → Connection string',
  postgres: 'Your postgres:// or postgresql:// connection string',
};

const VALID_PROVIDERS: Provider[] = ['railway', 'supabase', 'neon', 'postgres'];

export async function cmdGraduate(args: string[]): Promise<void> {
  let provider: Provider | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) {
      provider = args[i + 1] as Provider;
      break;
    }
  }

  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    console.error(`Usage: tophbase graduate --provider <${VALID_PROVIDERS.join('|')}>`);
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\nGraduating to ${provider}.`);
  console.log(`Where to find your connection string: ${PROVIDER_HINTS[provider]}\n`);
  const connStr = (await rl.question('Connection string: ')).trim();
  rl.close();

  if (!connStr.startsWith('postgres')) {
    console.error('Expected a postgres:// or postgresql:// connection string.');
    process.exit(1);
  }

  const projectName = process.env.TOPHBASE_PROJECT ?? 'default';
  const dataDir = process.env.TOPHBASE_DATA_DIR ?? path.join(os.homedir(), '.tophbase', 'projects', projectName);
  const pgliteDir = path.join(dataDir, 'data');

  const store = new PGliteStore(pgliteDir);
  await store.init();

  console.log('\nExporting local database...');
  const { ddl, fkAlters, inserts, tableCount, rowCount } = await exportLocal(store);
  await store.end();

  console.log(`  ${tableCount} table(s), ${rowCount} row(s)`);

  const { Client } = await import('pg');
  const client = new Client({ connectionString: connStr });
  await client.connect();

  try {
    await client.query('BEGIN');

    console.log('Applying schema...');
    for (const stmt of ddl) {
      await client.query(stmt);
    }
    for (const stmt of fkAlters) {
      await client.query(stmt);
    }

    console.log('Inserting data...');
    for (const stmt of inserts) {
      await client.query(stmt);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }

  console.log('\nGraduation complete!');
}

interface ExportResult {
  ddl: string[];
  fkAlters: string[];
  inserts: string[];
  tableCount: number;
  rowCount: number;
}

async function exportLocal(store: DbPool): Promise<ExportResult> {
  const tablesRes = await store.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  const tables = tablesRes.rows.map(r => r.table_name);

  const ddl: string[] = [];
  const fkAlters: string[] = [];
  const inserts: string[] = [];
  let rowCount = 0;

  for (const table of tables) {
    const colsRes = await store.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      is_identity: string;
      character_maximum_length: number | null;
    }>(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );

    const pksRes = await store.query<{ column_name: string }>(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
      [table]
    );
    const pks = new Set(pksRes.rows.map(r => r.column_name));

    const uniqRes = await store.query<{ constraint_name: string; column_name: string }>(
      `SELECT tc.constraint_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'UNIQUE'
       ORDER BY tc.constraint_name, kcu.ordinal_position`,
      [table]
    );

    const fksRes = await store.query<{
      constraint_name: string;
      column_name: string;
      foreign_table: string;
      foreign_column: string;
    }>(
      `SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
       WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'`,
      [table]
    );

    const colDefs: string[] = colsRes.rows.map(col => {
      const type = pgType(col);
      const nullable = col.is_nullable === 'YES' ? '' : ' NOT NULL';
      const identity = col.is_identity === 'YES' ? ' GENERATED ALWAYS AS IDENTITY' : '';
      const defVal = col.column_default && !identity ? ` DEFAULT ${col.column_default}` : '';
      return `  ${q(col.column_name)} ${type}${nullable}${defVal}${identity}`;
    });

    if (pks.size > 0) {
      colDefs.push(`  PRIMARY KEY (${[...pks].map(q).join(', ')})`);
    }

    const uniqMap = new Map<string, string[]>();
    for (const row of uniqRes.rows) {
      const cols = uniqMap.get(row.constraint_name) ?? [];
      cols.push(row.column_name);
      uniqMap.set(row.constraint_name, cols);
    }
    for (const [name, cols] of uniqMap) {
      colDefs.push(`  CONSTRAINT ${q(name)} UNIQUE (${cols.map(q).join(', ')})`);
    }

    ddl.push(`CREATE TABLE IF NOT EXISTS ${q(table)} (\n${colDefs.join(',\n')}\n);`);

    for (const fk of fksRes.rows) {
      fkAlters.push(
        `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(fk.constraint_name)} ` +
        `FOREIGN KEY (${q(fk.column_name)}) REFERENCES ${q(fk.foreign_table)} (${q(fk.foreign_column)});`
      );
    }

    const dataRes = await store.query(`SELECT * FROM ${q(table)}`);
    if (dataRes.rows.length > 0) {
      const cols = Object.keys(dataRes.rows[0] as Record<string, unknown>);
      for (const row of dataRes.rows) {
        const values = cols.map(c => pgLiteral((row as Record<string, unknown>)[c]));
        inserts.push(
          `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${values.join(', ')});`
        );
        rowCount++;
      }
    }
  }

  return { ddl, fkAlters, inserts, tableCount: tables.length, rowCount };
}

function pgType(col: {
  data_type: string;
  udt_name: string;
  character_maximum_length: number | null;
}): string {
  if (col.data_type === 'USER-DEFINED') return col.udt_name;
  if (col.data_type === 'ARRAY') return col.udt_name.replace(/^_/, '') + '[]';
  if (col.data_type === 'character varying') {
    return col.character_maximum_length ? `varchar(${col.character_maximum_length})` : 'text';
  }
  if (col.data_type === 'character') {
    return col.character_maximum_length ? `char(${col.character_maximum_length})` : 'char';
  }
  return col.data_type;
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function pgLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number' || typeof val === 'bigint') return String(val);
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}
