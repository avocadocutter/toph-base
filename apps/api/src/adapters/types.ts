import type { FastifyRequest, FastifyReply } from 'fastify';
import type { QueryResult } from '../db/pglite-store.js';

// ── Storage layer — implemented by PGliteStore and future stores ──

export interface IDataStore {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  migrate(sql: string): Promise<void>;
  introspect(): Promise<TableSchema[]>;
}

export interface TableSchema {
  name: string;
  schema: string;
  columns: ColumnSchema[];
}

export interface ColumnSchema {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  columnDefault: string | null;
  foreignTable?: string;
  foreignColumn?: string;
}

// ── Graduation export — separate from protocol concerns ──

export interface ExportPayload {
  tables: Record<string, Record<string, unknown>[]>;
  exportedAt: string;
}

export interface IGraduationExporter {
  exportSchema(): Promise<string>;   // PostgreSQL DDL string
  exportData(): Promise<ExportPayload>;
}

// ── Protocol adapter — the HTTP surface for a specific BaaS dialect ──

export interface IProtocolAdapter {
  readonly name: string;
  readonly version: string;
  handleRequest(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  handleAuth(req: FastifyRequest, reply: FastifyReply): Promise<void>;
}
