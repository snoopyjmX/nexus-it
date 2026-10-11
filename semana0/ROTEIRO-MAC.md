# Roteiro para rodar a Semana 0 no Mac

Tudo abaixo roda no **Terminal do Mac**, na raiz do repositório, salvo onde indicado. O que eu (Claude) não consigo fazer daqui é rodar Ollama e Docker no seu Mac, por isso estes passos são seus. Tempo estimado: 1 h 30 a 3 h, quase tudo esperando modelo.

Dados e critérios já estão commitados em `semana0/dados/`: `criterios.md`, `titulos.md`, `consultas.json`, `gold.json`, `corpus.json`, `casos-geracao.json` e `AUTORIA.md`. **Não edite nenhum deles antes de medir.**

## 0. Pegar o código

Se você já fez merge do branch `semana0/dados` no GitHub, basta `git pull` na `main`.
Se não, use o bundle que deixei em `~/Documents/semana0-dados.bundle`:

```bash
git clone https://github.com/snoopyjmX/nexus-it && cd nexus-it
git fetch ~/Documents/semana0-dados.bundle semana0/dados:semana0/dados
git switch semana0/dados
```

Depois, uma vez:

```bash
corepack enable          # ativa o pnpm; se der erro: npm i -g pnpm@10
pnpm install
```

## 1. Ambiente (passo 1 do protocolo)

```bash
{
  echo '# Ambiente da Semana 0'; echo '```'
  system_profiler SPHardwareDataType | grep -E "Model Name|Model Identifier|Processor|Cores|Memory|Chip"
  sw_vers
  df -h /
  ollama --version
  docker version --format 'Docker server {{.Server.Version}}'
  node --version
  echo '```'
} > semana0/dados/ambiente.md
cat semana0/dados/ambiente.md
```

Isso mostra se o Mac é Intel e quanta memória tem. Mac Intel ou 8 GB de RAM tornam a geração ao vivo provavelmente inviável; o passo 6 confirma com números.

## 2. Banco e modelo de embedding (passo 5)

```bash
cp .env.example .env           # abra e preencha POSTGRES_PASSWORD (qualquer senha local)
docker compose up -d db        # Postgres + pgvector em 127.0.0.1:5432
docker compose ps              # espere ficar "healthy"
ollama pull bge-m3
```

Se o banco `nexus_semana0` não existir (o volume já existia antes): `docker compose exec db createdb -U nexus nexus_semana0`.

## 3. Busca: lexical, vetorial e híbrida

```bash
export DATABASE_URL=postgres://nexus:<SUA_SENHA>@127.0.0.1:5432/nexus_semana0
cd semana0
pnpm busca
```

Saída: `semana0/resultados/<data>-busca.md` (tabelas) e `<data>-busca.json` (bruto). Abra o `.md`: ele traz Hit@1, Hit@5 e MRR por tipo e categoria, o placar ganha/empata/perde contra a lexical, as ambíguas e o limiar. **Não ajuste corpus nem consultas depois de ver esse resultado.**

## 4. Geração (passo 6), um modelo por vez

Escolhidos do catálogo do Ollama em 2026-10-10: `qwen3.5:4b` e `gemma3:4b`. Um terceiro, `llama3.2:3b`, só se os dois falharem.

Escolha o `--metodo` pelo critério da busca: `vetorial` ou `hibrida` se uma delas ganhou segundo `dados/criterios.md`; senão `lexical`.

```bash
ollama pull qwen3.5:4b
pnpm geracao --modelo qwen3.5:4b --metodo <lexical|vetorial|hibrida> --busca resultados/<data>-busca.json
ollama stop qwen3.5:4b

ollama pull gemma3:4b
pnpm geracao --modelo gemma3:4b --metodo <lexical|vetorial|hibrida> --busca resultados/<data>-busca.json
ollama stop gemma3:4b
```

Cada rodada faz 1 chamada fria + 12 casos × 3 execuções (37 chamadas). Num Mac Intel isso pode levar de 30 min a mais de 1 h por modelo: deixe o Terminal aberto. O script imprime o resumo no fim e grava `resultados/<data>-geracao-<modelo>.json`.

Antes de confiar na rodada, abra o JSON e confira:
- `fria.resposta.load_duration` é maior que zero (a chamada foi mesmo fria).
- Nenhuma resposta tem `message.thinking` (o modo de raciocínio ficou desligado).
- `ollamaPs` mostra memória usada e se rodou em CPU ou GPU.

Se o Mac travar ou uma chamada passar de 300 s, anote: é o critério "não trava a máquina".

## 5. Registro (passo 7)

Faça commit de `semana0/dados/ambiente.md` e de `semana0/resultados/` e suba o branch.
Depois me mande os arquivos `resultados/*.md` e `resultados/*.json` (ou diga que subiu): eu comparo cada número com `criterios.md`, escrevo `decisao.md` e entrego o mega resumo.

A leitura de injection (critérios b e c) precisa de olho humano na saída bruta dos casos `q29` e `q30`. Se você não quiser ler, eu leio e declaro em `AUTORIA.md` que foi a mesma IA que escreveu os dados.
