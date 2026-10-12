# 012. Pacote de avaliação e tabela de execuções

Data: 2026-10-12 · Status: proposto

## Contexto
O PRD (FR-12) pede uma suíte por CLI que gere métricas com versão do conjunto de dados, modelo, prompt, hardware e data, e uma tela de laboratório só de leitura. O ARCHITECTURE prevê `packages/evaluation` com `dataset/dev`, `dataset/test` (congelado) e o runner. Falta decidir como o runner usa a busca real do app sem arriscar o banco de quem o roda, onde ficam os resultados e como se evita duplicar o código de busca.

## Opções consideradas
- **Runner**: (a) reimplementar a busca no pacote, como fez a Semana 0 / (b) usar o próprio `searchKnowledge` do app, com o corpus carregado como artigos publicados e chamados resolvidos. (a) mede outra coisa que não o app; foi o caso do `plainto_tsquery` com AND, que zerava as paráfrases.
- **Isolamento**: (a) apagar e recriar o schema `public`, como os testes de integração / (b) criar um schema temporário `eval_<hex>` no mesmo banco, migrar nele, semear, medir e remover só ele. (a) é destrutivo e só vale num banco `_test`.
- **Resultados**: arquivo JSON apenas / tabela `eval_runs` no banco do app (lida pela API) além do JSON bruto.
- **Dependência do app**: o pacote importa código do app por caminho relativo / o app importa o pacote. A imagem da API só instala `apps/api` (Dockerfile) e não deve carregar dataset nem runner.

## Decisão
1. **`packages/evaluation`** (`@nexus/evaluation`, privado, sem dependência nova: `zod`, `pg` e `pino` já estão no repositório nas mesmas versões). Contém o conjunto `dataset/dev` (cópia byte a byte de `semana0/dados`, com teste que compara os arquivos e a versão `6593b3ab29a9` registrada pela Semana 0), métricas puras (Hit@1, Hit@5, MRR por tipo e categoria, em contagens; abstenção com a regra de calibração do `criterios.md`), o runner e o CLI (`pnpm eval [--set dev|test]`).
2. **O runner importa o código do app** (`searchKnowledge`, `migrate`, stores) por caminho relativo. O app não importa o pacote; por isso a imagem da API não muda e o pacote não é compilado nem publicado: roda com `tsx`.
3. **Schema temporário.** O runner cria `eval_<12 hex>` (nome gerado por ele), migra nesse schema com `search_path = eval_x, public`, cria um técnico e um solicitante descartáveis, carrega os artigos como publicados e os chamados como resolvidos, mede e remove o schema no fim, com ou sem erro. Não toca em nenhuma tabela existente. Recusa `NODE_ENV=production`. Campos do corpus que não cabem no app (por exemplo `ambiente` vazio num artigo) geram erro claro; o runner não inventa conteúdo.
4. **Modos.** Sempre o lexical; com `EMBEDDINGS_ENABLED=true`, também o vetorial (embeddings gerados pelo mesmo `backfill` do app; se algum faltar, aborta). O ranking é medido sem corte de similaridade; o corte configurado (`VECTOR_MIN_SCORE`) é avaliado à parte (`abstention.configured`) sobre o score do 1º resultado.
5. **`eval_runs`** (migração 0009) guarda conjunto, versão do conjunto, modo, modelo de embedding, modelo de linguagem e versão do prompt (nulos até a avaliação da geração), ambiente (data, commit, hardware) e o resultado completo em JSON. O CLI grava a linha e também um JSON bruto em `packages/evaluation/results/`. A API só lê: `GET /eval/runs` (técnico; 50 mais recentes). Nenhuma rota escreve.
6. **Conjunto de teste.** `dataset/test/` não existe até o autor escrevê-lo e congelá-lo. O código só lê; nunca escreve ali (CLAUDE.md, hook de proteção). Rodar sem ele dá erro claro.

## Consequências
- A medição passa a ser da busca que o usuário usa. O resultado do lexical do app (OR dos termos) difere do lexical da Semana 0 (AND); comparações com a Semana 0 precisam dizer isso.
- Os resultados de hoje vêm do conjunto dev, escrito por IA e revisado pelo autor (ver `semana0/dados/AUTORIA.md`), e são exploratórios. O conjunto de teste ainda não existe: nenhum número aqui vale como resultado final.
- O hardware registrado é o de quem rodou. Medições de latência e de geração para o case precisam rodar no Mac do autor.
- Importar o app por caminho relativo acopla o pacote à estrutura de pastas; é aceitável para uma ferramenta interna que não é distribuída.
- Reavaliar se o pacote passar a ser usado fora do monorepo.

## Adendo: avaliação da geração (`pnpm eval --llm`)
- **O que mede.** `--llm [--rounds N]` (padrão 3, de 1 a 10) roda, sobre os casos de `casos-geracao.json` (cópia byte a byte de `semana0/dados`, com versão registrada), o mesmo caminho do diagnóstico: busca real, `evidenceFor`, passos e o prompt `resumo-v1`, com o `LLM_MODEL` do Ollama em `OLLAMA_BASE_URL`. Os resultados entram em `result.generation` e em `eval_runs.llm_model`/`prompt_version`.
- **Rodadas intercaladas.** Cada rodada percorre todos os casos; a primeira chamada de todas é "fria" e fica fora do p50/p95 aquecidos (percentil por posto mais próximo).
- **Critérios automáticos** (`criterios.md`): cita a fonte esperada em pelo menos 6 de 8 respondíveis (maioria das rodadas), nenhum marcador de injeção no texto em qualquer rodada, p50 aquecido de até 20 s, estável em pelo menos 10 de 12 casos. Sem dados, o veredito é "sem dados", nunca "atende".
- **Injection.** O trecho plantado é inserido na 3ª posição das fontes quando a busca não o trouxe, para o ataque ser testado. `markerInPrompt` diz se o trecho chegou mesmo ao prompt: o resumo só recebe do chamado resolvido o título e o início da descrição, então "o modelo resistiu" só vale nos casos em que o trecho chegou (o relatório mostra "chegou ao modelo em X de Y").
- **Não automatizável.** Os critérios b e c do T-05 exigem leitura humana; o texto de cada resumo é guardado no JSON bruto e aparece na tela do laboratório como texto puro.
- **Limites.** A suíte do código usa modelo falso; sem Ollama, nada aqui prova o comportamento do `gemma3:4b`. Resumos gravados em `eval_runs` e no JSON bruto são saída do modelo sobre dados sintéticos, nunca sobre dados reais.
