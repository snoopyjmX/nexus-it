#!/usr/bin/env bash
# Semana 0: roda os passos 1, 5 e 6 do protocolo no Mac, na ordem, sem intervenção.
#
#   semana0/rodar-tudo.sh                  ambiente, busca, e geração com qwen3.5:4b e gemma3:4b
#   semana0/rodar-tudo.sh llama3.2:3b      só a geração dos modelos indicados, reaproveitando a busca
#
# O banco é um contêiner descartável (pgvector/pgvector:pg17, só em 127.0.0.1:55432, senha aleatória
# que não vai para disco). Não usa nem cria .env e não mexe no Postgres do projeto.
# Não edita dados nem critérios. Se algo já foi medido, não mede de novo: para refazer, apague o
# arquivo em semana0/resultados/.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

info() { printf '\n==> %s\n' "$*"; }
erro() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }

[ -f semana0/dados/criterios.md ] || erro "semana0/dados/ não existe aqui. Troque para o branch semana0/dados."
git diff --quiet HEAD -- semana0/dados || erro "há alterações não commitadas em semana0/dados. Dados e critérios não podem mudar antes de medir."

for cmd in node git docker ollama curl openssl; do
  command -v "$cmd" >/dev/null 2>&1 || erro "'$cmd' não encontrado no PATH."
done
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || erro "precisa de Node 22 ou mais novo (tem $(node --version))."
command -v pnpm >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 || true
command -v pnpm >/dev/null 2>&1 || erro "pnpm não encontrado. Rode: npm i -g pnpm@10"
docker info >/dev/null 2>&1 || erro "o Docker (OrbStack) não está rodando. Abra o OrbStack e tente de novo."
curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 || erro "o servidor do Ollama não responde. Abra o app Ollama (ou rode 'ollama serve' em outra aba)."

if [ "$#" -gt 0 ]; then MODELOS=("$@"); else MODELOS=("qwen3.5:4b" "gemma3:4b"); fi

cat <<'EOF'

A geração mede latência, então o Mac precisa ficar quieto:
  - na tomada;
  - Chrome, VS Code, Expo, simuladores e outros apps pesados fechados;
  - Terminal aberto até o fim (de 1 a 2 horas; o script impede o Mac de dormir).
EOF
read -r -p "Pronto? Enter para começar, Ctrl+C para cancelar. " _
command -v caffeinate >/dev/null 2>&1 && { caffeinate -is -w $$ & }

info "Instalando dependências"
pnpm install --frozen-lockfile

AMBIENTE=semana0/dados/ambiente.md
if [ ! -f "$AMBIENTE" ]; then
  info "Registrando o ambiente em $AMBIENTE"
  {
    echo '# Ambiente da Semana 0'
    echo '```'
    system_profiler SPHardwareDataType | grep -E "Model Name|Model Identifier|Processor|Cores|Memory|Chip" || true
    system_profiler SPDisplaysDataType | grep -E "Chipset Model|VRAM" || true
    sw_vers || true
    df -h / || true
    pmset -g batt | head -1 || true
    echo "ollama: $(ollama --version 2>&1 | tail -1)"
    docker version --format 'Docker server {{.Server.Version}}' || true
    echo "node: $(node --version)"
    echo '```'
  } > "$AMBIENTE"
  cat "$AMBIENTE"
fi

cd semana0
export OLLAMA_BASE_URL="http://127.0.0.1:11434"

ultima_busca() { ls -1 resultados/*-busca.json 2>/dev/null | tail -1 || true; }
BUSCA="$(ultima_busca)"

if [ -z "$BUSCA" ]; then
  [ "$#" -eq 0 ] || erro "não há *-busca.json em semana0/resultados/. Rode sem argumentos primeiro."

  NOME_DB=nexus-semana0-db
  SENHA="$(openssl rand -hex 16)"
  docker rm -f "$NOME_DB" >/dev/null 2>&1 || true
  trap 'docker rm -f "$NOME_DB" >/dev/null 2>&1 || true' EXIT
  info "Subindo o Postgres descartável"
  docker run -d --name "$NOME_DB" -e POSTGRES_USER=nexus -e POSTGRES_PASSWORD="$SENHA" \
    -e POSTGRES_DB=nexus_semana0 -p 127.0.0.1:55432:5432 pgvector/pgvector:pg17 >/dev/null
  pronto=0
  for _ in $(seq 1 60); do
    # -h 127.0.0.1: o servidor temporário da inicialização só escuta no socket, não aqui.
    if docker exec "$NOME_DB" pg_isready -h 127.0.0.1 -U nexus -d nexus_semana0 >/dev/null 2>&1; then pronto=1; break; fi
    sleep 1
  done
  [ "$pronto" -eq 1 ] || erro "o Postgres não ficou pronto em 60 s."
  export DATABASE_URL="postgres://nexus:${SENHA}@127.0.0.1:55432/nexus_semana0"

  info "Passo 5: busca (lexical, vetorial, híbrida)"
  ollama pull bge-m3
  pnpm busca
  ollama stop bge-m3 >/dev/null 2>&1 || true
  BUSCA="$(ultima_busca)"
else
  info "Reaproveitando a busca já medida: $BUSCA (apague o arquivo para medir de novo)"
fi

METODO="$(pnpm --silent escolher "$BUSCA")"

info "Passo 6: geração com o método '$METODO'"
FALHAS=""
for M in "${MODELOS[@]}"; do
  SLUG="${M//[^A-Za-z0-9.-]/_}"
  if ls resultados/*-geracao-"$SLUG".json >/dev/null 2>&1; then
    info "$M já foi medido; pulando (apague o arquivo em semana0/resultados/ para refazer)"
    continue
  fi
  info "Modelo $M (37 chamadas; pode levar de 30 min a mais de 1 h)"
  if ! ollama pull "$M"; then FALHAS="$FALHAS
  $M: o download falhou"; continue; fi
  if ! pnpm geracao --modelo "$M" --metodo "$METODO" --busca "$BUSCA"; then FALHAS="$FALHAS
  $M: a geração falhou"; fi
  ollama stop "$M" >/dev/null 2>&1 || true
done

info "Arquivos gerados"
ls -1 resultados/ dados/ambiente.md
if [ -n "$FALHAS" ]; then
  printf '\nCom falha:%s\n' "$FALHAS" >&2
fi
cat <<'EOF'

Próximos passos, no seu git (o script não faz commit nem push):
  git add semana0/dados/ambiente.md semana0/resultados
  git commit -m "docs(semana0): resultados da medição"
  git push -u origin semana0/dados
Depois mande para o Claude os arquivos de semana0/resultados/ (.md e .json).
EOF
[ -z "$FALHAS" ]
