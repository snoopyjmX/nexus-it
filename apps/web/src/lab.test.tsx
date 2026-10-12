import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCsv } from "./lab-export";
import type { EvalRun } from "./types";
import { ANA, TECH, loggedInAs, mockApi, renderApp } from "./test-utils";

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`sem item na posição ${index}`);
  return item;
}

const downloads: { name: string; blob: Blob }[] = [];

beforeEach(() => {
  downloads.length = 0;
  let pending: Blob | null = null;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => ((pending = blob), "blob:teste")), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (pending) downloads.push({ name: this.download, blob: pending });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const environment = { date: "2026-10-12T10:00:00.000Z", commit: "beca538", node: "v22.22.0", os: "Linux 6 x64", cpu: "Xeon X", memoryGb: 8 };

function run(over: Partial<EvalRun> = {}, suite: Partial<EvalRun["result"]["suite"]> = {}): EvalRun {
  const base: EvalRun = {
    id: "r-1",
    createdAt: "2026-10-12T10:00:00.000Z",
    set: "dev",
    datasetVersion: "6593b3ab29a9",
    searchMode: "lexical",
    embeddingModel: null,
    llmModel: null,
    promptVersion: null,
    environment,
    result: {
      schemaVersion: 1,
      set: "dev",
      datasetVersion: "6593b3ab29a9",
      searchMode: "lexical",
      embeddingModel: null,
      environment,
      suite: {
        queryCount: 3,
        degradedQueries: 0,
        modes: { lexical: 3 },
        byType: { direta: { n: 8, hit1: 7, hit5: 8, mrr: 0.938 }, parafrase: { n: 10, hit1: 7, hit5: 8, mrr: 0.754 } },
        byCategory: { vpn: { n: 3, hit1: 3, hit5: 3, mrr: 1 } },
        abstention: {
          calibration: { threshold: 1.65, abstainedUnanswerable: 2, totalUnanswerable: 4, lostAnswerable: 0, totalAnswerable: 9 },
          validation: { threshold: 1.65, abstainedUnanswerable: 3, totalUnanswerable: 4, lostAnswerable: 1, totalAnswerable: 9 },
          configured: null,
        },
        rows: [
          { id: "q01", type: "direta", category: "vpn", group: "calibracao", expected: ["kb-vpn-01"], position: 1, top5: ["kb-vpn-01", "kb-rd-02"], expectedInTop5: 1, topScore: 2.5 },
          { id: "q21", type: "sem_resposta", category: "rede", group: null, expected: [], position: null, top5: [], expectedInTop5: 0, topScore: 0 },
        ],
        ...suite,
      },
    },
  };
  return { ...base, ...over };
}

const open = async (runs: unknown[], user = TECH) => {
  mockApi({ "GET /auth/me": loggedInAs(user), "GET /eval/runs": { body: { items: runs } } });
  renderApp("/laboratorio");
};

describe("laboratório: acesso (FR-02, FR-12)", () => {
  it("técnico vê o menu e a tela; solicitante não vê o menu e é mandado para o início sem chamar a API", async () => {
    await open([run()]);
    expect(within(await screen.findByRole("navigation", { name: "Principal" })).getByRole("link", { name: "Laboratório" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Laboratório" })).toBeTruthy();
    cleanup();
    const calls = mockApi({ "GET /auth/me": loggedInAs(ANA), "GET /chamados": { body: { items: [], nextCursor: null } }, "GET /tickets": { body: { items: [], nextCursor: null } } });
    renderApp("/laboratorio");
    const nav = await screen.findByRole("navigation", { name: "Principal" });
    expect(within(nav).queryByRole("link", { name: "Laboratório" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Laboratório" })).toBeNull();
    expect(calls.some((c) => c.path.includes("/eval"))).toBe(false);
  });
});

describe("laboratório: lista e estados", () => {
  it("sem execuções explica como gerar", async () => {
    await open([]);
    expect(await screen.findByText(/nenhuma execução registrada/i)).toBeTruthy();
    expect(screen.getByText(/pnpm eval/)).toBeTruthy();
  });

  it("mostra erro quando a API falha", async () => {
    mockApi({ "GET /auth/me": loggedInAs(TECH), "GET /eval/runs": { status: 500, body: {} } });
    renderApp("/laboratorio");
    expect((await screen.findByRole("alert")).textContent).toMatch(/não foi possível carregar/i);
  });

  it("lista cada execução com data, conjunto, versão, busca e modelos", async () => {
    await open([
      run({ id: "r-2", searchMode: "vector", embeddingModel: "bge-m3", llmModel: "gemma3:4b", promptVersion: "resumo-v1", datasetVersion: "000000000002" }),
      run(),
    ]);
    const table = await screen.findByRole("table", { name: "Execuções" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText(/vector/)).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText(/bge-m3/)).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText(/gemma3:4b/)).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText(/resumo-v1/)).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("000000000002")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText(/lexical/)).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("6593b3ab29a9")).toBeTruthy();
  });

  it("uma execução com resultado ilegível não derruba a tela", async () => {
    await open([{ ...run({ id: "r-bad" }), result: { schemaVersion: 1 } }, run()]);
    const table = await screen.findByRole("table", { name: "Execuções" });
    expect(within(table).getByText(/resultado ilegível/i)).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });
});

describe("laboratório: detalhe da execução", () => {
  it("mostra por tipo e por categoria em contagens, MRR com vírgula, sem porcentagem", async () => {
    await open([run()]);
    const byType = await screen.findByRole("table", { name: "Por tipo de consulta" });
    const direta = within(byType).getByRole("row", { name: /direta/ });
    expect(within(direta).getByText("7/8")).toBeTruthy();
    expect(within(direta).getByText("8/8")).toBeTruthy();
    expect(within(direta).getByText("0,938")).toBeTruthy();
    const byCategory = screen.getByRole("table", { name: "Por categoria" });
    expect(within(byCategory).getByRole("row", { name: /vpn/ })).toBeTruthy();
    expect(document.body.textContent).not.toContain("%");
  });

  it("mostra ambiente, versão do conjunto e quantidade de consultas", async () => {
    await open([run()]);
    const env = await screen.findByRole("region", { name: "Ambiente" });
    for (const text of ["beca538", "Xeon X", "8 GB", "v22.22.0", "Linux 6 x64"]) expect(within(env).getByText(new RegExp(text))).toBeTruthy();
    expect(screen.getByText(/3 consultas/)).toBeTruthy();
  });

  it("mostra a abstenção em contagens e avisa que o limiar não é probabilidade", async () => {
    await open([run()]);
    const section = await screen.findByRole("region", { name: "Abstenção" });
    expect(within(section).getByText(/abstém 2 de 4 sem resposta/i)).toBeTruthy();
    expect(within(section).getByText(/perde 1 de 9 respondíveis/i)).toBeTruthy();
    expect(within(section).getByText(/limiar configurado.*não avaliado/i)).toBeTruthy();
    expect(within(section).getByText(/não é uma probabilidade/i)).toBeTruthy();
  });

  it("avisa quando há consultas degradadas", async () => {
    await open([run({}, { degradedQueries: 2 })]);
    expect((await screen.findByRole("note")).textContent).toMatch(/2 consultas.*degradadas/i);
  });

  it("escolher outra execução troca o detalhe", async () => {
    const other = run({ id: "r-2", datasetVersion: "000000000002" });
    other.result.suite.byType = { ambigua: { n: 2, hit1: 1, hit5: 2, mrr: 0.625 } };
    await open([run(), other]);
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Por tipo de consulta" });
    await user.click(within(screen.getByRole("table", { name: "Execuções" })).getAllByRole("button", { name: /ver detalhes/i })[1] as HTMLElement);
    expect(within(await screen.findByRole("table", { name: "Por tipo de consulta" })).getByRole("row", { name: /ambigua/ })).toBeTruthy();
  });

  it("lista as consultas uma a uma, com posição e esperadas no top-5", async () => {
    await open([run()]);
    const user = userEvent.setup();
    await user.click(await screen.findByText(/consultas uma a uma/i));
    const table = screen.getByRole("table", { name: "Consultas" });
    const q01 = within(table).getByRole("row", { name: /q01/ });
    expect(within(q01).getByText("kb-vpn-01 kb-rd-02")).toBeTruthy();
    expect(within(table).getByRole("row", { name: /q21/ }).textContent).toContain("—");
  });
});

describe("laboratório: exportação (FR-12)", () => {
  it("exporta o resultado da execução em JSON, idêntico ao armazenado", async () => {
    const selected = run();
    await open([selected]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Exportar JSON" }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.name).toBe("avaliacao-dev-6593b3ab29a9-lexical-2026-10-12.json");
    expect(JSON.parse(await at(downloads, 0).blob.text())).toEqual(selected.result);
  });

  it("exporta CSV com uma linha por consulta e cabeçalho", async () => {
    await open([run()]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Exportar CSV" }));
    expect(downloads[0]?.name).toBe("avaliacao-dev-6593b3ab29a9-lexical-2026-10-12.csv");
    const lines = (await at(downloads, 0).blob.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe("id,tipo,categoria,grupo,esperadas,posicao,top5,esperadas_no_top5,score_top1");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("q01,direta,vpn,calibracao,kb-vpn-01,1,kb-vpn-01 kb-rd-02,1,2.5");
    expect(lines[2]).toBe("q21,sem_resposta,rede,,,,,0,0");
  });
});

describe("CSV seguro", () => {
  const row = (over: Partial<EvalRun["result"]["suite"]["rows"][number]>) => ({ ...at(run().result.suite.rows, 0), ...over });

  it("escapa aspas, vírgulas e quebras de linha", () => {
    const csv = toCsv([row({ id: 'q"1', category: "a,b", top5: ["x\ny"] })]);
    expect(csv).toContain('"q""1"');
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"x\ny"');
  });

  it("neutraliza fórmulas de planilha no começo do campo", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      const cell = at(at(toCsv([row({ id: bad })]).split("\r\n"), 1).split(","), 0);
      expect(cell.replace(/^"/, "").startsWith("'"), bad).toBe(true);
    }
  });
});
