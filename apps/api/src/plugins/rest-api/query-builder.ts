/**
 * query-builder.ts
 *
 * Builds parameterized SQL strings from a ParsedQuery object.
 * All user input arrives pre-validated; column names are quoted via quoteIdentifier().
 *
 * To add a new filter operator: add a case in buildFilterExpr().
 * To add relationship embedding: extend buildRelationSubquery() using TableInfo.foreignKeys.
 */

import type { ParsedQuery, ParsedFilter, ParsedOrder, RelationSpec, EmbeddedFilter } from './query-parser.js';
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

// Builds a single SQL condition expression from a ParsedFilter.
// Mutates `values` by pushing consumed params. Returns the expression and how many params were consumed.
function buildFilterExpr(
  filter: ParsedFilter,
  paramIndex: number,
  values: unknown[],
  coercedValue?: unknown,
): { expr: string; consumed: number } {
  const col = quoteIdentifier(filter.column);
  const paramValue = coercedValue !== undefined ? coercedValue : filter.value;
  let expr: string;
  let consumed = 0;

  switch (filter.operator) {
    case 'eq':
      values.push(paramValue);
      expr = `${col} = $${paramIndex + 1}`;
      consumed = 1;
      break;
    case 'neq':
      values.push(paramValue);
      expr = `${col} != $${paramIndex + 1}`;
      consumed = 1;
      break;
    case 'gt':
      values.push(paramValue);
      expr = `${col} > $${paramIndex + 1}`;
      consumed = 1;
      break;
    case 'gte':
      values.push(paramValue);
      expr = `${col} >= $${paramIndex + 1}`;
      consumed = 1;
      break;
    case 'lt':
      values.push(paramValue);
      expr = `${col} < $${paramIndex + 1}`;
      consumed = 1;
      break;
    case 'lte':
      values.push(paramValue);
      expr = `${col} <= $${paramIndex + 1}`;
      consumed = 1;
      break;
    case 'like':
      values.push(paramValue);
      expr = `${col} LIKE $${paramIndex + 1}`;
      consumed = 1;
      break;
    case 'ilike':
      values.push(paramValue);
      expr = `${col} ILIKE $${paramIndex + 1}`;
      consumed = 1;
      break;
    case 'is':
      if (filter.value === 'null')        expr = `${col} IS NULL`;
      else if (filter.value === 'true')   expr = `${col} IS TRUE`;
      else if (filter.value === 'false')  expr = `${col} IS FALSE`;
      else throw new BadRequestError(`Invalid 'is' value: ${filter.value}. Use null, true, or false.`);
      consumed = 0;
      break;
    case 'in': {
      const inValues = filter.value.replace(/^\(|\)$/g, '').split(',');
      const placeholders = inValues.map((_, i) => `$${paramIndex + 1 + i}`);
      expr = `${col} IN (${placeholders.join(', ')})`;
      values.push(...inValues);
      consumed = inValues.length;
      break;
    }
    default:
      throw new BadRequestError(`Invalid filter operator: ${(filter as ParsedFilter).operator}`);
  }

  if (filter.negate) expr = `NOT (${expr})`;
  return { expr, consumed };
}

function coerceFilterValue(rawValue: string, table: TableInfo, columnName: string): unknown {
  const col = table.columns.find(c => c.name === columnName);
  if (!col) return rawValue;
  const dt = (col.dataType || col.udtName || '').toLowerCase();
  if (dt === 'boolean') {
    if (rawValue === 'true') return true;
    if (rawValue === 'false') return false;
  }
  return rawValue;
}

function buildWhereClause(
  filters: ParsedFilter[],
  orFilters: ParsedFilter[],
  table: TableInfo,
  paramOffset: number,
): { clause: string; values: unknown[] } {
  const values: unknown[] = [];
  let paramIndex = paramOffset;

  const andConditions: string[] = [];
  if (filters.length > 0) {
    validateColumns(filters.map(f => f.column), table);
    for (const filter of filters) {
      const coerced = coerceFilterValue(filter.value, table, filter.column);
      const { expr, consumed } = buildFilterExpr(filter, paramIndex, values, coerced);
      andConditions.push(expr);
      paramIndex += consumed;
    }
  }

  const orConditions: string[] = [];
  if (orFilters.length > 0) {
    validateColumns(orFilters.map(f => f.column), table);
    for (const filter of orFilters) {
      const coerced = coerceFilterValue(filter.value, table, filter.column);
      const { expr, consumed } = buildFilterExpr(filter, paramIndex, values, coerced);
      orConditions.push(expr);
      paramIndex += consumed;
    }
  }

  if (andConditions.length === 0 && orConditions.length === 0) return { clause: '', values };

  const parts: string[] = [];
  if (andConditions.length > 0) parts.push(andConditions.join(' AND '));
  if (orConditions.length > 0) parts.push(`(${orConditions.join(' OR ')})`);

  return { clause: `WHERE ${parts.join(' AND ')}`, values };
}

