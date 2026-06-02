import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { hstore } from '@electric-sql/pglite/contrib/hstore';
import { ltree } from '@electric-sql/pglite/contrib/ltree';
import { fuzzystrmatch } from '@electric-sql/pglite/contrib/fuzzystrmatch';
import { tablefunc } from '@electric-sql/pglite/contrib/tablefunc';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';
import { intarray } from '@electric-sql/pglite/contrib/intarray';
import { btree_gin } from '@electric-sql/pglite/contrib/btree_gin';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { isn } from '@electric-sql/pglite/contrib/isn';
import { seg } from '@electric-sql/pglite/contrib/seg';
import { lo } from '@electric-sql/pglite/contrib/lo';
import { tcn } from '@electric-sql/pglite/contrib/tcn';
import { tsm_system_rows } from '@electric-sql/pglite/contrib/tsm_system_rows';
import { tsm_system_time } from '@electric-sql/pglite/contrib/tsm_system_time';
import { bloom } from '@electric-sql/pglite/contrib/bloom';
import { dict_int } from '@electric-sql/pglite/contrib/dict_int';
import { dict_xsyn } from '@electric-sql/pglite/contrib/dict_xsyn';
import { pg_buffercache } from '@electric-sql/pglite/contrib/pg_buffercache';
import { pg_freespacemap } from '@electric-sql/pglite/contrib/pg_freespacemap';
import { pg_surgery } from '@electric-sql/pglite/contrib/pg_surgery';
import { pg_visibility } from '@electric-sql/pglite/contrib/pg_visibility';
import { pg_walinspect } from '@electric-sql/pglite/contrib/pg_walinspect';
import { pageinspect } from '@electric-sql/pglite/contrib/pageinspect';
import { amcheck } from '@electric-sql/pglite/contrib/amcheck';
import { auto_explain } from '@electric-sql/pglite/contrib/auto_explain';
import { age } from '@electric-sql/pglite/age';
import { pg_hashids } from '@electric-sql/pglite/pg_hashids';
import { pg_ivm } from '@electric-sql/pglite/pg_ivm';
import { pg_uuidv7 } from '@electric-sql/pglite/pg_uuidv7';
import { pgtap } from '@electric-sql/pglite/pgtap';

const ALL_EXTENSIONS = {
  vector, pgcrypto, uuid_ossp, pg_trgm, citext, hstore, ltree, fuzzystrmatch,
  tablefunc, cube, earthdistance, intarray, btree_gin, btree_gist, unaccent,
  isn, seg, lo, tcn, tsm_system_rows, tsm_system_time, bloom, dict_int,
  dict_xsyn, pg_buffercache, pg_freespacemap, pg_surgery, pg_visibility,
  pg_walinspect, pageinspect, amcheck, auto_explain,
  // Added in PGlite 0.4.x
  age, pg_hashids, pg_ivm, pg_uuidv7, pgtap,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
  fields?: { name: string; dataTypeID: number }[];
}

export interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
}

export interface DbPool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  connect(): Promise<DbClient>;
  end(): Promise<void>;
  dumpDataDir?(): Promise<Buffer>;
  restoreFromDump?(dump: Buffer): Promise<void>;
}

// Statements intercepted at the client level and handled as no-ops in local mode.
// PGLite has a single built-in role; SET LOCAL ROLE is meaningless here.
const NOOP_STATEMENTS = /^\s*(SET\s+LOCAL\s+ROLE|SET\s+ROLE)\s+/i;

export class PGliteStore implements DbPool {
  private db: PGlite;
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.db = new PGlite({ dataDir, extensions: ALL_EXTENSIONS });
  }

  async init(): Promise<void> {
    await this.db.waitReady;
  }

  getPglite(): PGlite {
    return this.db;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(text, values as unknown[] | undefined);
    return { rows: result.rows, rowCount: result.rows.length, fields: result.fields };
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  connect(): Promise<DbClient> {
    const store = this;
    let inTransaction = false;

    const client: DbClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async query<T = any>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
        const trimmed = text.trim().toUpperCase();

        if (NOOP_STATEMENTS.test(text)) {
          return { rows: [], rowCount: 0 };
        }

        if (trimmed === 'BEGIN') {
          await store.db.exec('BEGIN');
          inTransaction = true;
          return { rows: [], rowCount: 0 };
        }

        if (trimmed === 'COMMIT') {
          await store.db.exec('COMMIT');
          inTransaction = false;
          return { rows: [], rowCount: 0 };
        }

        if (trimmed === 'ROLLBACK') {
          try {
            await store.db.exec('ROLLBACK');
          } catch {
            // Ignore rollback errors (no active transaction)
          }
          inTransaction = false;
          return { rows: [], rowCount: 0 };
        }

        const result = await store.db.query<T>(text, values as unknown[] | undefined);
        return { rows: result.rows, rowCount: result.rows.length };
      },

      release() {
        if (inTransaction) {
          store.db.exec('ROLLBACK').catch(() => {});
          inTransaction = false;
        }
      },
    };

    return Promise.resolve(client);
  }

  async dumpDataDir(): Promise<Buffer> {
    const blob = await this.db.dumpDataDir('gzip');
    return Buffer.from(await blob.arrayBuffer());
  }

  async restoreFromDump(dump: Buffer): Promise<void> {
    await this.db.close();
    const { rm, mkdir: mkdirFs } = await import('node:fs/promises');
    await rm(this.dataDir, { recursive: true, force: true });
    await mkdirFs(this.dataDir, { recursive: true });
    const blob = new Blob([dump], { type: 'application/x-gzip' });
    this.db = new PGlite({ dataDir: this.dataDir, loadDataDir: blob, extensions: ALL_EXTENSIONS });
    await this.db.waitReady;
  }

  async end(): Promise<void> {
    await this.db.close();
  }
}
