/**
 * query-builder.ts
 *
 * Builds parameterized SQL strings from a ParsedQuery object.
 * All user input arrives pre-validated; column names are quoted via quoteIdentifier().
 *
 * To add a new filter operator: add a case in buildWhereClause().
 * To add relationship embedding: extend buildSelectQuery() to emit JOINs
 *   using the TableInfo.foreignKeys data (already fetched by schema introspection).
 */

import type { ParsedQuery, ParsedFilter, ParsedOrder } from './query-parser.js';
import type { TableInfo } from '../introspection/types.js';
import { quoteIdentifier } from '../../lib/sql-helpers.js';
import { BadRequestError } from '../../lib/errors.js';

interface BuiltQuery {
  text: string;
  values: unknown[];
}

function validateColumns(columns: string[], table: TableInfo) {
  const validColumns = new Set(table.columns.map(c => c.name));
  for (const col of columns) {
    if (!validColumns.has(col)) {
      throw new BadRequestError(`Unknown column: ${col}`);
    }
  }
}

function buildWhereClause(filters: ParsedFilter[], table: TableInfo, paramOffset: number): { clause: string; values: unknown[] } {
  if (filters.length === 0) return { clause: '', values: [] };

  validateColumns(filters.map(f => f.column), table);

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = paramOffset;

  for (const filter of filters) {
    const col = quoteIdentifier(filter.column);
    paramIndex++;

    switch (filter.operator) {
      case 'eq':
        conditions.push(`${col} = $${paramIndex}`);
        values.push(filter.value);
        break;
      case 'neq':
        conditions.push(`${col} != $${paramIndex}`);
        values.push(filter.value);
        break;
      case 'gt':
        conditions.push(`${col} > $${paramIndex}`);
        values.push(filter.value);
        break;
      case 'gte':
        conditions.push(`${col} >= $${paramIndex}`);
        values.push(filter.value);
        break;
      case 'lt':
        conditions.push(`${col} < $${paramIndex}`);
        values.push(filter.value);
        break;
      case 'lte':
        conditions.push(`${col} <= $${paramIndex}`);
        values.push(filter.value);
        break;
      case 'like':
        conditions.push(`${col} LIKE $${paramIndex}`);
        values.push(filter.value);
        break;
      case 'ilike':
        conditions.push(`${col} ILIKE $${paramIndex}`);
        values.push(filter.value);
        break;
      case 'is':
        if (filter.value === 'null') {
          conditions.push(`${col} IS NULL`);
          values.pop(); // don't need the param
          paramIndex--;
        } else if (filter.value === 'true') {
          conditions.push(`${col} IS TRUE`);
          values.pop();
          paramIndex--;
        } else if (filter.value === 'false') {
          conditions.push(`${col} IS FALSE`);
          values.pop();
          paramIndex--;
        } else {
          throw new BadRequestError(`Invalid 'is' value: ${filter.value}. Use null, true, or false.`);
        }
        break;
      case 'in': {
        const inValues = filter.value.replace(/^\(|\)$/g, '').split(',');
        const placeholders = inValues.map((_, i) => `$${paramIndex + i}`);
        conditions.push(`${col} IN (${placeholders.join(', ')})`);
        values.pop(); // remove the raw value
        values.push(...inValues);
        paramIndex += inValues.length - 1;
        break;
      }
    }
  }

  return { clause: `WHERE ${conditions.join(' AND ')}`, values };
}

function buildOrderClause(order: ParsedOrder[], table: TableInfo): string {
  if (order.length === 0) return '';
  validateColumns(order.map(o => o.column), table);
  const parts = order.map(o => `${quoteIdentifier(o.column)} ${o.direction.toUpperCase()}`);
  return `ORDER BY ${parts.join(', ')}`;
}

export function buildSelectQuery(table: TableInfo, parsed: ParsedQuery): BuiltQuery {
  const qualifiedTable = quoteIdentifier(table.name);

  let selectColumns = '*';
  if (parsed.select) {
    validateColumns(parsed.select, table);
    selectColumns = parsed.select.map(c => quoteIdentifier(c)).join(', ');
  }

  const { clause: whereClause, values } = buildWhereClause(parsed.filters, table, 0);
  const orderClause = buildOrderClause(parsed.order, table);
  const limitClause = parsed.limit != null ? `LIMIT ${parsed.limit}` : 'LIMIT 100';
  const offsetClause = parsed.offset > 0 ? `OFFSET ${parsed.offset}` : '';

  const text = [
    `SELECT ${selectColumns} FROM ${qualifiedTable}`,
    whereClause,
    orderClause,
    limitClause,
    offsetClause,
  ].filter(Boolean).join(' ');

  return { text, values };
}

