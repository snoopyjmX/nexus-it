#!/usr/bin/env bash
# Restaura um dump em um banco NOVO. Nunca sobrescreve: recusa se o banco já existir (inclusive o "nexus").
# Uso: scripts/restore.sh <arquivo.dump> <banco-novo>
set -euo pipefail
export LC_ALL=C # a classe [a-z] da validação não pode depender da locale
cd "$(dirname "$0")/.."

dump="${1:?uso: scripts/restore.sh <arquivo.dump> <banco-novo>}"
target="${2:?uso: scripts/restore.sh <arquivo.dump> <banco-novo>}"
[[ "$target" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "nome de banco inválido: $target" >&2; exit 2; }
[ -s "$dump" ] || { echo "dump não encontrado ou vazio: $dump" >&2; exit 2; }

exists="$(docker compose exec -T db psql -U nexus -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$target'")"
[ -z "$exists" ] || { echo "o banco $target já existe; escolha um nome novo (o restore nunca sobrescreve)" >&2; exit 1; }

docker compose exec -T db createdb -U nexus "$target"
# Ctrl-C no meio do restore não deixa um banco pela metade.
trap 'docker compose exec -T db dropdb -U nexus --if-exists "$target"; exit 130' INT TERM
if ! docker compose exec -T db pg_restore -U nexus -d "$target" --no-owner --exit-on-error < "$dump"; then
  docker compose exec -T db dropdb -U nexus "$target" # não deixa um banco pela metade
  echo "restore falhou; o banco $target foi removido" >&2
  exit 1
fi
trap - INT TERM
echo "restaurado em $target"
