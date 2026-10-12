import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Article, Ticket, TicketComment, TicketEvent } from "./types";
import { ANA, TECH, loggedInAs, mockApi, renderApp } from "./test-utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const person = (u: typeof ANA | typeof TECH) => ({ id: u.id, displayName: u.displayName });

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "t-1",
    title: "Impressora não imprime",
    description: "Fila trava no setor 3.",
    category: "hardware",
    priority: "medium",
    status: "open",
    requester: person(ANA),
    assignee: null,
    resolutionNote: null,
    version: 1,
    createdAt: "2026-10-11T12:00:00.000Z",
    updatedAt: "2026-10-11T12:00:00.000Z",
    ...over,
  };
}

const empty = { body: { items: [] } };

function detailRoutes(t: Ticket, extra: Parameters<typeof mockApi>[0] = {}, comments: TicketComment[] = [], events: TicketEvent[] = []) {
  return {
    [`GET /tickets/${t.id}`]: { body: t },
    [`GET /tickets/${t.id}/comments`]: { body: { items: comments } },
    [`GET /tickets/${t.id}/events`]: { body: { items: events } },
    ...extra,
  };
}

describe("solicitante: lista e abertura (FR-03)", () => {
  it("lista os chamados com status, prioridade e categoria em português", async () => {
    mockApi({
      "GET /auth/me": loggedInAs(ANA),
      "GET /tickets": { body: { items: [(({ description: _d, ...rest }) => rest)(ticket())], nextCursor: null } },
    });
    renderApp("/chamados");
    const link = await screen.findByRole("link", { name: "Impressora não imprime" });
    expect(link.getAttribute("href")).toBe("/chamados/t-1");
    expect(screen.getByText("Aberto")).toBeTruthy();
    expect(screen.getByText("Média")).toBeTruthy();
    expect(screen.getByText("Hardware")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Meus chamados" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Novo chamado" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Filtros" })).toBeNull();
  });

  it("estado vazio e erro têm texto próprio", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /tickets": { body: { items: [], nextCursor: null } } });
    renderApp("/chamados");
    expect(await screen.findByText("Você ainda não abriu chamados.")).toBeTruthy();
    cleanup();
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /tickets": { status: 500, body: {} } });
    renderApp("/chamados");
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar os chamados");
  });

  it("carrega mais usando o cursor devolvido pela API", async () => {
    const calls = mockApi({
      "GET /auth/me": loggedInAs(ANA),
      "GET /tickets": (call) =>
        call.path.includes("cursor=c2")
          ? { body: { items: [ticket({ id: "t-2", title: "Segundo" })], nextCursor: null } }
          : { body: { items: [ticket({ id: "t-1", title: "Primeiro" })], nextCursor: "c2" } },
    });
    renderApp("/chamados");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("link", { name: "Segundo" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Primeiro" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
    expect(calls.filter((c) => c.path.startsWith("/tickets")).length).toBe(2);
  });

  it("abre um chamado e vai para o detalhe; o dono não vai no corpo", async () => {
    const created = ticket({ id: "t-9", title: "Teclado quebrado" });
    const calls = mockApi({
      "GET /auth/me": loggedInAs(ANA),
      "POST /tickets": { status: 201, body: created },
      ...detailRoutes(created),
    });
    renderApp("/chamados/novo");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Título"), "  Teclado quebrado ");
    await user.type(screen.getByLabelText("Descrição"), "Teclas travadas.");
    await user.selectOptions(screen.getByLabelText("Categoria"), "hardware");
    await user.click(screen.getByRole("button", { name: "Abrir chamado" }));
    expect(await screen.findByRole("heading", { name: "Teclado quebrado" })).toBeTruthy();
    const post = calls.find((c) => c.method === "POST" && c.path === "/tickets");
    expect(post?.body).toEqual({ title: "Teclado quebrado", description: "Teclas travadas.", category: "hardware" });
    expect(post?.headers["X-CSRF-Token"]).toBe("csrf-123");
  });

  it("erro 400 da API aparece como aviso e o formulário continua", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "POST /tickets": { status: 400, body: { detail: "Requisição inválida." } } });
    renderApp("/chamados/novo");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Título"), "x");
    await user.type(screen.getByLabelText("Descrição"), "y");
    await user.click(screen.getByRole("button", { name: "Abrir chamado" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Confira os campos");
    expect(screen.getByLabelText("Título")).toBeTruthy();
  });

  it("técnico não vê o formulário de novo chamado: vai para a fila", async () => {
    mockApi({ "GET /auth/me": loggedInAs(TECH), "GET /tickets": { body: { items: [], nextCursor: null } } });
    renderApp("/chamados/novo");
    expect(await screen.findByRole("heading", { name: "Fila de chamados" })).toBeTruthy();
  });
});

describe("detalhe do chamado: solicitante", () => {
  it("mostra descrição, conversa e histórico em texto legível, sem texto do servidor interpretado como HTML", async () => {
    const t = ticket();
    mockApi({
      "GET /auth/me": loggedInAs(ANA),
      ...detailRoutes(
        t,
        {},
        [{ id: "c1", body: "<b>negrito?</b>", author: person(TECH), createdAt: t.createdAt }],
        [
          { id: "e1", type: "created", actor: person(ANA), payload: {}, createdAt: t.createdAt },
          { id: "e2", type: "transitioned", actor: person(TECH), payload: { from: "open", to: "in_progress" }, createdAt: t.createdAt },
        ],
      ),
    });
    renderApp("/chamados/t-1");
    expect(await screen.findByText("Fila trava no setor 3.")).toBeTruthy();
    expect(await screen.findByText("<b>negrito?</b>")).toBeTruthy();
    expect(screen.queryByText("negrito?", { selector: "b" })).toBeNull();
    expect(screen.getByText(/Chamado aberto/)).toBeTruthy();
    expect(screen.getByText(/Status: Aberto → Em andamento/)).toBeTruthy();
  });

  it("dono de chamado aberto edita (com a versão) e cancela", async () => {
    const t = ticket();
    const calls = mockApi({
      "GET /auth/me": loggedInAs(ANA),
      "PATCH /tickets/t-1": { body: ticket({ title: "Novo título", version: 2 }) },
      "POST /tickets/t-1/transitions": { body: ticket({ status: "cancelled", version: 2 }) },
      ...detailRoutes(t),
    });
    renderApp("/chamados/t-1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Editar chamado" }));
    const title = screen.getByLabelText("Título");
    await user.clear(title);
    await user.type(title, "Novo título");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ version: 1, title: "Novo título", description: "Fila trava no setor 3." });

    await user.click(await screen.findByRole("button", { name: "Cancelar chamado" }));
    expect(calls.some((c) => c.path.endsWith("/transitions"))).toBe(false);
    await user.click(await screen.findByRole("button", { name: "Confirmar: Cancelar chamado" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/transitions"))).toBe(true));
    expect(calls.find((c) => c.path.endsWith("/transitions"))?.body).toEqual({ to: "cancelled" });
  });

  describe("cancelar chamado pede confirmação (FR-04, NFR-06)", () => {
    const rotas = () => ({
      ...detailRoutes(ticket()),
      "GET /auth/me": loggedInAs(ANA),
      "POST /tickets/t-1/transitions": { body: ticket({ status: "cancelled", version: 2 }) },
    });
    const transicoes = (calls: ReturnType<typeof mockApi>) => calls.filter((c) => c.path.endsWith("/transitions"));

    it("clicar em 'Cancelar chamado' só abre o aviso, sem chamar a API", async () => {
      const calls = mockApi(rotas());
      renderApp("/chamados/t-1");
      await userEvent.setup().click(await screen.findByRole("button", { name: "Cancelar chamado" }));
      expect(await screen.findByText(/não pode ser reaberto/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Confirmar: Cancelar chamado" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Voltar" })).toBeTruthy();
      expect(transicoes(calls)).toHaveLength(0);
    });

    it("'Voltar' fecha o aviso sem chamar a API e devolve o foco ao botão que o abriu", async () => {
      const calls = mockApi(rotas());
      renderApp("/chamados/t-1");
      const user = userEvent.setup();
      const abrir = await screen.findByRole("button", { name: "Cancelar chamado" });
      await user.click(abrir);
      await user.click(await screen.findByRole("button", { name: "Voltar" }));
      expect(screen.queryByText(/não pode ser reaberto/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Confirmar: Cancelar chamado" })).toBeNull();
      expect(document.activeElement).toBe(abrir);
      expect(transicoes(calls)).toHaveLength(0);
    });

    it("pelo teclado: o foco abre em 'Voltar', então dois Enter não cancelam; confirmar exige Tab", async () => {
      const calls = mockApi(rotas());
      renderApp("/chamados/t-1");
      const user = userEvent.setup();
      const abrir = await screen.findByRole("button", { name: "Cancelar chamado" });
      abrir.focus();
      await user.keyboard("{Enter}");
      const voltar = await screen.findByRole("button", { name: "Voltar" });
      await waitFor(() => expect(document.activeElement).toBe(voltar));
      expect(voltar.getAttribute("aria-describedby")).toBeTruthy();
      expect(transicoes(calls)).toHaveLength(0);
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirmar: Cancelar chamado" }));
      await user.keyboard("{Enter}");
      await waitFor(() => expect(transicoes(calls)).toHaveLength(1));
      expect(transicoes(calls)[0]?.method).toBe("POST");
      expect(transicoes(calls)[0]?.body).toEqual({ to: "cancelled" });
    });
  });

  it("não mostra ações do técnico nem de edição quando já está em andamento", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), ...detailRoutes(ticket({ status: "in_progress", assignee: person(TECH) })) });
    renderApp("/chamados/t-1");
    await screen.findByRole("heading", { name: "Impressora não imprime" });
    for (const name of ["Editar chamado", "Iniciar atendimento", "Marcar como resolvido", "Assumir"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByLabelText("Prioridade")).toBeNull();
  });

  it("em chamado aberto o solicitante não vê o botão de iniciar atendimento", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), ...detailRoutes(ticket()) });
    renderApp("/chamados/t-1");
    await screen.findByRole("button", { name: "Cancelar chamado" });
    expect(screen.queryByRole("button", { name: "Iniciar atendimento" })).toBeNull();
  });

  it("em 'aguardando solicitante' o dono retoma o atendimento", async () => {
    const calls = mockApi({
      "GET /auth/me": loggedInAs(ANA),
      "POST /tickets/t-1/transitions": { body: ticket({ status: "in_progress" }) },
      ...detailRoutes(ticket({ status: "waiting_requester", assignee: person(TECH) })),
    });
    renderApp("/chamados/t-1");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Já respondi, retomar atendimento" }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/transitions"))?.body).toEqual({ to: "in_progress" }));
  });

  it("resolvido: confirma e fecha, ou reabre com motivo obrigatório", async () => {
    const resolved = ticket({ status: "resolved", assignee: person(TECH), resolutionNote: "Cabo trocado." });
    const calls = mockApi({
      "GET /auth/me": loggedInAs(ANA),
      "POST /tickets/t-1/transitions": { body: ticket({ status: "in_progress" }) },
      ...detailRoutes(resolved),
    });
    renderApp("/chamados/t-1");
    const user = userEvent.setup();
    expect(await screen.findByText(/Cabo trocado\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmar solução e fechar" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reabrir" }));
    await user.type(screen.getByLabelText("Motivo da reabertura"), "Voltou a falhar.");
    await user.click(screen.getByRole("button", { name: "Confirmar: Reabrir" }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/transitions"))?.body).toEqual({ to: "in_progress", comment: "Voltou a falhar." }));
  });

  it("fechado ou cancelado não mostra nenhuma ação", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), ...detailRoutes(ticket({ status: "closed" })) });
    renderApp("/chamados/t-1");
    await screen.findByRole("heading", { name: "Impressora não imprime" });
    expect(screen.queryByRole("heading", { name: "Ações" })).toBeNull();
  });

  it("envia comentário e limpa o campo", async () => {
    const calls = mockApi({
      "GET /auth/me": loggedInAs(ANA),
      "POST /tickets/t-1/comments": { status: 201, body: {} },
      ...detailRoutes(ticket()),
    });
    renderApp("/chamados/t-1");
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Novo comentário");
    await user.type(box, "  Ainda sem imprimir ");
    await user.click(screen.getByRole("button", { name: "Enviar comentário" }));
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(""));
    expect(calls.find((c) => c.path.endsWith("/comments") && c.method === "POST")?.body).toEqual({ body: "Ainda sem imprimir" });
  });

  it("chamado alheio ou inexistente (404) mostra 'não encontrada', sem dizer o motivo", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /tickets/outro": { status: 404, body: { title: "Not Found", status: 404 } } });
    renderApp("/chamados/outro");
    expect(await screen.findByRole("heading", { name: "Página não encontrada" })).toBeTruthy();
  });

  it("conflito de versão (409) mostra o aviso da API e recarrega o chamado", async () => {
    let loads = 0;
    mockApi({
      "GET /auth/me": loggedInAs(ANA),
      "PATCH /tickets/t-1": { status: 409, body: { detail: "O chamado foi alterado por outra pessoa. Recarregue e tente de novo." } },
      "GET /tickets/t-1": () => {
        loads += 1;
        return { body: ticket() };
      },
      "GET /tickets/t-1/comments": empty,
      "GET /tickets/t-1/events": empty,
    });
    renderApp("/chamados/t-1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Editar chamado" }));
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect((await screen.findByRole("alert")).textContent).toContain("alterado por outra pessoa");
    await waitFor(() => expect(loads).toBeGreaterThan(1));
  });
});

