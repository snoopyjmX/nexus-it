# NEXUS IT

Ferramenta interna de suporte de TI (organização fictícia). Técnico abre um chamado e vê fontes da base de conhecimento, passos de verificação e abstenção explícita quando a evidência é fraca.
Especificação única: @docs/PRD.md. Arquitetura e specs: @docs/ARCHITECTURE.md. Ameaças: docs/THREAT_MODEL.md.

## Fase atual
Fase 1 (Fundação). NÃO implemente nada de fases futuras nem itens de "Fora do escopo" do PRD.

## Stack (não troque sem ADR)
pnpm monorepo · apps/web: React + TS + Vite + Tailwind + TanStack Query · apps/api: Node LTS + TS + Express 5 + Zod · Postgres + pgvector via driver `pg` e SQL parametrizado · Vitest, Supertest, Playwright · Docker Compose · GitHub Actions.

## Comandos
- `pnpm lint` · `pnpm typecheck` · `pnpm test` (precisa do banco: `docker compose up -d db` e `.env.test`)
- `pnpm db:migrate` · `pnpm dev:api` · `pnpm dev:web`
- Ainda não existem: `pnpm test:e2e` (Fase 2), `pnpm db:seed` (Fase 1, junto com usuários)

## Regras inegociáveis
- Toda mudança cita um ID (FR-xx, NFR-xx, T-xx) e entrega teste junto. Sem teste, não está pronto.
- Escreva o teste que falha ANTES do código (use o agente test-author).
- Autorização sempre no servidor via módulo de política (`scopeTicketsFor`, `scopeArticlesFor`, `can`). UI nunca é controle de segurança.
- Recurso de outro usuário retorna 404, não 403. Mudança de status só por `POST /tickets/:id/transitions`.
- SQL só parametrizado. Zod `.strict()` em todo corpo de requisição, com schema por papel.
- Nenhuma dependência nova sem ADR em docs/adr/. Prefira a biblioteca padrão.
- Antes de usar API de uma biblioteca, consulte a documentação atual (use context7). Nunca invente nome de função, opção ou flag.
- Só dados sintéticos. Nunca leia nem escreva `.env` real. Nada do empregador do usuário.
- Saída do LLM é texto puro; links só de IDs validados no servidor. LLM nunca decide permissão.

## Anti-slop
- Código mínimo que passa no teste. Sem abstrações "para o futuro", sem camadas genéricas, sem helpers usados uma vez.
- Sem comentários que narram o óbvio; comente o porquê, não o quê.
- Sem `any`, sem `// @ts-ignore`, sem `eslint-disable` sem justificativa no PR.
- Não silencie erro para o teste passar. Corrija a causa.
- Se não tiver certeza de um requisito, pergunte em vez de decidir.

## Como terminar uma tarefa
Rode `/verify`. Mostre a saída real dos comandos (não diga "passou" sem evidência). Depois rode `/revisar`.
