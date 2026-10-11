# NEXUS IT

Ferramenta interna de suporte de TI com diagnóstico rastreável: o técnico vê as fontes, os passos de verificação e uma abstenção explícita quando a evidência é fraca.

> Em construção — Fase 1 (Fundação). Este README será reescrito na Fase 5 com demo, resultados medidos e limitações. Todos os dados são fictícios.

## Rodar localmente

Requisitos: Node 22.13+, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env            # preencha POSTGRES_PASSWORD
docker compose up -d db         # Postgres + pgvector em 127.0.0.1:5432
```

Crie `.env.test` com a linha abaixo (troque `<senha>` pela mesma do `.env`):

```
DATABASE_URL=postgres://nexus:<senha>@127.0.0.1:5432/nexus_test
```

```bash
pnpm test                       # testes (inclui integração com o Postgres)
pnpm lint && pnpm typecheck

DATABASE_URL=postgres://nexus:<senha>@127.0.0.1:5432/nexus pnpm db:migrate
DATABASE_URL=postgres://nexus:<senha>@127.0.0.1:5432/nexus pnpm dev:api   # http://127.0.0.1:3000
pnpm dev:web                    # http://localhost:5173
```

Para subir a API em container: `docker compose --profile app up --build`.

## Documentação

- Especificação: [docs/PRD.md](docs/PRD.md)
- Arquitetura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Segurança: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- Avaliação: [docs/AI_EVALUATION.md](docs/AI_EVALUATION.md)
- Decisões: [docs/adr/](docs/adr/)
