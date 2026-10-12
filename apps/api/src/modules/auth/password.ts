import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

// ADR-009: 64 MiB por hash, ~0,4 s de CPU. Os parâmetros ficam dentro do hash
// guardado, então aumentar o custo (ou trocar por Argon2id) é só refazer o hash no login.
export const DEFAULT_PARAMS: ScryptParams = { N: 2 ** 16, r: 8, p: 2 };

const SALT_BYTES = 16;
const KEY_BYTES = 32;
// Um hash vindo do banco não pode mandar o servidor gastar memória à vontade.
const LIMITS = { N: 2 ** 18, r: 16, p: 16, keyBytes: 64 };
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const INTEGER = /^\d{1,10}$/;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  needsRehash(stored: string): boolean;
}

interface Parsed extends ScryptParams {
  salt: Buffer;
  key: Buffer;
}

function parse(stored: string): Parsed | null {
  const parts = stored.split("$");
  const [algorithm, n, r, p, salt, key] = parts;
  if (parts.length !== 6 || algorithm !== "scrypt") return null;
  if (!INTEGER.test(n ?? "") || !INTEGER.test(r ?? "") || !INTEGER.test(p ?? "")) return null;
  if (!BASE64URL.test(salt ?? "") || !BASE64URL.test(key ?? "")) return null;

  const parsed = { N: Number(n), r: Number(r), p: Number(p), salt: Buffer.from(salt ?? "", "base64url"), key: Buffer.from(key ?? "", "base64url") };
  const powerOfTwo = parsed.N >= 2 && (parsed.N & (parsed.N - 1)) === 0;
  if (!powerOfTwo || parsed.N > LIMITS.N || parsed.r < 1 || parsed.r > LIMITS.r || parsed.p < 1 || parsed.p > LIMITS.p) return null;
  if (parsed.key.length < 16 || parsed.key.length > LIMITS.keyBytes) return null;
  return parsed;
}

function derive(password: string, salt: Buffer, keyBytes: number, { N, r, p }: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem com folga sobre os 128 * N * r bytes que o scrypt precisa.
    scrypt(password, salt, keyBytes, { N, r, p, maxmem: 256 * N * r }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export function createPasswordHasher(params: ScryptParams = DEFAULT_PARAMS): PasswordHasher {
  return {
    async hash(password) {
      const salt = randomBytes(SALT_BYTES);
      const key = await derive(password, salt, KEY_BYTES, params);
      return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
    },

    async verify(password, stored) {
      const parsed = parse(stored);
      if (!parsed) return false;
      try {
        const key = await derive(password, parsed.salt, parsed.key.length, parsed);
        return timingSafeEqual(key, parsed.key);
      } catch {
        return false;
      }
    },

    needsRehash(stored) {
      const parsed = parse(stored);
      return !parsed || parsed.N !== params.N || parsed.r !== params.r || parsed.p !== params.p;
    },
  };
}
