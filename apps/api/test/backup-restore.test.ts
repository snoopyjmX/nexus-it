import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetSchema, testDatabaseUrl } from "./test-db.js";

// T-14: o backup precisa restaurar em banco vazio. Roda contra o Postgres do compose (o mesmo container que
// fornece o pg_dump 17). Sem ele o teste é pulado, e isso inclui a CI (serviço de Postgres, não compose): lá a
// prova de T-14 é o drill 1 do RUNBOOK, feito à mão no release.
const root = new URL("../../../", import.meta.url).pathname;
const sh = (script: string, ...args: string[]) => execFileSync(`${root}scripts/${script}`, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const compose = (...args: string[]) => execFileSync("docker", ["compose", "exec", "-T", "db", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let composeUp = false;
try {
  compose("pg_isready", "-U", "nexus");
  composeUp = true;
} catch {
  composeUp = false;
}

const RESTORED = "nexus_restore_teste";
const CORRUPT = "nexus_restore_corrompido";

describe.skipIf(!composeUp)("backup e restore (T-14)", () => {
  const url = composeUp ? testDatabaseUrl() : "";
  const source = new pg.Pool({ connectionString: url, max: 2 });
  let dump = "";

  const restoredUrl = () => {
    const target = new URL(url);
    target.pathname = `/${RESTORED}`;
    return target.toString();
  };

  beforeAll(async () => {
    compose("dropdb", "-U", "nexus", "--if-exists", RESTORED);
    await resetSchema(source);
    await source.query("CREATE TABLE marcador (id int PRIMARY KEY, texto text NOT NULL)");
    await source.query("INSERT INTO marcador VALUES (1, 'um'), (2, 'dois')");
  });

  afterAll(async () => {
    compose("dropdb", "-U", "nexus", "--if-exists", RESTORED);
    compose("dropdb", "-U", "nexus", "--if-exists", CORRUPT);
    if (dump) rmSync(dump, { force: true });
    await source.end();
  });

  it("o dump é gerado só com permissão do dono e o restore recria os dados em banco novo", async () => {
    const sourceDb = new URL(url).pathname.slice(1);
    dump = `${root}${sh("backup.sh", sourceDb).trim()}`; // o script imprime o caminho relativo à raiz
    expect(statSync(dump).size).toBeGreaterThan(0);
    expect(statSync(dump).mode & 0o777).toBe(0o600);

    sh("restore.sh", dump, RESTORED);
    const restored = new pg.Pool({ connectionString: restoredUrl(), max: 1 });
    try {
      const { rows } = await restored.query("SELECT id, texto FROM marcador ORDER BY id");
      expect(rows).toEqual([{ id: 1, texto: "um" }, { id: 2, texto: "dois" }]);
    } finally {
      await restored.end();
    }
  });

  it("o restore nunca sobrescreve um banco que já existe", () => {
    expect(dump).not.toBe(""); // depende do teste anterior ter gerado o dump
    expect(() => sh("restore.sh", dump, RESTORED)).toThrow(/já existe/);
    expect(() => sh("restore.sh", dump, "nexus")).toThrow(/já existe/);
  });

  it("recusa nome de banco que não seja um identificador simples, no backup e no restore", () => {
    expect(() => sh("backup.sh", "x; DROP DATABASE nexus")).toThrow(/inválido/);
    expect(() => sh("restore.sh", dump, "x; DROP DATABASE nexus")).toThrow(/inválido/);
  });

  // Cada chamada ao compose leva ~1 s; o padrão do Vitest (5 s) é menor que este teste.
  it("dump corrompido: o restore falha e não deixa banco criado", { timeout: 60_000 }, () => {
    const broken = join(mkdtempSync(join(tmpdir(), "nexus-dump-")), "quebrado.dump");
    writeFileSync(broken, "isto não é um dump do pg_dump");
    try {
      expect(() => sh("restore.sh", broken, CORRUPT)).toThrow(/restore falhou/);
      expect(compose("psql", "-U", "nexus", "-d", "postgres", "-Atc", `SELECT 1 FROM pg_database WHERE datname = '${CORRUPT}'`).trim()).toBe("");
    } finally {
      rmSync(dirname(broken), { recursive: true, force: true });
    }
  });

  it("backups/ e *.dump ficam fora do Git", () => {
    expect(() => execFileSync("git", ["check-ignore", "-q", "backups/x.dump"], { cwd: root })).not.toThrow();
  });
});
