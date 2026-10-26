# Pendências do regulamento e decisões da comissão

**Estado:** existe um documento de referência e regras adicionais confirmadas pelo responsável, mas ainda não há regulamento formal do PDM aprovado. As regras implementáveis deste documento foram conectadas aos fluxos provisórios. Materiais de referência não equivalem à aprovação formal, e nenhuma lacuna foi preenchida por suposição. A classificação e publicação oficiais continuam bloqueadas.

## Decisões necessárias

1. **Inscrições múltiplas do mesmo vaqueiro:** esclarecimento explícito do responsável: pode haver uma ou mais inscrições, sem efeito ou penalidade por quantidade. Cada senha é independente e mantém seus próprios dados/resultados. Não se aplica descarte automático da melhor parcial nem da melhor inscrição.
2. **Dupla e identidade dos participantes:** confirmar se cada inscrição precisa de dois nomes, se há funções distintas e quais alterações constituem transferência. O sistema passou a guardar vaqueiro e parceiro; validação esportiva de identidade permanece pendente.
3. **Dias, rodízios e corridas:** a referência informa duas corridas por inscrição no Rodízio A e uma no B (três previstas no total), com agenda e quantidade configuradas por evento. O sistema agora aceita `racesPerEntry` em cada rodízio; a organização deve configurar os valores e a capacidade/ordem do evento, sem nomes ou quantidades globais presumidos.
4. **Ordem da fila:** confirmar se a ordem padrão crescente da senha atende à chamada, quais exceções são permitidas, quem as autoriza e como se registram pausas/retomadas e reordenações.
5. **Rabo da gata:** a referência define ausência no Rodízio A, corrida pendente, fila separada após o encerramento do A, última posição, bois escolhidos pela organização e nenhum desconto de pontos por ausência. O fluxo atual ainda não implementa essa fila separada nem seu momento; o prazo de chamada e o deslocamento genérico existentes não devem ser confundidos com a regra completa do rabo da gata.
6. **Corridas/bois e retornos:** definir ciclo válido de estados, ocorrências de julgamento, quem pode marcar zero/retorno, condições de autorização, número de novas apresentações e como relacionar corrida original e retorno autorizado. O motor não cria corrida automaticamente a partir de retorno.
7. **Pontuação:** regra informada: registrar exatamente a pontuação anunciada pelo juiz (por exemplo, 30, 35, 40 ou outro valor), sem calcular pontos pela distância. Corrida marcada como zero registra 0; retorno não pontua a corrida original automaticamente. O console já grava a pontuação anunciada separada da distância e mostra totais provisórios por inscrição. A decisão do juiz sobre validade continua sendo registrada por operador; isso não está validado como apuração oficial.
8. **Bonificação de cinco pontos:** regra informada: opcional e personalizável por evento. O evento pode ativar a bonificação e descrever suas condições; na corrida o operador a aplica explicitamente, registra a justificativa e o sistema soma os cinco pontos em campo separado da nota do juiz. A aplicação não é automática.
9. **Classificação:** cada senha mantém seus próprios pontos; totais provisórios são separados por categoria e inscrição. A referência indica que avanço, corte do Rodízio B, desempates, finais, campeão dos campeões e consolidação por vaqueiro/circuito dependem das regras e decisões de cada evento. O sistema não elimina inscrições nem declara posições/campeões oficiais automaticamente.
10. **Autoria e autoridade:** estabelecer papéis individuais de organização, pista, julgador e comissão, incluindo autorização para chamadas adicionais, mover ausência, autorizar retorno e corrigir resultado.

## Implementado nesta etapa

- Configuração de dias, horários, nome/ordem do rodízio, intervalo, capacidade, ordem de chamada e chamadas adicionais, sem nomes/dias fixos.
- Configuração de quantidade de corridas por inscrição/rodízio (`racesPerEntry`), com chamadas repetidas limitadas ao valor configurado.
- Serviço de fila por inscrição, elegibilidade por faixa/capacidade e pagamento confirmado, manutenção de itens adiados e rejeição de listas misturando eventos.
- Registro puro de chamada, espera configurada, ausência após o prazo e deslocamento para o fim com posição original/nova posição, operador, justificativa e proteção idempotente.
- Estados de corrida e validação de transições no domínio; corrida nova começa pendente, zero e retorno têm estados explícitos e transição para retorno exige decisão justificada.
- Registro da pontuação exata anunciada pelo juiz, zero como 0 e distância como informação sem cálculo de pontos; totais provisórios por inscrição/categoria.
- Bônus de cinco pontos configurável por evento, aplicado explicitamente somente em corrida pontuada, com condição e justificativa registradas.
- Histórico de transição de domínio com estado anterior/novo, corrida/inscrição/rodízio, operador, horário e motivo.
- Participante parceiro da dupla em inscrição, edição/transferência, persistência Supabase por migration aditiva e exportação futura ainda pendente.
- Classificação oficial bloqueada quando não há configuração de pontuação aprovada. O ranking existente continua sendo soma indicativa dos pontos oficialmente registrados, com aviso explícito.

## Limites atuais desta implementação

- O fluxo de pista persiste localmente e usa outbox quando conectado, mas as gravações de estado completo da pista pelo protocolo permanecem bloqueadas; não homologar sync remoto por causa desses testes locais.
- O rabo da gata ainda não tem fila separada executada após o Rodízio A; o fluxo genérico existente de ausência/deslocamento não implementa todos os critérios informados.
- O julgamento, a confirmação e o registro do bônus ainda dependem de identidade/permissão validada no servidor para cada ação. O nome de operador informado na interface não é prova suficiente de autorização.
- Corte de classificados, regra do “40 pontos”, critérios de desempate, final/campeão dos campeões, troca excepcional de puxador, racha de premiação e circuitos ainda não têm fluxos implementados.
- Totais do console são provisórios e por senha/categoria; não integram automaticamente o modelo legado `RunResult`, não selecionam classificados e não devem ser anunciados como oficiais.
- A configuração de agenda e do bônus continua sendo editada em JSON; não há editor visual estruturado nem aprovação normativa server-side.

