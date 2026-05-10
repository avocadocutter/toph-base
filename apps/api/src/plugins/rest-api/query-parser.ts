/**
 * query-parser.ts
 *
 * Converts PostgREST-style HTTP query params into a structured ParsedQuery object.
 * This is a pure transformation step — no SQL, no DB access.
 *
 * To add a new filter operator:
 *   1. Add the string to VALID_OPERATORS below.
 *   2. Handle it in buildWhereClause() in query-builder.ts.
 *
 * To add a new query feature (e.g. OR filters, not-modifier):
 *   1. Add a field to ParsedQuery.
 *   2. Parse it in parseQueryParams().
 *   3. Consume it in query-builder.ts.
 */

type FilterOperator =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'ilike'
  | 'is' | 'in';
import { BadRequestError } from '../../lib/errors.js';

const VALID_OPERATORS: FilterOperator[] = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
];

export interface ParsedFilter {
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface ParsedOrder {
  column: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export interface ParsedQuery {
  select: string[] | null; // null = all columns
  filters: ParsedFilter[];
  order: ParsedOrder[];
  limit: number | null;
  offset: number;
  onConflict: string[] | null; // columns to use as ON CONFLICT target for upserts
}

export function parseQueryParams(querystring: Record<string, string | undefined>): ParsedQuery {
  const parsed: ParsedQuery = {
    select: null,
    filters: [],
    order: [],
    limit: null,
    offset: 0,
    onConflict: null,
  };

  // Parse select
  if (querystring.select) {
    parsed.select = querystring.select.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Parse limit/offset
  if (querystring.limit) {
    const limit = parseInt(querystring.limit, 10);
    if (isNaN(limit) || limit < 0) throw new BadRequestError('Invalid limit');
    parsed.limit = Math.min(limit, 1000); // Cap at 1000
  }

  if (querystring.offset) {
    const offset = parseInt(querystring.offset, 10);
    if (isNaN(offset) || offset < 0) throw new BadRequestError('Invalid offset');
    parsed.offset = offset;
  }

  // Parse order
  if (querystring.order) {
    parsed.order = querystring.order.split(',').map(part => {
      const [column, dirPart] = part.trim().split('.');
      const direction = dirPart === 'desc' ? 'desc' : 'asc';
      return { column, direction };
    });
  }

  // Parse on_conflict (comma-separated column names for upsert conflict target)
  if (querystring.on_conflict) {
    parsed.onConflict = querystring.on_conflict.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Parse filters (any querystring key that has operator syntax: column=op.value)
  const reservedKeys = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
  for (const [key, rawValue] of Object.entries(querystring)) {
    if (reservedKeys.has(key) || !rawValue) continue;

    const dotIndex = rawValue.indexOf('.');
    if (dotIndex === -1) continue;

    const operator = rawValue.slice(0, dotIndex) as FilterOperator;
    const value = rawValue.slice(dotIndex + 1);

    if (!VALID_OPERATORS.includes(operator)) {
      throw new BadRequestError(`Invalid filter operator: ${operator}`);
    }

    parsed.filters.push({ column: key, operator, value });
  }

  return parsed;
}
