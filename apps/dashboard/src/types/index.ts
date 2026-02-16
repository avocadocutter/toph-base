export interface Project {
  id: string;
  ref: string;
  name: string;
  schemaName: string;
  jwtSecret?: string;
  status: string;
  publishableKey?: string;
  secretKey?: string;
  postgrestUrl?: string | null;
  postgrestHealth?: {
    url: string;
    isHealthy: boolean;
    lastCheck: number;
    lastError?: string;
  };
  memberRole: string;
  createdAt: string;
  updatedAt: string;
}

export interface TableSummary {
  schema: string;
  name: string;
  type: 'table' | 'view';
  columnCount: number;
  primaryKey: string[];
  rlsEnabled: boolean;
  rlsForced: boolean;
}

export interface TableDetail {
  schema: string;
  name: string;
  type: 'table' | 'view';
  columns: ColumnInfo[];
  primaryKey: string[];
  foreignKeys: ForeignKeyInfo[];
  rlsEnabled: boolean;
  rlsForced: boolean;
  rowCount: number;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  columnDefault: string | null;
  maxLength: number | null;
  isIdentity: boolean;
  isPrimaryKey: boolean;
}

export interface ForeignKeyInfo {
  columnName: string;
  foreignTable: string;
  foreignColumn: string;
  constraintName: string;
}

export interface UserRecord {
  id: string;
  email: string;
  role: string;
  emailConfirmed: boolean;
  isDisabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
}

export interface RlsPolicy {
  name: string;
  table: string;
  schema: string;
  command: string;
  permissive: boolean;
  roles: string[];
  using: string | null;
  withCheck: string | null;
}

export interface SqlResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: { name: string; dataTypeID: number }[];
  duration: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  limit: number;
  offset: number;
}
