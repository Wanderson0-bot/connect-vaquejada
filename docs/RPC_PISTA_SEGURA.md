# Contrato proposto para a RPC segura da pista

**Estado:** projeto técnico, ainda não implementado nem validado em PostgreSQL. A escrita remota segue bloqueada no cliente; migration 013 não foi aplicada.

## Princípios de autoridade

Proposta de assinatura: `apply_event_track_action(p_event_id uuid, p_operation_id uuid, p_base_version bigint, p_action text, p_action_data jsonb)`. O actor é exclusivamente `auth.uid()`. Papel e parque são derivados no banco pelas funções `require_event_permission` / `has_event_permission` e relação evento-parque; nunca aceitar actor, role, parkId, eventId interno, snapshot, versão resultante, history, status de chamada/corrida, resultado oficial ou pontos a partir de `p_action_data`.

A RPC carrega o evento e o `event_track_states` persistidos sob lock por evento/linha, valida `p_base_version`, deriva a próxima estrutura a partir do estado salvo e da configuração persistida do evento, e grava estado, operation record e auditoria numa única transação. Na inicialização, o servidor cria a estrutura a partir da configuração canônica do evento; não aceita um estado inicial completo do navegador. Se não conseguir derivar a programação/configuração, rejeita a ação.

Cada ação valida objeto JSON e lista exata de chaves: chaves extras, tipos inesperados, IDs malformados, nulls não permitidos e campos esportivos fora do contrato são rejeitados. A autoria vem de `auth.uid()`. Horários e histórico são gerados pelo servidor. IDs de chamada/corrida podem ser UUIDs fornecidos como identificadores idempotentes, nunca como autorização.

## Ações e campos permitidos

Todas incluem `p_event_id`, `p_operation_id` e `p_base_version` no envelope SQL, fora do JSON. A tabela abaixo lista as únicas chaves aceitas em `p_action_data`; campos opcionais são validados individualmente.

| Ação | Campos do JSON | Permissão mínima proposta | Regra de transição derivada no servidor |
|---|---|---|---|
| `rotation.pause` / `rotation.resume` | `rotationId`, `reason` | `track.rotation_control` | Rodízio ativo→pausado ou pausado→ativo, respectivamente. |
| `rotation.close` | `rotationId`, `reason` | `track.rotation_close` | Rodízio ativo→encerrado. Não aceitar fechamento por perfil de pista sem essa permissão. |
| `rotation.reopen` | `rotationId`, `reason` | `track.rotation_reopen` | Rodízio encerrado→ativo, com justificativa e auditoria privilegiada. |
| `call.create` | `rotationId`, `entryId`, `callId`, `raceId` | `track.queue` | Rodízio ativo; inscrição ativa do evento; elegibilidade/capacidade derivadas da configuração persistida; ids não usados. Servidor cria chamada e corrida pendente. Não toca resultado. |
| `call.present` | `callId` | `track.queue` | Somente chamada `called` sem resposta. |
| `call.absent` | `callId`, opcional `reason` | `track.queue` | Somente chamada não respondida e prazo vencido conforme relógio do servidor. |
| `call.move_tail` | `callId`, `reason` | `track.queue` | Somente chamada ausente ainda não deslocada; registrar posição anterior/nova e autor. |
| `race.start` | `raceId` | `track.queue` | Corrida pendente, rodízio ativo e comparecimento da chamada vinculada. |
| `race.judge` | `raceId`, `outcome`, opcionais `distance`, `distanceUnit`, `occurrence`, `observation` | `result.judge` | Corrida em andamento. `outcome` limitado aos valores de domínio; retorno vira solicitação, não decisão. Resultado aguarda confirmação oficial. `points` é rejeitado/não aceito. |
| `return.decide` | `raceId`, `decision`, `reason` | `result.return_decide` | Somente retorno solicitado; decisão e justificativa ficam auditadas. |
| `return.create_race` | `raceId`, `newRaceId` | `result.return_decide` | Somente após retorno autorizado; sem segunda corrida vinculada. Servidor cria nova corrida pendente e nova chamada relacionada. |
| `result.confirm` | `raceId` | `result.confirm` | Apenas julgamento pendente em estado julgável; muda somente confirmação e campos de auditoria, não dados esportivos. |
| `result.correct` | `raceId`, `outcome`, opcionais `distance`, `distanceUnit`, `occurrence`, `observation`, `reason` | `result.correct` | Apenas resultado oficial e justificativa válida; cria correção ligada ao anterior, preserva snapshot anterior e registra actor. Não aceita `points` enquanto regra/tabela não estiver aprovada. |

