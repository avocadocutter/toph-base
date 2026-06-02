import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGliteStore } from './pglite-store.js';

// Regression test for the silent SET LOCAL ROLE no-op that broke RLS.
//
// Background: PGliteStore.connect().query() previously intercepted any
// `SET LOCAL ROLE` / `SET ROLE` statement and returned without executing it.
// That meant `executeWithRlsContext`'s role switch was a no-op and every
// request ran as the PGlite superuser, silently bypassing RLS for all
// authenticated and anon traffic.
//
// These tests verify that the statements now reach Postgres and actually
// switch the effective role, so RLS policies are enforced.

describe('PGliteStore — SET LOCAL ROLE is not silently swallowed', () => {
  let dataDir: string;
  let store: PGliteStore;

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pglite-rls-test-'));
    store = new PGliteStore(dataDir);
    await store.init();

    // Set up roles and an RLS-protected table that anon should NOT be able
    // to read or write (no policy covers anon).
    await store.exec(`
      CREATE ROLE anon NOLOGIN NOINHERIT;
      CREATE TABLE protected (id int PRIMARY KEY, owner text);
      INSERT INTO protected VALUES (1, 'alice'), (2, 'bob');
      ALTER TABLE protected ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE protected TO anon;
    `);
  });

  afterAll(async () => {
    await store.end();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('actually switches role: SELECT current_user returns the requested role', async () => {
    const client = await store.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE anon');
      const result = await client.query<{ current_user: string }>('SELECT current_user');
      expect(result.rows[0]?.current_user).toBe('anon');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('enforces RLS for anon: SELECT on a policy-less table returns 0 rows', async () => {
    const client = await store.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE anon');
      const result = await client.query<{ id: number }>('SELECT id FROM protected');
      expect(result.rows).toEqual([]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('enforces RLS for anon: UPDATE on a policy-less table affects 0 rows', async () => {
    const client = await store.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE anon');
      const result = await client.query(`UPDATE protected SET owner = 'attacker' WHERE true`);
      expect(result.rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Confirm the data was not actually modified, even outside the rolled-back txn.
    const check = await store.query<{ owner: string }>(`SELECT owner FROM protected ORDER BY id`);
    expect(check.rows.map(r => r.owner)).toEqual(['alice', 'bob']);
  });

  it('rejects SET LOCAL ROLE for a role that does not exist (fails closed)', async () => {
    const client = await store.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query('SET LOCAL ROLE nonexistent_role')).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
