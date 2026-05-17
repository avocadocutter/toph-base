// Compatibility shim — re-exports the PGliteStore interface so files that
// import from './pool.js' continue to compile without changes.
export type { DbPool, DbClient, QueryResult } from './pglite-store.js';
