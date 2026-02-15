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
