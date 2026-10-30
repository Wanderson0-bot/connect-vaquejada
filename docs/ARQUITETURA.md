# Connect PDM — decisões e estado técnico

> **Estado da migração (2026-10-28):** o runtime atual no código usa Neon Managed Better Auth e Neon Data API. A migração ainda não foi aplicada a um projeto real e nenhum dado foi copiado. As seções históricas abaixo descrevem a arquitetura Supabase anterior; não as use como configuração ou validação do runtime atual. Consulte [Migração para Neon](./MIGRACAO_NEON.md) para instruções e pendências atuais.

## Diagnóstico

O projeto inicial é Vite, React e TypeScript com IndexedDB no navegador. Já tinha cadastro local de evento, categorias, inscrições numeradas, comprovantes e registro básico de pontuação/classificação. Não havia autenticação, servidor, sincronização ou testes. O modo IndexedDB continua útil para um aparelho, mas não isola parques nem compartilha dados entre aparelhos.

## Arquitetura adotada

- Interface: React, TypeScript e Vite.
- Conta: Supabase Auth (email/senha) via SDK oficial. A conta autenticada representa o parque; não há usuário separado de organizador.
- Persistência central: PostgreSQL do Supabase com RLS. `auth.uid()` determina o parque; o RPC de criação de evento obtém o `park_id` no servidor.
- Persistência local existente: IndexedDB quando backend não está configurado. A interface identifica esse modo como local e sem isolamento entre parques.
- PWA: build de produção pré-carrega app shell e recursos estáticos; o service worker não guarda tráfego Supabase e sua atualização não limpa IndexedDB.
- Eventos têm categorias e regulamento/configuração em JSON por evento/categoria. Inscrição e resultado referenciam o evento.

O painel Connect tem entrada separada em `/connect`: a interface administrativa só é renderizada após o contexto de plataforma ser validado pelo Supabase. Usuários sem função administrativa recebem uma negação explícita, e a interface operacional não oferece alternância direta para o painel Connect. Os convites de parque/evento direcionam à entrada operacional em `/`. A raiz pública e a separação completa de sessões ainda não estão implementadas.

O cadastro Connect lista parques por nome, cidade, UF e situação com paginação. O identificador humano é a combinação do nome com cidade/UF, enquanto o UUID permanece interno para relações e autorização. Provisionamento e recuperação são confirmados na interface e idempotentes por essa combinação; registros ambíguos exigem seleção explícita e não sobrescrevem dados. A migration `202610240020_park_name_identity.sql` remove o código comercial antigo, atualiza as RPCs de dashboard/lista/perfil e adiciona proteção de unicidade e auditoria. Ela interrompe a aplicação se já houver mais de um parque com a mesma combinação normalizada de nome/cidade/UF, para evitar mesclar ou apagar cadastros automaticamente.

Os atalhos para Escritório, Locução e Área operacional são parâmetros de navegação (`area`/`event`) na entrada operacional. São apenas conveniência de UI: não criam sessão nem permissão; cada identidade deve ter vínculo ativo e o banco continua validando as operações.

No modo local, `coordinator/server.mjs` é o coordenador Node.js/SQLite por parque. A outbox IndexedDB envia alterações ao serviço, que distribui snapshots aos aparelhos; consulte `docs/COORDENADOR_LOCAL.md`. A sincronização Supabase e autenticação individual/função ainda faltam.

## Implementado no repositório

