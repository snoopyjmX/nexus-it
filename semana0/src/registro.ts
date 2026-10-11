import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function commit(): string {
  try {
    const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const sujo = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
    return sujo ? `${hash}-com-alteracoes` : hash;
  } catch {
    return "desconhecido";
  }
}

export function ambiente() {
  return {
    data: new Date().toISOString(),
    commit: commit(),
    node: process.version,
    so: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "desconhecida",
    memoriaGb: Math.round(os.totalmem() / 1024 ** 3),
  };
}

export async function salvar(dir: string, nome: string, conteudo: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const arquivo = path.join(dir, nome);
  await writeFile(arquivo, conteudo);
  return arquivo;
}

export const carimbo = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

export function argumento(nome: string, padrao?: string): string {
  const i = process.argv.indexOf(`--${nome}`);
  const valor = i === -1 ? padrao : process.argv[i + 1];
  if (valor === undefined) throw new Error(`Falta o argumento --${nome}`);
  return valor;
}
