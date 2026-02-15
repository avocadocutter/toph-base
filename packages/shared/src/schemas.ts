import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const signinSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const createTableSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid table name'),
  schema: z.string().default('public'),
  columns: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid column name'),
    type: z.string().min(1),
    nullable: z.boolean().default(true),
    defaultValue: z.string().optional(),
    primaryKey: z.boolean().default(false),
  })).min(1, 'At least one column is required'),
  enableRls: z.boolean().default(false),
});

export const createPolicySchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid policy name'),
  table: z.string().min(1),
  schema: z.string().default('public'),
  command: z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL']),
  permissive: z.boolean().default(true),
  roles: z.array(z.string()).default(['authenticated']),
  using: z.string().optional(),
  withCheck: z.string().optional(),
});

export const sqlQuerySchema = z.object({
  query: z.string().min(1, 'Query is required').max(100000),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type SigninInput = z.infer<typeof signinSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type CreateTableInput = z.infer<typeof createTableSchema>;
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type SqlQueryInput = z.infer<typeof sqlQuerySchema>;
