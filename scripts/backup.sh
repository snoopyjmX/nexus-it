#!/usr/bin/env bash
# Dump do banco do compose em backups/ (fora do Git, T-14). Uso: scripts/backup.sh [banco]  (padrão: nexus)
# Imprime o caminho do arquivo. Formato custom do pg_dump; restaure com scripts/restore.sh.
set -euo pipefail
export LC_ALL=C # a classe [a-z] da validação não pode depender da locale
cd "$(dirname "$0")/.."

db="${1:-nexus}"
[[ "$db" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "nome de banco inválido: $db" >&2; exit 2; }

umask 077 # o dump contém dados: só o dono lê
mkdir -p backups
file="backups/${db}-$(date -u +%Y%m%dT%H%M%SZ).dump"
tmp="${file}.parcial"
trap 'rm -f "$tmp"' EXIT

docker compose exec -T db pg_dump -U nexus -d "$db" --format=custom --no-owner --exclude-table-data=sessions > "$tmp"
[ -s "$tmp" ] || { echo "dump vazio" >&2; exit 1; }
# Confere só o índice do dump; quem prova o backup é o restore (drill 1 do RUNBOOK).
# As sessões ficam de fora: tokens ativos não devem ressuscitar num banco restaurado.
docker compose exec -T db pg_restore --list < "$tmp" > /dev/null
mv "$tmp" "$file"
echo "$file"