function buildOrderClause(order: ParsedOrder[], table: TableInfo): string {
  if (order.length === 0) return '';
  validateColumns(order.map(o => o.column), table);
  const parts = order.map(o => {
    let sql = `${quoteIdentifier(o.column)} ${o.direction.toUpperCase()}`;
    if (o.nulls) sql += ` NULLS ${o.nulls.toUpperCase()}`;
    return sql;
  });
  return `ORDER BY ${parts.join(', ')}`;
}

function pgLiteralInline(val: string): string {
  if (val === 'null') return 'NULL';
  if (val === 'true') return 'TRUE';
  if (val === 'false') return 'FALSE';
  if (/^-?\d+(\.\d+)?$/.test(val)) return val;
  return `'${val.replace(/'/g, "''")}'`;
}

function buildEmbeddedWhereExtra(filters: ParsedFilter[]): string {
  if (filters.length === 0) return '';
  const parts = filters.map(f => {
    const col = quoteIdentifier(f.column);
    let expr: string;
    switch (f.operator) {
      case 'eq':   expr = `${col} = ${pgLiteralInline(f.value)}`; break;
      case 'neq':  expr = `${col} != ${pgLiteralInline(f.value)}`; break;
      case 'gt':   expr = `${col} > ${pgLiteralInline(f.value)}`; break;
      case 'gte':  expr = `${col} >= ${pgLiteralInline(f.value)}`; break;
      case 'lt':   expr = `${col} < ${pgLiteralInline(f.value)}`; break;
      case 'lte':  expr = `${col} <= ${pgLiteralInline(f.value)}`; break;
      case 'like': expr = `${col} LIKE ${pgLiteralInline(f.value)}`; break;
      case 'ilike':expr = `${col} ILIKE ${pgLiteralInline(f.value)}`; break;
      case 'is':
        if (f.value === 'null')       expr = `${col} IS NULL`;
        else if (f.value === 'true')  expr = `${col} IS TRUE`;
        else if (f.value === 'false') expr = `${col} IS FALSE`;
        else expr = `${col} IS NULL`;
        break;
      case 'in': {
        const vals = f.value.replace(/^\(|\)$/g, '').split(',').map(pgLiteralInline);
        expr = `${col} IN (${vals.join(', ')})`;
        break;
      }
      default: expr = `${col} = ${pgLiteralInline(f.value)}`;
    }
    return f.negate ? `NOT (${expr})` : expr;
  });
  return ' AND ' + parts.join(' AND ');
}

// Builds a correlated subquery expression for an embedded relation.
// Returns null if no FK relationship can be found in either direction.
function buildRelationSubquery(
  table: TableInfo,
  rel: RelationSpec,
  allTables: Map<string, TableInfo>,
  embeddedFilters: ParsedFilter[],
): string | null {
  const relTable = allTables.get(rel.name);
  if (!relTable) return null;

  if (!rel.countOnly && rel.columns) {
    const validCols = new Set(relTable.columns.map(c => c.name));
    for (const col of rel.columns) {
      if (!validCols.has(col)) {
        throw new BadRequestError(`Unknown column '${col}' in relation '${rel.name}'`);
      }
    }
  }

  const relColsSql = rel.columns
    ? rel.columns.map(c => quoteIdentifier(c)).join(', ')
    : '*';

  const quotedRel    = quoteIdentifier(rel.name);
  const quotedAlias  = quoteIdentifier(rel.alias ?? rel.name);
  const quotedMain   = quoteIdentifier(table.name);
  const extraWhere   = buildEmbeddedWhereExtra(embeddedFilters);

  // Many-to-one: current table has FK → related table (e.g. posts.user_id → users.id)
  const manyToOne = table.foreignKeys.find(fk => fk.foreignTable === rel.name);
  if (manyToOne) {
    const localCol   = quoteIdentifier(manyToOne.columnName);
    const foreignCol = quoteIdentifier(manyToOne.foreignColumn);
    const joinCond   = `${foreignCol} = ${quotedMain}.${localCol}`;
    if (rel.countOnly) {
      return (
        `json_build_array(json_build_object('count', ` +
        `(SELECT count(*)::int FROM ${quotedRel} WHERE ${joinCond}${extraWhere}))) ` +
        `AS ${quotedAlias}`
      );
    }
    return (
      `(SELECT row_to_json(r) FROM ` +
      `(SELECT ${relColsSql} FROM ${quotedRel} WHERE ${joinCond}${extraWhere} LIMIT 1) r) ` +
      `AS ${quotedAlias}`
    );
  }

  // One-to-many: related table has FK → current table (e.g. comments.post_id → posts.id)
  const oneToMany = relTable.foreignKeys.find(fk => fk.foreignTable === table.name);
  if (oneToMany) {
    const relCol   = quoteIdentifier(oneToMany.columnName);
    const localCol = quoteIdentifier(oneToMany.foreignColumn);
    const joinCond = `${relCol} = ${quotedMain}.${localCol}`;
    if (rel.countOnly) {
      return (
        `json_build_array(json_build_object('count', ` +
        `(SELECT count(*)::int FROM ${quotedRel} WHERE ${joinCond}${extraWhere}))) ` +
        `AS ${quotedAlias}`
      );
    }
    return (
      `COALESCE((SELECT json_agg(row_to_json(r)) FROM ` +
      `(SELECT ${relColsSql} FROM ${quotedRel} WHERE ${joinCond}${extraWhere}) r), '[]'::json) ` +
      `AS ${quotedAlias}`
    );
  }

  return null;
}

