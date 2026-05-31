/**
 * query-parser.ts
 *
 * Converts Supabase-compatible HTTP query params into a structured ParsedQuery object.
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
  negate: boolean;
}

export interface ParsedOrder {
  column: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export interface RelationSpec {
  name: string;
  alias: string | null;     // null = use table name as key
  columns: string[] | null; // null = all columns (*)
  countOnly: boolean;        // true when inner spec is just "count"
}

export interface EmbeddedFilter {
  relation: string;
  filter: ParsedFilter;
}

export interface ParsedQuery {
  select: string[] | null;   // null = all columns
  relations: RelationSpec[];  // embedded relationships extracted from select param
  filters: ParsedFilter[];    // AND filters from query params
  orFilters: ParsedFilter[];  // OR group from ?or=(...)
  embeddedFilters: EmbeddedFilter[]; // filters scoped to a related table (dotted column names)
  order: ParsedOrder[];
  limit: number | null;
  offset: number;
  onConflict: string[] | null;
}

// Splits a string on ',' only at parenthesis depth 0 (preserves in.(a,b) etc.)
function splitAtDepth0(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts.filter(Boolean);
}

// Parses "op.value" or "not.op.value" from the right-hand side of a filter param.
function parseOneFilter(column: string, rawValue: string): ParsedFilter {
  const dotIndex = rawValue.indexOf('.');
  if (dotIndex === -1) throw new BadRequestError(`Invalid filter syntax: ${column}=${rawValue}`);

  let operator = rawValue.slice(0, dotIndex);
  let value = rawValue.slice(dotIndex + 1);
  let negate = false;

  if (operator === 'not') {
    negate = true;
    const nextDot = value.indexOf('.');
    if (nextDot === -1) throw new BadRequestError(`Invalid filter syntax: ${column}=${rawValue}`);
    operator = value.slice(0, nextDot);
    value = value.slice(nextDot + 1);
  }

  if (!VALID_OPERATORS.includes(operator as FilterOperator)) {
    throw new BadRequestError(`Invalid filter operator: ${operator}`);
  }

  return { column, operator: operator as FilterOperator, value, negate };
}

// Parses one item from the ?or=(col.op.val,...) list, e.g. "status.eq.active".
function parseOrItem(expr: string): ParsedFilter {
  const firstDot = expr.indexOf('.');
  if (firstDot === -1) throw new BadRequestError(`Invalid or() filter expression: ${expr}`);
  return parseOneFilter(expr.slice(0, firstDot), expr.slice(firstDot + 1));
}

// Matches "relation_name(columns)" or "alias:relation_name(columns)" in a select token.
const EMBED_RE = /^(?:(\w+):)?(\w+)\((.*)\)$/;

export function parseQueryParams(querystring: Record<string, string | undefined>): ParsedQuery {
  const parsed: ParsedQuery = {
    select: null,
    relations: [],
    filters: [],
    orFilters: [],
    embeddedFilters: [],
    order: [],
    limit: null,
    offset: 0,
    onConflict: null,
  };

  // Parse select — detect embedded relation specs like comments(*) or author(id,name)
  if (querystring.select) {
    const cols: string[] = [];
    let hasStar = false;

    for (const token of splitAtDepth0(querystring.select)) {
      const m = token.match(EMBED_RE);
      if (m) {
        const alias = m[1] ?? null;
        const name  = m[2];
        const relCols = m[3].trim();
        const countOnly = relCols === 'count';
        parsed.relations.push({
          name,
          alias,
          countOnly,
          columns: countOnly || !relCols || relCols === '*'
            ? null
            : relCols.split(',').map(s => s.trim()).filter(Boolean),
        });
      } else if (token === '*') {
        hasStar = true;
      } else {
        cols.push(token);
      }
    }

    // '*' or no non-relation columns → select all main-table columns
    parsed.select = hasStar || cols.length === 0 ? null : cols;
  }

  // Parse limit / offset
  if (querystring.limit) {
    const limit = parseInt(querystring.limit, 10);
    if (isNaN(limit) || limit < 0) throw new BadRequestError('Invalid limit');
    parsed.limit = Math.min(limit, 1000);
  }

  if (querystring.offset) {
    const offset = parseInt(querystring.offset, 10);
    if (isNaN(offset) || offset < 0) throw new BadRequestError('Invalid offset');
    parsed.offset = offset;
  }

  // Parse order
  if (querystring.order) {
    parsed.order = querystring.order.split(',').map(part => {
      const segments = part.trim().split('.');
      const column = segments[0];
      const direction = segments[1] === 'desc' ? 'desc' : 'asc';
      const nullsPart = segments[2];
      const nulls: 'first' | 'last' | undefined =
        nullsPart === 'nullsfirst' ? 'first' :
        nullsPart === 'nullslast'  ? 'last'  :
        undefined;
      return { column, direction, nulls };
    });
  }

  // Parse on_conflict (upsert conflict target columns)
  if (querystring.on_conflict) {
    parsed.onConflict = querystring.on_conflict.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Parse ?or=(col.op.val,col2.op.val2) — flat OR group
  if (querystring.or) {
    const raw = querystring.or;
    const stripped = raw.startsWith('(') && raw.endsWith(')') ? raw.slice(1, -1) : raw;
    for (const item of splitAtDepth0(stripped)) {
      if (item.startsWith('and(') || item.startsWith('or(')) {
        throw new BadRequestError(`Nested and()/or() groups are not supported in ?or filters`);
      }
      parsed.orFilters.push(parseOrItem(item));
    }
  }

  // Parse AND filters: any remaining param with op.value syntax, including not.op.value.
  // Dotted keys like "relation.column=op.value" are embedded relation filters.
  const reservedKeys = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'or', 'columns']);
  for (const [key, rawValue] of Object.entries(querystring)) {
    if (reservedKeys.has(key) || !rawValue) continue;
    const dotPos = key.indexOf('.');
    if (dotPos !== -1) {
      const relation = key.slice(0, dotPos);
      const column   = key.slice(dotPos + 1);
      parsed.embeddedFilters.push({ relation, filter: parseOneFilter(column, rawValue) });
    } else {
      parsed.filters.push(parseOneFilter(key, rawValue));
    }
  }

  return parsed;
}