describe("técnico: fila e atendimento (FR-02, FR-04)", () => {
  it("filtra por status, prioridade, categoria e 'só os meus' via parâmetros da API", async () => {
    const calls = mockApi({ "GET /auth/me": loggedInAs(TECH), "GET /tickets": { body: { items: [ticket()], nextCursor: null } } });
    renderApp("/chamados");
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Fila de chamados" })).toBeTruthy();
    await screen.findByRole("link", { name: "Impressora não imprime" });
    await user.selectOptions(screen.getByLabelText("Status"), "in_progress");
    await user.selectOptions(screen.getByLabelText("Prioridade"), "high");
    await user.selectOptions(screen.getByLabelText("Categoria"), "network");
    await user.click(screen.getByLabelText("Só os meus"));
    await waitFor(() => {
      const last = calls.filter((c) => c.path.startsWith("/tickets?")).at(-1)?.path ?? "";
      expect(last).toContain("status=in_progress");
      expect(last).toContain("priority=high");
      expect(last).toContain("category=network");
      expect(last).toContain(`assigneeId=${TECH.id}`);
    });
    expect(screen.getByText(/Ana/)).toBeTruthy();
  });

  it("inicia o atendimento; o responsável padrão é decidido pela API", async () => {
    const calls = mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "POST /tickets/t-1/transitions": { body: ticket({ status: "in_progress" }) },
      ...detailRoutes(ticket()),
    });
    renderApp("/chamados/t-1");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Iniciar atendimento" }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/transitions"))?.body).toEqual({ to: "in_progress" }));
  });

  it("pedir informação exige o texto; resolver envia a nota", async () => {
    const calls = mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "POST /tickets/t-1/transitions": { body: ticket({ status: "waiting_requester" }) },
      ...detailRoutes(ticket({ status: "in_progress", assignee: person(TECH) })),
    });
    renderApp("/chamados/t-1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Pedir informação" }));
    await user.type(screen.getByLabelText("O que falta saber"), "Qual o patrimônio?");
    await user.click(screen.getByRole("button", { name: "Confirmar: Pedir informação" }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/transitions"))?.body).toEqual({ to: "waiting_requester", comment: "Qual o patrimônio?" }));

    await user.click(await screen.findByRole("button", { name: "Marcar como resolvido" }));
    await user.type(screen.getByLabelText("Nota de resolução"), "Cabo trocado.");
    await user.click(screen.getByRole("button", { name: "Confirmar: Marcar como resolvido" }));
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith("/transitions")).at(-1)?.body).toEqual({ to: "resolved", resolutionNote: "Cabo trocado." }));
  });

  it("muda prioridade e categoria com a versão atual, e assume o chamado", async () => {
    const calls = mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "PATCH /tickets/t-1": { body: ticket({ version: 2 }) },
      ...detailRoutes(ticket({ version: 4, assignee: null })),
    });
    renderApp("/chamados/t-1");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Prioridade"), "urgent");
    await user.selectOptions(screen.getByLabelText("Categoria"), "network");
    await user.click(screen.getByRole("button", { name: "Assumir" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(3));
    const bodies = calls.filter((c) => c.method === "PATCH").map((c) => c.body);
    expect(bodies[0]).toEqual({ version: 4, priority: "urgent" });
    expect(bodies[1]).toEqual({ version: 4, category: "network" });
    expect(bodies[2]).toEqual({ version: 4, assigneeId: TECH.id });
  });

  it("técnico não edita título e descrição (isso é do dono)", async () => {
    mockApi({ "GET /auth/me": loggedInAs(TECH), ...detailRoutes(ticket()) });
    renderApp("/chamados/t-1");
    await screen.findByRole("heading", { name: "Impressora não imprime" });
    expect(screen.queryByRole("button", { name: "Editar chamado" })).toBeNull();
  });

  it("transição recusada pela API (422) mostra o motivo", async () => {
    mockApi({
      "GET /auth/me": loggedInAs(TECH),
      "POST /tickets/t-1/transitions": { status: 422, body: { detail: "Transição de open para in_progress não é permitida." } },
      ...detailRoutes(ticket()),
    });
    renderApp("/chamados/t-1");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Iniciar atendimento" }));
    expect((await screen.findByRole("alert")).textContent).toContain("não é permitida");
  });
});

