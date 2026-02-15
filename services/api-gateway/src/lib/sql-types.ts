import { BadRequestError } from './errors.js';

const ALLOWED_BASE_TYPES = new Set([
  // Numeric
  'smallint', 'integer', 'int', 'int2', 'int4', 'int8', 'bigint',
  'decimal', 'numeric', 'real', 'float4', 'float8', 'double precision',
  'serial', 'smallserial', 'bigserial',
  // Character
  'text', 'varchar', 'character varying', 'char', 'character',
  // Boolean
  'boolean', 'bool',
  // Date/Time
  'date', 'time', 'timetz', 'time with time zone', 'time without time zone',
  'timestamp', 'timestamptz', 'timestamp with time zone', 'timestamp without time zone',
  'interval',
  // UUID
  'uuid',
  // JSON
  'json', 'jsonb',
  // Binary
  'bytea',
  // Network
  'inet', 'cidr', 'macaddr', 'macaddr8',
  // Geometric
  'point', 'line', 'lseg', 'box', 'path', 'polygon', 'circle',
  // Text search
  'tsvector', 'tsquery',
  // Other
  'money', 'xml', 'bit', 'bit varying', 'varbit',
]);

// Matches: base_type, base_type(N), base_type(N,M), any of these with [] suffix
const TYPE_PATTERN = /^([a-z][a-z0-9_ ]*?)(?:\((\d+(?:\s*,\s*\d+)?)\))?(\[\])?$/i;

export function validateColumnType(rawType: string): string {
  const trimmed = rawType.trim().toLowerCase();
  const match = trimmed.match(TYPE_PATTERN);
  if (!match) {
    throw new BadRequestError(`Invalid column type: ${rawType}`);
  }

  const [, baseType, precision, arraySuffix] = match;
  if (!ALLOWED_BASE_TYPES.has(baseType.trim())) {
    throw new BadRequestError(`Disallowed column type: ${baseType.trim()}`);
  }

  // Reconstruct the validated type
  let result = baseType.trim();
  if (precision) result += `(${precision})`;
  if (arraySuffix) result += '[]';
  return result;
}

const SAFE_DEFAULT_PATTERNS = [
  /^NULL$/i,
  /^true$/i,
  /^false$/i,
  /^'[^']*'$/,                          // String literal (no embedded quotes)
  /^-?\d+(\.\d+)?$/,                    // Numeric literal
  /^now\(\)$/i,
  /^CURRENT_TIMESTAMP$/i,
  /^CURRENT_DATE$/i,
  /^CURRENT_TIME$/i,
  /^gen_random_uuid\(\)$/i,
  /^uuid_generate_v4\(\)$/i,
  /^'[^']*'::[a-z_]+$/i,               // Cast literal e.g. '{}'::jsonb
  /^'\{\}'::\s*jsonb?$/i,              // Empty JSON default
  /^'\[\]'::\s*jsonb?$/i,              // Empty JSON array default
  /^0$/,
  /^''$/,                               // Empty string
  /^B'[01]+'$/,                         // Bit string literal
];

export function validateDefaultValue(raw: string): string {
  const trimmed = raw.trim();
  for (const pattern of SAFE_DEFAULT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return trimmed;
    }
  }
  throw new BadRequestError(`Unsafe default value expression: ${raw}`);
}
