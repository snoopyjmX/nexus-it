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
