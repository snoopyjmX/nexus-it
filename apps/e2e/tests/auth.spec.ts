import { expect, test } from "@playwright/test";
import { PASSWORD, USERS } from "../env.js";

test("credencial inválida mostra erro genérico e não entra [FR-01]", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("inexistente@exemplo.local");
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toHaveText("E-mail ou senha incorretos.");
  await expect(page.getByRole("heading", { name: "Entrar no NEXUS IT" })).toBeVisible();
});

test("entra e sai só pelo teclado, e o logout invalida a sessão no servidor [FR-01, NFR-06]", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").focus();
  await page.keyboard.type(USERS.requester2);
  await page.keyboard.press("Tab");
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();

  // As chamadas à API abaixo passam pelo proxy do Vite, como as do navegador.
  const cookies = await page.context().cookies();
  const session = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  expect((await request.get("/api/v1/auth/me", { headers: { cookie: session } })).status()).toBe(200);

  await page.getByRole("button", { name: "Sair" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Entrar no NEXUS IT" })).toBeVisible();

  // O cookie antigo reenviado à mão não vale mais: o token foi revogado no servidor, não só apagado no navegador.
  expect((await request.get("/api/v1/auth/me", { headers: { cookie: session } })).status()).toBe(401);
});

test("rota protegida sem sessão leva ao login [FR-01]", async ({ page }) => {
  await page.goto("/chamados");
  await expect(page.getByRole("heading", { name: "Entrar no NEXUS IT" })).toBeVisible();
});
