#!/usr/bin/env node

async function main() {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case undefined:
    case 'freshman':
      return cmdFreshman(args);
    case 'graduate':
      return cmdGraduate(args);
    case 'schema':
      return cmdSchema(args);
    case 'secrets':
      return cmdSecrets(args);
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`tophbase: unknown command '${cmd}'`);
      console.error(`Run 'tophbase --help' for available commands.`);
      process.exit(1);
  }
}

// ── Local config (.tophbase/config.json in cwd) ──────────────────────────────
// Everything lives inside .tophbase/ in the project repo (gitignored).

const LOCAL_CONFIG_DIR = '.tophbase';
const LOCAL_CONFIG_FILE = `${LOCAL_CONFIG_DIR}/config.json`;
const LOCAL_SECRETS_FILE = `${LOCAL_CONFIG_DIR}/secrets.json`;

interface LocalConfig {
  port: number;
  migrationsDir: string;
  pgWirePort?: number;
  functionsDir?: string;
}

async function readLocalConfig(): Promise<Partial<LocalConfig>> {
  const fs = (await import('node:fs/promises')).default;
  try {
    return JSON.parse(await fs.readFile(LOCAL_CONFIG_FILE, 'utf8')) as Partial<LocalConfig>;
  } catch {
    return {};
  }
}

async function writeLocalConfig(config: LocalConfig): Promise<void> {
  const fs = (await import('node:fs/promises')).default;
  await fs.mkdir(LOCAL_CONFIG_DIR, { recursive: true });
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await fs.readFile(LOCAL_CONFIG_FILE, 'utf8')) as Record<string, unknown>; } catch { /* ignore */ }
  await fs.writeFile(LOCAL_CONFIG_FILE, JSON.stringify({ ...existing, ...config }, null, 2), 'utf8');
}

