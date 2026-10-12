# 013. Testes de ponta a ponta com Playwright (Fase 5)

Data: 2026-10-12 · Status: proposto (vale ao ser mesclado pelo autor)

## Contexto
A Fase 5 pede e2e (ARCHITECTURE §8). Os testes de componente (ADR-010) rodam sem navegador e com `fetch` simulado, então não provam que web, API e banco funcionam juntos nem o foco do teclado num navegador real (NFR-06). A stack do CLAUDE.md já nomeia o Playwright, mas nenhum ADR cobre a dependência, e a regra do projeto exige um para qualquer pacote novo.

## Opções consideradas
- **Ferramenta**: `@playwright/test` (nomeado na stack; runner, asserções com espera e `webServer` embutidos) / Cypress (outra dependência fora da stack) / sem e2e, só testes de componente (não cobre sessão com cookie nem a pilha inteira).
- **Versão**: 1.63.0 (publicada em 2026-09-04) / 1.64.0 (publicada em 2026-10-07, com poucos dias de uso). Fixa-se a 1.63.0, exata e com lockfile, pelo critério de não adotar versão recém-publicada (T-09).
- **Navegador**: só Chromium / os três motores. Um motor basta para os fluxos críticos; o custo de instalação e o tempo no CI crescem com cada motor.
- **Banco**: um banco novo `nexus_e2e` (exige criar o banco no volume existente) / o `nexus_test` que os testes de integração já usam, com a mesma trava de `testDatabaseUrl()`. Fica o `nexus_test`: o e2e apaga e recria o schema, migra e semeia; nunca roda junto com `pnpm test`.
- **Local**: pacote próprio `apps/e2e` (o `pnpm-workspace.yaml` já cobre `apps/*`; mantém o Playwright e o navegador fora de `apps/web` e `apps/api`) / dentro de `apps/web`.

## Decisão
1. Entra `@playwright/test` **1.63.0**, só como dependência de desenvolvimento de `apps/e2e`, junto com `tsx` 4.23.15 (a mesma versão que a API já usa; o `pnpm exec tsx` precisa dele no pacote). Nenhum outro pacote.
2. `apps/e2e` contém `playwright.config.ts`, `prepare-db.ts`, um projeto `setup` (um login por conta, com o estado de sessão guardado em `playwright/.auth/`, fora do Git) e os testes. O `webServer` sobe a API (`prepare-db.ts` e depois `tsx ../api/src/server.ts`, padrão porta 3200, `E2E_API_PORT`) e o Vite (porta 5180, `E2E_WEB_PORT`), nunca reaproveitando um servidor já ativo, para não tocar na API de desenvolvimento de quem roda. O Vite do e2e usa `apps/web/vite.e2e.config.ts`, que estende o `vite.config.ts` trocando só o alvo do proxy.
3. `prepare-db.ts` usa `testDatabaseUrl()` e `resetSchema` da API (recusa banco que não seja local e `_test`), migra e semeia com o cenário do FR-16; se falhar, a API não sobe. A senha dos usuários semeados é `E2E_PASSWORD`, com um padrão fixo em `apps/e2e/env.ts` que só vale nesse banco `_test`, apagado a cada execução (nenhuma conta de ambiente real). O limite de login por IP (20 a cada 15 min) é o motivo do projeto `setup`: um login por conta, em vez de um por teste.
4. Raiz: `pnpm test:e2e`. Chromium, `retries` só no CI e trace só na primeira repetição.
5. Os testes usam só papéis e nomes acessíveis (como os de componente), o que mantém a verificação de NFR-06.
6. A ligação no CI (job próprio, `permissions: contents: read`, `playwright install --with-deps chromium`) vem em mudança separada, com revisão do workflow (T-17).

## Consequências
- `devDependency` nova de `apps/e2e`: não entra na imagem da API nem no `pnpm audit --prod`. O download do Chromium (cerca de 150 MB) acontece uma vez por máquina e por cache do CI.
- O e2e e `pnpm test` compartilham o `nexus_test`: rodam em sequência, nunca em paralelo.
- Cada teste que cria dados usa títulos únicos, para não depender de ordem.
- Se o tempo de execução ou a manutenção virar problema, a troca fica isolada em `apps/e2e`.
