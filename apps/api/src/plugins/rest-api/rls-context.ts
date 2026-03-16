import type { DbPool } from '../../db/pool.js';
import type { ProjectJwtPayload } from '../../types/fastify.js';
import { quoteIdentifier } from '../../lib/sql-helpers.js';
import { BadRequestError } from '../../lib/errors.js';

const ALLOWED_ROLES = new Set(['anon', 'authenticated', 'service_role']);

export async function executeWithRlsContext(
  db: DbPool,
  jwtPayload: ProjectJwtPayload | undefined,
  queryText: string,
  queryValues: unknown[],
  schemaName: string,
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Set search_path to the project schema
    await client.query(`SET LOCAL search_path TO ${quoteIdentifier(schemaName)}, public`);

    // Set the role based on authentication status
    const role = jwtPayload?.role ?? 'anon';
    if (!ALLOWED_ROLES.has(role)) {
      throw new BadRequestError(`Invalid role: ${role}`);
    }
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