Identificação de perfil a partir da matriz atual: responsável pelo parque tem as permissões de parque exceto `platform.admin`; operador de pista recebe `track.queue` e `track.rotation_control`; julgador recebe `result.judge` e `result.return_decide`; Escritório e Locução não recebem escrita na pista/resultados; confirmação, correção, fechamento e reabertura exigem as permissões separadas já reservadas ao responsável. Esses grants ainda exigem validação real em staging.

A classificação oficial permanece bloqueada até aprovação e configuração da tabela de pontuação e desempates. Distância julgada é dado observacional e não é convertida em ponto nesta RPC.

## Lock, idempotência e histórico

1. Validar sessão não nula e formato do envelope.
2. Adquirir advisory lock do evento e bloquear a linha `event_track_states` (`FOR UPDATE`).
3. Procurar `p_operation_id` **depois** do lock. Se já existir, retornar duplicata somente se actor, evento, ação, versão-base e payload canônico forem idênticos; caso contrário retornar conflito/uso indevido do ID, sem mutação.
4. Validar permissão, vínculo evento/parque/inscrição/rodízio, versão e transição.
5. Construir estado seguinte e histórico a partir dos registros persistidos; validar invariantes e ausência de resultado oficial sobrescrito.
6. Gravar estado versionado e operation record com `auth.uid()` no mesmo commit.

A migration de implementação precisará adicionar uma coluna `action_data`/hash ao log (ou tabela de requisições idempotentes) para comparar replay exato; armazenar apenas o estado de saída não basta para conferir payload/autor de uma repetição. Manter `operation_id` único. Erros de versão usam SQLSTATE de serialização/conflito; a aplicação preserva e bloqueia a outbox, buscando estado canônico para revisão, nunca substitui resultado oficial.

## Privilégios e implantação

A função futura será `SECURITY DEFINER SET search_path = ''`, qualificará todos os objetos por schema e revogará EXECUTE de `PUBLIC`, `anon` e `service_role`, concedendo somente `authenticated`. Tabelas continuam sem DML de cliente e com SELECT via RLS. Não conceder propriedade de tabela/função nem privilégios administrativos ao cliente. O proprietário PostgreSQL e credenciais administrativas de Supabase permanecem confiáveis e fora do frontend; seu uso deve ficar restrito a migrações/infraestrutura.

Migration 013 é um fail-closed intermediário: ao ser aplicada, remove acesso à função antiga e escritas diretas, mas não substitui a função. Uma nova migration posterior pode criar a função de ação segura, conceder EXECUTE apenas nela e manter a função antiga sem execução. Só depois de aplicar e passar testes SQL em staging poderá ser removida a barreira de sync no cliente. Não alterar migrations 011/012 já versionadas.

## O que falta antes da implementação

- Confirmar staging descartável, ref do projeto e autorização do responsável.
- Executar localmente em PostgreSQL/Supabase compatível a cadeia completa de migrations, validar `pg_proc.proacl`, `information_schema.role_table_grants`, memberships de roles, RLS/policies, triggers e tentativas com `anon`, `authenticated` e `service_role`.
- Implementar a função e fixtures pgTAP/SQL negativas/positivas; sem ambiente PostgreSQL disponível os testes permanecem `BLOQUEADO` e não se deve reativar escrita.
- Definir com comissão campos/registros de distância e condições esportivas ainda ambíguas. Não preencher tabela de pontos nem inferir critérios.

## Etapa 14 — equipe temporária e escopo de autorização

A migration aditiva 202610220015_connect_pdm_operations.sql adiciona a associação individual por evento para office, announcer, judge e track_operator. Convites são enviados manualmente por link individual, vinculados ao email Auth confirmado, guardam apenas hash do token e expiram no máximo ao término do evento. O banco deriva auth.uid(), parque pelo evento, papel, expiry, revogação e estado do evento; roles e IDs enviados pela UI não concedem permissão.

A matriz operacional desta etapa é: Escritório lê evento/inscrições, cria/edita inscrições e registra pagamento autorizado; Locução lê evento, inscrições, pista/resultados e classificação disponível; Julgador registra julgamento e decisão de retorno, mas não confirma/corrige resultados oficiais; Operador de pista controla fila/rodízio, sem julgar; park_manager conserva direitos apenas no parque associado; perfis Connect PDM gerem implantação dentro de sua permissão, sem acesso geral a dados operacionais. Convite opcional de responsável do parque não é pré-requisito do evento.

A migração preserva as memberships históricas, copia papéis operacionais ativos para os eventos atuais/futuros já existentes cujo status é ativo e término ainda futuro, limita a associação ao horário final e audita a desativação da permissão ampla. Convites operacionais antigos ainda não aceitos são revogados. Este caminho de compatibilidade exige ensaio em base descartável e revisão do roster; não foi executado.

