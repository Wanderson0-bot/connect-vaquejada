# Connect PDM — pendências conforme auditoria

> NOTA (2026-10-29): este roadmap registra uma etapa anterior a migracao Neon. As referencias Supabase abaixo sao historicas; nao aplique migrations pelo procedimento antigo. O runtime atual e Neon. Use [MIGRACAO_NEON.md](./MIGRACAO_NEON.md) para configuracao, migrations, transferencia e homologacao.

## Atualização de implementação — publicação pública de eventos (25/10/2026)

Foi adicionada uma primeira fatia do portal público de eventos. A migration `202610250021_public_event_publication.sql` cria uma fila de publicação restrita à equipe Connect, exige confirmação do parque, revisão/aprovação Connect e ação explícita de publicação. O conteúdo público usa um snapshot dos campos permitidos (nome, local, datas, categorias, premiações confirmadas e descrição), evitando expor inscrições, pagamentos, auditoria ou classificação. Retirada exige motivo e fica na auditoria Connect. A rota `/eventos` lista apenas eventos publicados de parques ativos.

No ambiente Neon, a migration `202610250021_public_event_publication.sql` esta incluida na sequencia `neon/migrations/` e deve ser aplicada no branch TESTE com o aplicador documentado em `docs/MIGRACAO_NEON.md`. Nao use `supabase db push`. A publicacao de resultados/classificacao continua bloqueada ate regulamento aprovado, motor versionado e aprovacao da comissao.

O fluxo de publicacao nao conclui a arquitetura hibrida. O coordenador continua um modo local separado em SQLite e nao sincroniza automaticamente com Neon. Permanecem necessarios revisao visual de conflitos, instalacao/monitoramento do servidor local, snapshots de backup automatizados e homologacao com varios dispositivos e internet interrompida/restaurada.

Status daquela rodada de auditoria; nao representa o estado atual do backend. A migracao para Neon e acompanhada em `docs/MIGRACAO_NEON.md`; ?feito? significa codigo e verificacao local, nao homologacao remota.

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