export function buildCountQuery(table: TableInfo, parsed: ParsedQuery): BuiltQuery {
  const qualifiedTable = quoteIdentifier(table.name);
  const { clause: whereClause, values } = buildWhereClause(parsed.filters, table, 0);
  const text = `SELECT count(*)::int AS count FROM ${qualifiedTable} ${whereClause}`;
  return { text, values };
}

export function buildInsertQuery(table: TableInfo, rows: Record<string, unknown>[]): BuiltQuery {
  if (rows.length === 0) throw new BadRequestError('Cannot insert empty array');

  const qualifiedTable = quoteIdentifier(table.name);
  const keys = Object.keys(rows[0]);
  validateColumns(keys, table);

  const columns = keys.map(k => quoteIdentifier(k)).join(', ');
  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];

  for (const row of rows) {
    const placeholders = keys.map((_, i) => `$${values.length + i + 1}`);
    rowPlaceholders.push(`(${placeholders.join(', ')})`);
    values.push(...keys.map(k => row[k]));
  }

  const text = `INSERT INTO ${qualifiedTable} (${columns}) VALUES ${rowPlaceholders.join(', ')} RETURNING *`;
  return { text, values };
}

export function buildUpsertQuery(
  table: TableInfo,
  rows: Record<string, unknown>[],
  ignoreDuplicates: boolean,
  onConflictColumns: string[] | null = null,
): BuiltQuery {
  if (rows.length === 0) throw new BadRequestError('Cannot upsert empty array');

  // Conflict target: prefer explicit ?on_conflict columns, fall back to primary key
  const conflictCols = onConflictColumns && onConflictColumns.length > 0
    ? onConflictColumns
    : table.primaryKey;

  if (conflictCols.length === 0) {
    throw new BadRequestError(
      `Table '${table.name}' has no primary key. Specify conflict columns via ?on_conflict=col1,col2`,
    );
  }

  validateColumns(conflictCols, table);

  const qualifiedTable = quoteIdentifier(table.name);
  const keys = Object.keys(rows[0]);
  validateColumns(keys, table);

  const columns = keys.map(k => quoteIdentifier(k)).join(', ');
  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];

  for (const row of rows) {
    const placeholders = keys.map((_, i) => `$${values.length + i + 1}`);
    rowPlaceholders.push(`(${placeholders.join(', ')})`);
    values.push(...keys.map(k => row[k]));
  }

  const conflictTarget = conflictCols.map(k => quoteIdentifier(k)).join(', ');
  let conflictClause: string;

  if (ignoreDuplicates) {
    conflictClause = `ON CONFLICT (${conflictTarget}) DO NOTHING`;
  } else {
    const updateKeys = keys.filter(k => !conflictCols.includes(k));
    if (updateKeys.length === 0) {
      conflictClause = `ON CONFLICT (${conflictTarget}) DO NOTHING`;
    } else {
      const updateClauses = updateKeys
        .map(k => `${quoteIdentifier(k)} = EXCLUDED.${quoteIdentifier(k)}`)
        .join(', ');
      conflictClause = `ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updateClauses}`;
    }
  }

  const text = `INSERT INTO ${qualifiedTable} (${columns}) VALUES ${rowPlaceholders.join(', ')} ${conflictClause} RETURNING *`;
  return { text, values };
}

export function buildUpdateQuery(
  table: TableInfo,
  body: Record<string, unknown>,
  filters: ParsedFilter[],
): BuiltQuery {
  if (filters.length === 0) {
    throw new BadRequestError('Update requires at least one filter');
  }

  const qualifiedTable = quoteIdentifier(table.name);
  const keys = Object.keys(body);
  validateColumns(keys, table);

  const setClauses = keys.map((k, i) => `${quoteIdentifier(k)} = $${i + 1}`);
  const setValues = keys.map(k => body[k]);

  const { clause: whereClause, values: whereValues } = buildWhereClause(filters, table, keys.length);

  const text = `UPDATE ${qualifiedTable} SET ${setClauses.join(', ')} ${whereClause} RETURNING *`;
  return { text, values: [...setValues, ...whereValues] };
}

export function buildDeleteQuery(table: TableInfo, filters: ParsedFilter[]): BuiltQuery {
  if (filters.length === 0) {
    throw new BadRequestError('Delete requires at least one filter');
  }

  const qualifiedTable = quoteIdentifier(table.name);
  const { clause: whereClause, values } = buildWhereClause(filters, table, 0);

  const text = `DELETE FROM ${qualifiedTable} ${whereClause} RETURNING *`;
  return { text, values };
}