As telas filtram ações, mas não são a fronteira de segurança. O banco e RLS são a fronteira. Não houve execução da migration 015, teste pgTAP, build completo nem teste de navegador para estas alterações. Os 25 testes SQL existem mas permanecem NÃO EXECUTADOS por ausência de psql e daemon Docker.

Modo offline não permite saber imediatamente de uma revogação remota. O perfil temporário expira localmente; quando reconectar, o servidor deverá validar novamente a autorização. Operações locais pendentes não são confirmação do servidor. RPC de escrita segura da pista não foi implementada nesta etapa; a antiga permanece suspensa por 013/014 e a sync remota continua bloqueada. Não usar como autenticação a identificação livre do operador no IndexedDB.

Resultados desta etapa: npm.cmd test 46/46 e npx.cmd tsc -b exit 0; build e test:browser falharam pelo acesso negado ambiental ao Vite; nenhum banco local/staging/remoto foi validado.





## Etapa 16 — estado da reconciliacao legada

A migration 016 de reconciliacao de equipes e independente da RPC segura da pista. Ela nao reativa a RPC antiga, nao concede permissao de pista ampla e nao altera sincronizacao. A RPC segura de acoes especificas continua nao implementada e sem testes PostgreSQL; escrita remota da pista permanece bloqueada. PostgreSQL local nao esta disponivel, portanto nem a migration 016 nem os testes de banco foram validados.

## Estado revalidado em 22/10/2026

A cadeia local 001–016 passou em PostgreSQL 18 descartavel com Auth scaffold, mas nao se implementou uma RPC de pista segura. A funcao antiga `apply_event_track_operation` continua aceitando `p_state` integral (migration 011), e as migrations 013/014 mantem sua execucao suspensa. O cliente continua preservando a outbox e bloqueando o envio remoto. Os testes locais comprovam o grant revogado para a RPC antiga, nao a seguranca de uma RPC nova.

Bloqueio de desenho: a tabela atual `event_track_states` guarda snapshot JSON e a configuracao/eligibilidade utilizada pelo console ainda nao esta definida como fonte canonica validada no banco. Reaproveitar o JSON do cliente como estado inicial/configuracao faria o servidor depender do mesmo dado nao confiavel que o contrato proibe. Antes da implementacao e preciso definir/armazenar a configuracao canonica do evento, mapear cada transicao de dominio para entidades persistidas e escrever pgTAP negativo/positivo para campo extra, papel, evento/parque, concorrencia, idempotencia, resultados oficiais, retorno e historico. Nao enviar nem liberar escrita remota enquanto esses itens nao estiverem fechados e validados em PostgreSQL/Supabase autorizado.

## Reavaliacao do estado canonico — 22/10/2026

Esta revisao confirma que o contrato acima ainda e somente uma proposta. O caminho remoto do evento salva `rules`/`category_rules`, mas omite `EventConfig.competition`; rodizios, capacidades, intervalos e prazo sao usados pelo dominio local sem fonte remota canonica demonstrada. O estado remoto da pista permanece snapshot JSON em `event_track_states`, com `event_track_operations.state` como outro snapshot. A RPC antiga aceita o snapshot completo e rotulo enviado pelo cliente; por isso 013/014 continuam necessarias.

Nenhuma acao de escrita pode ser reativada com seguranca nesta configuracao. Mesmo transicoes operacionais (pausar/retomar, chamada/presenca, inicio de corrida) precisam de estado canonico de rodizio/chamada e autorizacao verificavel. `call.create` exige capacidade, faixa e fila configuradas pelo evento. Julgamento, retorno, confirmacao e correcao exigem modelo persistido, papeis, historico e decisao autorizada. Nenhuma dessas acoes foi implementada como RPC nesta rodada.

A proxima migration, se aprovada, deve ser aditiva e incluir representacao versionada da configuracao competitiva do evento, dados normalizados para o ciclo de pista e log idempotente comparavel por ator/evento/acao/versao-base/payload. Deve prever reconciliacao explicita de `event_track_states` e outboxes locais antigos antes de aceitar escrita. Testar com pgTAP real; nao conceder DML direto nem EXECUTE na RPC antiga como transicao.

Na execucao local de 22/10/2026, testes/TypeScript/build passaram; Edge falhou antes de carregar a pagina, Docker daemon/pgTAP nao estavam disponiveis. Nenhum teste desta RPC foi executado porque ela ainda nao existe. Nenhuma operacao remota foi realizada.
