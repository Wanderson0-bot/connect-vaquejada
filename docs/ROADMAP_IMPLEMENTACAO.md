# Connect PDM — pendências conforme auditoria

## Atualização de implementação — publicação pública de eventos (25/10/2026)

Foi adicionada uma primeira fatia do portal público de eventos. A migration `202610250021_public_event_publication.sql` cria uma fila de publicação restrita à equipe Connect, exige confirmação do parque, revisão/aprovação Connect e ação explícita de publicação. O conteúdo público usa um snapshot dos campos permitidos (nome, local, datas, categorias, premiações confirmadas e descrição), evitando expor inscrições, pagamentos, auditoria ou classificação. Retirada exige motivo e fica na auditoria Connect. A rota `/eventos` lista apenas eventos publicados de parques ativos.

Para ativar este fluxo, aplique a migration 021 **depois** das migrations até `202610240020_park_name_identity.sql` no Supabase e valide os testes de RLS/RPC em ambiente de homologação. Este repositório não está conectado a um projeto Supabase; a migration não foi aplicada remotamente. A publicação de resultados/classificação continua fora do escopo e bloqueada até regulamento aprovado, motor versionado e aprovação da comissão.

O fluxo de publicação de evento não conclui a arquitetura híbrida do produto. Continuam necessários sincronização transacional coordenador↔Supabase, resolução visual de conflitos, instalação/monitoramento do servidor local, snapshots de backup automatizados e homologação com vários dispositivos e internet interrompida/restaurada.

Status atualizado após auditoria do repositório e implementação parcial do coordenador local. “Feito” significa código e verificação local; não implica validação no parque ou no Supabase de produção.

| Etapa | Estado | Evidência/pendência principal |
|---|---|---|
| 1. Auditoria | Feita nesta rodada | Repetidos 16 testes, TypeScript e build; sem projeto Supabase configurado. |
| 2. Coordenador LAN | Parcial — endurecimento de segurança aplicado | Além dos itens já existentes, agora recusa expor o token em HTTP na LAN por padrão; HTTPS é exigido fora de loopback, com exceção explícita apenas para laboratório. Teste de regressão incluído. Ainda faltam sincronização Supabase, resolução visual de conflitos, atomicidade local+outbox, gestão do serviço/instalador e ensaios reais. |
| 3. Pista | Parcial/pendente | Há registro/consulta de resultados, confirmação e correção; faltam fila esportiva, senha atual/próxima, ordem, rodízios, tentativas, ocorrências configuráveis, fechar/reabrir etapa e permissões específicas. |
| 4. Equipe e permissões | Pendente | Conta do parque existe no backend atual; não existem contas de equipe/RBAC. RLS Supabase entre parques não foi testado em banco real. |
| 5. Classificação esportiva | Bloqueada para uso oficial | A tela mostra somente soma provisória de pontos registrados, sem posições/desempates. Falta regulamento aprovado, registro/autorização server-side, motor determinístico, apuração/publicação versionadas e casos de referência da comissão. |
| 6. Locução e portal público | Pendente | Sem painel de locução ou portal público de eventos/resultados oficiais. |
| 7. Financeiro, histórico e backup | Parcial | Pagamentos, reservas e backup JSON manual; faltam reembolsos como lançamentos, importação histórica validada, backup automático/remoto, alertas e restauração testada. |
| 8. Gestão comercial por evento | Pendente | Sem módulo de contratos/locação/instalação/suporte. |
| 9. UTF-8 e pt-BR | Parcial | Testes cobrem round-trip de CSV/JSON e teste do SQLite/coordenador; IndexedDB real, Supabase, impressão e Excel/PDF não foram exercitados integradamente. |
| 10. Testes/aceitação | Parcial | Testes, TypeScript e build passam; faltam browsers/IndexedDB, Supabase, múltiplos dispositivos, LAN sem internet externa e teste operacional do parque. |

## Comandos desta rodada

- `node --check coordinator/server.mjs` — passou.
- `npm.cmd test` — 16 testes passaram.
- ` .\\node_modules\\.bin\\tsc.cmd --noEmit` — passou.
- `npm.cmd run build` — passou em execução autorizada fora do sandbox; Vite avisou que o bundle JavaScript minificado excede 500 kB.

## Dependências externas

O Supabase continua sem URL/chaves de ambiente nem banco acessível nesta execução. O coordenador para uso em LAN requer computador dedicado, Node.js 22.13+, token forte, armazenamento persistente, regra de firewall e certificado HTTPS confiável nos aparelhos. Esses requisitos estão detalhados em `docs/COORDENADOR_LOCAL.md`.
