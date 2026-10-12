import { expect, test as setup } from "@playwright/test";
import { authFile, PASSWORD, USERS, type Who } from "../env.js";

// Um login por conta e execução: o limite por IP (20 a cada 15 min) conta toda tentativa.
for (const who of Object.keys(USERS) as Who[]) {
  setup(`entra como ${who}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(USERS[who]);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
    await page.context().storageState({ path: authFile(who) });
  });
}
