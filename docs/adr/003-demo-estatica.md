# 003. Demo pública estática com respostas gravadas

Data: 2026-10-10 · Status: aceito

## Contexto
Recrutadores não vão clonar o repositório. Hospedar API + Postgres gratuitamente depende de planos que pausam, expiram ou exigem cartão, e o modelo local não fica disponível publicamente.

## Opções consideradas
- Backend ao vivo em host gratuito: mais real / frágil, exige reset e proteção contra abuso.
- Frontend estático com API simulada a partir de respostas gravadas da execução local real: sempre no ar / não é ao vivo.

## Decisão
Demo garantida estática, com o que é gravado identificado na UI, mais vídeo de 2–3 minutos do fluxo local. Backend ao vivo é bônus opcional após o MVP e após verificar os limites oficiais do host.

## Consequências
A demo nunca cai e não custa nada. O README deixa claro o que é gravado e como rodar local.

## Adendo: como foi implementada (2026-10-12)
- **Mesmo front, outro build.** `VITE_DEMO=true` (`pnpm build:demo`, saída em `apps/web/dist-demo`, caminhos relativos) faz `api()` responder só com `apps/web/src/demo/recorded.json`: nunca chama a rede. O build normal não carrega esses dados (verificado: nenhuma ocorrência no `dist`). Sem dependência nova.
- **Gravação real.** `pnpm demo:record` sobe a pilha de verdade (API, Postgres `_test` e Vite), semeia o corpus dev como base publicada e chamados resolvidos, abre quatro chamados com o texto de consultas dev que já existem (uma de cada tipo: direta, paráfrase, sem resposta, ambígua), pede o diagnóstico de cada um e visita as telas num navegador, guardando cada GET e o POST do diagnóstico. A gravação não leva token de sessão (o CSRF vira `demo`).
- **Execuções do laboratório.** As execuções que a tela do laboratório mostra não foram feitas durante a gravação: `prepare-demo-db.ts` importa os resultados já versionados em `packages/evaluation/results/`.
- **Rotulado.** Um aviso fixo diz que as respostas são gravadas e que escrever está desligado; escrita sem resposta gravada devolve 403 com o motivo, e consulta não gravada devolve 404.
- **Roteador por hash** na demo, porque hospedagem estática não reescreve URL.
- **O que a demo mostra e não mostra.** O diagnóstico gravado usa a busca por palavras: fontes como "evidência não verificada", sem resumo do modelo e sem exemplo de abstenção. Só os caminhos percorridos pela gravação funcionam; uma busca nova não gravada responde 404.
- **Testes.** `demo.test.tsx` (comportamento e a comparação inline em `api.ts` de que depende o build normal não levar os dados), `demo-recorded.test.tsx` (cobertura da gravação real) e o projeto `demo` do e2e (build estático num navegador, sem chamadas à API). Custo: todo `pnpm test:e2e` passa a construir a demo e subir um terceiro servidor (porta 5190).
- **Publicação** (onde hospedar) não faz parte deste adendo: é decisão do autor.