## Complementos da Etapa 3

- **Unidade de distância:** não há unidade oficial encontrada no projeto; o console aceita distância não negativa e unidade textual, sem conversão. Comissão deve definir unidade, precisão e arredondamento.
- **Pontuação:** o console registra a pontuação anunciada pelo juiz e mantém distância separada, sem derivar uma da outra. Isso gera somente total provisório; classificação oficial continua bloqueada.
- **Autorização:** operador é informado por texto, sem identidade individual/RBAC. Definir quem pode deslocar ausência, julgar, autorizar retorno, reabrir rodízio, confirmar e corrigir.
- **Prazo de chamada:** padrão configurável de 60 segundos. Comissão precisa definir marco inicial, repetições, tolerâncias e exceções.
- **Resultados legados:** o console grava estado próprio; não atualiza nem converte automaticamente `RunResult` legado. Classificação existente não representa lançamentos da pista até integração deliberada e testada.
- **Reabertura:** exige justificativa no domínio, mas ainda carece de autorização por papel.

**Implementação observada na Etapa 3:** há console e estado persistido de pista com corrida pendente, chamada idempotente, prazo/ausência, deslocamento de fila, estados do rodízio, julgamento, ocorrência/distância/unidade livre, retorno com decisão e corrida criada explicitamente, confirmação e correção com justificativa. Persistência local é IndexedDB; sync disponível integra outbox Supabase e entidade versionada do coordenador. Testes executados não validam navegador/IndexedDB, sincronização Supabase ou permissões individuais. O sistema segue sem aprovação para uso oficial.

**Nota de atualização:** as afirmações anteriores neste documento sobre ausência de console/persistência de pista descrevem o estado anterior à Etapa 3 e foram substituídas pelos complementos da Etapa 3 acima. Permanecem verdadeiras as pendências de regulamento, RBAC e homologação externa.
# Complemento Etapa 4 — bloqueios para apuração e operação oficial

## Classificação legada e pista

O modelo legado `RunResult` guarda `points` e estado de confirmação; `calculateStandings` soma somente resultados `official`. A pista persiste `TrackRace` separado, que registra distância e unidade textual e estado de resultado próprio. Não existe adaptador validado entre esses modelos. Não mapear distância para pontos nem inserir resultados de pista na classificação atual sem tabela, unidade, arredondamento e regras de seleção/desempate aprovados.

Contrato a aprovar antes da integração: ID estável do resultado; evento, inscrição, etapa/rodízio e corrida; distância original e unidade; outcome operacional; estado pendente/oficial/corrigido; julgador, confirmador e respectivos instantes; versão da tabela de pontuação; pontos calculados reproduzíveis; histórico anterior/novo e motivo de correção. Resultados pendentes, retorno aguardando decisão e corrida não confirmada não podem compor classificação oficial. Deve ser definido se bônus de cinco pontos entra no mesmo contrato, por qual condição e com qual autorização.

## Autorização da equipe

Nenhuma das funções de administrador de plataforma, responsável de parque, Escritório, Locução, Julgador ou Operador de Pista tem RBAC individual completo implementado. A propriedade do evento no Supabase e o token compartilhado do coordenador não diferenciam essas funções. O rótulo digitado do operador não comprova identidade. A comissão/responsável deve aprovar a matriz de ações, incluindo quem confirma/corrige resultado, autoriza retorno, desloca ausência, reabre rodízio, encerra etapa e altera configuração. Exigir identidade individual e imposição no servidor/banco antes de operação oficial.

## Auditoria de estabilização — evidências e pendências

Nesta execução o teste isolado do coordenador passou 2/2 e `node --check coordinator/server.mjs` passou. A suíte geral executou 11 testes aprovados, mas não completou porque `tests/domain.test.mjs` não conseguiu carregar o pacote `typescript`, ausente/incompleto após tentativas de `npm ci` que não progrediram. `npm run build` falhou porque `tsc` não está disponível; não declarar TypeScript/build aprovados. `package-lock.json` confere com os manifests e foi preservado. A migration `202610220011_track_console.sql` foi revisada estaticamente e não foi aplicada nem validada em Supabase real.

Pendências de ambiente não são decisão esportiva: obter registry/cache funcional e executar instalação reproduzível; repetir suíte completa, TypeScript e build; testar IndexedDB em navegador real, inclusive encerramento abrupto/reenvio; aplicar migration em staging e validar RLS, RPC, concorrência e isolamento entre parques/eventos. Manter uso oficial bloqueado até evidências registradas.

## Atualização de apuração — 23/10/2026

O documento histórico acima descreve o comportamento anterior à proteção atual. A soma informativa foi renomeada para `calculateProvisionalPoints`; não calcula posições oficiais e não usa a senha como desempate. `officialClassificationReadiness` não é liberado por flags configuradas no cliente. O CSV é identificado como provisório e interno, pois contém dados de pagamento. Veja `docs/APURACAO_CLASSIFICACAO.md` para o diagnóstico e os passos necessários após a comissão fornecer o regulamento.

Ainda não há aprovação server-side de regulamento, motor de pontuação ou classificação publicada/versionada. Nenhum regulamento oficial ou conjunto de resultados de referência foi fornecido, então nenhuma regra esportiva foi acrescentada.