export function buildSelectQuery(
  table: TableInfo,
  parsed: ParsedQuery,
  allTables?: Map<string, TableInfo>,
): BuiltQuery {
  const qualifiedTable = quoteIdentifier(table.name);

  let selectColumns = '*';
  if (parsed.select) {
    validateColumns(parsed.select, table);
    selectColumns = parsed.select.map(c => quoteIdentifier(c)).join(', ');
  }

  const relationExprs: string[] = [];
  if (parsed.relations.length > 0 && allTables) {
    for (const rel of parsed.relations) {
      const relFilters = (parsed.embeddedFilters as EmbeddedFilter[])
        .filter(ef => ef.relation === rel.name)
        .map(ef => ef.filter);
      const expr = buildRelationSubquery(table, rel, allTables, relFilters);
      if (expr) relationExprs.push(expr);
    }
  }

  const fullSelect = [selectColumns, ...relationExprs].join(', ');
  const { clause: whereClause, values } = buildWhereClause(parsed.filters, parsed.orFilters, table, 0);
  const orderClause = buildOrderClause(parsed.order, table);
  const limitClause = parsed.limit != null ? `LIMIT ${parsed.limit}` : 'LIMIT 100';
  const offsetClause = parsed.offset > 0 ? `OFFSET ${parsed.offset}` : '';

  const text = [
    `SELECT ${fullSelect} FROM ${qualifiedTable}`,
    whereClause,
    orderClause,
    limitClause,
    offsetClause,
  ].filter(Boolean).join(' ');

  return { text, values };
}

export function buildCountQuery(table: TableInfo, parsed: ParsedQuery): BuiltQuery {
  const qualifiedTable = quoteIdentifier(table.name);
  const { clause: whereClause, values } = buildWhereClause(parsed.filters, parsed.orFilters, table, 0);
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
  orFilters: ParsedFilter[] = [],
): BuiltQuery {
  if (filters.length === 0 && orFilters.length === 0) {
    throw new BadRequestError('Update requires at least one filter');
  }

  const qualifiedTable = quoteIdentifier(table.name);
  const keys = Object.keys(body);
  validateColumns(keys, table);

  const setClauses = keys.map((k, i) => `${quoteIdentifier(k)} = $${i + 1}`);
  const setValues = keys.map(k => body[k]);

  const { clause: whereClause, values: whereValues } = buildWhereClause(filters, orFilters, table, keys.length);

  const text = `UPDATE ${qualifiedTable} SET ${setClauses.join(', ')} ${whereClause} RETURNING *`;
  return { text, values: [...setValues, ...whereValues] };
}

export function buildDeleteQuery(
  table: TableInfo,
  filters: ParsedFilter[],
  orFilters: ParsedFilter[] = [],
): BuiltQuery {
  if (filters.length === 0 && orFilters.length === 0) {
    throw new BadRequestError('Delete requires at least one filter');
  }

  const qualifiedTable = quoteIdentifier(table.name);
  const { clause: whereClause, values } = buildWhereClause(filters, orFilters, table, 0);

  const text = `DELETE FROM ${qualifiedTable} ${whereClause} RETURNING *`;
  return { text, values };
}
