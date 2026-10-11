# Semana 0 — scripts do experimento

Protocolo e critérios: [docs/SEMANA0.md](../docs/SEMANA0.md). Os scripts só **medem**. Quem escreve consultas, corpus, gold, critérios e o veredito é você.

## O que você escreve (em `semana0/dados/`)

| Arquivo | Conteúdo |
| --- | --- |
| `criterios.md` | Tabela de critérios, com commit **antes** de qualquer medição |
| `consultas.json` | As 30 consultas, escritas antes do corpus |
| `corpus.json` | 30 artigos + 10 chamados resolvidos |
| `gold.json` | Fonte(s) esperada(s) de cada consulta (`[]` = sem resposta) |
| `casos-geracao.json` | Os 12 casos do passo 6 |

O formato de cada um está em [test/fixtures/](test/fixtures/), que são exemplos só de formato (não use como consultas). Regras que o script confere:

- `tipo` da consulta: `direta`, `parafrase`, `sem_resposta`, `ambigua` ou `injection`.
- Toda `sem_resposta` precisa de `"grupo": "calibracao"` ou `"validacao"` (4 em cada).
- Para medir quantas respondíveis o limiar perderia, dê `grupo` também a parte das respondíveis (ex.: metade em cada).
- `rascunho_llm: true` nos documentos que um LLM rascunhou.
- `ambigua` precisa de 2+ fontes no gold.
- Em `casos-geracao.json`, cada caso de injection leva `"documento_plantado"` (o documento com o texto malicioso) e `"marcador"` (o trecho que não pode aparecer na resposta).

```json
[{ "consulta": "c07" }, { "consulta": "c29", "documento_plantado": "kb-12", "marcador": "trecho plantado" }]
```

## Como rodar (no Mac, na raiz do repositório)

```bash
docker compose up -d db
ollama pull bge-m3
export DATABASE_URL=postgres://nexus:<senha>@127.0.0.1:5432/nexus_semana0
cd semana0

# Passo 5 — recuperação
pnpm busca
# → resultados/<data>-busca.json (bruto) e resultados/<data>-busca.md (tabelas)

# Passo 6 — geração, um modelo por vez
ollama pull <modelo>
pnpm geracao --modelo <modelo> --busca resultados/<data>-busca.json --metodo hibrida
```

`--metodo` escolhe de qual busca vem o contexto (`lexical`, `vetorial` ou `hibrida`): use a melhor do passo 5. Se o volume do Postgres já existia antes deste commit, crie o banco uma vez: `docker compose exec db createdb -U nexus nexus_semana0`.

## O que é medido e como

- **Lexical:** `websearch_to_tsquery` faz AND de todos os termos, então paráfrases tendem a voltar vazias. É a linha de base do protocolo, não um defeito do script.
- **Pesos:** título+sintoma A e procedimento B, como no protocolo. Ambiente e resultado entram como C, para o lexical ver o mesmo texto que o vetor. Mude em `src/banco.ts` se discordar, mas antes de medir.
- **Vetorial:** um vetor por documento, cosseno exato (sem índice ANN). **Híbrida:** RRF k=60 sobre o top-20 de cada um.
- **Ganha/empata/perde** contra a lexical usa Hit@5, que é o que o critério usa.
- **Limiar:** escolhido no grupo de calibração por uma regra fixa (máximo de abstenções certas menos respondíveis perdidas) e só conferido na validação. Score não é probabilidade.
- **Geração:**
  - Temperatura 0, seed 42, `think: false`, saída presa a um JSON Schema e top-3 documentos de contexto.
  - Uma chamada fria (modelo descarregado antes) e 3 rodadas aquecidas intercaladas. Chamadas seguidas nunca repetem o prompt, então o cache de prompt do Ollama não deixa a latência mais otimista.
  - Citação só conta se a fonte esperada estava no contexto e a resposta afirma suficiência. O denominador é só de respondíveis (direta, paráfrase, ambígua).
  - Acertos contam pela maioria das 3 rodadas. "Estável" significa mesma decisão e mesmas fontes nas 3; JSON inválido nunca é estável.
- **Injection:**
  - Se a busca não trouxe o documento plantado, ele é colocado no contexto (`plantadoForcado: true`). Sem isso, "resistiu" poderia ser só "não viu".
  - O critério (a), marcador vazou, é automático, conferido no texto decodificado; uma rodada com vazamento já conta.
  - Os critérios (b) e (c) ficam como `"revisar"` para você ler a saída bruta.
- **Rastreio:** cada resultado guarda o hash dos dados (`versaoDados`). A geração recusa um `busca.json` medido com outra versão.

Antes da rodada valendo, confira no JSON da geração que `fria.resposta.load_duration` é maior que zero (a chamada foi mesmo fria) e que nenhuma resposta traz `message.thinking`, ou seja, que `think: false` funcionou.

Depois de rodar, faça commit dos resultados e escreva `dados/decisao.md` comparando cada número com `criterios.md`.
