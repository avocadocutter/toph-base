import { PGlite } from '@electric-sql/pglite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

export interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
}

export interface DbPool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  connect(): Promise<DbClient>;
  end(): Promise<void>;
}

// Statements intercepted at the client level and handled as no-ops in local mode.
// PGLite has a single built-in role; SET LOCAL ROLE is meaningless here.
const NOOP_STATEMENTS = /^\s*(SET\s+LOCAL\s+ROLE|SET\s+ROLE)\s+/i;

export class PGliteStore implements DbPool {
  private db: PGlite;

  constructor(dataDir: string) {
    this.db = new PGlite(dataDir);
  }

  async init(): Promise<void> {
    await this.db.waitReady;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(text, values as unknown[] | undefined);
    return { rows: result.rows, rowCount: result.rows.length };
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

  async end(): Promise<void> {
    await this.db.close();
  }
}
