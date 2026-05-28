import fs from 'node:fs/promises';
import path from 'node:path';
import { PGliteStore } from './pglite-store.js';

export interface BranchInfo {
  name: string;
  createdAt: string;
  parentBranch: string | null;
}

interface BranchRegistry {
  activeBranch: string;
  branches: BranchInfo[];
}

const REGISTRY_FILE = 'branches.json';
const BRANCH_DATA_DIR = 'branch-data';

export class BranchManager {
  private dataDir: string;
  private registry!: BranchRegistry;
  private stores = new Map<string, PGliteStore>();
  private activeStore!: PGliteStore;
  private mu = false; // simple busy-lock for clone/reset ops

  private constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  static async create(dataDir: string, mainStore: PGliteStore): Promise<BranchManager> {
    const mgr = new BranchManager(dataDir);
    await mgr.loadRegistry();
    mgr.stores.set('main', mainStore);

    const active = mgr.registry.activeBranch;
    if (active !== 'main') {
      const branchDataDir = mgr.branchDataPath(active);
      const store = new PGliteStore(branchDataDir);
      await store.init();
      mgr.stores.set(active, store);
    }
    mgr.activeStore = mgr.stores.get(active)!;
    return mgr;
  }

  getActiveStore(): PGliteStore {
    return this.activeStore;
  }

  getActiveBranch(): string {
    return this.registry.activeBranch;
  }

  listBranches(): BranchInfo[] {
    return this.registry.branches;
  }

  async createBranch(name: string): Promise<BranchInfo> {
    this.validateBranchName(name);
    if (this.registry.branches.some(b => b.name === name)) {
      throw new Error(`Branch '${name}' already exists`);
    }
    await this.withLock(async () => {
      const src = this.getDataDirForBranch(this.registry.activeBranch);
      const dst = this.branchDataPath(name);
      await fs.mkdir(dst, { recursive: true });
      await copyDir(src, dst);
    });

    const branch: BranchInfo = {
      name,
      createdAt: new Date().toISOString(),
      parentBranch: this.registry.activeBranch,
    };
    this.registry.branches.push(branch);
    await this.saveRegistry();
    return branch;
  }

  async switchBranch(name: string): Promise<void> {
    if (!this.registry.branches.some(b => b.name === name)) {
      throw new Error(`Branch '${name}' does not exist`);
    }
    if (name === this.registry.activeBranch) return;

    if (!this.stores.has(name)) {
      const store = new PGliteStore(this.branchDataPath(name));
      await store.init();
      this.stores.set(name, store);
    }
    this.registry.activeBranch = name;
    this.activeStore = this.stores.get(name)!;
    await this.saveRegistry();
  }

  async deleteBranch(name: string): Promise<void> {
    if (name === 'main') throw new Error('Cannot delete the main branch');
    if (!this.registry.branches.some(b => b.name === name)) {
      throw new Error(`Branch '${name}' does not exist`);
    }
    if (this.registry.activeBranch === name) {
      await this.switchBranch('main');
    }
    const store = this.stores.get(name);
    if (store) {
      await store.end();
      this.stores.delete(name);
    }
    const dir = this.branchDataPath(name);
    await fs.rm(dir, { recursive: true, force: true });
    this.registry.branches = this.registry.branches.filter(b => b.name !== name);
    await this.saveRegistry();
  }

  async resetBranch(name: string): Promise<void> {
    if (name === 'main') throw new Error('Cannot reset the main branch');
    if (!this.registry.branches.some(b => b.name === name)) {
      throw new Error(`Branch '${name}' does not exist`);
    }
    await this.withLock(async () => {
      const wasActive = this.registry.activeBranch === name;
      const store = this.stores.get(name);
      if (store) {
        await store.end();
        this.stores.delete(name);
      }
      if (wasActive) {
        await this.switchBranch('main');
      }
      const dst = this.branchDataPath(name);
      await fs.rm(dst, { recursive: true, force: true });
      await fs.mkdir(dst, { recursive: true });
      const src = this.getDataDirForBranch('main');
      await copyDir(src, dst);

      const newStore = new PGliteStore(dst);
      await newStore.init();
      this.stores.set(name, newStore);
      if (wasActive) {
        this.registry.activeBranch = name;
        this.activeStore = newStore;
        await this.saveRegistry();
      }
    });
  }

