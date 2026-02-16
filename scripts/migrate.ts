#!/usr/bin/env tsx

/**
 * Migration runner for toph-base
 *
 * Reads and executes SQL migration files from the migrations/ directory.
 * Tracks applied migrations in toph_internal.migrations table.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '../migrations');

interface MigrationRow {
  name: string;
  applied_at: Date;
}

async function main() {
  const connectionString = process.env.DATABASE_URL ||
    `postgresql://${process.env.POSTGRES_USER || 'toph'}:${process.env.POSTGRES_PASSWORD || 'toph'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'toph'}`;

  console.log('Connecting to database...');
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS toph_internal.migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Get list of applied migrations
    const { rows: appliedMigrations } = await client.query<MigrationRow>(
      'SELECT name, applied_at FROM toph_internal.migrations ORDER BY name'
    );

    const appliedNames = new Set(appliedMigrations.map(m => m.name));

    console.log(`Applied migrations: ${appliedNames.size}`);

    // Get list of migration files
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Total migration files: ${files.length}`);

    // Apply pending migrations
    for (const file of files) {
      if (appliedNames.has(file)) {
        console.log(`✓ ${file} (already applied)`);
        continue;
      }

      console.log(`→ Applying ${file}...`);

      const sql = readFileSync(join(migrationsDir, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO toph_internal.migrations (name) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`✓ ${file} (applied)`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`✗ ${file} (failed)`);
        throw error;
      }
    }

    console.log('\n✓ All migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
