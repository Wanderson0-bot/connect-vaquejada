# Plano de validação antes de uma vaquejada real

> O checklist abaixo e uma etapa de homologacao, nao autoriza producao. O item de banco foi atualizado para Neon; siga [MIGRACAO_NEON.md](./MIGRACAO_NEON.md) e use apenas o branch TESTE ate concluir a validacao.


Este documento define o bloqueio de liberação. Nenhuma etapa deve ser marcada como aprovada apenas porque o build compila.

## Bloqueadores obrigatórios

- [ ] Aplicar as migrations Connect no branch Neon TESTE, confirmar Data API/Neon Auth e verificar grants/RLS em todas as tabelas expostas. Siga [MIGRACAO_NEON.md](./MIGRACAO_NEON.md); nao aplique migrations Supabase.
- [ ] Validar duas contas e parques diferentes no Neon TESTE: leitura, inclusao, atualizacao e tentativas de acesso cruzado devem respeitar RLS/RBAC do PostgreSQL.
- [ ] Validar no Neon TESTE contas individuais e permissoes para Escritorio, Locucao, Julgador e Pista, incluindo revogacao e acesso cruzado.
- [ ] Definir por escrito o regulamento esportivo usado pelo evento: categorias, pontos, tentativas, rodízios, ocorrências, desempates, classificação, finais e correções.
- [ ] Testar Pista com senha atual/próxima, tentativas inválidas, repetição de mensagens, fechamento/reabertura e trilha de auditoria.
- [ ] Testar 3 ou mais aparelhos no mesmo Wi-Fi, com internet externa disponível, retirada do cabo/WAN, reinício do coordenador e reconexão.
- [ ] Resolver conflitos pela interface sem descartar silenciosamente alterações nem sobrescrever resultado oficial.
- [ ] Testar backup e restauração em outro computador, incluindo UTF-8 e vínculos.
- [ ] Validar impressão no modelo de impressora e dispositivo que serão usados no parque.
- [ ] Realizar ensaio completo com dados fictícios e comparar classificação calculada com o julgador responsável.

## Critérios de aprovação

1. Nenhuma perda de inscrição, pagamento, reserva ou resultado confirmado durante o ensaio.
2. Nenhum número de senha duplicado no mesmo evento.
3. Nenhum resultado oficial alterado sem procedimento de correção, justificativa e auditoria.
4. Dados de um parque não podem ser consultados nem alterados por outro parque.
5. Falha de conexão deve ser visível; fila pendente e conflito não podem parecer sincronizados.
6. Restauração comprovada e responsáveis de contingência definidos.

Se algum item obrigatório estiver pendente, operar apenas em homologação/ensaio, não em competição oficial.
