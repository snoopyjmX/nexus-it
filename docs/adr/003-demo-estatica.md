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