  async getSchemaDiff(branchName: string): Promise<SchemaDiff> {
    if (!this.registry.branches.some(b => b.name === branchName)) {
      throw new Error(`Branch '${branchName}' does not exist`);
    }
    const mainStore = this.stores.get('main')!;
    let branchStore = this.stores.get(branchName);
    if (!branchStore) {
      branchStore = new PGliteStore(this.branchDataPath(branchName));
      await branchStore.init();
      this.stores.set(branchName, branchStore);
    }
    return computeSchemaDiff(mainStore, branchStore);
  }

  async applyDiffToMain(sqls: string[]): Promise<void> {
    const mainStore = this.stores.get('main')!;
    for (const sql of sqls) {
      await mainStore.exec(sql);
    }
  }

  async shutdown(): Promise<void> {
    for (const store of this.stores.values()) {
      await store.end().catch(() => {});
    }
    this.stores.clear();
  }

  private branchDataPath(name: string): string {
    return path.join(this.dataDir, BRANCH_DATA_DIR, name, 'data');
  }

  private getDataDirForBranch(name: string): string {
    if (name === 'main') return path.join(this.dataDir, 'data');
    return this.branchDataPath(name);
  }

  private async loadRegistry(): Promise<void> {
    const registryPath = path.join(this.dataDir, REGISTRY_FILE);
    try {
      const raw = await fs.readFile(registryPath, 'utf-8');
      this.registry = JSON.parse(raw);
    } catch {
      this.registry = {
        activeBranch: 'main',
        branches: [{ name: 'main', createdAt: new Date().toISOString(), parentBranch: null }],
      };
      await this.saveRegistry();
    }
  }

  private async saveRegistry(): Promise<void> {
    const registryPath = path.join(this.dataDir, REGISTRY_FILE);
    await fs.writeFile(registryPath, JSON.stringify(this.registry, null, 2), 'utf-8');
  }

  private validateBranchName(name: string): void {
    if (!/^[a-z][a-z0-9-]{0,49}$/.test(name)) {
      throw new Error('Branch name must be lowercase alphanumeric with hyphens, starting with a letter (max 50 chars)');
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.mu) throw new Error('Another branch operation is in progress');
    this.mu = true;
    try {
      return await fn();
    } finally {
      this.mu = false;
    }
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, dstPath);
      } else {
        await fs.copyFile(srcPath, dstPath);
      }
    }),
  );
}

// ── Schema diff ────────────────────────────────────────────────────────────

export interface DiffAddition {
  type: 'table' | 'column' | 'index';
  description: string;
  sql: string;
}

export interface DiffWarning {
  type: 'dropped_table' | 'dropped_column' | 'type_change';
  description: string;
}

export interface SchemaDiff {
  additions: DiffAddition[];
  warnings: DiffWarning[];
}

interface RawTable {
  table_name: string;
  table_schema: string;
}

interface RawColumn {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  character_maximum_length: number | null;
  ordinal_position: number;
}

interface RawPk {
  table_name: string;
  column_name: string;
}

interface RawIndex {
  table_name: string;
  index_name: string;
  index_def: string;
}

async function fetchSchema(store: PGliteStore): Promise<{
  tables: RawTable[];
  columns: RawColumn[];
  pks: RawPk[];
  indexes: RawIndex[];
}> {
  const [tables, columns, pks, indexes] = await Promise.all([
    store.query<RawTable>(`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `),
    store.query<RawColumn>(`
      SELECT table_name, column_name, data_type, udt_name, is_nullable,
             column_default, is_identity, character_maximum_length, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `),
    store.query<RawPk>(`
      SELECT kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
    `),
    store.query<RawIndex>(`
      SELECT t.relname AS table_name, i.relname AS index_name, pg_get_indexdef(ix.indexrelid) AS index_def
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND NOT ix.indisprimary
      ORDER BY t.relname, i.relname
    `),
  ]);
  return {
    tables: tables.rows,
    columns: columns.rows,
    pks: pks.rows,
    indexes: indexes.rows,
  };
}

