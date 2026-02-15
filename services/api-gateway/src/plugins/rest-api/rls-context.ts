import type { DbPool, DbClient } from '../../db/pool.js';
import type { JwtPayload } from '../../types/fastify.js';

/**
 * Execute a query within a transaction that sets the RLS context
 * from the JWT claims. This allows PostgreSQL RLS policies to
 * reference auth_uid() and auth_role().
 */
export async function executeWithRlsContext(
  db: DbPool,
  jwtPayload: JwtPayload | undefined,
  queryText: string,
  queryValues: unknown[],
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Set the role based on authentication status
    const role = jwtPayload ? 'authenticated' : 'anon';
    await client.query(`SET LOCAL ROLE ${role}`);

    // Set JWT claims if authenticated
    if (jwtPayload) {
      await client.query(
        `SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify(jwtPayload)],
      );
    } else {
      await client.query(
        `SELECT set_config('request.jwt.claims', '{}', true)`,
      );
    }

    // Execute the actual query
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
