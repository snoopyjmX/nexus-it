import pg from "pg";

// Os testes de integração apagam o schema. A trava abaixo impede que eles
// rodem contra qualquer banco cujo nome não termine em _test.
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não definida. Suba o banco: docker compose up -d db (veja o README).");
  }
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Recusando rodar testes destrutivos no banco "${name}": o nome precisa terminar em _test.`);
  }
  return url;
}

export async function resetSchema(pool: pg.Pool): Promise<void> {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
}