async function computeSchemaDiff(mainStore: PGliteStore, branchStore: PGliteStore): Promise<SchemaDiff> {
  const [main, branch] = await Promise.all([fetchSchema(mainStore), fetchSchema(branchStore)]);

  const additions: DiffAddition[] = [];
  const warnings: DiffWarning[] = [];

  const mainTables = new Set(main.tables.map(t => t.table_name));
  const branchTables = new Set(branch.tables.map(t => t.table_name));

  // New tables in branch
  for (const tbl of branch.tables) {
    if (!mainTables.has(tbl.table_name)) {
      const cols = branch.columns.filter(c => c.table_name === tbl.table_name);
      const pks = branch.pks.filter(p => p.table_name === tbl.table_name).map(p => p.column_name);
      additions.push({
        type: 'table',
        description: `New table: ${tbl.table_name}`,
        sql: buildCreateTable(tbl.table_name, cols, pks),
      });
    }
  }

  // Dropped tables
  for (const tbl of main.tables) {
    if (!branchTables.has(tbl.table_name)) {
      warnings.push({ type: 'dropped_table', description: `Table removed on branch: ${tbl.table_name}` });
    }
  }

  // Column-level diff for shared tables
  for (const tblName of mainTables) {
    if (!branchTables.has(tblName)) continue;
    const mainCols = main.columns.filter(c => c.table_name === tblName);
    const branchCols = branch.columns.filter(c => c.table_name === tblName);
    const mainColNames = new Set(mainCols.map(c => c.column_name));
    const branchColNames = new Set(branchCols.map(c => c.column_name));

    for (const col of branchCols) {
      if (!mainColNames.has(col.column_name)) {
        additions.push({
          type: 'column',
          description: `New column: ${tblName}.${col.column_name} (${col.udt_name})`,
          sql: buildAddColumn(tblName, col),
        });
      } else {
        const mainCol = mainCols.find(c => c.column_name === col.column_name)!;
        if (mainCol.udt_name !== col.udt_name) {
          warnings.push({
            type: 'type_change',
            description: `Type changed: ${tblName}.${col.column_name} (${mainCol.udt_name} → ${col.udt_name})`,
          });
        }
      }
    }

    for (const col of mainCols) {
      if (!branchColNames.has(col.column_name)) {
        warnings.push({ type: 'dropped_column', description: `Column removed on branch: ${tblName}.${col.column_name}` });
      }
    }
  }

  // New indexes
  const mainIndexNames = new Set(main.indexes.map(i => i.index_name));
  for (const idx of branch.indexes) {
    if (!mainIndexNames.has(idx.index_name)) {
      additions.push({
        type: 'index',
        description: `New index: ${idx.index_name} on ${idx.table_name}`,
        sql: idx.index_def + ';',
      });
    }
  }

  return { additions, warnings };
}

function buildCreateTable(tableName: string, cols: RawColumn[], pks: string[]): string {
  const colDefs = cols.map(c => {
    const type = c.udt_name === 'uuid' ? 'uuid'
      : c.udt_name === 'int4' ? 'integer'
      : c.udt_name === 'int8' ? 'bigint'
      : c.udt_name === 'bool' ? 'boolean'
      : c.udt_name === 'timestamptz' ? 'timestamptz'
      : c.udt_name === 'text' ? 'text'
      : c.udt_name === 'jsonb' ? 'jsonb'
      : c.udt_name === 'float8' ? 'double precision'
      : c.udt_name === 'float4' ? 'real'
      : c.udt_name === 'numeric' ? 'numeric'
      : c.data_type === 'USER-DEFINED' ? c.udt_name
      : c.data_type;
    const nullable = c.is_nullable === 'YES' ? '' : ' NOT NULL';
    const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
    return `  ${c.column_name} ${type}${nullable}${def}`;
  });
  if (pks.length > 0) colDefs.push(`  PRIMARY KEY (${pks.join(', ')})`);
  return `CREATE TABLE public.${tableName} (\n${colDefs.join(',\n')}\n);`;
}

function buildAddColumn(tableName: string, col: RawColumn): string {
  const type = col.udt_name === 'uuid' ? 'uuid'
    : col.udt_name === 'int4' ? 'integer'
    : col.udt_name === 'int8' ? 'bigint'
    : col.udt_name === 'bool' ? 'boolean'
    : col.udt_name === 'timestamptz' ? 'timestamptz'
    : col.udt_name === 'text' ? 'text'
    : col.udt_name === 'jsonb' ? 'jsonb'
    : col.udt_name === 'float8' ? 'double precision'
    : col.udt_name === 'float4' ? 'real'
    : col.udt_name === 'numeric' ? 'numeric'
    : col.data_type === 'USER-DEFINED' ? col.udt_name
    : col.data_type;
  const nullable = col.is_nullable === 'YES' ? '' : ' NOT NULL';
  const def = col.column_default ? ` DEFAULT ${col.column_default}` : '';
  return `ALTER TABLE public.${tableName} ADD COLUMN ${col.column_name} ${type}${nullable}${def};`;
}
