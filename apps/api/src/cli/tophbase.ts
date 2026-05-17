#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case undefined:
    case 'start':
      return cmdStart();
    case 'schema':
      return cmdSchema(args);
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

async function cmdStart() {
  // Delegate to the main server
  const serverPath = path.resolve(__dirname, '../index.js');
  await import(serverPath);
}

async function cmdSchema(args: string[]) {
  const subcmd = args[0];
  if (subcmd === 'refresh' || !subcmd) {
    const { buildConfig } = await import('../config.js');
    const { loadOrCreateProjectConfig } = await import('../lib/project-config.js');
    const { PGliteStore } = await import('../db/pglite-store.js');
    const { generateSchemaMd } = await import('../lib/schema-md.js');
    const fs = (await import('node:fs/promises')).default;
    const path = (await import('node:path')).default;
    const os = (await import('node:os')).default;

    const projectName = process.env.TOPHBASE_PROJECT ?? 'default';
    const dataDir = process.env.TOPHBASE_DATA_DIR ?? path.join(os.homedir(), '.tophbase', 'projects', projectName);
    const projectConfig = await loadOrCreateProjectConfig(dataDir);
    const config = buildConfig(projectConfig, projectName);
    const pgliteDir = path.join(dataDir, 'data');
    const store = new PGliteStore(pgliteDir);
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

function printHelp() {
  console.log(`
  tophbase — local Supabase-compatible backend

  COMMANDS
    start                  Start the backend server (default)
    schema refresh         Regenerate SCHEMA.md from current database schema

  OPTIONS
    --help, -h             Show this help message

  EXAMPLES
    tophbase start
    tophbase schema refresh
    npx tophbase start
`);
}

main().catch(err => {
  console.error('tophbase:', err.message ?? err);
  process.exit(1);
});
