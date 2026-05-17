#!/usr/bin/env node

async function main() {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case undefined:
    case 'freshman':
      return cmdFreshman();
    case 'graduate':
      return cmdGraduate(args);
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

async function cmdFreshman() {
  const { start } = await import('../server.js');
  await start();
}

async function cmdGraduate(args: string[]) {
  const { cmdGraduate: graduate } = await import('./graduate.js');
  await graduate(args);
}

async function cmdSchema(args: string[]) {
  const subcmd = args[0];
  if (subcmd === 'refresh' || !subcmd) {
    const { buildConfig, loadOrCreateProjectConfig, PGliteStore, generateSchemaMd } = await import('@tophbase/api');
    const fs = (await import('node:fs/promises')).default;
    const path = (await import('node:path')).default;
    const os = (await import('node:os')).default;

    const projectName = process.env.TOPHBASE_PROJECT ?? 'default';
    const dataDir = process.env.TOPHBASE_DATA_DIR ?? path.join(os.homedir(), '.tophbase', 'projects', projectName);
    const projectConfig = await loadOrCreateProjectConfig(dataDir);
    buildConfig(projectConfig, projectName);
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
    freshman                         Start the local backend server (default)
    graduate --provider <provider>   Deploy local data to a cloud Postgres
    schema refresh                   Regenerate SCHEMA.md from current database schema

  PROVIDERS
    railway   supabase   neon   postgres

  OPTIONS
    --help, -h   Show this help message

  EXAMPLES
    tophbase freshman
    tophbase graduate --provider railway
    npx tophbase
`);
}

main().catch(err => {
  console.error('tophbase:', err.message ?? err);
  process.exit(1);
});
