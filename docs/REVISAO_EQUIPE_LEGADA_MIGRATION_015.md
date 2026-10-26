# Revisao das associacoes operacionais legadas - migration 015

**Status: conversao automatica rejeitada; migration 016 adiciona inventario e reconciliacao, ainda sem execucao PostgreSQL.**

## Evidencia estatica

O bloco final de `supabase/migrations/202610220015_connect_pdm_operations.sql` executa:

```sql
insert into public.event_staff_memberships(event_id,user_id,role,expires_at,created_by)
select e.id,m.user_id,m.role,e.ends_at,m.created_by
  from public.park_memberships m
  join public.events e on e.park_id=m.park_id
 where m.disabled_at is null and m.role in ('office','announcer','judge','track_operator')
   and e.operational_status='active' and e.ends_at>now()
on conflict(event_id,user_id) do nothing;
```

O criterio relaciona pessoa e parque, mas nao identifica para qual evento a pessoa foi designada. Uma associacao ativa pode se transformar em varias associacoes de evento. Em seguida, a migration desativa a membership do parque e revoga convites operacionais ainda nao aceitos. Isso pode conceder acesso a eventos sem designacao verificada e remover acessos antigos sem um mapeamento seguro.

## Decisao segura ate revisao

- Nao aplicar essa conversao a uma base com memberships operacionais legadas.
- Nao inferir um vinculo pessoa-evento porque ambos compartilham o parque.
- Nao apagar memberships, convites ou registros de auditoria.
- Preservar o banco original e gerar inventario somente leitura de usuario, parque, papel, estado, convites e eventos elegiveis. Nao incluir tokens nem dados pessoais desnecessarios.
- Um responsavel autorizado pelo parque/evento deve confirmar explicitamente a associacao por evento. Casos nao confirmados ficam em revisao e nao recebem novo acesso operacional automaticamente.

## Mecanismo aditivo de reconciliacao (016)

`supabase/migrations/202610220016_legacy_staff_reconciliation.sql` cria inventario append-only, lote com hash do snapshot, itens por origem/evento candidato e RPCs para preparar, consultar, revisar e ativar um vinculo. A preparacao nao escreve em `park_memberships`, `park_invitations` ou `event_staff_memberships`; nao revoga convites nem desativa acessos. Cada pessoa/evento e classificada como `proven`, `ambiguous` ou `no_destination`. Associacao de parque isolada nunca constitui prova.

Uma classificacao comprovada exige referencia especifica do evento. Evidencia interna so e aceita quando existe membership do evento ainda ativa e nao expirada, e a evidencia e uma aceitacao de convite valida ou a ultima auditoria de concessao/alteracao sem evento posterior. Referencias de roster externo exigem validacao humana fora do banco. Ativacao requer aprovador e ativador distintos, revalida a membership-fonte, exige evento/parque ativos, rejeita membership de destino conflitante e cria acesso somente ao evento revisado. Repeticao da mesma preparacao/ativacao e idempotente; auditoria e append-only.

O inventario inclui autor, criacao, papel, estado e disabled_at da origem; evento candidato, estado e fim; evidencia, classificacao, decisao, revisor e datas. Convites legados pendentes sao inventariados, mas nao podem gerar membership por esta rota, pois nao identificam pessoa autenticada. Dados de origem permanecem preservados.

## Ambientes anteriores e posteriores a 015

- **015 pendente:** 016 depende de objetos criados por 015 e nao impede que 015 rode antes dela. Logo, este fluxo nao torna seguro aplicar 015 numa base que ainda tenha memberships operacionais: interromper o deploy antes da 015, executar o diagnostico read-only `supabase/diagnostics/legacy_staff_migration_015_preflight.sql` e exigir decisao/revisao do roster. Nao aplicar 015 por automacao enquanto o preflight encontrar origens. Como a 015 historica pode ja ter sido distribuida, nao foi editada.
- **015 ja aplicada:** nao tentar inferir quais memberships de evento vieram da conversao historica; preservar tudo e inventariar as origens ainda disponiveis. A reconciliacao nao revoga grants preexistentes. Como 015 desativou memberships amplas e revogou convites pendentes, 016 nao restaura esses estados automaticamente; cada novo grant exige aprovacao por evento.
- **Estado remoto:** desconhecido. Nenhuma consulta ou escrita remota foi feita nesta rodada.

