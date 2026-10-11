# NEXUS IT — PRD

Versão 2.0 · 2026-10-10 · Substitui o "Plano Mestre" e o "Plano Enxuto" (ver docs/historico/). Mudanças de decisão só com ADR em docs/adr/.

## 1. Produto em uma frase

Ferramenta interna de suporte de TI em que o técnico abre um chamado e vê as fontes mais prováveis da base de conhecimento e de chamados resolvidos, os passos de verificação do procedimento citado e uma abstenção explícita quando a evidência é fraca — com permissões testadas, avaliação medida e operação documentada.

- **Usuários:** técnico de suporte (principal) e solicitante. Uma única organização fictícia.
- **Dados:** 100% sintéticos. Nada de empregador, colegas ou sistemas reais.
- **Custo:** zero. Nenhuma API paga, cartão ou cloud obrigatória.
- **IA:** o núcleo do diagnóstico é determinístico (ADR-002). O LLM local é uma camada opcional que só resume e conecta, e só entra se passar nos critérios da Semana 0.

## 2. Escopo do MVP

| Módulo | O que entra |
| --- | --- |
| A. Chamados | Criar, listar, ver, atualizar. Máquina de estados (ARCHITECTURE §3). Comentários e histórico de eventos. Nota de resolução obrigatória. |
| B. Base de conhecimento | Artigos com sintoma, ambiente, procedimento, resultado esperado, tags, versão, rascunho/publicado. Só técnico edita. |
| C. Busca | Full-text do Postgres (baseline). Vetorial/híbrida só se passar no gate da Semana 0. |
| D. Diagnóstico | Fontes ranqueadas e clicáveis + próximos testes extraídos do campo `procedure` das fontes + abstenção por limiar de score. Resumo do LLM opcional e rotulado como gerado. Feedback útil/não útil. |
| E. Laboratório | Tela só leitura com métricas por versão de dataset, modelo e prompt. Exporta JSON/CSV. A suíte roda por CLI. |
| F. Operação | Docker Compose, health live/ready, logs estruturados, backup/restore, runbook com 3 drills. |

### Fora do escopo (regra fixa)

Multi-tenant · cadastro público de usuários (usuários via seed e CLI) · reset de senha · admin web · agente de inventário · gestão de ativos · execução de comandos · automação de correções · upload de anexos · integrações (e-mail, Slack, Teams) · chatbot público · SLA/contratos · analytics de produtividade individual · comentário interno · rascunho de artigo já publicado · microsserviços/filas/Kubernetes · API de LLM paga · qualquer dado real.

Opcional, só depois do MVP: painel de métricas operacionais simples; backend ao vivo na demo pública.

## 3. Requisitos funcionais

| ID | Requisito | Critério de aceite (teste ou evidência) |
| --- | --- | --- |
| FR-01 | Login e logout | Credencial inválida → erro genérico e tempo uniforme. Logout invalida a sessão no servidor. |
| FR-02 | Autorização por papel | Solicitante chamando rota de técnico → 403. |
| FR-03 | Isolamento de chamados | Solicitante B não lê, comenta, vê eventos nem altera chamado de A → 404. Teste por endpoint, gerado a partir da matriz. |
| FR-04 | Ciclo do chamado | Transição fora da tabela → 422 problem+json. Campo inválido ou extra → 400. |
| FR-05 | Histórico | Toda transição, mudança de responsável ou prioridade grava evento (ator, horário, tipo) na mesma transação. |
| FR-06 | Base de conhecimento | Só técnico cria/edita/publica. Rascunho → 404 para solicitante e ausente da busca e do contexto. |
| FR-07 | Busca lexical | Escopo pelo papel, decidido no servidor. Resultado reproduzível no dataset. |
| FR-08 | Busca vetorial/híbrida | Só existe se passou no gate da Semana 0 (docs/SEMANA0.md). |
| FR-09 | Diagnóstico estruturado | Fontes com link correto; próximos testes vindos do `procedure` das fontes; IDs fora da lista recuperada descartados. |
| FR-10 | Abstenção | Melhor score abaixo do limiar → painel mostra "evidência insuficiente" e não chama o LLM. Sem limiar confiável → fontes rotuladas "evidência não verificada", sem nenhuma porcentagem. |
| FR-11 | Feedback | Técnico marca útil/não útil e registra correção, sem promover a sugestão a fato. |
| FR-12 | Laboratório | Suíte por CLI gera métricas com versão de dataset, modelo, prompt, hardware e data. |
| FR-13 | Degradação | Modelo fora do ar → chamados, KB, busca e painel determinístico funcionam; UI avisa. |
| FR-14 | Health | `/health/live` e `/health/ready` distinguem processo de dependências, sem detalhes internos. |
| FR-15 | Consistência do índice | Despublicar/excluir artigo o remove das buscas lexical e vetorial (filtro na própria linha, ADR-001). |
| FR-16 | Seed e usuários | Um comando gera cenário fictício previsível. Usuários só via seed/CLI. |

## 4. Requisitos não funcionais

| ID | Requisito | Critério |
| --- | --- | --- |
| NFR-01 | Custo zero | Dev, testes e CI sem API paga, cartão ou cloud. |
| NFR-02 | Reprodutibilidade | Clone limpo → `docker compose up` + seed → app funcionando. Versões fixadas. |
| NFR-03 | Segurança | Checklist mapeado a OWASP Top 10:2025, API Top 10:2023, ASVS 5.0 nível 1 e LLM Top 10:2025. Não é certificação. |
| NFR-04 | Testabilidade | Nenhum teste de regra de negócio depende de LLM real (provider mock). |
| NFR-05 | Privacidade | Logs sem senha, cookie, token ou corpo de chamado; teste automatizado verifica. |
| NFR-06 | Acessibilidade | Fluxos críticos por teclado, foco visível, contraste WCAG 2.2 AA. |
| NFR-07 | Observabilidade | Logs JSON com request ID, rota, status e duração. |
| NFR-08 | Simplicidade | Monólito modular. Dependência nova só com ADR. |

## 5. Demo e apresentação

- **Demo garantida (ADR-003):** frontend estático com API simulada a partir de respostas gravadas da execução local real, rotuladas "gravado". Funciona sem backend.
- Vídeo de 2–3 minutos do fluxo completo rodando local.
- README entendível em 2 minutos: problema, como rodar, resultados medidos (inclusive negativos) e limitações.

## 6. Pré-requisito e processo

- Começa depois do deploy da Fase 5 do Sillage.
- Semana 0 antes de qualquer código do produto (docs/SEMANA0.md).
- Horas reais registradas em `horas.csv` desde a Semana 0. Faixa de planejamento: 120–185 h, não é previsão; reestimar após a Semana 0 e a Fase 1.
