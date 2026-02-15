/**
 * Safely quote a SQL identifier (table name, column name, etc.)
 * Prevents SQL injection via identifier names.
 */
export function quoteIdentifier(identifier: string): string {
  // Double any existing double quotes, then wrap in double quotes
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Safely quote a schema-qualified identifier.
 */
export function quoteQualifiedIdentifier(schema: string, name: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

/**
 * Validate that a string is a safe SQL identifier (letters, digits, underscores).
 */
export function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

import type { DbPool } from '../db/pool.js';
import { BadRequestError } from './errors.js';

const FORBIDDEN_PATTERNS = [
  /;\s*(DROP|ALTER|CREATE|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE)/i,
  /--/,
  /\/\*/,
];

export async function validateRlsPolicyExpression(
  db: DbPool,
  schema: string,
  table: string,
  expression: string,
): Promise<void> {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new BadRequestError('RLS policy expression cannot be empty');
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new BadRequestError(`Forbidden pattern in RLS expression: ${pattern.source}`);
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 5000');
    const qualifiedTable = quoteQualifiedIdentifier(schema, table);
    await client.query(`EXPLAIN SELECT 1 FROM ${qualifiedTable} WHERE ${trimmed}`);
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const pgError = error as { message?: string };
    throw new BadRequestError(
      `Invalid RLS expression: ${pgError.message ?? 'unknown error'}`,
    );
  } finally {
    client.release();
  }
}
