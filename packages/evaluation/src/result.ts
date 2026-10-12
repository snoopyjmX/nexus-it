import { execFileSync } from "node:child_process";
import os from "node:os";
import type { SuiteSummary } from "./suite.js";

export const RESULT_SCHEMA_VERSION = 1;

export interface Environment {
  date: string;
  commit: string;
  node: string;
  os: string;
  cpu: string;
  memoryGb: number;
}

export interface EvalResult {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  set: "dev" | "test";
  datasetVersion: string;
  searchMode: "lexical" | "vector";
  embeddingModel: string | null;
  environment: Environment;
  suite: SuiteSummary;
}

function commit(): string {
  try {
    const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "";
    return dirty ? `${hash}-com-alteracoes` : hash;
  } catch {
    return "desconhecido";
  }
}

export function environmentInfo(): Environment {
  return {
    date: new Date().toISOString(),
    commit: commit(),
    node: process.version,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "desconhecida",
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
  };
}
