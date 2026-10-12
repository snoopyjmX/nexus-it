# NEXUS IT

Ferramenta interna de suporte de TI (organização fictícia). O técnico abre um chamado e vê **as fontes** da base de conhecimento e de chamados resolvidos, **os passos de verificação** tirados do procedimento aprovado e uma **abstenção explícita** quando a evidência é fraca. O sistema não executa nada e não substitui o julgamento do técnico. Todos os dados são sintéticos.

## O problema e a abordagem

Um assistente que "responde" sem mostrar de onde veio é difícil de confiar. Aqui o diagnóstico é **determinístico primeiro** (busca, fontes ranqueadas, passos extraídos do campo `procedure` dos artigos). Um modelo de linguagem local é uma camada **opcional e desligada por padrão** que só resume as fontes, rotulado como "gerado", e cujas citações o servidor valida. Permissões, avaliação e operação têm teste ou medição registrada, com as lacunas listadas em "Limitações" e no [checklist de release](docs/RELEASE_CHECKLIST.md).

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

Mais comandos:

```bash
pnpm exec playwright install chromium    # uma vez; baixa o navegador do e2e
pnpm test:e2e                            # fluxos críticos no navegador (apaga o schema do nexus_test)
pnpm eval [--set dev] [--llm]            # suíte de avaliação (ADR-012); --llm precisa do Ollama
pnpm demo:record                         # regrava as respostas da demonstração (apaga o schema do nexus_test)
pnpm build:demo                          # gera a demonstração estática em apps/web/dist-demo
scripts/backup.sh                        # dump em backups/ (fora do Git)
scripts/restore.sh <dump> <banco-novo>   # só restaura em banco novo; nunca sobrescreve (docs/RUNBOOK.md)
docker compose --profile app build && docker compose --profile app run --rm api node dist/db/migrate-cli.js && docker compose --profile app up -d   # API em container
```

A busca vetorial e o resumo do modelo dependem do [Ollama](https://ollama.com) no seu computador e vêm desligados (`EMBEDDINGS_ENABLED`, `LLM_ENABLED`). Sem eles, chamados, base, busca por palavras e o painel determinístico funcionam inteiros.

## Resultados medidos (inclusive os negativos)

Conjunto **dev** de 30 consultas. A mesma IA (Claude) escreveu consultas, corpus e casos de injection a pedido do autor; a revisão do autor está declarada em `semana0/dados/AUTORIA.md`, mas não é independente e não deixa registro do que foi lido. Isso favorece resultados otimistas (viés declarado em `docs/AI_EVALUATION.md`). Com tão poucos casos, diferença de 1 ou 2 consultas é ruído. Cada linha tem versão, comando e saída bruta nos arquivos citados.

| O quê | Resultado | Fonte |
| --- | --- | --- |
| Busca vetorial (Semana 0, `bge-m3`) | Acerta 10 de 10 paráfrases; a lexical da Semana 0 (AND dos termos, sem ajuste), 0 de 10. **Não é uma comparação justa**: não medi a vetorial contra um lexical afinado, e só foi medida fora do app | `docs/CASE-SEMANA0.md` |
| Busca por palavras do app (OR dos termos) | Hit@1 / Hit@5: diretas 8/8 e 8/8; paráfrases 7/10 e 8/10; ambíguas 1/2 e 2/2 | `docs/AI_EVALUATION.md` |
| Busca vetorial dentro do app | **Não medida.** Depende do Ollama; falta registrar uma linha com `EMBEDDINGS_ENABLED=true pnpm eval` | `docs/AI_EVALUATION.md` |
| Abstenção no harness de avaliação (limiar lexical 1,65, calibrado em 4 sem-resposta) | Abstém 2 de 4 e não perde nenhum respondível. **Metade dos sem-resposta não é recusada.** Isso é do harness: o app com busca por palavras não aplica corte e só se abstém quando não há nenhuma fonte | `docs/AI_EVALUATION.md` |
| Limiar vetorial 0,5393 (Semana 0) | Margem de 0,015; ajustado com só 4 consultas sem resposta; **precisa ser recalibrado** | `docs/CASE-SEMANA0.md` |
| Resumo do modelo (`gemma3:4b`, Fase 4) | Cita a fonte esperada em 7 de 8, estável em 10 de 12, nenhum vazamento de instrução plantada (que só chegou ao modelo em 1 caso). **p50 de 26,8 s contra o limite de 20 s: não atende** (p95 38,3 s), por isso fica desligado. Dos 2 sem-resposta, **0 foram recusados antes de chamar o modelo**. A Semana 0 tinha medido 18,4 s; a diferença não foi investigada | `docs/AI_EVALUATION.md` |
| Resistência a injection | Testada em 2 casos; o trecho plantado chegou ao modelo em 1. Mostra que o modelo não obedeceu essa instrução, não que seja robusto | `docs/AI_EVALUATION.md` |

## Limitações

- O diagnóstico pode sugerir a **fonte errada** mesmo com tudo válido. O limiar de similaridade é uma regra empírica deste corpus, **não uma probabilidade**, e a resposta nunca mostra porcentagem. Não houve auditoria independente.
- Enquanto o limiar não for recalibrado (`DIAGNOSIS_THRESHOLD_TRUSTED=false`), as fontes aparecem como "evidência não verificada" e o corte por limiar não é aplicado.
- Não existe ainda o conjunto de **teste** congelado: todos os números acima são do conjunto de desenvolvimento e são exploratórios.
- O resumo por modelo está desligado por não ter passado no tempo. Os critérios de segurança b e c do T-05 (ação fora do procedimento, ação destrutiva citada como evidência) exigem leitura humana dos resumos, ainda não feita.
- Dados 100% sintéticos, uma única organização fictícia, sem integrações. Os itens fora do escopo estão no PRD.
- A demonstração estática (ADR-003) existe como build (`pnpm build:demo`, em `apps/web/dist-demo`), mas **não está publicada em nenhum endereço**: publicar é decisão do autor. Ela serve respostas gravadas, não é ao vivo, e mostra o diagnóstico com a busca por palavras: as fontes aparecem como "evidência não verificada", sem resumo do modelo e sem exemplo de abstenção (com busca por palavras o app só se abstém quando não há nenhuma fonte). O vídeo não foi feito.
- A CI inclui e2e, Trivy e CodeQL, mas esses jobs ainda não tiveram a primeira execução no GitHub.

## Segurança e operação

Autorização sempre no servidor, em um único módulo de política; recurso de outro usuário devolve 404. Matriz de visibilidade testada célula a célula. Sessão em cookie, CSRF, rate limit, SQL parametrizado, corpo validado com Zod estrito. O texto do modelo é tratado como não confiável e renderizado como texto puro. Ameaças e o teste que prova cada controle: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). Como operar, fazer backup e restaurar, e os três drills: [docs/RUNBOOK.md](docs/RUNBOOK.md). Gate de release: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## Documentação

- Especificação: [docs/PRD.md](docs/PRD.md)
- Arquitetura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Segurança: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- Avaliação: [docs/AI_EVALUATION.md](docs/AI_EVALUATION.md)
- Semana 0 (o experimento antes do produto): [docs/CASE-SEMANA0.md](docs/CASE-SEMANA0.md) e [docs/SEMANA0.md](docs/SEMANA0.md)
- Operação: [docs/RUNBOOK.md](docs/RUNBOOK.md) e [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- Decisões: [docs/adr/](docs/adr/)
