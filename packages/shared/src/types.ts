export interface TableMetadata {
  schema: string;
  name: string;
  type: 'table' | 'view';
  columns: ColumnMetadata[];
  primaryKey: string[];
  foreignKeys: ForeignKeyMetadata[];
  rlsEnabled: boolean;
  rlsForced: boolean;
  rowCount: number;
}

export interface ColumnMetadata {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  columnDefault: string | null;
  maxLength: number | null;
  isIdentity: boolean;
  isPrimaryKey: boolean;
}

export interface ForeignKeyMetadata {
  columnName: string;
  foreignTable: string;
  foreignColumn: string;
  constraintName: string;
}

export interface RlsPolicy {
  name: string;
  table: string;
  schema: string;
  command: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  permissive: boolean;
  roles: string[];
  using: string | null;
  withCheck: string | null;
}

export interface User {
  id: string;
  email: string;
  role: string;
  emailConfirmed: boolean;
  isDisabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthResponse {
  tokens: AuthTokens;
  user: Omit<User, 'metadata'>;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  limit: number;
  offset: number;
}

export type FilterOperator =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'ilike'
  | 'is' | 'in';
