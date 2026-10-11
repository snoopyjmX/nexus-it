# Semana 0 — Experimento de viabilidade

Objetivo: responder com dados, em 12–18 h e sem construir o produto:
1. A busca vetorial ganha da lexical em paráfrases?
2. Existe um limiar de score que separa "tem resposta" de "não tem"?
3. Algum modelo local cita a fonte certa, resiste a injection e responde num tempo aceitável neste Mac?

Roda na pasta `semana0/` deste repositório, com scripts Node/TypeScript (como rodar: [semana0/README.md](../semana0/README.md)). O código do produto não importa nada dela. Registre as horas em `horas.csv`.

## Passo 1 — Hardware e ambiente (30 min)

```
system_profiler SPHardwareDataType   # chip, núcleos, memória
sw_vers                              # versão do macOS
df -h /                              # espaço livre
ollama --version
docker version --format '{{.Server.Version}}'
```

Salve a saída em `semana0/dados/ambiente.md`. Mac Intel ou 8 GB de RAM → geração ao vivo provavelmente inviável (hipótese; o passo 6 confirma).

## Passo 2 — Critérios antes dos dados (1 h)

Copie a tabela de critérios do fim deste arquivo para `semana0/dados/criterios.md`, ajuste se discordar, e faça commit. Nada é medido antes desse commit.

## Passo 3 — Consultas antes do corpus (2 h)

6 categorias: acesso/senha, VPN, rede/DNS, impressora, e-mail/Office, estação Windows. 5 títulos de problema por categoria (30 títulos). Escreva as consultas **antes** dos artigos, como um solicitante descreveria:

| Tipo | Qtd |
| --- | --- |
| Direta (vocabulário técnico) | 8 |
| Paráfrase leiga (sem termos do título) | 10 |
| Sem resposta no corpus | 8 (4 calibram o limiar, 4 validam) |
| Ambígua (2+ causas) | 2 |
| Injection plantada em artigo ou chamado | 2 |

## Passo 4 — Corpus (5–7 h)

30 artigos curtos (100–200 palavras) no formato sintoma / ambiente / procedimento / resultado esperado, mais 10 chamados resolvidos. Inclua 6 pares de distratores (mesmo sintoma, causa e procedimento diferentes). Um LLM pode rascunhar artigos se você revisar cada um com rigor de N2; registre quais foram rascunhados. As consultas são sempre suas. Rotule a fonte esperada de cada consulta em `gold.json`.

## Passo 5 — Recuperação (3–4 h)

Postgres com pgvector via Docker (conferir a tag atual da imagem oficial), extensão `unaccent`.

- **Lexical:** `to_tsvector('portuguese', unaccent(...))`, título+sintoma com peso A, procedimento com peso B, `websearch_to_tsquery`, `ts_rank_cd`.
- **Vetorial:** `bge-m3` via Ollama, 1 artigo = 1 vetor, busca **exata** por cosseno, sem índice ANN.
- **Híbrida:** RRF com k=60 sobre o top-20 de cada método.

Meça Hit@1, Hit@5 e MRR por tipo de consulta e por categoria, em contagens (ex.: 7/10). Faça uma tabela consulta a consulta marcando se vetorial/híbrida ganha, empata ou perde para a lexical. Para a abstenção, escolha o limiar com o grupo de calibração e verifique-o no grupo de validação. Score não é probabilidade: o limiar é regra empírica deste corpus.

## Passo 6 — Geração (3–4 h)

Dois modelos de até ~4B parâmetros escolhidos no catálogo do Ollama na data (um terceiro só se ambos falharem). Antes, leia na documentação oficial do Ollama como usar saída estruturada com JSON schema, temperatura 0, seed fixa e como desligar o modo de raciocínio, se o modelo tiver.

12 casos (8 respondíveis, 2 sem resposta, 2 injection), contexto vindo da melhor busca do passo 5. 3 execuções por caso, aquecido; a primeira chamada fria registrada à parte. Anote `ollama ps` (memória, CPU/GPU) e o ID de `ollama list`.

## Passo 7 — Registro e decisão (1 h)

`semana0/resultados/`: os scripts gravam commit, ambiente, modelo + ID, parâmetros, frio/aquecido e saída bruta por caso. `semana0/dados/decisao.md`: uma linha por critério — passou, não passou ou inconclusivo.

## Critérios (heurísticos para um conjunto pequeno — não são prova estatística)

| Componente | Adotar se | Senão |
| --- | --- | --- |
| Busca vetorial/híbrida | Nas 10 paráfrases, Hit@5 da melhor variante supera o lexical em ≥ 2 consultas, sem perder mais de 1 nas diretas e sem perdas concentradas numa mesma categoria | Fica full-text. Empate ou inconclusivo também mantém full-text. O experimento vai para o case |
| Abstenção por limiar | O limiar escolhido na calibração abstém em ≥ 3/4 dos sem-resposta da validação e perde ≤ 1 respondível desse grupo | Sem limiar: painel nunca afirma suficiência; fontes rotuladas "evidência não verificada", sem porcentagem |
| Geração ao vivo | Cita a fonte esperada em ≥ 6/8 respondíveis; 0 ataques bem-sucedidos (critérios a/b/c do THREAT_MODEL T-05); p50 aquecido ≤ 20 s; não trava a máquina | Painel determinístico; LLM vira experimento documentado |
| Variância | Mesma resposta nas 3 execuções em ≥ 10/12 casos | Registrar instabilidade; não usar o modelo para próximos testes |

O limite de 20 s é uma escolha de UX para um botão com indicador de progresso, não um benchmark.
