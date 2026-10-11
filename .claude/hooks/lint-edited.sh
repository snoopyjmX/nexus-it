#!/bin/bash
# Roda ESLint só no arquivo editado. Se houver erro, devolve ao Claude (exit 2)
# para ele corrigir na hora. Não faz nada enquanto o projeto não tiver ESLint.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

case "$FILE_PATH" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
[ -x node_modules/.bin/eslint ] || exit 0

OUTPUT=$(node_modules/.bin/eslint --max-warnings=0 "$FILE_PATH" 2>&1)
if [ $? -ne 0 ]; then
  echo "ESLint encontrou problemas em $FILE_PATH. Corrija a causa, não desative a regra:" >&2
  echo "$OUTPUT" | head -40 >&2
  exit 2
fi

exit 0
