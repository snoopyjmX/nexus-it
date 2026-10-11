import pg from "pg";

export interface Database {
  ping(): Promise<void>;
}

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000 });
}

export function createDatabase(pool: pg.Pool): Database {
  return {
    async ping() {
      await pool.query("SELECT 1");
    },
  };
}