- SDK Supabase com sessão persistente, renovação automática, login, criação de conta, confirmação de email, encerramento e recuperação de senha.
- Cadastro e edição de perfil do parque associado no servidor à conta autenticada; constraint única limita a uma conta proprietária por parque e vice-versa.
- Migração SQL para parques, eventos, inscrições e resultados; RLS deriva a propriedade pela sessão e bloqueia linhas de outros parques.
- Log SQL de alterações operacionais, disponível para leitura do parque e sem permissão de escrita para clientes autenticados.
- RPCs para criar parque/evento sem confiar em `park_id` de entrada.
- Operações conectadas de leitura e gravação de eventos, inscrições e resultados, com cache remoto offline e outbox local para criação, pagamento e confirmação; sincronização idempotente ao reconectar.
- Status manual de pagamento (pendente, pago, isento), valor/formato, registro por conta autenticada, atualização posterior e preservação do status `paid` legado.
- CSV administrativo por evento com categoria, pagamentos e pontos registrados; classificado como provisório, sem posições oficiais, e identificado como restrito por conter dados de inscrição/pagamento. Não é publicação pública.
- Escritório com pesquisa por número/vaqueiro/cavalo/representação, filtros combináveis de categoria/pagamento/situação, indicadores do resultado filtrado e impressão sequencial de comprovantes por diálogo padrão do navegador.
- Registro de resultado insert-only e confirmação condicional de pendente para oficial; migração SQL bloqueia alteração/exclusão direta de resultados oficiais e alteração dos dados esportivos de resultados pendentes.
- Correção autorizada de resultado oficial cria substituto e registro append-only com motivo; resultado anterior fica superseded, não pontua e não pode ser editado/excluído. Eventos com confirmação mantêm substituto pendente.
- Auditoria remota consulta no máximo 250 entradas recentes sob RLS. O modo local registra inclusões e atualizações de inscrições, eventos, pagamentos, resultados e restaurações numa store IndexedDB dedicada, sem identidade autenticada.
- Backup JSON manual preserva dados operacionais e histórico de auditoria local; restauração valida as referências e mescla numa transação IndexedDB. A restauração é bloqueada no modo Supabase; não há backup remoto agendado.
- O SQLite do coordenador possui backup/verify/restore independente via `coordinator/backup.mjs`, manifesto com SHA-256/integridade/contagens/migrações e schema versionado (`user_version=2`). Este fluxo não inclui IndexedDB nem Supabase; veja `docs/INVENTARIO_DADOS.md`.
- Datas inicial/final e estado futuro/em andamento/encerrado na lista de eventos.
- Edição de dados de evento disponível, com auditoria remota ou local e validações para preservar categorias inscritas e capacidade já emitida. O modo Supabase exige rede; a migração `202610210006_event_capacity_updates.sql` serializa a redução de capacidade contra a emissão concorrente de senhas.
- Cancelamento de inscrição com motivo, autoria e horário; conserva número e registro, bloqueia cancelamentos após resultados, bloqueia novos resultados e mantém cancelamentos fora da classificação. A operação pode ser enfileirada offline e sincronizada idempotentemente após aplicar `202610210007_entry_cancellation.sql`.
- Transferência de inscrição ativa, com motivo, data e autoria; conserva o número/evento, exige categoria habilitada, recusa inscrição com resultado e registra cada before/after na auditoria. A outbox compara os dados anteriores para detectar alterações concorrentes; aplicar também `202610210008_entry_transfers.sql`.
- Reserva de número de senha separada da inscrição, com expiração em até 30 dias, liberação justificada e conversão atômica preservando o número. Reservas ativas ocupam capacidade e impedem atribuição duplicada; registros convertidos/liberados/expirados permanecem para histórico e backup. Aplicar `202610210009_ticket_reservations.sql`. No Supabase, as operações exigem conexão; no IndexedDB local, são transacionais no aparelho.
- Categorias por evento, configuração livre por categoria e validação SQL da categoria da inscrição.
- Limite de senhas conferido em transação IndexedDB local; migração adicional usa contador transacional privado no Postgres para serializar cadastros concorrentes. A mudança de evento de uma inscrição fica bloqueada no backend.
- Testes unitários de isolamento da classificação por evento, categorias e estado temporal.
- UTF-8: testes de ida e volta preservam nomes acentuados em backup JSON e CSV; a cadeia via IndexedDB e Supabase real ainda n?o foi integrada.

## Dependências e lacunas

O modo conectado requer criar e configurar um projeto Supabase, aplicar a migração, habilitar Auth email/senha, SMTP e URLs de retorno/recuperação, e definir `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Nenhum projeto, segredo ou banco foi fornecido; a migração e o isolamento entre duas contas ainda não foram executados contra um banco real. A chave `service_role` nunca deve ir para o frontend.

Ainda faltam: sincronização do coordenador ao Supabase e validação LAN com vários aparelhos, importação de dados IndexedDB local para o parque remoto, arquivamento de eventos, equipe e RBAC, dispositivos autorizados, testes de integração de cache/outbox/correção/auditoria/cancelamento/transferência/reservas e restauração IndexedDB, fluxo offline de edição de eventos/correção/perfil, reembolsos, regras PDM validadas, relatórios mais completos, portal público, backup remoto/agendado, monitoramento e implantação. A revogação offline não é imediata; cache e perfil expiram em até sete dias.

Nenhuma regra esportiva foi inventada. Regras incompletas continuam sendo configuração informativa; a tela só apresenta soma provisória de pontos registrados e a classificação oficial fica bloqueada porque falta aprovação de regulamento autenticada no servidor. Consulte `docs/APURACAO_CLASSIFICACAO.md`.

## Validação executada

- Validação desta atualização: `npm test` passou com 54/54 testes, incluindo snapshot/verify/restore SQLite em base fictícia temporária e proteções de classificação provisória; IndexedDB real, Supabase e aparelhos LAN não foram exercitados.
- `tsc --noEmit`: passou.
- `npm run build`: passou; aviso informativo de chunk JavaScript acima de 500 kB.
- O build gerou o service worker; `node --check` passou e a inspeção confirmou que arquivos estáticos são pré-carregados e as rotas Supabase são excluídas. Não houve teste de instalação/uso offline em navegador ou hardware real.
- Parser do backup validado com testes unitários; importação transacional IndexedDB não foi executada por falta de ambiente browser/IndexedDB de teste.
- RLS e SQL não foram aplicados/testados: falta projeto Supabase e banco acessível.
- A verificação de capacidade SQL e a gravação IndexedDB concorrente foram implementadas, mas não exercitadas em Postgres/browser real neste ambiente.
- Login real, email, cache/outbox IndexedDB em navegador, reconexão, conflito multi-aparelho, LAN, impressão, restauração transacional e hardware não foram testados. A lógica pura de ordenação/sobreposição tem teste unitário; isso não valida transações IndexedDB nem respostas Supabase.



## Coordenador local

No modo local, `coordinator/server.mjs` é o coordenador Node.js/SQLite por parque. A outbox IndexedDB envia alterações ao serviço, que distribui snapshots aos aparelhos; consulte `docs/COORDENADOR_LOCAL.md`. A sincronização Supabase e autenticação individual/função ainda faltam.

O banco SQLite do coordenador tem backup isolado com `npm run coordinator:backup`; não confundir com o backup JSON da interface. A matriz de fontes de verdade, escopos e lacunas de recuperação está em `docs/INVENTARIO_DADOS.md`.
