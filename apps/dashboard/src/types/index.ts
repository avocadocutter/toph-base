export interface Project {
  id: string;
  ref: string;
  name: string;
  dbName: string;
  status: string;
  publishableKey?: string;
  secretKey?: string;
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

export interface Migration {
  name: string;
  status: 'pending' | 'applied' | 'failed';
  appliedAt: string | null;
  errorMessage: string | null;
}

export interface MigrationListResponse {
  data: Migration[];
  pendingCount: number;
}

export interface MigrationDetail {
  name: string;
  content: string;
  status: string;
  appliedAt: string | null;
  errorMessage: string | null;
}

export interface ApplyMigrationsRequest {
  names: string[];
}

export interface ApplyMigrationsResponse {
  applied: string[];
  failed: Array<{ name: string; error: string }>;
}