describe("base de conhecimento", () => {
  const article: Article = {
    id: "a-1",
    title: "Impressora de rede não imprime",
    symptom: "Fila parada.",
    environment: "Windows 11.",
    procedure: "1. Reinicie o spooler.",
    expectedResult: "Documento sai.",
    tags: ["impressora"],
    status: "published",
    version: 2,
    author: person(TECH),
    updatedAt: "2026-10-11T12:00:00.000Z",
  };

  it("lista os artigos publicados com as tags", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": { body: { items: [article], nextCursor: null } } });
    renderApp("/base");
    expect((await screen.findByRole("link", { name: article.title })).getAttribute("href")).toBe("/base/a-1");
    expect(screen.getByText("impressora")).toBeTruthy();
  });

  it("busca e distingue artigo de chamado resolvido", async () => {
    const calls = mockApi({
      "GET /auth/me": loggedInAs(ANA),
      "GET /articles": { body: { items: [], nextCursor: null } },
      "GET /search": {
        body: {
          mode: "lexical",
          items: [
            { kind: "article", id: "a-1", title: article.title, symptom: "Fila parada.", tags: [], score: 1 },
            { kind: "ticket", id: "t-7", title: "Monitor sem sinal", summary: "Fica preto.", score: 0.5 },
          ],
        },
      },
    });
    renderApp("/base");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Buscar na base"), "impressora & rede");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect((await screen.findByRole("link", { name: "Monitor sem sinal" })).getAttribute("href")).toBe("/chamados/t-7");
    expect(screen.getByRole("link", { name: article.title }).getAttribute("href")).toBe("/base/a-1");
    expect(screen.getByText("Chamado resolvido")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("2 resultados");
    expect(calls.find((c) => c.path.startsWith("/search"))?.path).toBe("/search?q=impressora%20%26%20rede");
  });

  it("busca sem resultado diz que não achou", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles": { body: { items: [], nextCursor: null } }, "GET /search": { body: { mode: "lexical", items: [] } } });
    renderApp("/base");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Buscar na base"), "zzz");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect((await screen.findByRole("status")).textContent).toContain("Nada encontrado");
  });

  it("lê o artigo com as quatro seções", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles/a-1": { body: article } });
    renderApp("/base/a-1");
    expect(await screen.findByRole("heading", { name: article.title })).toBeTruthy();
    for (const name of ["Sintoma", "Ambiente", "Procedimento", "Resultado esperado"]) expect(screen.getByRole("heading", { name })).toBeTruthy();
    expect(screen.getByText("1. Reinicie o spooler.")).toBeTruthy();
    expect(screen.queryByText("Rascunho")).toBeNull();
  });

  it("rascunho de outro (404) mostra 'não encontrada'", async () => {
    mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /articles/a-2": { status: 404, body: {} } });
    renderApp("/base/a-2");
    expect(await screen.findByRole("heading", { name: "Página não encontrada" })).toBeTruthy();
  });
});

describe("navegação", () => {
  it("o menu muda com o papel", async () => {
    mockApi({ "GET /auth/me": loggedInAs(TECH) });
    renderApp("/");
    const nav = await screen.findByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Fila" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Base de conhecimento" })).toBeTruthy();
    cleanup();
    mockApi({ "GET /auth/me": loggedInAs(ANA) });
    renderApp("/");
    const nav2 = await screen.findByRole("navigation", { name: "Principal" });
    expect(within(nav2).getByRole("link", { name: "Meus chamados" })).toBeTruthy();
  });
});
