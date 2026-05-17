import fs from 'node:fs/promises';
import path from 'node:path';
import { generateProjectJwtSecret, generatePublishableKey, generateSecretKey } from '../plugins/auth/jwt.js';

export type Dialect = 'supabase' | 'pocketbase' | 'appwrite';

export interface ProjectConfig {
  dialect: Dialect | null;
  jwtSecret: string;
  publishableKey: string;  // safe for client-side code, used with createClient()
  secretKey: string;       // server-side only, bypasses RLS
  createdAt: string;
}

export async function loadOrCreateProjectConfig(dataDir: string): Promise<ProjectConfig> {
  const configPath = path.join(dataDir, 'vibebase-config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw) as ProjectConfig;
    // Migrate legacy configs that used anonKey
    if ('anonKey' in config && !config.publishableKey) {
      config.publishableKey = (config as unknown as { anonKey: string }).anonKey;
      config.secretKey = generateSecretKey();
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    }
    return config;
  } catch {
    const config: ProjectConfig = {
      dialect: null,
      jwtSecret: generateProjectJwtSecret(),
      publishableKey: generatePublishableKey(),
      secretKey: generateSecretKey(),
      createdAt: new Date().toISOString(),
    };
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    return config;
  }
}

export async function saveProjectConfig(dataDir: string, config: ProjectConfig): Promise<void> {
  const configPath = path.join(dataDir, 'vibebase-config.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}
