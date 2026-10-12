# 010. Dependências do front-end (Fase 2)

Data: 2026-10-11 · Status: aceito (decidido por Claude, por delegação do autor, após análise)

## Contexto
A Fase 2 entrega as telas (ARCHITECTURE §7). O `apps/web` só tem React e Vite. A stack do CLAUDE.md já nomeia Tailwind e TanStack Query, mas o ADR-005 só cobriu as dependências da Fase 1, e a regra do projeto exige ADR para qualquer dependência nova. Faltam ainda roteamento e ferramenta de teste de componentes.

## Opções consideradas
- Estilo: Tailwind v4 com o plugin do Vite (nomeado na stack; sem arquivo de configuração, CSS gerado no build) / CSS escrito à mão (zero dependência, mais código e mais risco de inconsistência de contraste e foco, que são requisitos de NFR-06).
- Dados do servidor: TanStack Query (nomeado na stack; cache, estados de carregando e erro, invalidação após mutação) / `fetch` com `useEffect` em cada tela (repete a lógica de carregando, erro e corrida de requisições).
- Roteamento: `react-router` / roteador próprio sobre `history` (pouco código, mas sem aninhamento, sem carregamento por rota e com mais bugs de borda de navegação e foco) / sem rotas (não atende: detalhe de chamado precisa de URL).
- Testes de componente: Vitest (já usado na API) com `jsdom`, `@testing-library/react`, `@testing-library/dom` e `@testing-library/user-event`, que consultam a tela por papel e nome acessível, o que também força rótulos corretos (NFR-06) / Playwright para tudo (já previsto para a Fase 5, mais lento e exige navegador no CI a cada mudança). `@testing-library/jest-dom` não entra: as consultas por papel já falham quando o elemento não existe.

## Decisão
Entram, com versão exata e lockfile:
- produção: `@tanstack/react-query`, `react-router`;
- desenvolvimento: `tailwindcss`, `@tailwindcss/vite`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`.

Nenhuma biblioteca de componentes, de formulário, de ícones ou de estado global. Formulários usam estado local e validação do servidor (a API já valida com Zod). A autenticação continua no cookie de sessão (ADR-004): o front só guarda o token CSRF em memória, vindo de `/auth/me`, nunca em `localStorage`.

## Consequências
- Pacotes de produção novos entram no bundle e na auditoria (`pnpm audit --prod`, já no CI). Os de desenvolvimento não vão para a imagem final.
- Guards de rota no front são só UX; quem protege é a API (ARCHITECTURE §7).
- Testes de componente rodam sem navegador e sem API (com `fetch` simulado). O fluxo ponta a ponta com navegador real continua sendo da Fase 5.
- Se o tamanho do bundle ou a manutenção de alguma delas virar problema, a troca é local: cada uma é usada por um módulo fino (`api.ts`, `router`, `styles`).
