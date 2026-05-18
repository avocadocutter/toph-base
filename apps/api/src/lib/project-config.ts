import fs from 'node:fs/promises';
import path from 'node:path';
import { generateProjectJwtSecret, generatePublishableKey, generateSecretKey } from '../plugins/auth/jwt.js';

export type Dialect = 'supabase' | 'pocketbase' | 'appwrite';

export interface ProjectConfig {
  dialect: Dialect | null;
  jwtSecret: string;
  publishableKey: string;
  secretKey: string;
  createdAt: string;
}

const CONFIG_FILE = 'config.json';

export async function loadOrCreateProjectConfig(dataDir: string): Promise<ProjectConfig> {
  const configPath = path.join(dataDir, CONFIG_FILE);
  await fs.mkdir(dataDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    // file doesn't exist yet — start fresh
  }

  // Already has required fields
  if (existing.jwtSecret && existing.publishableKey && existing.secretKey) {
    return existing as unknown as ProjectConfig;
  }

  // Generate missing crypto fields and merge into existing config
  const jwtSecret = (existing.jwtSecret as string | undefined) ?? generateProjectJwtSecret();
  const merged = {
    ...existing,
    dialect: (existing.dialect ?? null) as Dialect | null,
    jwtSecret,
    publishableKey: (existing.publishableKey as string | undefined) ?? await generatePublishableKey(jwtSecret),
    secretKey: (existing.secretKey as string | undefined) ?? await generateSecretKey(jwtSecret),
    createdAt: (existing.createdAt as string | undefined) ?? new Date().toISOString(),
  };

  await fs.writeFile(configPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged as ProjectConfig;
}

export async function saveProjectConfig(dataDir: string, config: ProjectConfig): Promise<void> {
  const configPath = path.join(dataDir, CONFIG_FILE);
  // Merge with existing so we don't lose port/migrationsDir written by the CLI
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
  } catch { /* ignore */ }
  await fs.writeFile(configPath, JSON.stringify({ ...existing, ...config }, null, 2), 'utf8');
}