async function prompt(rl: import('node:readline').Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ── freshman ──────────────────────────────────────────────────────────────────

async function cmdFreshman(args: string[]) {
  const path = (await import('node:path')).default;

  const flagPort = argValue(args, '--port');
  const flagMigrations = argValue(args, '--migrations-dir');

  const saved = await readLocalConfig();
  const isFirstRun = !saved.port && !flagPort;

  // Data dir is always .tophbase/ in cwd — no prompt needed.
  const dataDir = path.resolve(LOCAL_CONFIG_DIR);

  let port: number;
  let migrationsDir: string;

  if (flagPort) {
    port = Number(flagPort);
    if (isNaN(port)) { console.error('tophbase freshman: --port must be a number'); process.exit(1); }
  } else if (saved.port) {
    port = saved.port;
  } else {
    const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt(rl, '  Port [8000]: ');
    rl.close();
    port = Number(answer.trim() || 8000);
    if (isNaN(port)) { console.error('tophbase freshman: port must be a number'); process.exit(1); }
  }

  if (flagMigrations) {
    migrationsDir = path.resolve(flagMigrations);
  } else if (saved.migrationsDir) {
    migrationsDir = saved.migrationsDir;
  } else {
    const suggested = path.resolve('./supabase/migrations');
    const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt(rl, `  Migrations dir [${suggested}]: `);
    rl.close();
    migrationsDir = path.resolve(answer.trim() || suggested);
  }

  // ── Postgres wire protocol (optional) ────────────────────────────────────
  const flagPgWirePort = argValue(args, '--pg-wire-port');
  let pgWirePort: number | undefined;

  if (flagPgWirePort) {
    pgWirePort = Number(flagPgWirePort);
    if (isNaN(pgWirePort)) { console.error('tophbase freshman: --pg-wire-port must be a number'); process.exit(1); }
  } else if (saved.pgWirePort) {
    pgWirePort = saved.pgWirePort;
  } else {
    const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
    const enable = await prompt(rl, '  Enable Postgres wire protocol? [y/N]: ');
    if (enable.trim().toLowerCase() === 'y') {
      let answer = '';
      while (!answer.trim()) {
        answer = await prompt(rl, '  PG wire port (required): ');
        if (!answer.trim()) console.log('  Port is required.');
      }
      pgWirePort = Number(answer.trim());
      if (isNaN(pgWirePort)) {
        rl.close();
        console.error('tophbase freshman: PG wire port must be a number');
        process.exit(1);
      }
    }
    rl.close();
  }

  // ── Edge functions (optional) ─────────────────────────────────────────────
  const flagFunctionsDir = argValue(args, '--functions-dir');
  let functionsDir: string | undefined;

  if (flagFunctionsDir) {
    functionsDir = path.resolve(flagFunctionsDir);
  } else if (saved.functionsDir) {
    functionsDir = saved.functionsDir;
  } else {
    const suggested = path.resolve('./supabase/functions');
    const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt(rl, `  Edge functions dir [${suggested}]: `);
    rl.close();
    functionsDir = answer.trim() ? path.resolve(answer.trim()) : suggested;
  }

  if (isFirstRun || flagPort || flagMigrations || flagPgWirePort || flagFunctionsDir || (!saved.functionsDir && functionsDir !== undefined)) {
    await writeLocalConfig({ port, migrationsDir, ...(pgWirePort !== undefined && { pgWirePort }), ...(functionsDir !== undefined && { functionsDir }) });
    if (isFirstRun) console.log(`  Config saved to ${LOCAL_CONFIG_FILE}`);
  }

  console.log('');
  console.log(`  Data dir:       ${dataDir}`);
  console.log(`  Port:           ${port}`);
  console.log(`  Migrations dir: ${migrationsDir}`);
  if (pgWirePort !== undefined) console.log(`  PG wire port:   ${pgWirePort}`);
  if (functionsDir !== undefined) console.log(`  Functions dir:  ${functionsDir}`);
  console.log('');

  process.env.TOPHBASE_DATA_DIR = dataDir;
  process.env.TOPHBASE_PROJECT = path.basename(process.cwd());
  process.env.TOPHBASE_PORT = String(port);
  process.env.TOPHBASE_MIGRATIONS_DIR = migrationsDir;
  if (pgWirePort !== undefined) process.env.TOPHBASE_PG_PORT = String(pgWirePort);
  if (functionsDir !== undefined) process.env.TOPHBASE_FUNCTIONS_DIR = functionsDir;

  const secrets = await readLocalSecrets();
  for (const [k, v] of Object.entries(secrets)) process.env[k] = v;

  const { start } = await import('../server.js');
  await start();
}

function argValue(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const val = args[idx + 1];
  if (!val || val.startsWith('--')) {
    console.error(`tophbase freshman: ${flag} requires a value`);
    process.exit(1);
  }
  return val;
}

// ── secrets ───────────────────────────────────────────────────────────────────

async function readLocalSecrets(): Promise<Record<string, string>> {
  const fs = (await import('node:fs/promises')).default;
  try {
    const raw = JSON.parse(await fs.readFile(LOCAL_SECRETS_FILE, 'utf8')) as unknown;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, string>;
  } catch { /* no file */ }
  return {};
}

async function writeLocalSecrets(secrets: Record<string, string>): Promise<void> {
  const fs = (await import('node:fs/promises')).default;
  await fs.mkdir(LOCAL_CONFIG_DIR, { recursive: true });
  await fs.writeFile(LOCAL_SECRETS_FILE, JSON.stringify(secrets, null, 2), 'utf8');
}

async function cmdSecrets(args: string[]) {
  const sub = args[0];

  if (!sub || sub === 'list') {
    const secrets = await readLocalSecrets();
    const keys = Object.keys(secrets);
    if (keys.length === 0) {
      console.log('  No secrets set.');
    } else {
      console.log('');
      for (const k of keys) console.log(`  ${k}`);
      console.log('');
    }
    return;
  }

  if (sub === 'set') {
    const pairs = args.slice(1);
    if (pairs.length === 0) {
      console.error('Usage: tophbase secrets set KEY=VALUE [KEY2=VALUE2 ...]');
      process.exit(1);
    }
    const secrets = await readLocalSecrets();
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq === -1) {
        console.error(`Invalid format: '${pair}'. Expected KEY=VALUE`);
        process.exit(1);
      }
      secrets[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    await writeLocalSecrets(secrets);
    console.log(`  ${pairs.length} secret(s) saved.`);
    return;
  }

  if (sub === 'unset') {
    const keys = args.slice(1);
    if (keys.length === 0) {
      console.error('Usage: tophbase secrets unset KEY [KEY2 ...]');
      process.exit(1);
    }
    const secrets = await readLocalSecrets();
    for (const k of keys) delete secrets[k];
    await writeLocalSecrets(secrets);
    console.log(`  ${keys.length} secret(s) removed.`);
    return;
  }

  console.error(`tophbase secrets: unknown subcommand '${sub}'`);
  console.error(`Available: list, set, unset`);
  process.exit(1);
}

// ── graduate ──────────────────────────────────────────────────────────────────

async function cmdGraduate(args: string[]) {
  const { cmdGraduate: graduate } = await import('./graduate.js');
  await graduate(args);
}

// ── schema ────────────────────────────────────────────────────────────────────

async function cmdSchema(args: string[]) {
  const subcmd = args[0];
  if (subcmd === 'refresh' || !subcmd) {
    const { buildConfig, loadOrCreateProjectConfig, PGliteStore, generateSchemaMd } = await import('@tophbase/api');
    const fs = (await import('node:fs/promises')).default;
    const path = (await import('node:path')).default;

    const dataDir = path.resolve(LOCAL_CONFIG_DIR);
    const projectName = path.basename(process.cwd());
    const projectConfig = await loadOrCreateProjectConfig(dataDir);
    buildConfig(projectConfig, projectName);
    const store = new PGliteStore(path.join(dataDir, 'data'));
    await store.init();

    const md = await generateSchemaMd(store);
    await fs.writeFile('SCHEMA.md', md, 'utf8');
    console.log('SCHEMA.md updated.');
    await store.end();
  } else {
    console.error(`tophbase schema: unknown subcommand '${subcmd}'`);
    process.exit(1);
  }
}

// ── help ──────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
  tophbase — local Supabase-compatible backend

  COMMANDS
    freshman   Start the local backend server
               All data stored in .tophbase/ in the current directory.
               Prompts for port and migrations dir on first run.
               Config saved to .tophbase/config.json (add .tophbase/ to .gitignore).

               Flags (override saved config):
                 --port <port>
                 --migrations-dir <path>
                 --pg-wire-port <port>    Enable Postgres wire protocol on this port (required if enabling)
                 --functions-dir <path>   Directory containing edge functions (default: ./supabase/functions)

    graduate --provider <provider>   Deploy local data to a cloud Postgres
    schema refresh                   Regenerate SCHEMA.md from current database schema
    secrets list                     List secret names
    secrets set KEY=VALUE ...        Set one or more secrets
    secrets unset KEY ...            Remove one or more secrets

  PROVIDERS
    railway   supabase   neon   postgres

  OPTIONS
    --help, -h   Show this help message

  EXAMPLES
    tophbase freshman
    tophbase freshman --migrations-dir ./supabase/migrations
    tophbase graduate --provider railway
`);
}

main().catch(err => {
  console.error('tophbase:', err.message ?? err);
  process.exit(1);
});
