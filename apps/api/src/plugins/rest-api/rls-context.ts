/**
 * rls-context.ts
 *
 * Executes a SQL query inside a transaction with the correct Postgres role and JWT
 * claims set, so that Row Level Security policies work as expected.
 *
 * Transaction flow:
 *   BEGIN
 *   SET LOCAL ROLE <role>          -- enforces RLS role boundary
 *   set_config('request.jwt.claims', ...)  -- full claims JSON (for jsonb operators)
 *   set_config('request.jwt.claim.sub', ...)   -- auth.uid()
 *   set_config('request.jwt.claim.role', ...)  -- auth.role()
 *   set_config('request.jwt.claim.email', ...) -- auth.email()
 *   <your query>
 *   COMMIT
 *
 * To replace this layer (e.g. different claims format, read-replica routing):
 * implement a function with the same signature and swap the import in index.ts.
 */

import type { DbPool } from '../../db/pool.js';
import type { ProjectJwtPayload } from '../../types/fastify.js';
import { BadRequestError } from '../../lib/errors.js';

const ALLOWED_ROLES = new Set(['anon', 'authenticated', 'service_role']);

export async function executeWithRlsContext(
  db: DbPool,
  jwtPayload: ProjectJwtPayload | undefined,
  queryText: string,
  queryValues: unknown[],
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const role = jwtPayload?.role ?? 'anon';
    if (!ALLOWED_ROLES.has(role)) {
      throw new BadRequestError(`Invalid role: ${role}`);
    }
    await client.query(`SET LOCAL ROLE ${role}`);

    // Set JWT claims in the formats Supabase auth helper functions expect:
    // auth.uid()  reads request.jwt.claim.sub  or request.jwt.claims ->> 'sub'
    // auth.role() reads request.jwt.claim.role or request.jwt.claims ->> 'role'
    const claims = jwtPayload ? JSON.stringify(jwtPayload) : '{}';
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);

    if (jwtPayload) {
      await client.query(`SELECT set_config('request.jwt.claim.sub',   $1, true)`, [jwtPayload.sub   ?? '']);
      await client.query(`SELECT set_config('request.jwt.claim.role',  $1, true)`, [jwtPayload.role  ?? '']);
      await client.query(`SELECT set_config('request.jwt.claim.email', $1, true)`, [jwtPayload.email ?? '']);
    }

    const result = await client.query(queryText, queryValues);

    await client.query('COMMIT');
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
