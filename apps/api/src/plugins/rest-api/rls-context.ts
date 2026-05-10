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
