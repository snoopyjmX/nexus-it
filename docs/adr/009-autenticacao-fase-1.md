# 009. Autenticação da Fase 1: scrypt, CSRF derivado e rate limit em memória

Data: 2026-10-11 · Status: aceito em 2026-10-11 (autor delegou a decisão a Claude após análise; revisitar se o runtime passar para Node 24 ou se houver mais de uma instância)

## Contexto
O ADR-004 define sessão em cookie com store em Postgres e CSRF sincronizador. O THREAT_MODEL pede Argon2id, rate limit por IP e por conta e login com mensagem genérica e tempo uniforme. Três pontos não estavam fechados:

1. **Algoritmo de senha.** O Node 22 (`.node-version`, Dockerfile e CI) não tem `crypto.argon2`, que só existe a partir do Node 24.7. Argon2id exigiria uma dependência nativa nova ou trocar o runtime.
2. **CSRF.** O ARCHITECTURE §2 guarda `csrf_token_hash` na sessão, mas `/auth/me` precisa entregar o token ao navegador, e um hash não pode ser devolvido.
3. **Rate limit.** Não há decisão sobre onde guardar os contadores.

## Opções consideradas
- Senha:
  - Argon2id por dependência (`argon2` ou `@node-rs/argon2`): segue a especificação / dependência nativa, imagem Alpine (musl) e superfície de ataque (T-09).
  - Argon2id nativo com Node 24: sem dependência / muda `.node-version`, Dockerfile, CI e a versão de quem já roda o projeto.
  - `scrypt` de `node:crypto`: sem dependência, aceito pelo OWASP Password Storage Cheat Sheet quando Argon2id não está disponível / desvia do texto do THREAT_MODEL.
- CSRF: guardar o token em claro na sessão (vaza para quem lê o banco) / derivar do token da sessão (nada extra no banco).
- Rate limit: Postgres (sobrevive a reinício, mais I/O por tentativa) / memória do processo (simples, perde o estado ao reiniciar e não é compartilhado entre instâncias).

## Decisão
- **Senha com `scrypt`** de `node:crypto`, N=2^16, r=8, p=2 (64 MiB), sal de 16 bytes, saída de 32 bytes, guardada como `scrypt$N$r$p$sal$hash`. Medido em 2026-10-11 neste ambiente (2 vCPU): mediana de 376 ms, dentro do alvo de 100–500 ms; remedir no Mac. Os parâmetros ficam no próprio hash, então subir o custo ou trocar por Argon2id depois é só refazer o hash no login. A comparação é em tempo constante.
- **CSRF derivado:** o token é `sha256("csrf:" + token_da_sessao)` em hexadecimal. A tabela `sessions` não tem `csrf_token_hash`. `/auth/me` devolve o token e toda mutação autenticada exige `X-CSRF-Token` igual a ele. Além disso, mutação com cabeçalho `Origin` de outro host é recusada, o que também cobre o login (T-16).
- **Rate limit em memória**, janela fixa de 15 minutos: 20 tentativas de login por IP e 5 falhas por e-mail informado (existindo ou não, para não revelar contas). Acima disso, 429 com `Retry-After`. O número de chaves é limitado.
- **Sessão:** token de 32 bytes aleatórios, só o hash SHA-256 no banco, expiração por inatividade de 30 minutos e absoluta de 12 horas. Cada login cria uma sessão nova e apaga a que veio no cookie. O cookie é `Secure` apenas em produção (em desenvolvimento o servidor roda em HTTP).
- **Login com tempo uniforme:** usuário inexistente ou inativo gasta o mesmo scrypt contra um hash falso. A resposta é sempre 401 com a mesma mensagem.

## Consequências
- Nenhuma dependência nova. O THREAT_MODEL (Argon2id) e o ARCHITECTURE §2 (`csrf_token_hash`) são atualizados no mesmo commit para refletir esta decisão.
- Cada hash usa 64 MiB e ~0,4 s de CPU; o limite de tentativas protege contra esgotar a máquina com logins.
- O limite por conta permite que alguém bloqueie o login de outra pessoa por 15 minutos com 5 tentativas erradas. É a troca aceita por não deixar adivinhação de senha ilimitada.
- Os contadores somem se a API reiniciar e não valem para mais de uma instância. Com várias instâncias, mover para o Postgres exige ADR novo.
- Se o autor preferir Argon2id, a mudança fica contida no módulo de senha e na migração de hashes no login.

## Análise da decisão (2026-10-11)
- Argon2id por dependência nativa custaria um módulo C++/Rust na imagem Alpine, mais superfície de ataque e de build (T-09), para um ganho que o OWASP não exige: o Cheat Sheet aceita scrypt com N=2^17/r=8/p=1 ou equivalente, e N=2^16/r=8/p=2 tem custo de memória e tempo comparável (64 MiB, ~0,4 s).
- Trocar o runtime para Node 24 só por isso mexe em Dockerfile, CI e máquina de quem desenvolve, sem ganho no problema real (senhas de um sistema interno de demonstração).
- O risco da escolha é baixo e reversível: o formato do hash carrega os parâmetros e o algoritmo, e `needsRehash` já refaz o hash no login. Quando o Node 24 for o runtime, trocar para `crypto.argon2` é uma mudança contida no módulo de senha.
- Pendência técnica: remedir o custo do scrypt no Mac do autor com `pnpm auth:bench` e, se a mediana passar de 500 ms, baixar N para 2^15 (registrar aqui). Medido neste ambiente de desenvolvimento (2 vCPU Xeon 2,1 GHz): mediana de 393 ms.
