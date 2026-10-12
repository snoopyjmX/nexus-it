import type { Browser, Page } from "@playwright/test";
import { authFile, type Who } from "./env.js";

// Abre uma página já autenticada como essa conta (estado salvo por tests/auth.setup.ts).
export async function as(browser: Browser, who: Who): Promise<Page> {
  return (await browser.newContext({ storageState: authFile(who) })).newPage();
}
