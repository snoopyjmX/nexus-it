import { expect, test, type Page } from "@playwright/test";
import { as } from "../as.js";

async function openTicket(page: Page, title: string) {
  await page.goto("/chamados/novo");
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Descrição").fill("A impressora do andar mostra erro e não imprime.");
  await page.getByLabel("Categoria").selectOption({ label: "Hardware" });
  await page.getByRole("button", { name: "Abrir chamado" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test("solicitante abre o chamado, o técnico atende e outro solicitante não o enxerga [FR-03, FR-04]", async ({ browser }) => {
  const title = `Impressora sem toner ${Date.now()}`;
  const requester = await as(browser, "requester1");
  await openTicket(requester, title);
  const url = requester.url();
  await expect(requester.getByText("Aberto", { exact: true })).toBeVisible();

  await requester.goto("/chamados");
  await expect(requester.getByRole("link", { name: title })).toBeVisible();

  const technician = await as(browser, "technician");
  await technician.goto("/chamados");
  await expect(technician.getByRole("heading", { name: "Fila de chamados" })).toBeVisible();
  await technician.getByRole("link", { name: title }).click();
  await technician.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(technician.getByText("Em andamento", { exact: true })).toBeVisible();

  // Mesma URL, outro solicitante: a API responde 404 (não 403) e a tela mostra "não encontrada".
  const other = await as(browser, "requester2");
  const ticketId = url.split("/").pop();
  expect((await other.request.get(`/api/v1/tickets/${ticketId}`)).status()).toBe(404);
  await other.goto(url);
  await expect(other.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
});

test("cancelar pede confirmação: foco em Voltar, Voltar devolve o foco, confirmar cancela [FR-04, NFR-06]", async ({ browser }) => {
  const title = `Mouse sem resposta ${Date.now()}`;
  const page = await as(browser, "requester1");
  await openTicket(page, title);

  const cancel = page.getByRole("button", { name: "Cancelar chamado" });
  await cancel.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Um chamado cancelado não pode ser reaberto.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Voltar" })).toBeFocused();
  // Nada foi enviado ao servidor ainda.
  await expect(page.getByText("Aberto", { exact: true })).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(page.getByText("Um chamado cancelado não pode ser reaberto.")).toBeHidden();
  await expect(cancel).toBeFocused();

  await cancel.click();
  await page.getByRole("button", { name: /^Confirmar: Cancelar chamado/ }).click();
  await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();
  await expect(cancel).toBeHidden();
});
