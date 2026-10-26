# Plano de validação antes de uma vaquejada real

Este documento define o bloqueio de liberação. Nenhuma etapa deve ser marcada como aprovada apenas porque o build compila.

## Bloqueadores obrigatórios

- [ ] Aplicar migrações em projeto Supabase de homologação e verificar grants/RLS em todas as tabelas expostas.
- [ ] Testar duas contas de parques diferentes: leitura, inclusão, atualização e tentativa de acesso cruzado devem respeitar isolamento.
- [ ] Implementar e testar contas individuais, funções e permissões para Escritório, Locução, Julgador e Pista.
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
