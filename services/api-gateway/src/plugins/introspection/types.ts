export interface IntrospectedTable {
  schema: string;
  name: string;
  type: 'table' | 'view';
}

export interface IntrospectedColumn {
  tableName: string;
  columnName: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  columnDefault: string | null;
  maxLength: number | null;
  isIdentity: boolean;
}

export interface IntrospectedPrimaryKey {
  tableName: string;
  columnName: string;
}

export interface IntrospectedForeignKey {
  tableName: string;
  columnName: string;
  foreignTable: string;
  foreignColumn: string;
  constraintName: string;
}

export interface SchemaCache {
  tables: Map<string, TableInfo>;
  lastUpdated: number;
}

export interface TableInfo {
  schema: string;
  name: string;
  type: 'table' | 'view';
  columns: ColumnInfo[];
  primaryKey: string[];
  foreignKeys: ForeignKeyInfo[];
  rlsEnabled: boolean;
  rlsForced: boolean;
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
