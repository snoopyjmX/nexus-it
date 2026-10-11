import { existsSync } from "node:fs";
import path from "node:path";

const envTest = path.resolve(import.meta.dirname, "../../.env.test");
if (!process.env.DATABASE_URL && existsSync(envTest)) process.loadEnvFile(envTest);
