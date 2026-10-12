# NEXUS IT

Ferramenta interna de suporte de TI com diagnóstico rastreável: o técnico vê as fontes, os passos de verificação e uma abstenção explícita quando a evidência é fraca.

> Em construção — Fase 3 (dataset e busca vetorial; a Fase 2, com chamados, base de conhecimento e busca lexical, está entregue). Este README será reescrito na Fase 5 com demo, resultados medidos e limitações. Todos os dados são fictícios.

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

Usuários só existem por seed ou CLI (não há cadastro público). A senha nunca vai por argumento nem tem valor padrão:

```bash
# cenário fictício: 1 técnico e 2 solicitantes (tecnico@, solicitante1@, solicitante2@exemplo.local)
DATABASE_URL=... SEED_PASSWORD='uma-senha-local-com-12+' pnpm db:seed

# um usuário avulso; a senha vem de NEXUS_USER_PASSWORD ou da entrada padrão
printf '%s\n' 'uma-senha-local-com-12+' | DATABASE_URL=... pnpm user:create --email ana@exemplo.local --name "Ana" --role technician
```

O seed não roda com `NODE_ENV=production`. Papéis: `technician` e `requester`.

Para subir a API em container:

```bash
docker compose --profile app build
docker compose --profile app run --rm api node dist/db/migrate-cli.js
docker compose --profile app up -d
```

## Documentação

- Especificação: [docs/PRD.md](docs/PRD.md)
- Arquitetura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Segurança: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- Avaliação: [docs/AI_EVALUATION.md](docs/AI_EVALUATION.md)
- Decisões: [docs/adr/](docs/adr/)