## Evidencias e testes

O pgTAP `supabase/tests/legacy_staff_reconciliation.test.sql` cobre dois eventos no mesmo parque, outro parque, fonte sem evento, convite pendente, membership repetida via idempotencia, prova por auditoria de evento, classificacao ambigua, revisao humana, aprovacao em duas pessoas, conflito de papel, isolamento e grant direto negado. Tambem verifica que grant historico seguido por revogacao volta a ser classificado como ambiguo. O arquivo declara 29 assercoes; **0 executadas** ate existir PostgreSQL/Supabase local. A suite Node verifica estaticamente que a preparacao nao altera memberships/convites e que a migration exige evidencias/revisao; isso nao valida SQL, RLS ou grants efetivos.

## Decisoes humanas e limitacoes

- O responsavel deve indicar roster/documentos oficiais que provem cada designacao, quem pode revisar e quem pode ativar (duas pessoas distintas), e como tratar ex-colaboradores sem destino comprovado.
- `review_document:<referencia>` e somente um ponteiro; o sistema nao prova o conteudo do documento. A equipe deve armazenar e auditar a evidência fora do payload SQL.
- O diagnostico preflight e um bloqueio operacional documental, nao um hook automatico do `supabase db push`. Responsavel pelo deploy deve interromper a cadeia antes da 015 se houver registros legados, ate a migration historica ser substituida por procedimento autorizado e testado numa copia.
- Nao ha conversao validada, RLS efetiva validada, nem recomendacao de uso oficial. Escrita remota da pista continua bloqueada.

A migration 016 ainda nao tem interface de revisao. Depois de aprovada em PostgreSQL, criar uma tela Connect PDM que use apenas as RPCs com escopo/permissao documentados; nao permitir DML direto nem automatizar referencias `review_document` sem revisao humana.

## Correcoes observadas nesta rodada

PostgreSQL 18 local descartavel validou a cadeia 001–016 com scaffold minimo de `auth`; nao equivale ao Supabase stack. A migration 016 teve casts explicitos adicionados para os NULLs dos UNIONs. Seus 29 cenarios foram executados contra PostgreSQL usando adaptador local, 29/29 aprovados; a extensao pgTAP nao existe nesta instalacao, portanto nao relatar como pgTAP oficial.

O preflight 015 pre-schema mostrou BLOCK diante de uma membership operacional e um convite pendente; a guarda no inicio da migration 015 abortou em transacao antes de mudar o schema/dados. Nota de manutencao: 012 recebeu fechamento de parenteses (correcao apenas sintatica); 015 recebeu guarda fail-closed e drops idempotentes de policies duplicadas. Sao alteracoes explicitas em arquivos historicos, sem rollout remoto; equipes devem conferir o historico de migrations antes de distribuir.

A UI de reconciliacao foi adicionada ao Connect Admin e usa somente as RPCs 016. Ainda nao foi testada em navegador ou contra auth remoto. Os casos ambiguos continuam dependentes de evidencias humanas, e ativacao requer segundo operador.

### Resultado consolidado da rodada

- PostgreSQL 18 descartavel, Auth scaffold: migrations 001–016 PASSARAM (cada arquivo em sua propria transacao). Testes SQL executados em copias temporarias: 25/25 operacoes e 29/29 reconciliacao PASSARAM com adaptador local; a extensao pgTAP nao estava instalada, entao `supabase test db --local` real segue BLOQUEADO por falta do daemon Docker/porta 54322.
- O cenario pre-015 com membership operacional e convite aberto retornou `BLOCK` no preflight; migration 015 abortou antes de alterar schema/dados. Nao e validacao do Supabase Auth/PostgREST real.
- Aplicacao: build e 50 testes Node aprovados; TypeScript aprovado. Teste browser FALHOU por falha GPU/CDP do Edge antes de carregar o app.
- Migration 012 teve apenas fechamento de parenteses para permitir parsing da guarda existente. Migration 015 recebeu bloqueio pre-schema e `DROP POLICY IF EXISTS` para a cadeia 001–016 executar em banco vazio sem duplicar policies. Estas edicoes historicas estao registradas; conferir o estado de cada ambiente antes de rollout e nunca reaplicar uma migration ja registrada.
- Nenhuma migration remota, RPC segura da pista ou sincronizacao remota de escrita foi ativada.
