# RUNBOOK

Operação local do NEXUS IT (PRD, módulo F). Dados 100% sintéticos; nada aqui vale para um ambiente real sem revisão.

## Subir, parar e conferir

```bash
docker compose up -d db                       # Postgres + pgvector em 127.0.0.1 (porta do compose)
docker compose --profile app up -d            # inclui a API em container (NODE_ENV=production)
docker compose ps                             # db deve estar "healthy"
```

- `GET /api/v1/health/live`: o processo está de pé. Não olha dependências.
- `GET /api/v1/health/ready`: o banco responde. Com o banco fora, responde 503 com `{"status":"unavailable","checks":{"database":"unavailable"}}`, sem detalhe interno (FR-14).
- Logs são JSON do pino, com redaction de `authorization`, `cookie`, `password`, `token` e corpo (T-11).

## Backup e restore (T-14)

```bash
scripts/backup.sh [banco]                     # padrão: nexus. Grava backups/<banco>-<UTC>.dump e imprime o caminho
scripts/restore.sh backups/<arquivo>.dump <banco-novo>
```

- Os dumps ficam em `backups/` (no `.gitignore`, junto com `*.dump`) e são criados com permissão `600`. O dump contém dados: não o copie para fora da máquina sem criptografar.
- O `backup.sh` não leva os dados da tabela `sessions` (tokens ativos não ressuscitam num banco restaurado), confere o índice do dump com `pg_restore --list` e não deixa arquivo parcial. Essa conferência não vê dados truncados: **só o restore prova o backup** (drill 1).
- O `restore.sh` **nunca sobrescreve**: restaura só em banco novo e recusa nome que já exista (inclusive `nexus`). Se o restore falhar no meio, remove o banco criado.
- Para voltar a usar o restaurado, aponte `DATABASE_URL` da API para o banco novo. Não há renomeação automática do banco original.
- Se o restore for interrompido (Ctrl-C), pode sobrar um banco pela metade: remova com `docker compose exec -T db dropdb -U nexus <banco>`.
- Teste: `apps/api/test/backup-restore.test.ts` roda na máquina de quem tem o Postgres do compose de pé. **A CI não o executa**: o job usa um serviço de Postgres, não o compose, e o teste é pulado em silêncio. Por isso a prova de T-14 no release é o drill 1, feito à mão.

## Os 3 drills

Os documentos do projeto citam "runbook com 3 drills" (PRD, módulo F) mas não os definem. **Proposta, aguardando a confirmação do autor**: os três abaixo saem de ameaças que o THREAT_MODEL já registra, T-14 (a prova prevista é o restore feito no release), segredo vazado (THREAT_MODEL, "Reportar vulnerabilidades") e T-12/FR-13 (aqui o drill mostra ao operador o que ele vê quando o modelo cai; a prova automatizada já existe). Se o autor tinha outros três em mente, troque. Refaça cada um antes de um release.

### Drill 1: o backup restaura em banco vazio (T-14)

Executado em 2026-10-12, no Mac do autor, contra o banco `nexus` do compose:

```bash
scripts/backup.sh nexus                       # backups/nexus-20261012T175921Z.dump (modo 600, 30209 bytes)
scripts/restore.sh backups/nexus-....dump nexus_drill       # "restaurado em nexus_drill"
# conferir origem e destino com a mesma consulta (tabelas em public | usuários | migrações | sessões):
docker compose exec -T db psql -U nexus -d nexus       -Atc "<consulta>"   # 11|3|9|1
docker compose exec -T db psql -U nexus -d nexus_drill -Atc "<consulta>"   # 11|3|9|0
scripts/restore.sh backups/nexus-....dump nexus             # "o banco nexus já existe; escolha um nome novo ..."
docker compose exec -T db dropdb -U nexus nexus_drill; rm backups/nexus-....dump
```

A consulta é `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'), (SELECT count(*) FROM users), (SELECT count(*) FROM schema_migrations), (SELECT count(*) FROM sessions)`. Passa quando tabelas, usuários e migrações coincidem, as sessões do restaurado são 0 (o dump não leva os tokens ativos) e a segunda restauração é recusada. O dump apagado ao final contém dados: não o deixe em `backups/`.

### Drill 2: segredo vazado (T-08)

Roteiro, **não executado** contra um vazamento real. Ordem importa: revogar antes de limpar.

1. **Revogar e rotacionar primeiro.** Troque a senha do Postgres sem digitá-la na linha de comando (ela ficaria no histórico do shell e no `ps`): `docker compose exec db psql -U nexus -d postgres` e, no prompt, `\password nexus`. Atualize `POSTGRES_PASSWORD` no `.env` e a `DATABASE_URL` no `.env.test`, e reinicie a API. O projeto não tem segredo de sessão a rotacionar: as sessões são tokens guardados no banco (passo 2).
2. **Encerrar as sessões ativas:** `docker compose exec -T db psql -U nexus -d nexus -c "DELETE FROM sessions"`. Todos entram de novo.
3. **Só depois, limpar o histórico** do Git (por exemplo com `git filter-repo`) e forçar a atualização do remoto. Um segredo que já esteve em um push público deve ser tratado como comprometido mesmo depois disso.
4. **Detecção:** o job `secrets` do CI roda o Gitleaks em cada push e pull request (T-08). Prova do controle: abrir um PR com um segredo falso e ver o job falhar. Esse PR de teste ainda não foi feito.

### Drill 3: o modelo de linguagem fora do ar (T-12, FR-13)

Prova automatizada: `apps/api/test/diagnosis.test.ts`, caso "modelo fora do ar: o diagnóstico determinístico segue inteiro, sem resumo" (resposta 201, fontes e passos presentes, `llm: "unavailable"`, execução gravada com `llm_outcome: provider_error`).

Execução automatizada (2026-10-13): o e2e (`apps/e2e`) sobe a API com `LLM_ENABLED=true` e `OLLAMA_BASE_URL=http://127.0.0.1:9` (porta fechada, conexão recusada na hora), e `tests/llm-fora-do-ar.spec.ts` confere o painel; o resto do e2e roda nessa mesma configuração. Isso prova a recusa de conexão. **Não prova** timeout, resposta lenta nem erro 5xx do modelo (esses casos estão em `diagnosis.test.ts`) e não foi feito com o Ollama real parado.

Para ver à mão com a mesma porta fechada: suba a API com `LLM_ENABLED=true` e `OLLAMA_BASE_URL=http://127.0.0.1:9`, abra um chamado como técnico e peça o diagnóstico. Para testar com o Ollama de verdade parado (não feito, para não derrubar o do autor), encerre o aplicativo Ollama e repita com o `OLLAMA_BASE_URL` padrão.
