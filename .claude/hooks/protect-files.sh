#!/bin/bash
# Bloqueia edições em arquivos sensíveis ou que só humanos devem alterar.
# Exit 2 = bloqueia e devolve a mensagem ao Claude.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
FILE_PATH="${FILE_PATH//\\//}"

[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
  *.env.example) exit 0 ;;
esac

PROTECTED=(
  ".env"
  ".git/"
  "pnpm-lock.yaml"
  "packages/evaluation/dataset/test/"
)

for pattern in "${PROTECTED[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Bloqueado: $FILE_PATH é protegido ('$pattern'). Peça ao usuário para editar ou para liberar explicitamente." >&2
    exit 2
  fi
done

exit 0
