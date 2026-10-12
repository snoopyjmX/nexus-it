import { expect, test } from "@playwright/test";
import { as } from "../as.js";

test("rascunho fica escondido do solicitante até o técnico publicar [FR-06, FR-07]", async ({ browser }) => {
  const title = `Wi-Fi cai ao acordar o notebook ${Date.now()}`;
  const technician = await as(browser, "technician");
  await technician.goto("/base/novo");
  await technician.getByLabel("Título").fill(title);
  await technician.getByLabel("Sintoma").fill("O notebook perde a rede sem fio depois de sair da suspensão.");
  await technician.getByLabel("Ambiente").fill("Windows 11, adaptador Wi-Fi integrado.");
  await technician.getByLabel("Procedimento").fill("1. Desligue e ligue o adaptador.\n2. Atualize o driver de rede.");
  await technician.getByLabel("Resultado esperado").fill("A rede reconecta sozinha após a suspensão.");
  await technician.getByLabel("Tags (separadas por vírgula)").fill("wifi, notebook");
  await technician.getByRole("button", { name: "Salvar" }).click();
  await expect(technician.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(technician.getByText("Rascunho", { exact: true })).toBeVisible();
  const url = technician.url();

  const requester = await as(browser, "requester1");
  await requester.goto("/base");
  await expect(requester.getByRole("heading", { name: "Base de conhecimento" })).toBeVisible();
  await expect(requester.getByRole("link", { name: title })).toHaveCount(0);
  await requester.goto(url);
  await expect(requester.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();

  await technician.getByRole("button", { name: "Publicar" }).click();
  await expect(technician.getByRole("button", { name: "Despublicar" })).toBeVisible();

  await requester.goto("/base");
  await expect(requester.getByRole("link", { name: title })).toBeVisible();
  await requester.getByRole("link", { name: title }).click();
  await expect(requester.getByRole("heading", { level: 2, name: "Procedimento" })).toBeVisible();

  await requester.goto("/base");
  await requester.getByLabel("Buscar na base").fill("suspensão");
  await requester.getByRole("button", { name: "Buscar" }).click();
  // A linha de status só existe na visão de busca (a lista comum não a tem), o que distingue os dois casos.
  await expect(requester.getByRole("status")).toContainText(/resultados? para “suspensão”/);
  await expect(requester.getByRole("link", { name: title })).toBeVisible();
});
