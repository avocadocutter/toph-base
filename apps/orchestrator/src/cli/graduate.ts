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

  if (provider === 'railway') {
    await cmdGraduateRailway();
    return;
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

// ── Railway deploy ────────────────────────────────────────────────────────────

async function cmdGraduateRailway(): Promise<void> {
  const { execSync, spawnSync } = await import('node:child_process');
  const fs = (await import('node:fs/promises')).default;
  const { fileURLToPath } = await import('node:url');

  // 1. Check railway CLI
  try {
    execSync('which railway', { stdio: 'pipe' });
  } catch {
    console.error('\n  railway CLI not found. Install it:');
    console.error('    npm install -g @railway/cli\n');
    process.exit(1);
  }

  // 2. Check login
  const whoami = spawnSync('railway', ['whoami'], { encoding: 'utf8', shell: true });
  if (whoami.status !== 0) {
    console.error('\n  Not logged in to Railway.');
    console.error('  Run: railway login');
    console.error('  Then re-run: tophbase graduate --provider railway\n');
    process.exit(1);
  } else {
    const user = whoami.stdout.trim();
    if (user) console.log(`\n  Railway: ${user}`);
  }

  // 3. Project name
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const defaultName = `${path.basename(process.cwd())}-tophbase`;
  const projectName = (await rl.question(`  Project name [${defaultName}]: `)).trim() || defaultName;
  rl.close();

  // 4. Staging dir — this is what gets deployed to Railway
  const stageDir = path.resolve('.tophbase', 'railway');
  await fs.mkdir(stageDir, { recursive: true });

  // 5. Pack both tophbase packages using pnpm (which resolves workspace: refs to real versions)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(__dirname, '../..');
  const apiRoot = path.resolve(pkgRoot, '../api');

  // Read versions to construct exact tarball filenames
  const orchPkg = JSON.parse(await fs.readFile(path.join(pkgRoot, 'package.json'), 'utf8')) as { version: string };
  const apiPkg  = JSON.parse(await fs.readFile(path.join(apiRoot, 'package.json'), 'utf8')) as { version: string };
  const orchTarball = `tophbase-${orchPkg.version}.tgz`;
  const apiTarball  = `tophbase-api-${apiPkg.version}.tgz`;

  console.log('\nPacking tophbase...');
  for (const [root, label] of [[apiRoot, '@tophbase/api'], [pkgRoot, 'tophbase']] as [string, string][]) {
    const r = spawnSync('pnpm', ['pack', '--pack-destination', stageDir], { encoding: 'utf8', shell: true, cwd: root });
    if (r.status !== 0) {
      console.error(`Failed to pack ${label}:`, r.stderr);
      process.exit(1);
    }
  }

  // 6. Copy local migrations into the staging dir so they land in the image.
  let localConfig: Record<string, unknown> = {};
  try { localConfig = JSON.parse(await fs.readFile('.tophbase/config.json', 'utf8')) as Record<string, unknown>; } catch { /* no local config */ }
  const localMigrationsDir = typeof localConfig.migrationsDir === 'string'
    ? localConfig.migrationsDir
    : path.resolve('./supabase/migrations');

  const stageMigrationsDir = path.join(stageDir, 'migrations');
  let hasMigrations = false;
  try {
    await fs.cp(localMigrationsDir, stageMigrationsDir, { recursive: true });
    hasMigrations = true;
    console.log(`\nCopied migrations from ${localMigrationsDir}`);
  } catch {
    console.log(`\nNo migrations found at ${localMigrationsDir} — skipping`);
  }

  const localFunctionsDir = typeof localConfig.functionsDir === 'string'
    ? localConfig.functionsDir
    : path.resolve('./supabase/functions');
  const stageFunctionsDir = path.join(stageDir, 'functions');
  let hasFunctions = false;
  try {
    await fs.cp(localFunctionsDir, stageFunctionsDir, { recursive: true });
    hasFunctions = true;
    console.log(`Copied functions from ${localFunctionsDir}`);
  } catch {
    console.log(`No functions found at ${localFunctionsDir} — skipping`);
  }

  // 7. Write Dockerfile + startup script.
  //    The pnpm override redirects @tophbase/api to the local tarball so pnpm never
  //    hits the registry for it. Volume is mounted at /app/.tophbase, which is exactly
  //    where freshman writes data (path.resolve('.tophbase') from /app).
  const stagePkg = {
    name: 'tophbase-service',
    version: '1.0.0',
    type: 'module',
    pnpm: { overrides: { '@tophbase/api': `file:./${apiTarball}` } },
  };

  await fs.writeFile(
    path.join(stageDir, 'start.sh'),
    [
      '#!/bin/sh',
      // Pass flags directly so freshman skips port/migrations/functions prompts.
      // Pipe a single newline to answer the pg-wire prompt (empty = N = disabled).
      `printf '\\n' | node_modules/.bin/tophbase freshman --port "$PORT" --migrations-dir /app/migrations${hasFunctions ? ' --functions-dir /app/functions' : ''}`,
    ].join('\n') + '\n',
    'utf8',
  );

  await fs.writeFile(
    path.join(stageDir, 'Dockerfile'),
    [
      'FROM denoland/deno:bin AS deno',
      'FROM node:22',
      'COPY --from=deno /deno /usr/local/bin/deno',
      'RUN npm install -g pnpm@10',
      'WORKDIR /app',
      `COPY ${apiTarball} ${orchTarball} start.sh ./`,
      ...(hasMigrations ? ['COPY migrations ./migrations'] : []),
      ...(hasFunctions ? ['COPY functions ./functions'] : []),
      `RUN echo '${JSON.stringify(stagePkg)}' > package.json`,
      `RUN pnpm add ./${apiTarball} ./${orchTarball}`,
      'RUN chmod +x start.sh',
      'ENV TOPHBASE_HOST=0.0.0.0',
      'CMD ["/app/start.sh"]',
    ].join('\n') + '\n',
    'utf8',
  );

  // Remove stale nixpacks files if present from a previous attempt
  for (const f of ['package.json', 'railway.json']) {
    await fs.unlink(path.join(stageDir, f)).catch(() => {});
  }

  // 7. Carry over local keys so production uses the same API keys as local dev
  const localKeys = await readLocalKeys();

  let localSecrets: Record<string, string> = {};
  try { localSecrets = JSON.parse(await fs.readFile('.tophbase/secrets.json', 'utf8')) as Record<string, string>; } catch { /* no secrets */ }

  // 8. Create Railway project, or link if it already exists
  const listOut = spawnSync('railway', ['list', '--json'], { encoding: 'utf8', shell: true, cwd: stageDir });
  let existingId: string | undefined;
  if (listOut.status === 0) {
    try {
      const projects = JSON.parse(listOut.stdout) as { name: string; id: string }[];
      existingId = projects.find(p => p.name === projectName)?.id;
    } catch { /* ignore */ }
  }

  if (existingId) {
    console.log(`\nProject '${projectName}' already exists, linking...`);
    const link = spawnSync('railway', ['link', '--project', existingId], { stdio: 'inherit', shell: true, cwd: stageDir });
    if (link.status !== 0) {
      console.error('Failed to link Railway project.');
      process.exit(1);
    }
  } else {
    console.log('\nCreating Railway project...');
    const init = spawnSync('railway', ['init', '--name', projectName], {
      stdio: 'inherit',
      shell: true,
      cwd: stageDir,
    });
    if (init.status !== 0) {
      console.error('Failed to create Railway project.');
      process.exit(1);
    }
  }

  // 9. Create service with variables if it doesn't already exist
  const svcList = spawnSync('railway', ['service', 'list', '--json'], {
    encoding: 'utf8',
    shell: true,
    cwd: stageDir,
  });
  let serviceExists = false;
  if (svcList.status === 0) {
    try {
      const services = JSON.parse(svcList.stdout) as { name: string }[];
      serviceExists = services.some(s => s.name === projectName);
    } catch { /* ignore */ }
  }

  if (!serviceExists) {
    const varFlags: string[] = [
      '--variables', 'TOPHBASE_HOST=0.0.0.0',
      '--variables', `TOPHBASE_PROJECT=${projectName}`,
    ];
    if (localKeys) {
      varFlags.push('--variables', `TOPHBASE_JWT_SECRET=${localKeys.jwtSecret}`);
      varFlags.push('--variables', `TOPHBASE_PUBLISHABLE_KEY=${localKeys.publishableKey}`);
      varFlags.push('--variables', `TOPHBASE_SECRET_KEY=${localKeys.secretKey}`);
    }
    for (const [k, v] of Object.entries(localSecrets)) {
      varFlags.push('--variables', `${k}=${v}`);
    }
    console.log('\nCreating service...');
    const addService = spawnSync('railway', ['add', '--service', projectName, ...varFlags], {
      stdio: 'inherit',
      shell: true,
      cwd: stageDir,
    });
    if (addService.status !== 0) {
      console.error('Failed to create Railway service.');
      process.exit(1);
    }
  } else {
    console.log(`\nService '${projectName}' already exists, skipping.`);
  }

  // 10. Add persistent volume — mounted at /app/.tophbase so freshman's path.resolve('.tophbase') lands on it
  console.log('\nAdding persistent volume at /app/.tophbase...');
  spawnSync('railway', ['volume', 'add', '--mount-path', '/app/.tophbase'], {
    stdio: 'inherit',
    shell: true,
    cwd: stageDir,
  });

  // 11. Deploy
  console.log('\nDeploying...');
  const up = spawnSync('railway', ['up', '--detach'], {
    stdio: 'inherit',
    shell: true,
    cwd: stageDir,
  });
  if (up.status !== 0) {
    console.error('Deployment failed.');
    process.exit(1);
  }

  // 12. Generate public domain
  console.log('\nGenerating public domain...');
  const domainOut = spawnSync('railway', ['domain', '--json'], {
    encoding: 'utf8',
    shell: true,
    cwd: stageDir,
  });
  let railwayUrl = '';
  if (domainOut.status === 0) {
    try {
      const d = JSON.parse(domainOut.stdout) as { domain?: string };
      if (d.domain) railwayUrl = `https://${d.domain}`;
    } catch { /* ignore */ }
  }

  console.log('\n  Graduation complete!');
  if (railwayUrl) {
    console.log(`  URL: ${railwayUrl}`);
  }
  if (localKeys) {
    console.log(`\n  Publishable key: ${localKeys.publishableKey}`);
    console.log(`  Secret key:      ${localKeys.secretKey}`);
  } else {
    console.log('\n  Keys auto-generated on first start — check Railway logs for your publishable/secret keys.');
  }
  console.log('');
}

async function readLocalKeys(): Promise<{ jwtSecret: string; publishableKey: string; secretKey: string } | null> {
  try {
    const fs = (await import('node:fs/promises')).default;
    const configPath = path.resolve('.tophbase', 'data', 'config.json');
    const raw = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
    if (raw.jwtSecret && raw.publishableKey && raw.secretKey) {
      return raw as { jwtSecret: string; publishableKey: string; secretKey: string };
    }
  } catch { /* no local keys yet */ }
  return null;
}

// ── Data export (non-Railway providers) ──────────────────────────────────────

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
