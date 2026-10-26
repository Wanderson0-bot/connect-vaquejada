# Status da auditoria tÃ©cnica â€” Connect PDM

**Data:** 22/10/2026  
**Escopo:** auditoria documental e estÃ¡tica do repositÃ³rio; nenhuma regra esportiva ou mÃ³dulo de produto foi alterado.

## Resumo executivo

O repositÃ³rio Ã© um MVP avanÃ§ado, com aplicaÃ§Ã£o web React/TypeScript, persistÃªncia IndexedDB, modo opcional de sincronizaÃ§Ã£o LAN por Node.js/SQLite e modo conectado Supabase/PostgreSQL. HÃ¡ implementaÃ§Ã£o real de cadastro de eventos e inscriÃ§Ãµes, pagamentos manuais, reservas, cancelamento/transferÃªncia, registro e correÃ§Ã£o auditada de resultados, classificaÃ§Ã£o simples, backup manual e relatÃ³rios CSV.

**Status operacional:** nÃ£o homologado para administrar sozinho um evento oficial. A interface e as regras ainda nÃ£o foram validadas pela comissÃ£o do PDM; nÃ£o hÃ¡ papÃ©is por operador, resoluÃ§Ã£o de conflitos de sincronizaÃ§Ã£o nem evidÃªncia de integraÃ§Ã£o real Supabase, navegador offline ou rede com mÃºltiplos aparelhos. O regulamento prÃ³prio nÃ£o foi fornecido neste contexto, entÃ£o nenhuma regra de pontuaÃ§Ã£o, tentativas ou julgamento pode ser aprovada nesta auditoria.

## Arquitetura observada

- **Frontend:** Vite 6, React 18, TypeScript 5, `lucide-react`; telas concentradas em `src/App.tsx`, autenticaÃ§Ã£o/perfil em `src/Account.tsx`, regras e tipos em `src/domain.ts`.
- **Modo local:** IndexedDB `pdm-local` (versÃ£o 5), stores de eventos, inscriÃ§Ãµes, resultados, auditoria, reservas, cache remoto, outbox Supabase e outbox/versÃµes do coordenador. Backup JSON manual Ã© validado e mesclado localmente.
- **PWA:** `vite.config.ts` gera service worker que prÃ©-carrega o shell e assets. NÃ£o faz cache de chamadas API do Supabase; isso permite abrir a aplicaÃ§Ã£o, mas nÃ£o torna os dados remotos offline automaticamente.
- **Coordenador LAN opcional:** `coordinator/server.mjs` usa `node:sqlite`, SQLite WAL, token Bearer compartilhado, versÃµes otimistas, log de operaÃ§Ãµes e conflitos. `src/coordinator.ts` armazena URL/token no localStorage; `src/db.ts` mantÃ©m a fila local. TLS Ã© exigido para escuta fora do loopback, salvo exceÃ§Ã£o explÃ­cita de laboratÃ³rio.
- **Modo conectado:** `@supabase/supabase-js` fornece Auth e acesso ao Postgres; nove migrations criam dados, RLS, auditoria e RPCs de operaÃ§Ãµes crÃ­ticas. A chave anon Ã© configuraÃ§Ã£o pÃºblica; nenhuma chave service role deve ir ao frontend.
- **DependÃªncias externas para operaÃ§Ã£o conectada:** projeto Supabase, migrations aplicadas e validadas, Auth/email/SMTP e URLs de retorno configurados, URL/chave anon e conectividade. A implantaÃ§Ã£o LAN requer servidor/aparelho dedicado, armazenamento persistente, HTTPS e gestÃ£o segura do token.

## Funcionalidades observadas

| Ãrea | Estado tÃ©cnico observado | Limite operacional |
|---|---|---|
| Conta e parque | Parcial/conectado | Uma conta proprietÃ¡ria por parque; sem usuÃ¡rios individuais, equipe, papÃ©is ou autorizaÃ§Ã£o por aÃ§Ã£o. Cache offline de perfil tem prazo e nÃ£o revoga acesso imediatamente. |
| Eventos e categorias | Parcial | Cadastro/ediÃ§Ã£o e regras livres como texto/JSON; categorias sÃ£o lista fixa no cÃ³digo. Regras informativas nÃ£o implementam regulamento completo. |
| InscriÃ§Ãµes e capacidade | Implementado com ressalvas | NÃºmero, categoria, limite, busca/filtros e comprovante; limite Ã© transacional no IndexedDB e possui contador/RPC Postgres. Disputa em aparelhos sÃ³ Ã© garantida se todos usarem o mesmo backend/coordenador ativo. |
| Pagamentos | Parcial | Status/valor/mÃ©todo manuais; nÃ£o hÃ¡ integraÃ§Ã£o de cobranÃ§a, conciliaÃ§Ã£o ou reembolso. Auditoria de usuÃ¡rio local nÃ£o equivale a identidade autenticada. |
| Reservas | Implementado com ressalvas | Prazo, liberaÃ§Ã£o e conversÃ£o com validaÃ§Ã£o no backend; Supabase exige conexÃ£o e o caminho local Ã© transacional apenas no aparelho/coordenador. |
| Cancelamento e transferÃªncia | Parcial | Motivo e histÃ³rico preservados, com guardas SQL; depende da migration correspondente e de sincronizaÃ§Ã£o Ã­ntegra. PolÃ­tica de reembolso nÃ£o foi definida. |
| Resultados e classificaÃ§Ã£o | Parcial, nÃ£o homologado | Resultado pendente/oficial, confirmaÃ§Ã£o e correÃ§Ã£o append-only; classificaÃ§Ã£o soma pontos oficiais disponÃ­veis. Pontos, rodÃ­zios, ocorrÃªncias, critÃ©rios, desempates e finais dependem do regulamento oficial do PDM. |
| Auditoria | Parcial | Auditoria SQL protegida por RLS e log local; consulta remota limitada a registros recentes. Modo local nÃ£o oferece identidade forte nem proteÃ§Ã£o contra administrador do aparelho/arquivo. |
| Offline e sincronizaÃ§Ã£o | Parcial | Shell PWA, cache/outbox e coordenador local existem; fluxo Supabase reconecta operaÃ§Ãµes implementadas, porÃ©m nÃ£o foi validado em navegador real. Conflitos ficam bloqueados e nÃ£o hÃ¡ fluxo de reconciliaÃ§Ã£o de usuÃ¡rio. |
| Backup e relatÃ³rios | Parcial | ExportaÃ§Ã£o CSV e backup/restauraÃ§Ã£o manual locais com validaÃ§Ã£o. Sem backup remoto/agendado nem evidÃªncia de restauraÃ§Ã£o integral em outro dispositivo. |
| LocuÃ§Ã£o/pista/portal pÃºblico | Ausente | NÃ£o hÃ¡ fluxo operacional dedicado para chamada de senhas, julgamento colaborativo ou consulta pÃºblica. |

## Falhas e riscos priorizados

1. **Bloqueador esportivo â€” regras sem homologaÃ§Ã£o.** O registro/classificaÃ§Ã£o atual usa `points` e estados tÃ©cnicos; nÃ£o representa por si sÃ³ regulamento do PDM. NÃ£o liberar classificaÃ§Ã£o oficial atÃ© formalizaÃ§Ã£o, implementaÃ§Ã£o e conferÃªncia por julgador/comissÃ£o.
2. **Bloqueador de autorizaÃ§Ã£o â€” ausÃªncia de RBAC.** Conta proprietÃ¡ria Ãºnica ou token compartilhado nÃ£o distingue escritÃ³rio, pista, julgador e locuÃ§Ã£o. Criar usuÃ¡rios individuais, papÃ©is mÃ­nimos e trilha de autoria antes de operaÃ§Ã£o com equipe.
3. **Concorrencia ainda requer revisao manual.** O coordenador detecta versao-base obsoleta e registra conflito; a tela Rede local agora mostra tentativa e versao central ao responsavel do parque. Nao ha mesclagem automatica; apos a revisao, a equipe deve corrigir o registro e enviar uma nova operacao. O caminho Supabase ainda precisa de ensaio multiaparelho e analise de colisao de numero/capacidade.
4. **Bloqueador de homologaÃ§Ã£o â€” integraÃ§Ã£o remota nÃ£o exercitada.** Migrations, RLS, RPCs, isolamento entre parques, Auth e recuperaÃ§Ã£o nÃ£o foram aplicados/testados contra Supabase real.
5. **Risco de operaÃ§Ã£o offline.** NÃ£o foi testado IndexedDB real, encerramento abrupto, quota/evicÃ§Ã£o do navegador, migraÃ§Ã£o de schema, vÃ¡rios aparelhos desconectados nem retorno de rede. O shell cacheado nÃ£o Ã© evidÃªncia de dados sincronizados.
6. **Risco de identidade e auditoria local.** Offline permite janela de uso baseada em cache com validade; autor local Ã© rÃ³tulo e o token LAN Ã© compartilhado e guardado no localStorage sem criptografia. Furto/uso compartilhado do aparelho pode comprometer atribuiÃ§Ã£o e acesso.
7. **Risco de operaÃ§Ã£o/backup.** Backup manual nÃ£o Ã© agendado; coordenador depende de SQLite e armazenamento/backup do host. Definir cÃ³pias, retenÃ§Ã£o, restauraÃ§Ã£o e responsÃ¡veis.
8. **Risco de estados/validaÃ§Ãµes.** ValidaÃ§Ãµes no frontend ajudam a UX, mas integridade depende de constraints/RPCs/trigger no banco central. Conferir toda aÃ§Ã£o acessÃ­vel diretamente via PostgREST/RPC, limites numÃ©ricos, campos vazios, transiÃ§Ãµes e repetiÃ§Ã£o de requisiÃ§Ã£o.
9. **Risco financeiro.** Pagamento Ã© anotaÃ§Ã£o manual, sem confirmaÃ§Ã£o bancÃ¡ria, conciliaÃ§Ã£o, recibo fiscal ou reembolso. NÃ£o tratar `paid` como confirmaÃ§Ã£o externa.
10. **Risco de configuraÃ§Ã£o/segredo.** `.env.example` contÃ©m nomes de variÃ¡veis e valores ilustrativos, nÃ£o credenciais. Confirmar ausÃªncia de segredo real no histÃ³rico Git e manter service role somente em ambiente servidor protegido; esta auditoria nÃ£o reproduz valores sensÃ­veis.
11. **UTF-8 â€” risco confirmado em literais.** A inspeÃ§Ã£o encontrou textos com sinais de mojibake (`endereÃƒÂ§o`, por exemplo) no cÃ³digo e em fixtures do teste do coordenador. O teste do coordenador preserva os bytes/textos que recebe, mas contÃ©m palavras jÃ¡ corrompidas como fixture; portanto, nÃ£o comprova acentos corretos nessa parte. O teste de backup/CSV prevÃª acentos corretos, mas nÃ£o foi executado porque falta TypeScript. Revisar arquivos e fixtures, corrigir os literais comprovadamente corrompidos e sÃ³ entÃ£o executar testes de ida e volta em browser, SQLite e Supabase.

## Regras PDM: implementaÃ§Ã£o direta versus decisÃ£o necessÃ¡ria

Podem ser implementadas diretamente apÃ³s aceitaÃ§Ã£o do responsÃ¡vel: cadastro de categorias oficiais, campos obrigatÃ³rios, estados de inscriÃ§Ã£o, registro das ocorrÃªncias definidas, sequÃªncia de chamadas/rodÃ­zios, pontuaÃ§Ã£o, penalidades, desempate, classificaÃ§Ã£o e procedimento de correÃ§Ã£o â€” **desde que cada item esteja escrito no regulamento entregue**.

Dependem de decisÃ£o documentada da comissÃ£o: regulamento e versÃ£o vigente; significado de zero/retorno; quantidade e ordem de tentativas; critÃ©rios de validaÃ§Ã£o e autoridade do julgador; tratamento de empate, desistÃªncia, atraso e interrupÃ§Ã£o; elegibilidade por categoria; critÃ©rios para finais; polÃ­tica de recursos/correÃ§Ãµes; quem pode confirmar e em que prazo. AtÃ© lÃ¡, tratar texto livre cadastrado no evento como referÃªncia, nÃ£o como lÃ³gica homologada.

## Testes e verificaÃ§Ãµes executados nesta auditoria

- `npm.cmd test`: **parcial/falhou**. Os dois testes `tests/coordinator.test.mjs` passaram (persistÃªncia SQLite/reinÃ­cio, repetiÃ§Ã£o de operaÃ§Ã£o, conflito e bloqueio de HTTP LAN inseguro). O fixture de acentos do coordenador parece jÃ¡ estar corrompido e nÃ£o serve como prova de UTF-8 correto. A suÃ­te `tests/domain.test.mjs` nÃ£o iniciou: `ERR_MODULE_NOT_FOUND` para `typescript`; o pacote nÃ£o estÃ¡ instalado no workspace.
- `npm.cmd run build`: **nÃ£o executado atÃ© o fim**. O script iniciou, mas `tsc` nÃ£o foi encontrado; dependÃªncias locais ausentes. NÃ£o hÃ¡ conclusÃ£o de compilaÃ§Ã£o/build.
- InspeÃ§Ã£o estÃ¡tica do cÃ³digo, nove migrations, dois arquivos de teste, configuraÃ§Ãµes, `.env.example`, documentaÃ§Ã£o e arquivos de aplicaÃ§Ã£o. SQL/RLS, navegador, Supabase, dispositivos e hardware nÃ£o foram executados.
- O lockfile presente Ã© `package-lock.json`; `node_modules` nÃ£o estÃ¡ disponÃ­vel. O teste de domÃ­nio contÃ©m 16 casos previstos; o teste do coordenador contÃ©m 2. HÃ¡ cobertura unitÃ¡ria da lÃ³gica pura, CSV/backup (nÃ£o executada nesta auditoria) e cobertura HTTP/SQLite bÃ¡sica, mas nÃ£o de IndexedDB/browser ou Supabase real.

## Documentos relacionados

## AtualizaÃ§Ã£o â€” Etapa 2 (22/10/2026)

- Adicionado motor puro de configuraÃ§Ã£o/validaÃ§Ã£o de dias e rodÃ­zios, ordenaÃ§Ã£o/elegibilidade de fila, prazo de chamada/ausÃªncia, deslocamento idempotente para o fim e estados/transiÃ§Ãµes de corrida com histÃ³rico. O cadastro continua sem teto por vaqueiro; cada senha permanece independente.
- A tela de evento aceita configuraÃ§Ã£o JSON de agenda/rodÃ­zios e a tela de lanÃ§amento lista apenas os nomes configurados. NÃ£o hÃ¡ mais opÃ§Ãµes fixas A/B/Retorno no lanÃ§amento/correÃ§Ã£o. Foi removido o teto de 100 pontos da interface; valor negativo/nÃ£o finito e boi invÃ¡lido sÃ£o rejeitados.
- InscriÃ§Ã£o passou a aceitar parceiro da dupla. A migration aditiva `202610220010_entry_partner.sql` preserva linhas antigas com valor vazio, atualiza a guarda de transferÃªncia e oferece RPC compatÃ­vel para converter reservas com o parceiro.
- O painel de classificaÃ§Ã£o avisa que o ranking Ã© apenas parcial quando falta configuraÃ§Ã£o de pontuaÃ§Ã£o aprovada. A tabela por distÃ¢ncia ainda nÃ£o Ã© executada: resultados nÃ£o armazenam distÃ¢ncia, portanto a pontuaÃ§Ã£o oficial segue bloqueada/pendente de integraÃ§Ã£o.
- **Limite relevante:** fila, chamadas, corridas e histÃ³rico do motor ainda nÃ£o sÃ£o persistidos nem sincronizados. NÃ£o existe console de pista para presenÃ§a, ausÃªncia, pausa, retomada, retorno ou justificativas. Esses fluxos sÃ£o lÃ³gica de domÃ­nio testÃ¡vel, nÃ£o funcionalidade pronta para evento. Detalhes e decisÃµes pendentes em [PENDENCIAS_REGULAMENTO_PDM.md](PENDENCIAS_REGULAMENTO_PDM.md).
- **VerificaÃ§Ã£o nesta etapa:** `node --test tests/competition.test.mjs` passou (7 testes do motor). `node --test tests/coordinator.test.mjs` passou (2 testes). `npm.cmd test` continua falhando antes de carregar a suÃ­te de domÃ­nio por `ERR_MODULE_NOT_FOUND: typescript`, embora execute os testes de competiÃ§Ã£o/coordenador. `npm.cmd run build` falha porque `tsc` nÃ£o existe no ambiente. `npm.cmd ci --offline --ignore-scripts` nÃ£o concluiu (dependÃªncias incompletas no cache; permaneceu sem progresso e foi interrompido); a instalaÃ§Ã£o local ficou parcial. Portanto, nÃ£o hÃ¡ validaÃ§Ã£o TypeScript/build nem execuÃ§Ã£o vÃ¡lida da suÃ­te antiga de domÃ­nio.

- Plano de homologaÃ§Ã£o objetiva: [PLANO_HOMOLOGACAO_REAL.md](PLANO_HOMOLOGACAO_REAL.md)
- DocumentaÃ§Ã£o preexistente: `ARQUITETURA.md`, `PLANO_VALIDACAO_EVENTO_REAL.md`, `COORDENADOR_LOCAL.md`, `AUDITORIA_COORDENADOR.md`, `ROADMAP_IMPLEMENTACAO.md` e `README.md`.

## AtualizaÃ§Ã£o da Etapa 3 â€” console operacional da pista

O cÃ³digo agora inclui `src/TrackConsole.tsx`, conectado ao estado versionado persistido em IndexedDB. A interface permite escolher rodÃ­zio, consultar fila elegÃ­vel/prÃ³xima senha/itens adiados, chamar senha, registrar presenÃ§a/ausÃªncia, deslocar ausente com justificativa, pausar/retomar/encerrar/reabrir rodÃ­zio, iniciar/julgar corrida, registrar distÃ¢ncia e ocorrÃªncia, decidir retorno, criar corrida de retorno autorizada, confirmar e corrigir resultado oficial, e consultar corridas/histÃ³rico.

`src/db.ts` adiciona stores `track_states` e `track_outbox`, aplicaÃ§Ã£o transacional local e fila idempotente do Supabase. O coordenador LAN aceita estado de pista versionado e preserva conflitos. A migration aditiva `202610220011_track_console.sql` cria estado/operaÃ§Ãµes, RLS de leitura por proprietÃ¡rio e RPC CAS com controle de versÃ£o. Nenhuma migration foi aplicada em Supabase real.

**Estado:** console apto a ensaio local, ainda nÃ£o homologado para evento oficial. O rÃ³tulo de operador nÃ£o Ã© identidade autenticada; nÃ£o existem papÃ©is individuais. Conflitos sÃ£o preservados e indicados, sem interface de reconciliaÃ§Ã£o. A classificaÃ§Ã£o antiga nÃ£o lÃª os resultados do console. DistÃ¢ncia aceita unidade textual, mas nÃ£o calcula pontos. NÃ£o hÃ¡ teste automatizado de recarga do navegador/IndexedDB; a persistÃªncia verificada Ã© a do coordenador SQLite.

**VerificaÃ§Ãµes executadas:** `node --experimental-strip-types --test tests/competition.test.mjs tests/coordinator.test.mjs` passou 10/10 apÃ³s os ajustes (reexecutar apÃ³s a Ãºltima alteraÃ§Ã£o para confirmar). `npm test` passou 10 testes e falhou ao importar `typescript` em `tests/domain.test.mjs`. `npm run build` falhou porque `tsc` nÃ£o estÃ¡ instalado/disponÃ­vel. `npm ci --offline --ignore-scripts --no-audit --no-fund` falhou com `ENOTEMPTY` limpando `node_modules`; a tentativa direcionada de instalaÃ§Ã£o offline de TypeScript falhou com `ENOTCACHED`. `package-lock.json` permaneceu intacto. Supabase real nÃ£o foi testado.

### Registro final das verificaÃ§Ãµes da Etapa 3

Executado apÃ³s as Ãºltimas alteraÃ§Ãµes: `node --experimental-strip-types --test tests/competition.test.mjs tests/coordinator.test.mjs` â€” **10/10 testes passaram**; `node --check coordinator/server.mjs` â€” **passou**. A suÃ­te `npm test` completa â€” **falhou** porque `tests/domain.test.mjs` nÃ£o consegue importar `typescript`; os demais 10 testes passaram nessa execuÃ§Ã£o. `npm run build` â€” **falhou**, `tsc` nÃ£o encontrado. O `npm ci` nÃ£o concluiu, entÃ£o nÃ£o hÃ¡ verificaÃ§Ã£o TypeScript/build vÃ¡lida. O teste de coordenador cobre persistÃªncia SQLite apÃ³s reinÃ­cio e idempotÃªncia de `track_states`; nÃ£o substitui teste real do IndexedDB no navegador. Migration/RLS/RPC seguem sem execuÃ§Ã£o no Supabase.

**AtualizaÃ§Ã£o do resultado final:** teste direcionado `node --experimental-strip-types --test tests/competition.test.mjs tests/coordinator.test.mjs` passou 10/10 e `node --check coordinator/server.mjs` passou. Na Ãºltima execuÃ§Ã£o de `npm test`, 10 testes passaram e o arquivo `tests/domain.test.mjs` nÃ£o carregou porque o pacote `typescript` estÃ¡ incompleto/ausente. `npm run build` falhou porque `tsc` nÃ£o estÃ¡ disponÃ­vel. Uma execuÃ§Ã£o direta de TypeScript havia iniciado e acusou tambÃ©m `lucide-react` ausente. Tentativas limpas/offline e online de `npm ci` nÃ£o concluÃ­ram; nÃ£o foi possÃ­vel restaurar dependÃªncias usando o cache/rede disponÃ­vel. Lockfile mantido sem alteraÃ§Ã£o.

**Nota sobre histÃ³rico:** trechos anteriores da auditoria referem-se ao estado anterior Ã  Etapa 3; esta atualizaÃ§Ã£o prevalece para a disponibilidade do console e das stores/migration de pista. Status de homologaÃ§Ã£o e dependÃªncias ainda bloqueantes seguem conforme descrito acima.
# Etapa 4 â€” estabilizaÃ§Ã£o tÃ©cnica (22/10/2026)

## DependÃªncias e comandos verificados

O projeto usa npm, com `package-lock.json` lockfileVersion 3. As dependÃªncias e devDependencies da raiz do lock coincidem com `package.json`; nÃ£o hÃ¡ versÃ£o de Node fixada por `engines`/`.nvmrc`. Ambiente: Node `v24.21.0`, npm `11.19.0`. O TypeScript segue estrito; o build real Ã© `tsc -b && vite build`.

Comandos executados: `npm.cmd ci`; `npm.cmd ci --fetch-retries=0 --fetch-timeout=15000 --loglevel=error`; `npm.cmd test`; `node --test tests/coordinator.test.mjs`; `node --check coordinator/server.mjs`; `npx.cmd tsc -b`; `npm.cmd run build`; comparaÃ§Ã£o das dependÃªncias em `package.json`/lock. As trÃªs tentativas de `npm ci` ficaram sem progresso/saÃ­da e foram interrompidas, inclusive a tentativa com rede elevada. O lockfile foi preservado. `typescript` estÃ¡ ausente/incompleto (`Cannot find package ... node_modules/typescript/index.js`; tambÃ©m foi observado `Cannot find module '../lib/tsc.js'`) e `tsc` nÃ£o estÃ¡ disponÃ­vel; `lucide-react` tambÃ©m nÃ£o estÃ¡ instalado. O teste completo iniciou 11 testes aprovados e falhou ao carregar `tests/domain.test.mjs` por falta de `typescript`. O teste isolado do coordenador passou 2/2; `node --check coordinator/server.mjs` passou. `npm run build` falhou porque `tsc` nÃ£o Ã© reconhecido. `npx tsc -b` foi interrompido sem saÃ­da. NÃ£o hÃ¡ evidÃªncia de typecheck/build de produÃ§Ã£o aprovados.

## Integridade, classificaÃ§Ã£o e banco

O domÃ­nio bloqueia classificaÃ§Ã£o oficial sem tabela de pontos aprovada e regra de desempate aprovada. Resultados confirmados/corrigidos de pista recebem identidade estÃ¡vel baseada no UUID da corrida; correÃ§Ãµes mantÃªm valor anterior no histÃ³rico e exigem justificativa; nÃ£o se permite criar mais de uma corrida de retorno para a mesma original. A persistÃªncia local recusa encerrar rodÃ­zio com operaÃ§Ã£o correspondente pendente/bloqueada nas outboxes. O teste de confirmaÃ§Ã£o/correÃ§Ã£o estÃ¡ em `tests/competition.test.mjs`. Resultados de pista seguem separados de `RunResult` legado: nÃ£o hÃ¡ conversÃ£o de distÃ¢ncia em pontos nem inclusÃ£o automÃ¡tica na classificaÃ§Ã£o.

A migration `202610220011_track_console.sql` usa RLS de leitura por propriedade do evento, revoga DML direto e limita escrita Ã  RPC autenticada. A RPC confere vÃ­nculo evento/inscriÃ§Ã£o/senha, idempotÃªncia, versÃ£o otimista, adiÃ§Ã£o de histÃ³rico e preservaÃ§Ã£o de resultado oficial sem correÃ§Ã£o auditada. A revisÃ£o foi estÃ¡tica: migration, sintaxe PostgreSQL, grants/RLS, concorrÃªncia e isolamento nÃ£o foram executados em Supabase de homologaÃ§Ã£o.

## Matriz de autorizaÃ§Ã£o observada

| Perfil pretendido | Mecanismo existente | Lacuna |
|---|---|---|
| Administrador da plataforma | Nenhum papel de plataforma observado | Sem administraÃ§Ã£o multi-tenant separada |
| ResponsÃ¡vel pelo parque | ProprietÃ¡rio autenticado do evento no Supabase; token compartilhado no coordenador | Sem autorizaÃ§Ã£o granular por aÃ§Ã£o |
| EscritÃ³rio | Sem perfil individual | Sem polÃ­tica por funÃ§Ã£o |
| LocuÃ§Ã£o | Sem perfil individual | Sem polÃ­tica por funÃ§Ã£o |
| Julgador | Sem perfil individual; rÃ³tulo textual de operador | RÃ³tulo nÃ£o comprova identidade nem direito de confirmar/corrigir |
| Operador de Pista | Sem perfil individual; coordenador usa bearer compartilhado | AÃ§Ãµes nÃ£o sÃ£o autorizadas por papel no servidor |

Ã‰ uma descriÃ§Ã£o, nÃ£o uma concessÃ£o de permissÃµes. Esconder botÃµes nÃ£o protege operaÃ§Ãµes. Supabase autoriza o proprietÃ¡rio do evento, nÃ£o papÃ©is de equipe; o coordenador autentica token compartilhado, sem identidade individual. NÃ£o inserir service-role no cliente.

## Contrato futuro para classificaÃ§Ã£o

NÃ£o converter `distance` em `points` por aproximaÃ§Ã£o. O contrato precisa conter `resultId` estÃ¡vel, evento, inscriÃ§Ã£o, etapa/rodÃ­zio e corrida, distÃ¢ncia e unidade originais, desfecho operacional separado do estado de confirmaÃ§Ã£o, autor e instante de julgamento/confirmaÃ§Ã£o, versÃ£o da tabela aprovada e pontos derivados exclusivamente dessa versÃ£o. CorreÃ§Ãµes devem preservar snapshots anterior/posterior e justificativa. SÃ³ resultados confirmados sÃ£o elegÃ­veis; desempates, descartes, finais e bois extras dependem de regra aprovada. AtÃ© integraÃ§Ã£o deliberada e testes comparativos com a apuraÃ§Ã£o oficial, manter classificaÃ§Ã£o oficial bloqueada.

## Resultado e bloqueios

Executado/testado localmente: coordenador 2/2 e teste sintÃ¡tico do servidor aprovados. `npm test` nÃ£o completou; 11 casos que chegaram a executar passaram antes do erro de importaÃ§Ã£o de TypeScript. NÃ£o compilado: typecheck/build bloqueados por instalaÃ§Ã£o incompleta. Pendente de navegador: IndexedDB real, reload, interrupÃ§Ã£o abrupta, quota e reenvio offline. Pendente de ambiente: Supabase/Postgres, migration/RLS/RPC, isolamento entre parques/eventos e concorrÃªncia remota. Uso oficial segue bloqueado por build/suÃ­te, RBAC, validaÃ§Ã£o externa e aprovaÃ§Ã£o das regras esportivas/classificaÃ§Ã£o.
# Etapa 5 â€” recuperaÃ§Ã£o do ambiente e homologaÃ§Ã£o tÃ©cnica

## DiagnÃ³stico reproduzÃ­vel da instalaÃ§Ã£o

Ambiente: Windows 10.0.26200, raiz `C:\Users\abreu\Desktop\Connect PDM`, Node `v24.21.0`, npm `11.19.0`. Registry configurado: `https://registry.npmjs.org/`; cache padrÃ£o: `%LOCALAPPDATA%\npm-cache`. VariÃ¡veis de proxy (HTTP/HTTPS/ALL/NO_PROXY, maiÃºsculas e minÃºsculas) nÃ£o estavam definidas; proxy e https-proxy npm sÃ£o `null`; `strict-ssl=true`, sem CA/certfile/cafile customizados. O teste do store de certificados do Windows encontrou certificados raiz disponÃ­veis. HÃ¡ aproximadamente 125 GB livres no volume C:; escrita no projeto foi permitida.

`npm ping --verbose` falhou nas tentativas HTTP com `EACCES` em `https://registry.npmjs.org/-/ping`. O npm tambÃ©m nÃ£o conseguiu criar log no cache padrÃ£o (`EPERM` no caminho de logs); teste de escrita no cache padrÃ£o foi negado. A saÃ­da nÃ£o mostrou erro DNS ou TLS e proxy nÃ£o estÃ¡ configurado. A causa comprovada para o processo original Ã© a restriÃ§Ã£o de rede do sandbox (`EACCES`); a indisponibilidade de escrita no cache padrÃ£o era um segundo impedimento. A comparaÃ§Ã£o em ambiente com permissÃ£o de rede confirma que o registry responde: GET dos tarballs retornou HTTP 200 e POST do audit retornou 200. Isso descarta incompatibilidade do lock/dependÃªncias e problema de DNS/TLS como causa observada.

ExecuÃ§Ã£o de recuperaÃ§Ã£o: `npm.cmd ci --verbose --cache ./.npm-cache --fetch-retries=1 --fetch-timeout=60000`, com acesso de rede autorizado e cache temporÃ¡rio gravÃ¡vel no projeto â€” **exit 0**, 81 pacotes adicionados, 82 auditados, zero vulnerabilidades reportadas; lockfile nÃ£o regenerado/alterado. npm avisou que o postinstall de esbuild requer revisÃ£o de `allowScripts`, embora o script tenha executado com code 0 e o build subsequente tenha usado Vite/esbuild. O cache temporÃ¡rio local foi removido apÃ³s a instalaÃ§Ã£o. A pasta padrÃ£o `%LOCALAPPDATA%\npm-cache` continua sem permissÃ£o; para instalar neste ambiente, usar cache em diretÃ³rio gravÃ¡vel e permitir acesso de rede ao registry.

## Testes e compilaÃ§Ã£o

- `npm.cmd test`: **34/34 passaram**, exit 0.
- `node --test tests/coordinator.test.mjs`: **2/2 passaram**, exit 0.
- `npx.cmd tsc -b`: exit 0, sem erros de tipo.
- Primeira execuÃ§Ã£o sandbox de `npm.cmd run build`: TypeScript chegou ao fim; Vite falhou ao ler `../..`/`vite.config.ts` com `Acesso negado`.
- `npm.cmd run build` com permissÃ£o de leitura autorizada: **exit 0**; Vite transformou 1.628 mÃ³dulos e concluiu em 16,34 s. Aviso nÃ£o bloqueante: chunk JavaScript principal 536,48 kB apÃ³s minificaÃ§Ã£o (acima do limite informativo de 500 kB).
- `node --check coordinator/server.mjs`: passou na execuÃ§Ã£o da Etapa 4; o coordenador tambÃ©m passou 2/2 testes nesta etapa.
- `npm run test:coordinator` nÃ£o Ã© script definido e retornou â€œMissing scriptâ€; o teste correto foi executado diretamente via `node --test tests/coordinator.test.mjs`.

## Navegador/IndexedDB

O executÃ¡vel Edge estÃ¡ presente e o Vite foi iniciado em `http://127.0.0.1:5173/` com permissÃ£o de execuÃ§Ã£o fora da restriÃ§Ã£o que impedia ler a configuraÃ§Ã£o. Tentou-se executar Edge headless/CDP; uma instÃ¢ncia encerrou por falha de GPU, e outra abriu DevTools mas nÃ£o manteve uma pÃ¡gina do app utilizÃ¡vel para automaÃ§Ã£o. O fluxo solicitado de criar evento/rodÃ­zio, chamada, presenÃ§a, corrida, resultado, reload, offline, outbox e reenvio **nÃ£o foi executado**. Nenhuma evidÃªncia foi criada de IndexedDB funcionar em navegador real; testes unitÃ¡rios nÃ£o substituem essa homologaÃ§Ã£o.

## Supabase staging e RBAC

NÃ£o hÃ¡ CLI `supabase`, `supabase/config.toml`, variÃ¡veis Supabase no processo ou arquivo `.env` local; existe somente `.env.example`, contendo nomes de configuraÃ§Ã£o, sem credenciais de staging. Docker estÃ¡ disponÃ­vel, mas nÃ£o basta para declarar ambiente Supabase autorizado/configurado. Nenhuma migration foi aplicada e nenhum teste de RLS, isolamento cruzado, concorrÃªncia, replay ou conflito remoto foi executado.

RBAC individual segue ausente. O alcance efetivo e suas limitaÃ§Ãµes sÃ£o:

| Perfil | Permitido pelo mecanismo atual | Proibido pelo mecanismo atual |
|---|---|---|
| Administrador da plataforma | Nenhuma operaÃ§Ã£o como perfil de plataforma: perfil nÃ£o existe no modelo observado | NÃ£o hÃ¡ regra de negaÃ§Ã£o especÃ­fica para esse papel inexistente |
| ResponsÃ¡vel pelo parque | ProprietÃ¡rio autenticado pode operar dados/eventos prÃ³prios no Supabase; credencial compartilhada do coordenador pode executar aÃ§Ãµes suportadas no parque vinculado | RLS limita eventos de outro proprietÃ¡rio no Supabase; coordenador Ã© vinculado a um parque. NÃ£o hÃ¡ restriÃ§Ã£o por aÃ§Ã£o dentro do parque |
| EscritÃ³rio | Sem permissÃ£o prÃ³pria. Se usar sessÃ£o do proprietÃ¡rio/token do coordenador, herda o alcance amplo dessa credencial | NÃ£o existe negaÃ§Ã£o individual de julgamento, chamada, correÃ§Ã£o ou configuraÃ§Ã£o para esse perfil |
| LocuÃ§Ã£o | Sem permissÃ£o prÃ³pria. Credencial compartilhada permite o mesmo alcance tÃ©cnico de quem a compartilhou | NÃ£o existe bloqueio de escrita por funÃ§Ã£o; nÃ£o hÃ¡ papel somente leitura para locuÃ§Ã£o |
| Julgador | Sem permissÃ£o prÃ³pria. Com sessÃ£o do proprietÃ¡rio/token compartilhado pode alcanÃ§ar aÃ§Ãµes gerais suportadas | NÃ£o hÃ¡ enforcement que o impeÃ§a de alterar configuraÃ§Ã£o, chamadas ou outros dados fora da funÃ§Ã£o pretendida |
| Operador de Pista | Sem permissÃ£o prÃ³pria. Token compartilhado do coordenador autoriza operaÃ§Ãµes suportadas para o parque configurado | NÃ£o hÃ¡ enforcement que limite a chamada/presenÃ§a/operaÃ§Ã£o e negue confirmaÃ§Ã£o, correÃ§Ã£o, reabertura ou outras aÃ§Ãµes sensÃ­veis por papel |

O rÃ³tulo digitado de operador nÃ£o Ã© identidade. Esta tabela descreve permissÃµes herdadas/ausentes, nÃ£o recomenda concedÃª-las. Qualquer regra de autorizaÃ§Ã£o futura exige identidade individual, autorizaÃ§Ã£o server-side/coordenador e polÃ­tica de banco testadas. Controles de interface nÃ£o sÃ£o seguranÃ§a.

ClassificaÃ§Ã£o oficial permanece bloqueada atÃ© tabela de pontos e critÃ©rios de desempate aprovados e configurados. Resultados da pista nÃ£o sÃ£o convertidos para `RunResult` legado.

## ConclusÃ£o da Etapa 5

DependÃªncias restauradas; suÃ­te, TypeScript e build passaram. Continuam pendentes: cenÃ¡rio E2E de IndexedDB em navegador real; staging Supabase e testes de RLS/concorrÃªncia; RBAC backend/banco; integraÃ§Ã£o homologada da pista com classificaÃ§Ã£o; aprovaÃ§Ã£o esportiva. Estes bloqueios impedem uso oficial.


## Etapa 6 - identidade e autorizacao individual (2026-10-22)

### Mecanismos agora presentes no codigo

- Migration aditiva `202610220012_individual_rbac.sql`: associacao individual usuario-parque/perfil, memberships desativaveis sem apagar auditoria, convites de uso unico (token armazenado como hash, email confirmado), RPCs SECURITY DEFINER com grants limitados, verificacao de permissao por parque/evento, RLS revisada nas tabelas de parque/evento/inscricao/resultado/auditoria/pista, grants por coluna nas inscricoes e RPC de leitura que mascara dados financeiros por perfil, alem de triggers de autorizacao por acao. `platform_admins` nao e gravavel pelo cliente e deve ser provisionado por operador confiavel do banco.
- Cliente Supabase consulta `get_my_park_context`, distingue perfil (`access_role`) do proprietario e restringe cache offline a identidade autenticada por no maximo uma hora. Convite e aceito pelo servidor somente apos autenticacao e confirmacao do email.
- Gestao de equipe permite convidar por email para papel do parque e desativar membership. A tela nao e barreira de seguranca: RPC, RLS e triggers verificam no servidor.
- Coordenador local exige credenciais distintas por operador (`CONNECT_PDM_OPERATOR_CREDENTIALS`), com user UUID, papel, expiracao e revogacao. Operacoes SQLite guardam `actor_user_id`; autorizacao e por acao e leituras filtram entidades/campos. Token nao e mais credencial comum de parque.
- Outbox de pista grava a identidade Supabase original. Reenvio por outra conta ou sem identidade vai para `blocked` sem apagar a operacao; escrita remota revalida membership/permissao no momento da sincronizacao. Itens antigos da outbox de pista sem `actorUserId` tambem ficam em quarentena para revisao, pois nao ha como atribuir autoria retroativamente.

### Matriz efetiva definida

| Perfil | Permitido | Negado / reservado |
|---|---|---|
| Administrador da plataforma | Permissao global `platform.admin` somente em pontos explicitamente protegidos; provisionamento manual confiavel | Sem acesso implicito a parques, eventos, dados financeiros ou resultados; console global ainda nao implementado |
| Responsavel pelo parque | Gestao de seu parque/eventos, inscricoes, pagamentos, reservas, pista, julgamento, confirmacao/correcao, auditoria e usuarios do proprio parque | Sem acesso a outro parque nem promocao a administrador global |
| Escritorio | Leitura operacional, criacao/edicao de inscricao, pagamentos e relatorios | Cancelamento, transferencia, julgamento, resultado, pista e usuarios |
| Locucao | Leitura de evento, inscricoes sem campos financeiros, pista, resultados e classificacao nao oficial | Qualquer escrita, pagamento, correcao/confirmacao oficial, gestao de usuarios |
| Julgador | Leitura operacional, registrar julgamento e decisao de retorno permitida | Confirmacao/correcao de resultado oficial, financeiro, inscricao e usuarios |
| Operador de Pista | Leitura operacional, fila/chamada e controle normal de rodizio | Fechar/reabrir rodizio, julgamento/resultado, financeiro e usuarios |

Escritorio, cancelamento, transferencia, confirmacao, correcao, fechamento/reabertura e gestao de membros possuem permissoes distintas. Responsavel herda escopo amplo apenas no parque associado. Classificacao oficial segue bloqueada por falta de tabela aprovada de pontuacao e desempates.

### Testes e verificacoes Etapa 6

- `npm.cmd test`: 36/36 passaram (inclui regras locais de papeis e coordenador HTTP/SQLite real com ausencia de sessao, token expirado, tentativa de criar evento por Escritorio, parque divergente e conflitos negados).
- `node --test tests/coordinator.test.mjs`: 3/3 passaram.
- `npx.cmd tsc -b`: passou apos correcao dos tipos de formulario do parque.
- `npm.cmd run build`: passou fora do sandbox (fora dele, a primeira tentativa falhou ao ler `../..` com Acesso negado); Vite transformou 1628 modulos e criou `dist`. Permanece aviso de chunk JS 541.86 kB (>500 kB).
- Testes locais de matriz e coordenador nao substituem RLS PostgreSQL. Nao ha CLI/configuracao/staging Supabase autorizado: migration nao aplicada; nenhum teste real de policies, isolamento cruzado, concorrencia, expiracao de sessao, membership alterada, convite/email ou revogacao Supabase foi executado.
- Nenhum fluxo de IndexedDB foi validado em navegador nesta etapa. Cache de perfil offline e apenas permissao local provisoria; dispositivo compartilhado e adulteracao do cliente permanecem riscos. Operacao pendente pode ser rejeitada/quarentenada ao reconectar.

### Bloqueios para homologacao real

1. Aplicar migration e executar suite RLS em staging com dois parques, seis perfis, membership desativada, tentativa de auto-promocao, escrita direta e RPCs; testar concorrencia e revogacao durante sessao/outbox.
2. Aprovar/provisionar estrategia de identidade para coordenador local. Credenciais individuais ficam em localStorage e lista de papeis e estatica no processo: revogacao/alteracao exige atualizar ambiente e reiniciar. Nao existe introspeccao online do Supabase Auth nem SSO.
3. Testar convite, confirmacao de email, recuperacao e desativacao em staging com URLs/template aprovados.
4. Validar cache/outbox em navegador real, dispositivo compartilhado, logout, expiracao e conta desativada; conferir quarentena e historico.
5. Aprovar regulamento, pontuacao e desempate e concluir homologacao esportiva antes de classificacao oficial.

Estado: autorizacao remota e local implementada incrementalmente, mas **RBAC nao homologado e uso oficial continua bloqueado** enquanto staging, browser e provisioning nao tiverem evidencia.

## Etapa 8 - automacao de navegador e ambiente de homologacao (22/10/2026)

### Alteracoes e resultado local

- `package.json` recebeu `test:browser`; nenhuma dependencia foi adicionada. A automacao usa Edge instalado, `node:test`, WebSocket/CDP nativo do Node 24 e perfil temporario isolado. O servidor e configurado para loopback. Processos Edge preexistentes nao foram encerrados nem seus perfis utilizados.
- `tests/browser/track-console.test.mjs` implementa o fluxo ficticio pelo bundle de producao, com seletores acessiveis, erros de console/requisicao, reload e leitura das stores IndexedDB. A parte remota e explicitamente separada e nao alega sync Supabase.
- O ensaio browser executado anteriormente com permissao de ambiente chegou ao fluxo de chamadas, presenca, resultado zero sem pontos, reload, ausencia/adiamento, chamada posterior da mesma senha, conclusao, pausa/retomada/encerramento e recuperacao de estado local offline. Na retomada da senha 2, o navegador revelou defeito reproduzivel: `race.start` localizava a chamada antiga (ausente) em vez da chamada atual. `src/domain.ts` agora escolhe a chamada mais recente daquela corrida; `tests/competition.test.mjs` cobre a regressao, incluindo identidade unica da corrida e historico.
- A mesma execucao chegou a persistir a pausa offline no IndexedDB e recarregou a aplicacao offline. A execucao completa terminou reprovada por uma assercao de texto do aviso (genero em â€œPausa registradoâ€), nao por perda dos dados. `src/TrackConsole.tsx` foi ajustado para mensagens neutras e informar explicitamente operacao local/sync pendente. Esse ajuste final nao foi compilado/testado no bundle porque as verificacoes abaixo foram impedidas pelo sandbox.
- Diagnostico da falha de Edge: havia processos Edge ativos, que foram preservados; as portas consultadas nao tinham listener; nao havia Playwright/Puppeteer/WebDriver no projeto. A inicializacao anterior via PowerShell dividiu argumentos do caminho de perfil que contem espacos (`Connect PDM`), produzindo `Multiple targets are not supported in headless mode`; a tentativa normal nao criou listener CDP local. A nova automacao usa `spawn` com argumentos separados, Edge headless em perfil temporario e porta CDP escolhida localmente; nao expÃµe depuracao a rede.

### Comandos desta retomada

| Comando | Resultado real |
|---|---|
| `npm.cmd test` | Exit 0; 36 passaram, 0 falharam (inclui regressao de reinscricao/chamada da mesma corrida). |
| `npx.cmd tsc -b` | Exit 0. |
| `npm.cmd run build` | Exit 1 dentro do sandbox: esbuild recebeu `Acesso negado` ao ler `../..` e nao conseguiu carregar `vite.config.ts`. O comando nao produziu validacao do codigo atual. Uma build anterior, antes do ultimo ajuste de texto da UI, havia terminado com exit 0 sob permissao do ambiente; isso nao valida a fonte final. |
| `npm.cmd run test:browser` | Exit 1; o preview Vite foi bloqueado pelo mesmo `Acesso negado` ao config. A execucao anterior chegou ao fluxo descrito, mas terminou com falha da assercao do toast. Portanto a suite browser completa atual nao esta aprovada. |

### Limites remotos e bloqueios

Nao ha instancia/credencial autorizada de Supabase staging nem CLI/config local. Nenhuma migration foi aplicada nesta etapa; RLS, dois parques, convite/revogacao, permissao por sessao e concorrencia remota nao foram testados. Nao houve sincronizacao Supabase: a verificacao offline demonstra somente persistencia local na execucao parcial e nao confirma outbox remota. O coordenador continua carregando roster de credenciais individuais da configuracao do processo; mudanca/revogacao requer atualizacao segura dessa configuracao e reinicio. A UI guarda token individual localmente e dispositivos compartilhados exigem ensaio de logout/expiracao.

Antes de retomar: executar `npm.cmd run build`, `npm.cmd run test:browser` e os dois comandos ja aprovados num ambiente autorizado a ler a configuracao Vite, sem elevar o bind alem de `127.0.0.1`; garantir que a nova execucao browser termina verde e guardar output sem segredos. Depois, provisionar projeto Supabase descartavel autorizado, configurar variaveis somente no processo de staging e executar as migrations em ordem, com dois parques e perfis ficticios. A classificacao oficial continua bloqueada pela falta de tabela de pontuacao e criterios de desempate aprovados. **Etapa 8 e homologacao oficial permanecem abertas.**

## Etapa 7 â€” homologacao do navegador e modo offline (22/10/2026)

### Resultado desta execucao

O ambiente e Windows, Node `v24.21.0` e npm `11.19.0`. O build de producao foi atualizado com `npm.cmd run build`: exit 0, Vite `6.4.5`, 1.628 modulos transformados. O bundle principal tem 541,86 kB sem gzip (148,85 kB gzip) e permanece o aviso do Vite para chunks acima de 500 kB. `npx.cmd tsc -b` terminou com exit 0. `npm.cmd test` terminou com exit 0: **36 testes passaram, zero falharam**.

O preview foi iniciado no endereco restrito `http://127.0.0.1:4178/`; uma requisicao local HTTP recebeu status 200. A primeira tentativa de build/preview dentro do sandbox foi bloqueada ao ler `../..` (`Acesso negado`); o build e o preview foram repetidos com autorizacao do ambiente. Isso nao ampliou o bind para a rede local ou publica.

Edge instalado: `155.0.4283.62`. Playwright e Puppeteer nao estao instalados no projeto. A tentativa headless terminou com `Multiple targets are not supported in headless mode`; a tentativa normal, usando perfil isolado `.etapa7-edge-profile`, nao disponibilizou o endpoint local de depuracao na porta `9237`. Nao foi possivel inspecionar a pagina, interagir com controles ou capturar console/DOM. Nenhum perfil de navegador existente foi usado. Portanto, nenhum passo de negocio abaixo conta como executado em navegador.

### Matriz de cenarios

| Cenario | Resultado | Evidencia | Pendencia |
|---|---|---|---|
| Bundle de producao e servidor local | Aprovado apenas tecnicamente | Build exit 0; URL local respondeu HTTP 200 | Abrir e inspecionar no navegador ainda pendente |
| Selecionar evento/rodizio e consultar fila/prÃ³xima senha | Nao executado no navegador | Edge/CDP indisponivel; sem captura de DOM | Executar com navegador interativo ou automacao funcional |
| Chamada, presenca, inicio/fim, resultado de teste, confirmacao e historico | Nao executado | Nenhuma acao de UI foi realizada | Ensaio com evento e competidores ficticios |
| Ausencia, deslocamento ao fim, nova chamada e identidade da senha | Nao executado | Sem acesso interativo ao console | Verificar ausencia de duplicidade e historico |
| Pausa, retomada e encerramento do rodizio | Nao executado | Sem acesso interativo ao console | Confirmar bloqueio/retomada apos reload |
| Reload apos operacoes, fechar/reabrir navegador e IndexedDB | Nao executado | Nao houve sessao de pagina inspecionavel | Validacao real de persistencia continua bloqueadora |
| Perda/restauracao de rede, outbox, sincronizacao e reenvio | Nao executado | Nenhuma interrupcao foi simulada; sem ambiente remoto configurado | Repetir em browser e backend de homologacao; comprovar idempotencia |
| Login/logout, expiracao e perfis | Nao executado | Nenhuma conta ficticia configurada; sem ambiente Supabase | Criar contas de staging e testar enforcement no servidor/banco |
| Leitura operacional, tela estreita, clique repetido e impressao | Nao executado | Sem viewport/DOM de navegador acessivel | Avaliar no dispositivo e impressora previstos para pista |
| TypeScript e testes automatizados | Aprovado localmente | `npx.cmd tsc -b` exit 0; `npm.cmd test` 36/36 | Testes unitarios nao provam IndexedDB/browser |

### Conclusao e bloqueios

Nao foi encontrado defeito reproduzivel no fluxo visual porque a UI nao pode ser operada neste ambiente; isso nao equivale a ausencia de defeitos. Nenhum teste de regressao foi acrescentado: nao houve comportamento de aplicacao reproduzido que justificasse uma correcao, e os testes existentes permaneceram verdes. O IndexedDB, a recuperacao apos fechar o browser, o modo offline, a outbox e a sincronizacao **nao estao validados em navegador**. A busca de configuracao encontrou apenas `.env.example` e nenhuma variavel `VITE_*`/`SUPABASE_*`; nao ha evidencia de staging, Auth ou migracao aplicada nesta etapa. Os resultados automatizados continuam locais e nao substituem esses ensaios.

O proximo passo e executar a matriz de `docs/PLANO_HOMOLOGACAO_REAL.md` em um posto de homologacao com Edge/Chrome interativo e perfil descartavel, contas ficticias individuais, backend Supabase staging autorizado e captura de console/rede/IndexedDB sem segredos. Manter bloqueado o uso oficial ate persistencia/offline, autorizacao remota, RLS e regras esportivas serem aprovadas com evidencia.

## Etapa 9 - validacao final da correcao e suite Edge (22/10/2026)

### Revisao do Vite e do bloqueio anterior

O diretorio real e a raiz do projeto, `C:\Users\abreu\Desktop\Connect PDM`; `Resolve-Path vite.config.ts` resolve para o arquivo da raiz. A configuracao calcula `projectRoot` usando `dirname(fileURLToPath(import.meta.url))`; importa somente Vite, plugin React e modulos Node `fs/promises`, `crypto`, `path` e `url`. Nao ha import de `../..`. A mensagem de build observada, com caminho pessoal sanitizado, foi:

```text
X [ERROR] Cannot read directory "../..": Acesso negado.
X [ERROR] Could not resolve "<raiz>\\vite.config.ts"
failed to load config from <raiz>\vite.config.ts
error during build:
Error: Build failed with 2 errors:
error: Cannot read directory "../..": Acesso negado.
error: Could not resolve "<raiz>\\vite.config.ts"
```

A mesma configuracao compilou sem alteracoes no contexto autorizado: a causa foi a fronteira de leitura do sandbox/esbuild, nao a resolucao de caminhos do projeto. Nenhuma permissao global ou configuracao Vite foi alterada.

### Regressao e mensagens

O teste agora verifica que a ausencia continua registrada no snapshot de auditoria `call.absent`, que o deslocamento parte desse estado e a chamada de retorno tem ID proprio. A nova chamada reutiliza a corrida pendente original sem criar outra corrida nem mudar a senha; o inicio da corrida e o julgamento/confirmacao funcionam depois da nova presenca. O browser inspeciona os IDs de chamadas, as corridas e snapshots anteriores/posteriores do historico no IndexedDB.

A funcao comum `trackOperationMessage` fornece textos distintos para local, pendente, sincronizado e conflito e tem as quatro saidas testadas. A mensagem local foi verificada na interface real Edge. Sem Supabase/coordenador nesta sessao, os estados pendente e sincronizado foram verificados pelo teste da funcao usada pela UI, nao por sincronizacao visual com backend real.

### Sequencia final de verificacao

| Comando | Codigo de saida | Resultado |
|---|---:|---|
| `npm.cmd test` | 0 | 37 passaram, 0 falharam. |
| `npx.cmd tsc -b` | 0 | Sem erros. |
| `npm.cmd run build` | 0 | Vite 6.4.5, 1.628 modulos; `index-CgnsgqM5.js` 542,15 kB (148,97 kB gzip); aviso nao bloqueante acima de 500 kB. |
| `npm.cmd run test:browser` | 0 | Edge 155.0.4283.62; 1 teste passou. URL local efemera `http://127.0.0.1:64577/`; perfil temporario isolado. Evento ficticio `e2e-1708ce55-2931-4397-a9d0-ea72041976eb`; 4 chamadas e 3 corridas; reload/IndexedDB/offline local confirmados; zero erros de console e zero falhas de requisicao nao esperadas. Uma resposta 404 de favicon e duas falhas de rede eram esperadas no contexto observado (favicon ausente e desconexao simulada). |

O fluxo Edge cobriu abertura, criacao do evento e inscricoes ficticias, chamada/presenca/inicio, resultado zero confirmado sem pontos, consulta de historico, ausencia/deslocamento/rechamada, pausa/retomada/encerramento/reabertura, reload, persistencia IndexedDB, acao local offline, reload offline e restauracao da conectividade. Sem backend configurado, estado permaneceu `local`, outboxes remotas vazias, sem falsa confirmacao de sincronizacao.

Falhas intermediarias foram separadas entre harness e produto: o snapshot de teste omitia IDs e campos do historico; apos essa correcao funcional, Edge reteve um arquivo de cache durante limpeza. O coletor agora inclui os campos e espera/repete a remocao do perfil. A ultima execucao completa acima terminou com exit 0.

Continuam pendentes staging Supabase, migrations/RLS, isolamento de parques, concorrencia remota, revogacao Auth/coordenador e mensagens pendentes/concluidas produzidas por backend real. O roster estatico do coordenador ainda exige reinicio para revogacao. Unidade de distancia, pontuacao, desempate e regras especiais aguardam comissao; classificacao oficial e uso oficial seguem bloqueados.

**Etapa 9 tecnicamente aprovada para compilacao e fluxo local Edge/IndexedDB; nao e homologacao Supabase/RBAC nem autorizacao para evento oficial.**

## Etapa 10 - auditoria estatica Supabase/RBAC/outbox (22/10/2026)

### Ambiente remoto

**BLOQUEADO:** nao existe projeto Supabase de staging identificavel/autorizado. A inspeÃ§Ã£o encontrou apenas `.env.example` com placeholders; nenhum nome de variÃ¡vel `SUPABASE_*`, `VITE_SUPABASE_*` ou `CONNECT_PDM_*` definido no processo; nenhum arquivo `.env` local, `supabase/config.toml` ou CLI `supabase`. O diretorio `supabase/` contem apenas `migrations/`. Nenhuma conexao foi tentada e nenhuma migration foi aplicada. Nao foi acessada producao.

### Inventario estatico de migrations

Os 12 arquivos estao versionados e, em ordem lexicografica, formam a sequencia abaixo. A revisao estatica confirma que os corpos `SECURITY DEFINER` localizados declaram `SET search_path = ''`; triggers internos revogam EXECUTE ao cliente e RPCs publicas revogam `PUBLIC`/`anon` antes de conceder a funcao pretendida a `authenticated`.

| Migration | Escopo e observacao estatica |
|---|---|
| `202610210001_multi_park.sql` | Parques/eventos/inscricoes/resultados/auditoria, RLS de proprietario, `owns_event`, autoria e triggers base. |
| `202610210002_manual_payments.sql` | Estado e autoria de pagamento, guardas/triggers. |
| `202610210003_immutable_results.sql` | Resultado append-only e guarda de confirmacao. |
| `202610210004_ticket_capacity.sql` | Contador, capacidade serializada e funcoes SECURITY DEFINER. |
| `202610210005_result_corrections.sql` | Substituicao auditada e trilha de correcao append-only. |
| `202610210006_event_capacity_updates.sql` | Validacao concorrente de reducao de capacidade. |
| `202610210007_entry_cancellation.sql` | Cancelamento e ligacao de resultados a inscricoes ativas. |
| `202610210008_entry_transfers.sql` | Transferencia com motivo/autoria e identidade da senha preservada. |
| `202610210009_ticket_reservations.sql` | Reserva, expiracao, conversao/liberacao e contador serializado. |
| `202610220010_entry_partner.sql` | Parceiro da dupla e ajustes de conversao/transferencia. |
| `202610220011_track_console.sql` | Estado/operaÃ§Ãµes da pista, CAS por versao, RLS de leitura e RPC de escrita. |
| `202610220012_individual_rbac.sql` | Memberships, convites, papeis, helpers de permissao, RLS/triggers por acao e RPCs. |

Nenhuma linha desta tabela significa que o SQL executou: status de aplicacao em Supabase e **NAO EXECUTADO**.

### Matriz estatica de autorizacao

| Operacao/dados | Regra encontrada no banco/coordenador | Classificacao Etapa 10 |
|---|---|---|
| Parque/evento/inscricao/resultados/auditoria | RLS ativada; migrations 001/012 substituem politicas de owner por checks de membership/evento. RLS bloqueia anon; grants/RPCs distinguem escrita. | PASSOU em leitura estatica; RLS remota NAO EXECUTADA. |
| Pagamento/cancelamento/transferencia | Triggers e RPCs verificam `auth.uid()` e permissoes `payment.record`, `entry.cancel`, `entry.transfer`; papeis staff nao recebem essas permissoes por padrao. | PASSOU em leitura estatica; escrita direta API/SQL NAO EXECUTADA. |
| Convites e membership | Token UUID retornado uma vez e armazenado como SHA-256; aceite exige sessao, email confirmado e convite nao expirado/revogado/usado; `FOR UPDATE`; RLS revalida membership nas operacoes. Desativacao e auditada e mantem a linha. | PASSOU em leitura estatica; expiracao, reutilizacao, sessao aberta e revogacao NAO EXECUTADAS remotamente. |
| Isolamento entre parques | Predicados resolvem `event_id -> park_id -> membership`; o cliente nao define a autoridade por `park_id`. | PASSOU em leitura estatica; tentativa cruzada entre dois parques NAO EXECUTADA. |
| Perfil platform admin | `platform_admins` sem grants para roles cliente; provisionamento somente fora do cliente. Nao recebe acesso global implicito via papel de parque. | PASSOU em leitura estatica; provisionamento/acesso NAO EXECUTADOS. |
| Estado operacional da pista | RPC checa identidade, permissao para a acao, versao, evento/inscricao, append-only de historico e preservacao de resultado oficial anterior. Contudo, aceita JSON completo sem validar a transicao/delta correspondente a `p_action`. Um `track_operator` autorizado a `call.create` pode submeter corrida nova com `status/resultStatus = official`, mantendo ultima linha de auditoria `call.create`; nao ha guarda contra promover resultado novo a oficial nessa acao. Isso permite fabricar estado oficial na tabela de pista via API direta, sem `result.confirm`. | **FALHOU - bloqueador critico de integridade/RBAC** (demonstrado estaticamente; sem tentativa remota). A classificacao legada nao consome hoje esse JSON, mas o console pode exibi-lo como oficial. |
| Repeticao simultanea da RPC de pista | Busca de `operation_id` acontece antes de advisory lock; apos esperar o lock, a funcao nao repete a busca antes do CAS. Reenvio concorrente do mesmo ID pode virar conflito de versao em vez de resposta duplicada (sem duplicar estado). | BLOQUEADO para confirmacao concorrente real; risco estatico a corrigir/testar. |
| Coordenador local | Cada chamada protegida resolve Bearer contra roster individual e verifica disabled/expiracao/papel. O processo fica vinculado a um parque. O roster vem de `CONNECT_PDM_OPERATOR_CREDENTIALS`; revogar/alterar exige atualizar ambiente e reiniciar, sem introspeccao Supabase Auth. `/api/health` permanece publico e retorna parkId/sequence/time. | PASSOU em revisao de mecanismo local com limitacao; revogacao imediata integrada a Auth BLOQUEADA. |
| Outbox Supabase | Operacao de pista grava `actorUserId`; sync exige sessao da mesma identidade e RPC/RLS revalida permissao. Versao/conflito bloqueia item e preserva operacao; erro permanente bloqueia, erro de rede mantem pending. Outbox generica filtra `ownerUserId`. | PASSOU em leitura estatica; falha/replay/revocacao remotos NAO EXECUTADOS. |
| Outbox do coordenador | Registro de `coordinator_outbox` nao armazena autor autenticado original. Offline, item pode ser enviado sob qualquer token configurado posteriormente; SQLite registra o autor do token que sincroniza, nao prova quem criou o item. Portanto operacao antiga pode ser atribuida a outro usuario no aparelho compartilhado. | **FALHOU - autoria local nao vinculada ao criador**; requer desenho de identidade offline e teste. |

O helper `has_park_permission` concede todas as permissoes de parque ao owner e ao papel membership `park_manager`, exceto `platform.admin`, que e verificado separadamente. Os outros papeis recebem a lista explicita; permissao sem mapeamento resulta `false`. A matriz documentada da Etapa 6 corresponde em geral a esse mapa, com dois limites: manager de parque pode todas as operacoes do proprio parque; `track_operator` pode `pause/resume`, mas `close/reopen` nao sao concedidos. A equipe Locucao/Julgador/Escritorio permanece restrita pelas permissoes do helper. A migration nao cria conta de platform admin nem console global.

| Perfil | Supabase/RLS + RPC (estatico) | Coordenador Node (estatico) |
|---|---|---|
| Administrador da plataforma | Somente predicado `platform.admin`; nenhuma rota global de produto concede acesso geral. | Perfil nao existe na lista de operadores. |
| Responsavel pelo parque | Owner/membership `park_manager` recebe permissoes do proprio parque, inclusive equipe/resultados/financeiro/correcoes. | `park_manager` amplo, vinculado ao unico `CONNECT_PDM_PARK_ID`; conflitos podem ser consultados. |
| Escritorio | `event/entry.read`, `entry.create/update`, `payment.record`, `report.read`; sem cancelamento/transferencia/reserva/resultado/usuarios. | Lista equivalente, sem reserva (fora das permissoes da funcao). |
| Locucao | Le evento/inscricao, pista, resultado e classificacao; sem financeiro/escrita. | Le evento/inscricao, pista, resultados e standings; campos de pagamento filtrados. |
| Julgador | Le operacao/pista/resultados; `result.judge` e `result.return_decide`; sem confirmacao/correcao oficial. | Lista equivalente, sem confirmacao/correcao/financeiro. |
| Operador de Pista | Le evento/inscricao/pista; fila e pause/resume; sem julgamento, fechamento/reabertura privilegiada ou usuarios. | `track.queue` e `track.rotation_control`; sem close/reopen, julgamento ou usuarios. |

Isto e equivalencia estatica de configuracoes, nao prova de autorizacao executada no banco/servidor.

### Resultado das fases

| Fase/verificacao | Estado |
|---|---|
| A - inventario, leitura de auth/RLS/RPC/coordenador/outbox | PASSOU como auditoria estatica; encontrou as duas falhas acima e limites de revogacao. |
| A - garantia efetiva de toda transicao da pista por SQL | FALHOU estaticamente: RPC aceita estado arbitrario para acao permitida. |
| B - projeto staging separado, Auth ficticio e CLI | BLOQUEADO: ausencia de projeto/configuracao/credenciais autorizadas. |
| B - migrations remotas aplicadas | NAO EXECUTADO. |
| C - anon, seis papeis, acesso cruzado, convite, revogacao/sessao, API direta, concorrencia, replay e conflito de resultado | NAO EXECUTADO (sem staging). |
| C - coordenador individual/restart/outbox/authorship | Testes locais existentes sao unitarios/SQLite; ensaio de restart e ator antigo nesta etapa NAO EXECUTADO. Falha de autoria offline do coordenador identificada estaticamente. |
| D - regressao/codigo | Nenhuma alteracao de autorizacao ou migration feita nesta etapa: a correÃ§Ã£o precisa de migration aditiva e teste PostgreSQL real, ausentes no ambiente. As duas falhas permanecem bloqueadoras. |
| D - `npm.cmd test` | PASSOU; 37/37, exit 0. |
| D - `npx.cmd tsc -b` | PASSOU; exit 0. |
| D - `npm.cmd run build` | PASSOU; exit 0, Vite 6.4.5, 1.628 modulos; chunk 542,15 kB e aviso >500 kB. |
| D - `npm.cmd run test:browser` | PASSOU localmente; 1/1 no Edge 155.0.4283.62, loopback. Isso nao testa auth/outbox remota. |
| E - homologacao oficial | BLOQUEADA pelas falhas de transicao/autoria e por todas as verificacoes remotas e esportivas ainda pendentes. |

Sequencia local executada: `npm.cmd test` (exit 0, 37/37); `npx.cmd tsc -b` (exit 0); `npm.cmd run build` (exit 0; Vite 6.4.5, 1.628 modulos, 542,15 kB JS/148,97 kB gzip, aviso de chunk); `npm.cmd run test:browser` (exit 0, 1/1). Evidencia browser desta etapa: Edge 155.0.4283.62, `http://127.0.0.1:53905/`, evento ficticio `e2e-96e7afb7-3a21-446a-9585-418480102d65`, 4 chamadas/3 corridas, reload e IndexedDB offline local; 0 erros de console e 0 falhas de rede nao esperadas. Uma resposta 404 de favicon e duas desconexoes esperadas durante o modo offline foram capturadas. Nenhum dado remoto foi sincronizado.

### Proximo passo seguro

Responsavel deve provisionar projeto Supabase descartavel e confirmar por canal operacional seu project ref, nome/URL de staging e que nao e producao. Somente depois instalar CLI aprovada, autenticar sem guardar saida com token, `supabase link --project-ref <STAGING_PROJECT_REF>`, `supabase migration list --linked`, `supabase db push --dry-run`; revisar a lista de 12 migrations e aplicar `supabase db push` somente apos confirmar visualmente a identidade staging. A documentacao oficial da CLI descreve o dry-run e o link como pre-condicao para push: [Supabase CLI e migrations](https://supabase.com/docs/guides/local-development/cli-workflows). Nunca usar reset remoto.

Antes de liberar qualquer usuario, criar dois parques e usuarios ficticios separados; executar teste direto via PostgREST/RPC e SQL com anon/authenticated para cada papel e registrar SQLSTATE/status sem tokens. Corrigir `apply_event_track_operation` com validacao server-side de transicao/action e add testes PostgreSQL; bind autoria da outbox local do coordenador a identidade original, colocando itens sem autoria verificavel em quarentena. Testar repeticao concorrente mesma operationId, CAS, revogacao, reenvio apos restart e preservacao de resultado oficial. Nao alterar regra esportiva nem pontuacao.

## Etapa 11 - bloqueio preventivo da RPC, quarentena da outbox e revogacao local (22/10/2026)

### Decisoes de seguranca

| Bloqueador | Causa | Correcao nesta etapa | Regressao/resultado | Risco restante |
|---|---|---|---|---|
| Estado da pista aceito como JSON integral (`apply_event_track_operation`) | A RPC anterior validava permissao/versao e append de historico, mas nao provava que o delta correspondia a `p_action`; `call.create` podia introduzir resultado `official`. | Criada migration aditiva `202610220013_suspend_unvalidated_track_rpc.sql`: revoga EXECUTE de `PUBLIC`, `anon`, `authenticated` e DML nas tabelas de pista, mantendo SELECT autenticado sujeito a RLS e sem apagar linhas/historico. | Teste local estatico `track-rpc-stopgap.test.mjs` verifica o fail-closed no SQL; `npm.cmd test` PASSOU 39/39. Nao e teste PostgreSQL. | Migration NAO aplicada. Quando aplicada, sincronizacao remota da pista fica deliberadamente indisponivel ate RPC substituta, baseada em acao/dados pequenos e transicoes server-side, ter testes PostgreSQL e staging. Nenhuma garantia remota mudou ainda. |
| Reenvio da mesma operationId na RPC | Consulta de duplicata precedia o lock e nao era repetida dentro dele; a RPC tambem nao vinculava duplicate ao autor autenticado. | Incluida na mesma suspensao preventiva; nenhuma nova promessa de idempotencia remota e feita. | BLOQUEADO: exige teste concorrente PostgreSQL/staging e RPC substituta. | Nao reabilitar a funcao antiga; replay concorrente remoto permanece sem validacao. |
| Autoria da outbox do coordenador | Itens IndexedDB nao continham atestacao de quem os criou e o servidor atribuÃ­a o autor do token atual. | DB local v7 coloca itens antigos sem prova em `blocked`, preservando payload/historico. Novos itens do coordenador tambem ficam bloqueados e a sincronizacao automatica os ignora. | Teste de migracao IDB nao disponivel na suite Node; comportamento revisado estaticamente e compilacao verificada. | Envio da outbox do coordenador fica interrompido ate existir atestacao assinada por servidor que vincule operationId/conteudo/usuario/dispositivo, expiracao e revogacao. UUID no navegador nao e prova. Itens antigos requerem revisao manual; nunca reatribuir automaticamente. |
| Autoria da outbox Supabase de pista apos reload | `actorUserId` persistido era editavel; igualdade com sessao atual nao prova quem criou a operacao. | Binding do autor passou a ser somente em memoria, vindo da sessao Supabase no instante de criacao. Reenvio exige binding; item recuperado do IndexedDB sem binding vai para `blocked`, preservado. | `npm.cmd test` PASSOU 39/39; `npx.cmd tsc -b` PASSOU. Teste browser com Auth Supabase nao executado. | Operacoes offline apos reload pedem revisao; ainda falta recibo verificavel do servidor para retomada segura. Migration 013, quando aplicada, suspende escrita remota de pista. |
| Revogacao no coordenador | Roster de `CONNECT_PDM_OPERATOR_CREDENTIALS` era carregado no startup; alteracao exigia restart. | Adicionado `CONNECT_PDM_OPERATOR_CREDENTIALS_FILE`; se configurado, relido e validado em cada requisicao protegida. Arquivo ausente, JSON invalido ou roster malformado falha fechado. Teste altera arquivo e recebe 401 sem reiniciar o processo. | Teste HTTP local em `tests/coordinator.test.mjs` PASSOU. | O modo antigo por variavel de ambiente permanece estatico e exige restart. Arquivo local nao e fonte remota Supabase; revogacao central depende de infraestrutura inexistente. Coordenador indisponivel impede sync e conserva pendencias locais. |

### Comandos e resultado desta etapa

- `npm.cmd test`: PASSOU, 39/39, exit 0 (inclui teste HTTP local do coordenador e verificacao estatica da migration).
- `npx.cmd tsc -b`: primeira execucao FALHOU por acessar `oldVersion` no objeto errado; corrigido para `IDBVersionChangeEvent`. Reexecucao PASSOU, exit 0.
- `npm.cmd run build`: processo autorizado mostrou Vite 6.4.5 iniciando compilacao, mas a captura nao trouxe sumario final nem exit code; NAO contar como aprovado ate nova execucao observavel.
- `npm.cmd run test:browser`: NAO EXECUTADO ainda nesta etapa.
- Migration remota, PostgreSQL/RLS, concorrencia real, isolamento de parques e revogacao Supabase: BLOQUEADOS, sem staging autorizado. Nenhum acesso remoto realizado.

**Estado de liberacao:** FALHOU para uso oficial. Migration preventiva proposta, ainda nao aplicada. Bloqueiam a liberacao: staging ausente; RPC de transicao ainda nao implementada/testada; atestacao assinada da outbox ainda inexistente; RLS/RBAC remoto nao exercitado; regras esportivas pendentes e tabela aprovada de pontos/desempate ausente.

### Aditivo de resultados apos a tabela Etapa 11

A repeticao final de `npm.cmd run build` terminou com exit 0: Vite 6.4.5, 1.628 modulos, bundle JS 542,74 kB (149,15 kB gzip); permanece aviso de chunk >500 kB. Portanto build local PASSOU. `npm.cmd run test:browser` teve uma primeira execucao FALHOU (button not found para â€œChamar senha 2â€ em `tests/browser/track-console.test.mjs:375`, exit 1); sem alteracao de codigo entre tentativas, a repeticao passou 1/1 (exit 0), Edge 155.0.4283.62, URL loopback `http://127.0.0.1:63077/`, evento ficticio `e2e-c389edbf-605f-45ee-bc08-7733b463da6d`, 4 chamadas/3 corridas, reload e operacao local offline; 0 erros de console e 0 falhas de requisicao, 1 favicon 404 e 2 falhas de rede esperadas no teste offline. Classificar a suite como PASSOU na ultima execucao, com uma falha transitoria/flaky anterior registrada. Nenhum Supabase/coordenador remoto configurado ou sincronizado.

A RPC legada aceitava estes `p_action`: `rotation.pause`, `rotation.resume`, `rotation.close`, `rotation.reopen`, `call.create`, `call.present`, `call.absent`, `call.move_tail`, `race.start`, `race.judge`, `return.decide`, `return.create_race`, `result.confirm` e `result.correct`. Ela mapeava esses nomes para permissoes RBAC, mas nao validava em banco a transicao individual de cada acao sobre o estado completo. A migration 013 suspende todos esses caminhos conjuntamente; nao ha excecao por papel/acao ate existir implementacao server-side. O domÃ­nio local continua validando estados, mas isso nao autoriza escrita remota.

Testes pedidos de payload adulterado por acao, tentativa de cada papel contra cada permissao, cruzamento real de parques, replay concorrente, autoria ausente/incompativel e preservacao de historico apos rejeicao remota: BLOQUEADOS/NAO EXECUTADOS no banco. Os 39 testes locais incluem transicoes do dominio, escopos RBAC do coordenador, revogacao por arquivo e uma verificacao estatica de revogacao da RPC; nao substituem testes SQL/RLS.

## Etapa 12 - inspecao da suspensao e contrato da RPC (22/10/2026)

### Fase A - privileges e caminhos

- Inventario atual: 14 migrations (`202610210001` ate `202610220014`). Migrations 011/012 criam apenas a RPC `public.apply_event_track_operation(uuid,uuid,bigint,text,jsonb,text)` para escrita dos estados da pista. A migration 012 concede EXECUTE a `authenticated`; 013 revoga e nao apaga a funcao nem os dados.
- Migration 013 revoga a funcao e DML da pista para `PUBLIC`, `anon` e `authenticated`; migration 014 adiciona revogacao explicita de EXECUTE e DML para `service_role`. Ambas mantem SELECT autenticado sujeito a RLS. Nao ha sequences nessas tabelas: PKs sao UUID; `created_at` tem default timestamp. A politica RLS de SELECT da 012 continua a limitar linhas por `track.read` e evento/parque.
- A migration e repetivel estaticamente: contem somente REVOKE/GRANT/COMMENT idempotentes; nao faz DROP, DELETE, TRUNCATE ou alteracao de dados. Isso nao substitui executar a migration num banco limpo e num banco com fixture.
- Nenhum outro modulo SQL pesquisado chama a RPC antiga; nao foram encontrados triggers nas tabelas da pista nem outra funcao wrapper de escrita. O coordenador local era caminho alternativo: a API aceitava snapshot integral de `track_states`; o servidor agora rejeita esse entityType antes de persistir, inclusive chamada autenticada direta. Outbox do coordenador permanece em quarentena.
- `PUBLIC`/roles de aplicacao e `service_role` estao cobertos explicitamente na migration. Proprietario da funcao/tabela, superuser e qualquer role administrativa mantem capacidade inerente. Membership/inheritance efetiva, ACLs adicionadas fora das migrations e owners reais **nao podem ser apurados sem consultar `pg_proc.proacl`, `pg_class.relacl`, `pg_auth_members` e `has_function_privilege` na instancia**. Nao afirmo a suspensao efetiva no banco remoto.
- Fluxos que ficam indisponiveis: toda escrita remota da pista (chamada, presenca/ausencia, fila, inicio, julgamento, retorno, confirmacao/correcao e controle do rodizio) tanto via Supabase quanto via coordenador. Leitura continua disponivel conforme RLS. No cliente, a chamada RPC foi removida e a outbox Supabase e preservada em `blocked`, sem tentativa automatica. Dados locais ainda podem ser registrados e nao significam sincronizacao remota.

### Fases B-D - ambiente e testes

| Verificacao | Estado | Evidencia |
|---|---|---|
| Staging explicitamente autorizado/configurado | BLOQUEADO | Sem variaveis de ambiente `SUPABASE_*`, `VITE_SUPABASE_*` ou `CONNECT_PDM_*`; sem `.env`; sem `supabase/config.toml`; CLI `supabase` ausente. Docker esta instalado, mas nao foi iniciado: o pedido limita testes PostgreSQL reais a staging autorizado. Nenhuma conexao/migration remota realizada. |
| Migration 013 aplicada e grants efetivos inspecionados | NAO EXECUTADO | Nao ha project ref nem confirmacao de staging; nenhum banco inspecionado. |
| PostgreSQL: chamada adulterada, roles, parques, versao, duplicidade, correcoes, autoria, revogacao, acesso API/banco e caminhos alternativos | BLOQUEADO | Requer staging autorizado com dois parques e contas ficticias; nenhuma substituicao por mocks. |
| Coordenador: chamada direta com snapshot adulterado | PASSOU localmente | Teste HTTP de `tests/coordinator.test.mjs` envia `track_states` com resultado `official` sob acao `call.create`; API rejeita e snapshot continua sem estado de pista. Teste local SQLite/Node, nao PostgreSQL. |
| Guardas locais da migration/sync client | PASSOU como verificacao estatica | `tests/track-rpc-stopgap.test.mjs` confere revogacao na migration, ausencia de DROP e ausencia de chamada cliente a RPC vulneravel. Nao prova ACL real. |
| `npm.cmd test` | PASSOU | 40/40, exit 0. |
| `npx.cmd tsc -b` | PASSOU | Exit 0. |
| `npm.cmd run build` | PASSOU | Exit 0, Vite 6.4.5, 1.628 modulos; JS 540,91 kB/148,66 kB gzip, aviso de chunk >500 kB. |
| `npm.cmd run test:browser` | PASSOU | 1/1, Edge 155.0.4283.62, `http://127.0.0.1:52526/`; evento ficticio, 4 chamadas/3 corridas, reload/IndexedDB e offline local; zero erros de console e requisicoes inesperadas. Sem Supabase/coordenador remoto. |

### Fase C - contrato preparado, nao implementado

Contrato detalhado em `docs/RPC_PISTA_SEGURA.md`: a funcao futura recebe envelope de evento/opId/versao/acao e JSON restrito por acao, deriva actor por `auth.uid()`, carrega estado/configuracao persistidos, adquire lock, revalida idempotencia depois do lock, deriva transicao no servidor e escreve estado/historico/log atomicamente. A lista cobre transicoes de rodizio, chamadas, presenca/ausencia, corrida, julgamento, retorno, confirmacao e correcao. Campos `status`, `resultStatus`, `history`, `actor`, `parkId`, `role`, `user_id`, `points` ou snapshot integral nao sao entradas autorizadas. A tabela de pontuacao e desempates continua sem aprovacao; nenhum ponto e inferido.

**Nenhuma RPC nova foi criada nesta etapa.** A migration 014 foi adicionada como revogacao complementar; sem PostgreSQL autorizado nao e possivel provar ACL efetiva, transacao, policies ou concorrencia. Reativar a escrita sem esses testes contrariaria o criterio de integridade. O cliente e o coordenador ficam explicitamente fail-closed.

### Proximos passos que dependem do responsavel

1. Provisionar projeto Supabase descartavel/staging separado e enviar confirmacao explicita, project ref e URL/nome verificavel; criar contas ficticias e dois parques independentes. Nao enviar service-role key pelo cliente.
2. Em terminal autorizado, inspecionar `supabase migration list --linked`, revisar ref e `supabase db push --dry-run`; aplicar 013 apenas apos confirmar novamente o alvo staging. Capturar version e ACL/RLS sem segredos.
3. Executar consultas de ACL/inheritance e testes API/SQL de anon, cada papel, parque cruzado, revogacao e chamada direta; confirmar 013 realmente bloqueia execute/DML sem impedir leitura autorizada.
4. Implementar migration posterior e testes PostgreSQL para o contrato documentado. So habilitar nova escrita depois de todos testes de payload, papel, parque, CAS, replay concorrente, correcoes, autoria e auditoria passarem no staging.
5. Definir assinatura/retomada segura da outbox offline e obter aprovacao formal das regras esportivas. Classificacao oficial segue bloqueada.

**Classificacao geral Etapa 12:** PASSOU em testes locais e revisao estatica; BLOQUEADO em staging/PostgreSQL. Nao houve validacao remota nem autorizacao para uso oficial.

### Suplemento de ACL da Etapa 12

A migration 013 foi preservada sem alteracao nesta etapa por ser uma migration versionada; ela revoga os principals PUBLIC/anon/authenticated. Para nao presumir heranca/ACL de `service_role`, criei a migration aditiva posterior `202610220014_track_service_role_stop.sql`, que revoga explicitamente EXECUTE na RPC antiga e DML/truncate/references/trigger nas tabelas da pista para esse role. O estado final esperado resulta da aplicacao ordenada 013+014. Nenhuma das duas foi aplicada; grants efetivos e memberships continuam NAO EXECUTADOS. O teste Node verifica texto/conteudo dessas migrations, nao ACL PostgreSQL.

O bloqueio do cliente em `syncTrackOperations` agora coloca itens pendentes em `blocked` e nao contem chamada ao nome da RPC antiga. O servidor do coordenador rejeita `track_states` em `validateOperation`, antes de persistir ou invocar a autorizacao de payload. O teste HTTP existente envia estado adulterado com resultado oficial e recebe rejeicao. Isto bloqueia escrita nos dois caminhos de aplicacao conhecidos; roles de dono/superuser e operacao administrativa permanecem fora dessa fronteira e precisam de governanca/ACL auditada no staging.


### Registro final de execucao Etapa 12

- `npm.cmd test`: PASSOU, 40 testes, 0 falhas, exit 0. Inclui rejeicao por API direta do coordenador para snapshot integral adulterado; teste local Node/SQLite.
- `npx.cmd tsc -b`: PASSOU, exit 0.
- `npm.cmd run build`: PASSOU, exit 0; Vite 6.4.5, 1.628 modulos, bundle 540,91 kB (148,66 kB gzip), aviso >500 kB.
- `npm.cmd run test:browser`: PASSOU, 1/1, Edge 155.0.4283.62 em `http://127.0.0.1:63658/`, evento ficticio `e2e-4b842ca2-8ef8-4671-a3ac-bd2cc5bb2a2f`, 4 chamadas/3 corridas e recuperacao local; 0 erros console, 0 falhas de requisicao inesperadas. O browser nao usou Supabase nem coordenador configurado.
- PostgreSQL real / migration 013+014 / ACL-RLS / concorrencia / RLS-RBAC / revogacao / dois parques: BLOQUEADO, nenhum endpoint acessado. Confirmacao de staging, project ref e autorizacao ainda necessarias.


## Etapa 13 - preparacao de staging sem conexao remota

- Projeto local: 14 arquivos SQL em `supabase/migrations`, ordenados de `202610210001` a `202610220014`; migrations 013/014 presentes. Nao existe `.git`, `supabase/config.toml`, `supabase/.temp/project-ref`, `.env` ou `.env.local`; nao existe historico local `supabase_migrations.schema_migrations` consultavel neste workspace.
- CLI: `supabase` nao instalado/nao encontrado; nao consta em `package.json` nem `package-lock.json`. Node `v24.21.0` e npm `11.19.0`; documentacao oficial corrente requer Node 20+ para CLI executada via npm. `winget` existe, `scoop` nao; nenhuma instalacao tentada. Arquivos locais de config/token da CLI nao foram encontrados (conteudo nunca lido).
- Nenhuma variavel `SUPABASE_*`, `VITE_SUPABASE_*` ou `CONNECT_PDM_*` foi listada no ambiente; nenhuma URL/ref pode ser inferida localmente. Nenhuma autenticacao, link, consulta remota, dry-run ou migration ocorreu.
- O responsavel informou que criou um staging, mas Project Ref nao foi fornecido/confirmado; destino remoto continua **BLOQUEADO** e nao pode ser distinguido por prova operacional de producao.
- Plano preparado: receber Project Ref e confirmacao da URL/nome no Dashboard; instalar CLI pelo procedimento oficial aprovado; preparar `supabase/config.toml` local (hoje ausente); revisar cada passo; apos confirmacao explicita, autenticar sem expor token, linkar esse ref, conferir `supabase projects list` e `supabase migration list --linked`, executar somente `supabase db push --dry-run`, revisar a lista exata; interromper se ref/ambiente/historico divergirem. `db push` nao sera executado sem nova confirmacao explicita.
- Consequencia 013: remove EXECUTE da RPC antiga para PUBLIC/anon/authenticated e escrita direta das tabelas para esses principals; leitura authenticated continua sujeita a RLS. Consequencia 014: estende a revogacao de EXECUTE/DML para `service_role`. Em conjunto, escrita normal de pista fica indisponivel; dados/tabelas nao sao apagados. A cadeia remota pode ter zero, parte ou todas as 14 migrations aplicadas; sem historico remoto nao se sabe quais comandos seriam propostos. `db push` aplica qualquer migration local pendente, nao somente 013/014.
- Homologacao e uso oficial permanecem bloqueados; cliente e coordenador continuam sem sincronizacao de pista. Nenhuma confirmacao de staging, ACL ou dados remotos e inferida da existencia do projeto informado.

## Etapa 12B - preparar conferencia do staging (22/10/2026)

- O responsavel informou o Project Ref `ftaxsyrnvbjsncimdmom` como staging. Esse valor foi recebido por mensagem, mas **nao foi comparado ao Dashboard nem a uma lista de projetos autenticada**; identidade do destino ainda nao foi verificada independentemente.
- Verificacao local: raiz `C:\Users\abreu\Desktop\Connect PDM`; `supabase` nao encontrado no PATH; CLI nao consta como dependencia do projeto. Versao da CLI: **nao disponivel**, pois nao esta instalada. Node `v24.21.0`, npm `11.19.0`. Existem 14 migrations, de `202610210001_multi_park.sql` a `202610220014_track_service_role_stop.sql`, incluindo 013 e 014.
- Nao existe `supabase/config.toml` ou `supabase/.temp/project-ref`. `docs/RPC_PISTA_SEGURA.md` existe. Nenhum login, instalacao, link, comando remoto ou alteracao de banco foi executado nesta etapa. Nenhum segredo foi lido ou registrado.
- Documentacao oficial consultada: instalacao npm da CLI como dependencia de desenvolvimento e requisito Node 20+; `supabase login` interativo; `supabase link`; `supabase migration list --linked`; `supabase db push --dry-run --linked`. `db push --dry-run` e uma consulta remota sem aplicar alteracoes, mas pode listar qualquer migration local pendente (potencialmente as 14); nao sera executado sem confirmacao especifica.
- Proposta para instalar, pendente de autorizacao por alterar package/lock: `npm.cmd install --save-dev supabase`. Apos instalar, usar `npx.cmd supabase --version` e registrar a versao. Autenticacao deve ser feita em terminal interativo via `npx.cmd supabase login`, sem argumento `--token`, sem colar token em comandos/logs e sem usar credencial `service_role`. O armazenamento de credencial da CLI deve ser protegido; nao copiar tokens para o repositorio.
- Vinculo preparado, mas nao executado: `npx.cmd supabase link --project-ref ftaxsyrnvbjsncimdmom`. Antes de vincular, conferir no Dashboard Project Settings > General que o Project ID e exatamente esse ref e que nome/URL identificam o staging separado; apos autorizacao, comparar com `npx.cmd supabase projects list` e com `supabase/.temp/project-ref`.
- Consultas remotas preparadas, **aguardando confirmacao explicita antes de qualquer execucao**:
  1. `npx.cmd supabase migration list --linked`
  2. `npx.cmd supabase db push --dry-run --linked`
- Nao executar `db push`, `db reset`, SQL remoto ou reativacao da sincronizacao da pista. O estado remoto e a lista exata de migrations que seriam propostas seguem **BLOQUEADOS / DESCONHECIDOS**. Nenhuma das migrations 013/014 foi validada remotamente.

## Etapa 12B - tentativa autorizada de instalacao da CLI (22/10/2026)

- Confirmada raiz `C:\Users\abreu\Desktop\Connect PDM`. O diretorio nao tem metadados Git disponiveis; os manifests foram inspecionados diretamente. Antes/depois da tentativa: `package.json` sem `devDependencies.supabase` e lockfile sem a dependencia na raiz; tamanhos permaneceram 676 e 67258 bytes. Nenhuma alteracao foi feita aos manifests.
- Executado uma vez: `npm.cmd install --save-dev supabase`. Resultado: **FALHOU**, exit code 1, `npm error code EACCES`, `FetchError: request to https://registry.npmjs.org/supabase failed`; o npm tambem reportou que nao conseguiu gravar logs em `C:\Users\abreu\AppData\Local\npm-cache\_logs`. Nao foi feita elevacao de permissao, ajuste de cache/rede ou nova tentativa.
- A CLI continua nao instalada; versao nao disponivel. `npm.cmd test`, `npx.cmd tsc -b` e `npm.cmd run build` **NAO EXECUTADOS nesta tentativa**, pois a etapa condicionou essas verificacoes a instalacao concluida. Devem ser executados apos resolver o bloqueio e instalar a dependencia.
- Nenhum login, link, consulta remota, migration, SQL ou alteracao de dados ocorreu. O banco remoto continua nao validado e a sincronizacao remota da pista permanece bloqueada.
- Proximo passo necessario: um operador do ambiente deve corrigir/autorizAR acesso de leitura ao registry npm e permissao de escrita no cache/logs npm; depois autorizar uma nova tentativa local. Nao ha evidencia suficiente para atribuir EACCES apenas a rede ou apenas a ACL do cache: a mensagem de fetch aponta acesso negado durante requisicao e a mensagem do log confirma bloqueio de escrita no cache.

## Etapa 12C - diagnostico seguro do npm (22/10/2026)

- Raiz confirmada: `C:\Users\abreu\Desktop\Connect PDM`. `node --version`: `v24.21.0`; `npm.cmd --version`: `11.19.0`.
- Configuracao: registry `https://registry.npmjs.org/` (correto); cache `C:\Users\abreu\AppData\Local\npm-cache`; userconfig `C:\Users\abreu\.npmrc`; globalconfig `C:\Users\abreu\AppData\Roaming\npm\etc\npmrc`. O conteudo de `.npmrc` nao foi lido. `npm config get proxy` e `https-proxy` retornaram sem configuracao; nenhuma variavel padrao de proxy estava definida.
- Testes de escrita limitados: cache padrao existe, mas criacao de arquivo-prova foi negada (`Access denied`). A raiz do projeto permite escrita. `.npm-cache` dentro do projeto foi criado apenas para teste, aceitou escrita, e foi removido ao final; cache preexistente nao foi apagado.
- Acesso ao registry: `curl.exe --head --max-time 10 --silent --show-error https://registry.npmjs.org/supabase` falhou com exit 1: `curl: (7) Failed to connect to registry.npmjs.org:443 after 126 ms: Could not connect to server`. `npm.cmd ping --registry=https://registry.npmjs.org/ --cache=.\\.npm-cache --fetch-timeout=10000 --logs-max=0` exibiu somente o aviso PING e nao respondeu; foi interrompido, exit 1. Evidencia aponta para bloqueio de conectividade de saida/politica do ambiente, nao proxy configurado. Separadamente, a permissao de escrita do cache padrao esta bloqueada.
- `package.json` continua com 676 bytes e `package-lock.json` com 67258 bytes; parse JSON confirmou que nenhum lista `supabase`. CLI nao instalada; nenhuma instalacao, login, link, consulta remota ou migration ocorreu.
- Causa pratica da instalacao bloqueada: ha duas barreiras independentes observadas: acesso HTTPS ao registry nao funciona e o cache padrao nao aceita escrita. Usar cache local resolveria somente a segunda. Nao foram alterados proxy, registry, certificados ou ACLs.
- Depois que o responsavel pelo ambiente liberar conectividade aprovada ao registry, e mediante nova confirmacao, comando proposto: `npm.cmd install --save-dev supabase --cache .\\.npm-cache`. **Este comando nao foi executado.** O cache sera local ao projeto; revisar `.gitignore`/higiene do repositorio depois da instalacao, sem apagar caches anteriores.
- Nenhum teste/build foi executado nesta etapa. Supabase remoto continua nao consultado e nao validado; sincronizacao remota da pista permanece bloqueada.

## Etapa 12D - verificacao de conectividade HTTPS (22/10/2026)

- Diretorio confirmado: `C:\Users\abreu\Desktop\Connect PDM`.
- DNS: `Resolve-DnsName registry.npmjs.org` **PASSOU** e retornou registros A (104.16.x.34) e AAAA (2606:4700::6810:...). Nao ha falha de resolucao observada.
- TCP: `Test-NetConnection registry.npmjs.org -Port 443 -InformationLevel Detailed` retornou `NameResolutionSucceeded: True`, `TcpTestSucceeded: False`, destino selecionado `104.16.0.34:443`. Foram exibidos avisos de conexao TCP falha para os enderecos IPv4 retornados.
- HTTPS: `curl.exe --verbose --head --max-time 15 https://registry.npmjs.org/supabase`; exit 7. Mensagem completa relevante: `* connect to 104.16.0.34 port 443 from 0.0.0.0 port 49526 failed: Bad access`, repetida para os IPs tentados; `* Failed to connect to registry.npmjs.org:443 after 238 ms: Could not connect to server`; `curl: (7) Failed to connect to registry.npmjs.org:443 after 238 ms: Could not connect to server`. A conexao nao chegou a TLS/HTTP.
- Proxy: verificacao anterior da configuracao npm e nomes de variaveis de ambiente nao encontrou proxy. Busca nos documentos do projeto nao encontrou instrucoes oficiais do administrador para proxy. Nenhum arquivo `.npmrc` foi aberto nem seu conteudo exibido.
- Interpretacao: DNS funciona; o bloqueio ocorre na abertura de socket TCP, antes de TLS, e a mensagem `Bad access` sugere restricao de rede/politica do ambiente atual (ou controle local de rede). As verificacoes nao distinguem conclusivamente uma regra do sandbox de firewall/EDR local. Os documentos tambem registram uma execucao anterior em ambiente com rede autorizada na qual o registry respondeu HTTP 200; assim, nao ha evidência de indisponibilidade geral do registry. O responsavel pela rede/computador deve verificar/liberar egress HTTPS TCP 443 para `registry.npmjs.org` no contexto autorizado, sem desativar controles; nenhuma alteracao foi tentada.
- Nenhuma dependencia/configuracao foi alterada. Supabase CLI continua nao instalada; Supabase remoto nao foi consultado/validado; sincronizacao oficial da pista permanece bloqueada. Etapa encerra aguardando liberacao autorizada de conectividade.

## Etapa 12E - validacao local sem rede (22/10/2026)

### Ferramentas e verificacoes executadas

- `node_modules` presente; `tsc.cmd` e `vite.cmd` locais presentes; CLI Supabase ausente. Scripts conferidos em `package.json`: `test`, `build`, `test:browser`.
- `npm.cmd test`: **PASSOU**, 40/40, exit 0.
- `npx.cmd tsc -b`: **PASSOU**, exit 0.
- `npm.cmd run build`: **FALHOU**, exit 1. A etapa TypeScript do script terminou (Vite iniciou); esbuild/Vite nao conseguiu ler `../..` (`Acesso negado`) e nao resolveu `C:\Users\abreu\Desktop\Connect PDM\vite.config.ts`. Nenhum contorno de permissao/configuracao foi feito.
- `npm.cmd run test:browser`: **FALHOU**, 1 teste, exit 1. A automacao Edge nao iniciou o preview porque o mesmo erro do Vite impediu carregar `vite.config.ts`; fluxo de interface nao foi executado. Nao e evidencia de falha funcional do console.

### Migrations, outbox e recuperacao

- Inventario estatico confirma 14 migrations, em ordem lexicografica/cronologica: 001-009 (`202610210001`-`202610210009`), 010-014 (`202610220010`-`202610220014`).
- Estado remoto individual **DESCONHECIDO**: nao foi consultado. Relatorios anteriores registram 013 e 014 como nao aplicadas; nao ha evidência remota atual para afirmar o estado de todas as 14, portanto nao se lista nenhuma outra como aplicada/pendente confirmada.
- `docs/RPC_PISTA_SEGURA.md` e um contrato proposto, nao uma RPC implementada: derivar `auth.uid()`, papel/parque e estado persistido no banco; lock/versionamento; lista estrita de campos por acao; auditoria atomica/idempotencia; grants minimos. Testes PostgreSQL e implementacao permanecem pendentes.
- Confirmado em `src/db.ts`: `syncTrackOperations` preserva itens e muda `pending` para `blocked`, com motivo explicito; nao chama a RPC e nao os apaga. Migrations 013/014 revogam execucao/DML dos caminhos existentes, mas nao foram aplicadas/validadas remotamente.
- Ha regra de quarentena/bloqueio, mas **nao existe procedimento operacional implementado para reconciliar estados antigos da pista** (comparar estado local/remoto, decidir conflitos com autorizacao e reprocessar sem sobrescrever resultado oficial). O contrato menciona buscar estado canonico e revisao; fluxo de resolucao ainda precisa ser projetado/testado. Nao reativar sync antes disso e dos testes SQL.

### Bloqueios remanescentes

- Acesso HTTPS ao registry npm continua indisponivel neste contexto; a CLI Supabase permanece ausente. Nenhuma tentativa de instalacao nesta etapa.
- Build/automacao browser bloqueados pelo acesso negado do Vite/esbuild ao diretorio pai; validar em terminal/ambiente autorizado sem enfraquecer sandbox, mantendo o projeto no mesmo estado.
- PostgreSQL/Supabase staging nao consultado: aplicacao/grants efetivos de migrations, RPC/RLS, RBAC, isolamento entre parques, concorrencia e sincronizacao continuam nao executados.
- Nao declarar homologacao oficial; pontuacao/desempates continuam sujeitos a aprovacao formal.

## Etapa 12F - diagnostico build e preview de navegador (22/10/2026)

- CWD e raiz efetiva confirmados como `C:\Users\abreu\Desktop\Connect PDM`.
- Leitura local sem alteracao: `package.json` e `vite.config.ts` puderam ser lidos. Vite declarado `^6.0.1`, instalado `6.4.5`; esbuild transitivo instalado `0.25.12`; binarios locais `node_modules/.bin/vite.cmd` e `esbuild.cmd` presentes. Nenhum pacote instalado/atualizado.
- `vite.config.ts` nao declara root relativo, nao usa `../..` e nao configura `configFile` externo. Usa `projectRoot = dirname(fileURLToPath(import.meta.url))`; geracao do service worker escreve sob `dist` no projeto. Nenhuma referencia a caminho pai foi achada na configuracao.
- Teste inofensivo: `Get-Content vite.config.ts` e `fs.readFileSync/realpathSync` resolveram o arquivo em `C:\Users\abreu\Desktop\Connect PDM\vite.config.ts`. Listagem de `..\\..` (que resolve a `C:\Users\abreu`) falhou com `O acesso ao caminho 'C:\Users\abreu' foi negado.`
- Erro completo registrado na execucao anterior do build: `X [ERROR] Cannot read directory "../..": Acesso negado.`; `X [ERROR] Could not resolve "C:\\Users\\abreu\\Desktop\\Connect PDM\\vite.config.ts"`; `failed to load config from C:\Users\abreu\Desktop\Connect PDM\vite.config.ts`; `Error: Build failed with 2 errors: error: Cannot read directory "../..": Acesso negado. error: Could not resolve "C:\\Users\\abreu\\Desktop\\Connect PDM\\vite.config.ts"`. Vite reportou a mesma falha no preview browser. O erro nao e causado por uma referencia `../..` explicita na configuracao; correlaciona com o processo de carregamento/bundling do config do Vite/esbuild sem acesso ao diretorio pai, negado neste sandbox. A causalidade interna exata nao foi provada por trace do esbuild.
- `tests/browser/track-console.test.mjs` cria servidor filho executando `node_modules/vite/bin/vite.js preview` com `cwd` na raiz do projeto, aguarda HTTP 200 em loopback e so depois inicia Edge headless com perfil temporario/CDP local. Portanto, o teste depende do preview funcional; a falha ocorreu antes de abrir a pagina e nao exercitou o fluxo de UI.
- A evidencia apoia restricao do ambiente/sandbox ao acessar o pai, nao erro de caminho configurado. Correcao minima proposta: executar build/preview em terminal autorizado que permita ao processo Vite/esbuild ler o diretorio pai necessario, preservando a configuracao. Nao ampliar ACL nem modificar `vite.config.ts` para contornar o bloqueio sem trace conclusivo.
- Estado dos testes conhecidos nesta etapa: `npm.cmd test` PASSOU 40/40; `npx.cmd tsc -b` PASSOU; build FALHOU no Vite/esbuild; browser FALHOU antes de Edge/UI. Nenhum desses testes foi reexecutado nesta etapa; os resultados sao os da verificacao local anterior.
- CLI Supabase ausente; nenhum acesso remoto. Banco, RLS/RBAC, migration e sync oficiais continuam nao validados/bloqueados.

## Etapa 12G - build em terminal autorizado (22/10/2026)

- **Execucao nao realizada por este agente.** O terminal disponivel continua no contexto restrito que negou leitura de `C:\Users\abreu`; nao ha acesso a uma sessao normal/autorizada do operador nesta execucao. Nao foi feita elevacao de privilegios nem tentativa de contornar ACL/politica.
- Portanto, `npm.cmd run build` e `npm.cmd run test:browser` nesta etapa: **NAO EXECUTADOS**. Nao ha novos exit codes nem mensagens para esses comandos; o resultado anterior segue sendo build FALHOU com `Cannot read directory "../..": Acesso negado` e browser FALHOU antes da abertura do Edge pelo preview Vite.
- Estado local previamente observado (nao reexecutado em 12G): `npm.cmd test` 40/40 PASSOU; `npx.cmd tsc -b` PASSOU. A Etapa 12G requer fechamento posterior na sessao normal do projeto.
- Roteiro para o operador executar em terminal habitual autorizado, sem admin: `Set-Location 'C:\Users\abreu\Desktop\Connect PDM'`; `Get-Location`; `npm.cmd run build`; `npm.cmd run test:browser`. Registrar `$LASTEXITCODE` imediatamente apos cada comando e a saida integral. Declarar browser PASSOU somente com Edge iniciado e fluxo terminado com exit 0. Se ambos passarem, executar `npm.cmd test` e `npx.cmd tsc -b` novamente; se o acesso negado persistir, parar e encaminhar a evidencia ao administrador, sem alterar ACL/politicas.
- Nenhum codigo, dependencia ou configuracao foi alterado; nenhuma operacao Supabase ocorreu. Uso oficial continua bloqueado por validacao real de RLS/RBAC, isolamento entre parques, concorrencia e sincronizacao da pista.

## Etapa 12H - resultados de homologacao local informados pelo operador (22/10/2026)

Os resultados abaixo foram fornecidos pelo operador nesta sessao e registrados como evidencias reportadas; nao foram reexecutados por este agente nesta etapa.

| Verificacao | Resultado reportado | Ressalva |
|---|---|---|
| `npm.cmd run build` | PASSOU, exit 0; Vite 6.4.5, 1.628 modulos, 14,43 s | Aviso de bundle JS principal ~540,91 kB (>500 kB). |
| `npm.cmd run test:browser` | PASSOU, 1/1, Edge 155.0.4283.62 | Evento ficticio; fila, reload do IndexedDB e recuperacao offline local. Um favicon 404 e duas falhas de rede esperadas na simulacao offline. IndexedDB local isolado; outbox remota nao configurada. |
| `npm.cmd test` | PASSOU, 40/40, exit 0 | Evidencia informada pelo operador. |
| `npx.cmd tsc -b` | PASSOU, sem erros reportados | Exit code nao informado separadamente. |

Esta execucao de navegador em terminal do operador supera, para build e preview locais, os resultados bloqueados da Etapa 12G no sandbox. O favicon 404 e as duas falhas de rede ocorreram conforme a ressalva informada e nao invalidam o resultado reportado, mas ficam registradas. Teste local nao comprova sincronizacao remota.

### Pendencias inalteradas

- CLI Supabase nao instalada; estado remoto das migrations nao consultado nesta etapa. Migrations 013 e 014 **nao podem ser consideradas aplicadas** sem evidencia remota atual.
- RPC segura de pista ainda nao implementada/testada em PostgreSQL. Reconciliacao operacional completa dos estados/outboxes antigos ainda ausente.
- RLS/RBAC efetivos, isolamento entre parques, concorrencia e sincronizacao remota seguem pendentes de staging real autorizado.
- Classificacao oficial continua bloqueada pelas regras da comissao; uso oficial permanece bloqueado.
- Nenhuma consulta, login, link, migration, alteracao de codigo/dependencias/configuracao ou dado remoto foi realizada nesta etapa.

## Etapa 13 - preparacao local para conexao Supabase (22/10/2026)

### Verificacoes locais observadas

- Raiz: `C:\Users\abreu\Desktop\Connect PDM`.
- `git status --short` nao pode fornecer estado: `fatal: not a git repository (or any of the parent directories): .git`. A pasta nao contem metadados Git acessiveis.
- Node `v24.21.0`; npm `11.19.0`.
- CLI ausente: `Get-Command supabase` indisponivel; `node_modules/.bin/supabase.cmd`, `node_modules/supabase/package.json` e `node_modules/@supabase/cli/package.json` nao existem; `package.json` nao declara CLI. `supabase --version` nao pode ser executado. `npx.cmd supabase --version` foi intencionalmente nao executado, pois sem CLI local poderia baixar/instalar pacote.
- HTTPS: `curl.exe --head --silent --show-error --max-time 10 https://registry.npmjs.org/` retornou exit 7: `curl: (7) Failed to connect to registry.npmjs.org:443 after 128 ms: Could not connect to server`. A tentativa de instalar continua bloqueada por conectividade do ambiente.
- Nao existe `supabase/config.toml`, `.temp/project-ref` vinculado ou `.npm-cache` local. Ha 14 migrations locais.

### Instalacao proposta, nao executada

Metodo para este projeto: dependencia de desenvolvimento npm, usando cache gravavel local. Comando preparado: `npm.cmd install --save-dev supabase --cache .\\.npm-cache`. Se executado, altera `package.json` e `package-lock.json`; nao foi executado e aguarda autorizacao futura, alem da liberacao HTTPS ao registry. Sem install/login/link.

### Identidade e estado remoto

- Project Ref esperado `ftaxsyrnvbjsncimdmom` e finalidade de staging/teste foram informados pelo responsavel. Nao foram confirmados no Dashboard oficial autenticado nesta sessao; nao deduzir identidade/ambiente do identificador isolado. O operador deve verificar em Dashboard > Project Settings > General o Project ID exato e confirmar nome/finalidade de staging antes de qualquer link.
- Nao houve login, link, consulta remota ou alteracao. Status de migrations remotas permanece DESCONHECIDO; nenhum estado das 14 migrations pode ser inferido desta etapa. Registros anteriores dizem que 013/014 nao foram aplicadas naquele momento, sem consulta atual; nao as considerar aplicadas.
- Sincronizacao oficial da pista permanece bloqueada. Uso oficial continua bloqueado por RPC segura nao implementada/testada, RLS/RBAC, isolamento, concorrencia e sync remota pendentes.

## Etapa 13B - validar CLI local apos instalacao (22/10/2026)

### Instalacao e ferramentas

- A leitura local confirma `supabase` em `devDependencies` no `package.json` (`^2.121.0`) e no lockfile; pacote instalado `2.121.0`, binario local `node_modules/.bin/supabase.cmd` presente. `supabase --version` pelo executavel local reportou `2.121.0`, exit 0, definindo `SUPABASE_TELEMETRY_DISABLED=1` apenas no processo para impedir escrita de telemetria em `%USERPROFILE%`. Sem npx e sem conexao/login.
- `esbuild` instalado `0.25.12`; `node_modules/esbuild/package.json` declara `postinstall: node install.js`. A aprovacao/execucao desse script pendente nao foi alterada. O binario local `node_modules/.bin/esbuild.cmd --version` executou e reportou `0.25.12`, exit 0; isso testa o binario e nao executa `install.js`.
- Na tentativa de `supabase --version` sem opt-out, a CLI tentou criar `%USERPROFILE%\\.supabase\\telemetry.json.tmp...` e recebeu `EPERM`. A documentacao oficial Supabase permite opt-out por `SUPABASE_TELEMETRY_DISABLED=1`; o valor foi definido somente no ambiente daquele comando e removido ao final, sem persistencia de configuracao.

### Validacoes executadas

| Comando | Resultado | Detalhe |
|---|---|---|
| `npm.cmd test` | PASSOU | 40/40, 0 falhas, exit 0. |
| `npx.cmd tsc -b` | PASSOU | Sem saida/erros, exit 0. |
| `npm.cmd run build` | FALHOU | Exit 1; Vite/esbuild: `Cannot read directory "../..": Acesso negado.` e `Could not resolve "C:\\Users\\abreu\\Desktop\\Connect PDM\\vite.config.ts"`. Falha ambiental de leitura ja observada; nao indica falha do postinstall do esbuild, cujo binario executa. Nao ajustar permissoes/configuracao nesta etapa. |

Nao foi executado teste de navegador nesta Etapa 13B, que nao o solicitou. Nenhum script pendente foi aprovado ou executado manualmente; nenhum pacote reinstalado. Nenhum login, link, consulta ou comando remoto Supabase realizado. CLI instalada localmente nao significa conexao remota pronta.

### Pendencias remotas

CLI pode ser usada localmente, mas registry/conectividade, autenticacao, identidade de staging, historico remoto, migrations 013/014 e grants efetivos nao foram consultados. RPC segura permanece sem validacao PostgreSQL; RLS/RBAC, isolamento, concorrencia e sincronizacao da pista continuam pendentes. Uso oficial permanece bloqueado.

## Etapa 14 — arquitetura operacional e provisionamento Connect PDM (22/10/2026)

### Implementação local nesta etapa

- Migration aditiva 202610220015_connect_pdm_operations.sql (15a migration local): parque aceita proprietário opcional, recebe código Connect PDM único e permanente e status administrativo; eventos recebem status operacional. Parques antigos recebem código inicial derivado do UUID persistente. Provisionamento usa o código como chave de negócio e ON CONFLICT DO NOTHING para recuperar sem sobrescrever.
- Cadastro self-service create_park_account foi revogado no banco e removido do fluxo da aplicação. O primeiro administrador da plataforma ainda depende de provisionamento por operador confiável na tabela protegida platform_admins.
- ConnectAdminConsole separa implantação/suporte do Dashboard operacional. Implantação provisiona parque/evento e equipe temporária. Suporte consulta resumo mínimo e auditoria administrativa do parque escolhido. Perfil de plataforma não autoriza inscrições, pagamentos ou resultados; para operar, requer associação operacional independente.
- Acesso administrativo do responsável do parque é opcional. O funcionamento do evento não depende desse painel.
- Equipe temporária individual por evento inclui escritório, locução, julgamento e operador de pista; convite requer email Supabase Auth confirmado, token guardado como hash, revogação e expiração limitada ao término do evento.
- A migration converte memberships operacionais legadas ativas em acesso por evento apenas para eventos ativos que terminam no futuro, preservando linhas e auditoria, e desativa o escopo de parque para não dar acesso a eventos futuros. Convites operacionais ainda não aceitos são revogados. Impacto precisa ser ensaiado e o roster ativo revisado em banco descartável.
- has_event_permission deriva o parque do evento persistido e aplica papel por evento. A interface filtra abas e ações, mas RLS/RPC continuam sendo a fronteira de autorização.
- TrackConsole esconde julgamento de operador de pista e chamadas para julgador. A escrita remota da pista continua bloqueada pelas migrations 013/014; RPC segura nova não foi criada.

### Matriz de autorização implementada no código e proposta no banco

| Perfil | Acesso concedido | Restrições |
|---|---|---|
| Administrador da plataforma | Gestão da plataforma, parques/eventos, equipe Connect e auditoria. | Não ganha dados operacionais de parques sem vínculo operacional independente. |
| Implantação Connect PDM | Provisionar e recuperar parque; editar cadastro; suspender acesso; criar evento; emitir/revogar equipe temporária. | Sem promover outros administradores e sem leitura geral de dados operacionais. |
| Suporte Connect PDM | Resumo mínimo de implantação e auditoria administrativa do parque selecionado. | Sem alteração de cadastro/evento e sem inscrições/pagamentos/resultados. |
| Responsável pelo parque (opcional) | Gestão do próprio parque/eventos conforme associação existente. | Sem privilégios Connect PDM ou globais. |
| Escritório temporário | Ler evento/inscrições, cadastrar/editar inscrição e registrar pagamento permitido. | Sem pista, julgamento, resultado oficial, gestão de usuários ou cancelamento/transferência privilegiados. |
| Locução temporária | Ler evento, inscrições, pista/resultados e classificação já disponível. | Sem escrita, financeiro ou alteração de resultado. |
| Julgador temporário | Ler dados necessários, registrar julgamento e decidir retorno no evento. | Sem confirmação/correção privilegiada, financeiro ou gestão de usuários. |
| Operador de pista temporário | Leitura necessária, fila e controles de rodízio do evento. | Sem julgamento, resultado oficial ou gestão de usuários. |

Os perfis Connect PDM são atribuídos por administrador já provisionado ou operador confiável. Nenhuma alteração de perfil enviada pelo cliente é considerada autorização.

### Resultados desta execução

| Verificação | Resultado |
|---|---|
| npm.cmd test | PASSOU: 46/46, zero falhas, exit 0; inclui seis verificações estáticas novas, não integração SQL. |
| npx.cmd tsc -b | PASSOU: exit 0, sem erros reportados. |
| npm.cmd run build | FALHOU: exit 1; Vite/esbuild: Cannot read directory ../..: Acesso negado e falha ao resolver vite.config.ts. Restrição ambiental observada, sem alteração de ACL/configuração. |
| npm.cmd run test:browser | FALHOU: exit 1 porque Vite preview não iniciou pela mesma falha. Fluxo UI desta alteração não rodou. A evidência anterior do operador antecede estas mudanças. |
| supabase/tests/connect_pdm_operations.test.sql | NÃO EXECUTADO. Não há psql. Docker client 29.8.2 existe, mas docker info exit 1: daemon docker_engine ausente; leitura da configuração do usuário foi negada. |
| git status --short | Indisponível: fatal: not a git repository. |

CLI Supabase local 2.121.0 existe, mas não há supabase/config.toml. Não houve aplicação de migration, conexão, login, consulta ou escrita remota.

### Riscos e bloqueios

- Migration 015, RPC de provisionamento, eventos, convites e controles de perfil foram implementados no código, mas não foram aplicados nem executados em PostgreSQL.
- Os 25 testes pgTAP não substituem execução. Cadeia completa das 15 migrations está BLOQUEADA por falta de PostgreSQL local/Docker.
- RLS/RBAC, privilégios efetivos, conversão de memberships legadas, convite, expiração/revogação e concorrência precisam de ensaio local e staging.
- Build e automação de navegador falharam pelo acesso negado a C:\Users\abreu. Validar em terminal autorizado, sem mudar permissões.
- Usuários offline não conseguem descobrir revogação remota até reconectar. O cache local de acesso dura até uma hora; membership temporária tem expiry filtrado localmente. Sync deverá revalidar autorização e preservar/quarentenar itens não autorizados. Escrita remota da pista permanece bloqueada.
- Reinstalação de um dispositivo recupera estado remoto quando houver backend válido; dados apenas locais dependem de backup e não sobrevivem necessariamente à remoção do navegador/dispositivo.
- Tabela de pontuação/desempates carece de aprovação formal; classificação oficial bloqueada.

Uso oficial permanece bloqueado. Próximo passo técnico: executar cadeia 001–015 e pgTAP em PostgreSQL descartável, inspecionar o roster convertido, depois validar build/navegador. Só depois solicitar autorização específica para staging.


### PostgreSQL local

- Comando npx.cmd supabase test db --local: FALHOU, exit 1. A CLI reportou ECONNREFUSED 127.0.0.1:54322 e orientou iniciar Docker/Supabase local. Nenhuma migration foi aplicada pelo comando. docker info também falha por daemon docker_engine indisponível; psql não existe no PATH.
- O arquivo pgTAP local tem 25 verificações. Resultado permanece BLOQUEADO, não passou nem falhou funcionalmente.



### Ordem de implantação e compatibilidade

A versão web nova tolera RPCs de contexto ausentes para preservar leitura de contas de parque antigas durante uma atualização gradual; essa compatibilidade não fornece os recursos de administração nem o novo RBAC por evento. Segurança server-side do novo fluxo só existe depois de aplicar e validar a migration 015. Antes disso, o backend legado ainda expõe sua RPC antiga de cadastro e permissões amplas para versões antigas do cliente. Não publicar o frontend como se isso corrigisse o servidor, nem liberar operação segura com a migration pendente. Ordem proposta: validar migration em banco descartável, validar staging, aplicar banco autorizado e só então publicar frontend; manter pista bloqueada.
## Etapa 15 — homologação técnica da migration 015 (22/10/2026)

### Inspeção e risco encontrado

- Inventário local: 15 migrations, ordenadas de `202610210001_multi_park.sql` até `202610220015_connect_pdm_operations.sql`. A 015 referencia objetos introduzidos por 001 (`parks`, `events`), 012 (`platform_admins`, `park_memberships`, `park_invitations`, `has_park_permission`) e preserva o bloqueio de escrita da pista estabelecido em 013/014. Não há `supabase/config.toml` local.
- A inspeção do SQL confirma tabelas/RLS para equipe Connect, auditoria e equipe temporária por evento; rotinas de gestão usam `SECURITY DEFINER`, `search_path = ''`, autorização derivada de `auth.uid()` e grants explícitos a `authenticated`. As tabelas temporárias e sequências têm escrita/uso revogados para papéis cliente e `service_role`. Isso é leitura estática, não prova de privilégios efetivos no servidor.
- **Bloqueador de integridade da migration 015:** o bloco final associa cada membership operacional legada ativa a *todos* os eventos ativos e futuros do parque (`join events on park_id`, sem vínculo por evento/equipe), depois desativa a membership ampla do parque. Isso pode conceder acesso a eventos sem evidência de designação. A conversão não foi executada. Não aplicar 015 em base com memberships legadas antes de revisar roster e aprovar mapeamento seguro; não inferir nem converter vínculos ambíguos. Ver `docs/REVISAO_EQUIPE_LEGADA_MIGRATION_015.md`.
- A cadeia 001–015 não foi aplicada em PostgreSQL. A compatibilidade de funções, triggers, constraints, privilégios herdados, RLS e fixtures não foi demonstrada em execução. Testes estáticos não substituem banco real.

### Ferramentas e resultados observados nesta execução

| Comando/verificação | Resultado |
|---|---|
| `Get-Location` | `C:\Users\abreu\Desktop\Connect PDM`. |
| `node --version`; `npm.cmd --version` | Node `v24.21.0`; npm `11.19.0`. |
| `npx.cmd supabase --version` com telemetria desabilitada só no processo | CLI local `2.121.0`. Sem login ou acesso remoto. |
| `docker --version` | Docker CLI `29.8.2`. |
| `docker info` | FALHOU: daemon indisponível em `npipe:////./pipe/docker_engine`; o CLI também não conseguiu ler `C:\Users\abreu\.docker\config.json` (acesso negado). Nenhuma configuração/permissão alterada. |
| `Get-Command psql` / `Test-Path supabase\config.toml` | `psql` ausente; configuração local Supabase ausente. |
| `npx.cmd supabase test db --local` | FALHOU, exit 1: `ECONNREFUSED 127.0.0.1:54322`. Não conectou ao remoto nem aplicou migrations. |
| `npm.cmd test` | PASSOU, exit 0: 46/46. Inclui verificações estáticas; não é teste PostgreSQL. |
| `npx.cmd tsc -b` | PASSOU, exit 0, sem erros reportados. |
| `npm.cmd run build` | FALHOU, exit 1: Vite/esbuild `Cannot read directory "../..": Acesso negado` e não resolveu `C:\Users\abreu\Desktop\Connect PDM\vite.config.ts`. |
| `npm.cmd run test:browser` | FALHOU, exit 1: preview não iniciou pela mesma falha Vite; cenário Edge não executado. |
| Contagem pgTAP | `plan(25)` e 25 asserções `extensions.ok/is`; **0/25 executadas** por falta de PostgreSQL local. |

### Status

- Cadeia 001–015 em PostgreSQL descartável: BLOQUEADO.
- 25 verificações pgTAP: BLOQUEADO, nenhuma executada.
- Conversão de memberships legadas: BLOQUEADO até revisão do mapeamento e decisão sobre vínculos ambíguos.
- Build e navegador: FALHARAM ambientalmente; testes unitários e TypeScript passaram.
- Nenhuma migration aplicada local ou remotamente; nenhuma consulta ou gravação Supabase remota. Escrita remota da pista e classificação oficial continuam bloqueadas.

## Etapa 16 — reconciliacao segura das equipes legadas (22/10/2026)

### Implementado localmente

- A migration historica 015 permanece intacta. Seu bloco final (aprox. linhas 669–679) deriva memberships por parque para todos os eventos ativos/futuros do mesmo parque, sem evidencia pessoa-evento; depois desativa as memberships operacionais legadas e revoga convites operacionais ainda nao aceitos. Nao se presume que 015 esteja pendente em todos os ambientes.
- Nova migration aditiva `202610220016_legacy_staff_reconciliation.sql`: inventario por lote e por candidato pessoa/evento, referencias de origem, classificacao (`proven`, `ambiguous`, `no_destination`), decisao, revisor, timestamps e auditoria append-only. Preparacao nao concede nem revoga acesso. A revisao exige motivo e prova vinculada ao evento; prova interna e invalidada se houver revogacao/auditoria posterior ou vinculo atual inativo. Ativacao exige revisor e ativador distintos, origem imutavel desde o snapshot, parque/evento ativos, papel sem conflito e cria somente vinculo explicitamente aprovado. A repeticao e idempotente.
- Novo diagnostico read-only `supabase/diagnostics/legacy_staff_migration_015_preflight.sql` lista origens legadas sem expor token ou email e marca registros como bloqueadores para aplicacao de 015.
- Novo teste `supabase/tests/legacy_staff_reconciliation.test.sql`: 29 assertions planejadas, com fixtures ficticias para dois eventos no parque A, parque B e fonte sem evento. Inclui retry, atribuicao apenas por evidencia especifica, ambiguidade, ativacao duas pessoas, conflito, isolamento, revogacao posterior e grants diretos negados.
- `tests/onboarding-architecture.test.mjs` verifica a presenca do preflight e restricoes estruturais da preparacao/reconciliacao. Essa cobertura e estatica, nao substitui PostgreSQL.

### Limites de implantacao

- **015 ainda pendente:** migration 016 vem depois e nao pode impedir a execucao anterior da 015. Se o preflight retornar qualquer membership operacional ou convite aberto, bloquear a aplicacao da 015 ate decidir e validar uma estrategia segura numa copia. A migration 015 nao foi editada porque pode ter sido aplicada em ambientes existentes.
- **015 ja aplicada:** 016 nao tenta reconstruir, apagar ou revogar automaticamente concessoes/eventos existentes, pois a procedencia pode ser indistinguivel. Cada novo vinculo exige revisao explicita; memberships legadas e registros de auditoria permanecem intactos.
- `review_document:<id>` e uma referencia sujeita a confirmacao humana fora do banco; o SQL nao valida conteudo externo. O preflight tambem e procedimento de deploy, nao um bloqueio automatico do comando da CLI.
- Migration 016, seguranca efetiva, privilegios, politicas RLS e testes SQL ainda nao executados em PostgreSQL. Migration 015 remota e estado remoto seguem desconhecidos. Nenhuma conexao ou escrita remota foi feita.

### Verificacoes nesta rodada

| Verificacao | Resultado |
|---|---|
| Inventario estatico de 012/015 e da nova migration/fixtures | EXECUTADO por inspecao de arquivos; nao comprova execucao no banco. |
| `npm.cmd test` | PASSOU anteriormente nesta rodada: 49/49, exit 0 (teste estrutural apos ajuste de comentarios). Reexecutar no fechamento desta rodada. |
| `npx.cmd tsc -b` | PASSOU anteriormente, exit 0. Nenhum TypeScript alterado nesta etapa. |
| `npm.cmd run build` | FALHOU, exit 1: Vite/esbuild `Cannot read directory "../..": Acesso negado` e falha ao resolver `vite.config.ts`. Nenhuma ACL alterada. |
| `npm.cmd run test:browser` | FALHOU, exit 1: preview Vite nao iniciou pelo mesmo bloqueio; cenario de navegador nao executado. |
| PostgreSQL/Supabase local e 29 pgTAP | BLOQUEADO: Docker daemon indisponivel, `psql` ausente e porta local 54322 recusou conexao. 0/29 executadas; SQL da migration nao foi validado por parser PostgreSQL. |
| Supabase remoto | NAO EXECUTADO; sem consulta, aplicacao de migration ou escrita remota. |

## Atualizacao da apuracao/classificacao — 23/10/2026

Diagnostico e limitacoes detalhados em `docs/APURACAO_CLASSIFICACAO.md`. O calculo existente somava `RunResult.points` confirmados, confiava em flags editaveis no cliente para aparentar prontidao, ordenava empates pela senha e mostrava posicoes sequenciais na tela. O CSV nao identificava o estado da classificacao e continha dados de pagamento.

A interface agora falha fechada para prontidao oficial, a tela nao mostra posicoes, empates nao usam a senha como criterio e a soma e identificada como provisoria. O CSV administrativo identifica que nao ha apuracao aprovada e que o arquivo e interno; nao e uma publicacao publica. Nenhum registro existente foi apagado e nenhuma migration, credencial ou instancia remota foi alterada.

Pendente: regulamento formal vigente e aprovado, casos de referencia, modelo e autorizacao server-side para aprovar regulamentos/resultados/publicacoes, motor deterministico e homologacao. Estes ajustes de interface/dominio nao permitem uso oficial em competicao real.

A RPC segura de pista segue nao implementada/validada, a RPC antiga permanece suspensa e a escrita remota da pista bloqueada. Classificacao oficial e uso oficial permanecem bloqueados por seguranca remota e decisoes esportivas pendentes.

### Fechamento desta execucao — Etapa 16 (22/10/2026)

Comandos reexecutados em sequencia:

- `npm.cmd test`: exit 0; 49 testes passaram, 0 falharam.
- `npx.cmd tsc -b`: exit 0; sem erros reportados.
- `npm.cmd run build`: exit 1. Erro reproduzivel do Vite/esbuild: `Cannot read directory "../..": Acesso negado.` e `Could not resolve "C:\Users\abreu\Desktop\Connect PDM\vite.config.ts"`. Nenhuma permissao ou configuracao de seguranca foi alterada.
- `npm.cmd run test:browser`: exit 1; Edge nao iniciou o preview porque Vite falhou com os mesmos erros. Nenhum fluxo de navegador executado.
- Conferencia estrutural do pgTAP: `plan(29)` e 29 chamadas de assercao. Isso so confirma a contagem do arquivo; 0 assercoes SQL foram executadas.

O bloqueio do PostgreSQL segue comprovado nesta sessao por tentativa anterior: `supabase test db --local` exit 1 com `ECONNREFUSED 127.0.0.1:54322`; Docker daemon ausente e `psql` nao instalado. A migration 016 e sua cadeia anterior nao foram parseadas/executadas por PostgreSQL. Staging/remoto nao foi acessado.

Limitacao de produto: a Etapa 16 fornece as tabelas e RPCs de inventario/revisao/ativacao no banco, mas nao adiciona uma tela de administracao para conduzir o workflow. A migration precisa ser validada primeiro; depois, a UI Connect PDM deve consumir somente essas RPCs autorizadas e expor revisao/ativacao com confirmacao de dois operadores. Ate la, nao usar SQL ad hoc para conceder memberships.

Esta secao e a fotografia atual da rodada; contagens e referencias a 14/15 migrations em secoes historicas acima pertencem a auditorias anteriores. O estado local atual inclui a migration 016, totalizando 16 arquivos SQL. O historico remoto continua desconhecido.

## Atualizacao de estabilizacao e PostgreSQL local — 22/10/2026

### Correcoes focadas

- A causa do `Cannot read directory "../..": Acesso negado` foi o carregador bundle padrao do Vite/esbuild, que empacotava `vite.config.ts` e tentava acessar o diretório pai fora do escopo permitido. `vite build --configLoader runner` e `vite preview --configLoader runner` passaram a carregar a config com o runner do Vite. Build de produção passou; nenhum ACL ou controle do Windows foi alterado. O runner é experimental no Vite 6.4.5.
- O teste Edge já usa o mesmo loader e o preview iniciou, mas o Edge falhou em `Runtime.enable` após falhas do processo GPU (`GPU process isn't usable`, exit `-1073741790`), erros de criptografia/registro e colisão de cache. O fluxo UI não começou; não desativei sandbox nem contornei políticas do navegador.
- Execução real em PostgreSQL 18 local descartável, iniciado diretamente após `pg_ctl` falhar ao criar token restrito. A instância ouviu somente `127.0.0.1:55433`; não houve conexão ao serviço PostgreSQL existente nem ao Supabase. Com scaffold Auth local (roles `anon`, `authenticated`, `service_role`, `auth.users`/`auth.uid()`), a cadeia 001–016 executou em transação separada por migration.
- Defeitos de SQL encontrados e corrigidos: 012 tinha parêntese ausente na guarda de resultados oficiais; 015 tentava criar policies já existentes e agora as remove idempotentemente; 016 precisava de casts UUID/text/timestamptz explícitos para `NULL` em `UNION ALL`. O teste `connect_pdm_operations.test.sql` tinha três linhas com coluna `revoked_at` sem valor; corrigido. O teste 016 agora estabelece autor antes de criar parques e executa leituras de auditoria/estado com o role adequado.

**Aviso de histórico:** 012 e 015 são arquivos de migration já versionados e foram modificados de modo explícito nesta correção local: a alteração de 012 é apenas sintática; 015 acrescenta uma guarda no início que falha antes de qualquer alteração quando há membership operacional legada ativa ou convite operacional aberto, além de `DROP POLICY IF EXISTS` para políticas criadas em 012. Ambientes que já aplicaram versões anteriores não devem reaplicar essas migrations; revisar histórico e adotar a política de rollout do banco antes de distribuir os arquivos. Nenhuma alteração remota ocorreu.

### Preflight 015

No banco descartável até 014, fixtures fictícias produziram `BLOCK`, `active_memberships=1`, `open_invitations=1`. Executar 015 com `psql --single-transaction` falhou intencionalmente, exit 3, com `Migration 015 blocked: legacy operational access needs review...`; consulta posterior confirmou `connect_code` ausente e uma membership/convite ainda ativos. A proteção agora existe no próprio arquivo 015 e o diagnóstico é válido antes de 015 (não consulta a coluna `operational_status` criada por 015). Casos em ambientes previamente migrados continuam sujeitos à reconciliação 016.

### Migrations e testes SQL

- 16/16 migrations passaram em PostgreSQL 18 descartável com scaffold Auth; não é Supabase local oficial nem staging, e não testa o servidor GoTrue/PostgREST real.
- O PostgreSQL instalado não contém extensão pgTAP. `connect_pdm_operations.test.sql` (25 asserções) e `legacy_staff_reconciliation.test.sql` (29 asserções) foram executados em cópias temporárias idênticas exceto pela remoção da linha `CREATE EXTENSION pgtap`, usando adaptador local de assertions que executa as expressões SQL e reporta contagem/falha. Resultado: 25/25 e 29/29, exit 0. Isto é teste real das funções/tabelas no PostgreSQL local, **não é execução oficial de pgTAP**; `supabase test db --local` continua não executável sem Docker/Supabase CLI local.
- O adaptador e as cópias modificadas foram mantidos somente no diretório temporário e não são parte do projeto.

### Estado de pista e autorização

A interface Connect Admin agora expõe preparação de inventário, revisão com referência/motivo, ativação por segundo operador e auditoria, chamando somente as RPCs da migration 016. Nenhuma etapa concede acesso durante inventário. A interface ainda não foi executada em navegador/backend real. A RPC antiga continua revogada; RPC segura de ações específicas não existe, e a sync remota segue bloqueada. Não liberar classificação oficial sem aprovação de pontuação/desempate.

### Comandos da aplicação nesta rodada

- `npm.cmd run build`: PASSOU, exit 0, Vite 6.4.5, 1629 módulos; bundle principal 562.23 kB, warning acima de 500 kB.
- `npm.cmd test`: PASSOU, 49/49 antes do UI; repetir após as mudanças atuais.
- `npx.cmd tsc -b`: PASSOU antes do UI; repetir após as mudanças atuais.
- `npm.cmd run test:browser`: FALHOU, exit 1 por falha do Edge/GPU; preview local iniciou. Nenhum fluxo UI foi aprovado.
- Supabase remoto: NÃO EXECUTADO. Nenhuma migration, consulta, login ou escrita remota.

## Resultado final de regressao — Etapa 17 (22/10/2026)

| Comando/verificacao | Resultado observado |
|---|---|
| `npm.cmd test` | PASSOU, 50/50, exit 0. |
| `npx.cmd tsc -b` | PASSOU, exit 0. |
| `npm.cmd run build` | PASSOU, exit 0; Vite 6.4.5, 1629 modulos; bundle principal 568.07 kB com aviso (>500 kB). |
| `npm.cmd run test:browser` | FALHOU, exit 1. Preview Vite iniciou; Edge headless encerrou o processo GPU (`GPU process isn't usable`, exit `-1073741790`) e CDP `Runtime.enable` expirou. A pagina e o fluxo nao foram carregados. |
| Cadeia SQL 001–016 | PASSOU, 16/16 migrations no cluster PostgreSQL 18 descartavel com scaffold Auth local; nao e stack Supabase oficial. |
| Testes SQL operations / reconciliation | PASSOU 25/25 e 29/29, respectivamente, no PostgreSQL local real usando adaptador temporario de assertions; pgTAP oficial nao instalado. |
| Preflight/guarda migration 015 | PASSOU cenario negativo: preflight retornou BLOCK para 1 membership + 1 convite; 015 abortou (exit 3) dentro de transacao antes de DDL/DML; apos abortar os dois vinculos permaneciam ativos e `connect_code` nao existia. |
| `npx.cmd supabase test db --local` | BLOQUEADO, exit 1: `ECONNREFUSED 127.0.0.1:54322`; Docker daemon ausente. |
| Supabase remoto | NAO EXECUTADO. Nenhuma leitura ou escrita remota. |

A instalacao PostgreSQL 18 existente nao foi usada. O cluster de validacao foi iniciado diretamente a partir de `%TEMP%` e escutou apenas em loopback; `pg_ctl` falhou por bloqueio de token restrito (nao se tentou contornar esse bloqueio). Depois da validacao, o cluster temporario foi encerrado. A extensao pgTAP real e a implementacao completa de GoTrue/PostgREST continuam pendentes.

### Escopo que ainda bloqueia homologacao

- A interface de reconciliacao foi compilada e coberta estaticamente, mas nao executada em navegador com Auth/backend real.
- RPC segura de pista de acoes especificas ainda nao foi implementada; a RPC antiga segue suspensa e a sincronizacao remota de escrita permanece bloqueada.
- A tabela de pontuacao, desempates e regras esportivas necessarias dependem de aprovacao formal; classificacao oficial bloqueada.
- Sem staging: RLS/RBAC, revogacao real, isolamento remoto, concorrencia e outbox nao foram validados contra Supabase.
- Backup/restauracao entre dispositivos e atualizacao/rollback remotos nao foram exercitados.

Portanto, build e testes locais de aplicacao passaram, mas navegador/Edge e homologacao Supabase continuam bloqueados. Uso oficial/producao NAO aprovado.


## Rodada focada em RPC da pista e homologacao local — 22/10/2026

### Resultado da revisao do estado canonico

- `202610220011_track_console.sql` armazena o estado completo da pista em `event_track_states.state` (JSONB), e o log `event_track_operations` conserva tambem o snapshot integral. `apply_event_track_operation` recebe `p_state` do cliente e o ator textual `p_actor_label`; apesar das verificacoes de versao e historico, a transicao e montada pelo cliente.
- `202610220013_suspend_unvalidated_track_rpc.sql` revoga EXECUTE da RPC antiga para `PUBLIC`, `anon` e `authenticated` e revoga DML direto de pista para papeis cliente. `202610220014_track_service_role_stop.sql` revoga a funcao e DML direto tambem para `service_role`. A funcao antiga continua suspensa; nenhuma reativacao foi feita.
- `CompetitionConfig` exige dias, rodizios, intervalos/capacidade, ordem de chamada e prazo. O caminho remoto de criacao/edicao em `src/db.ts` envia `EventConfig.rules` e outros campos, mas nao persiste `EventConfig.competition`. A pista e a outbox ficam localmente como `TrackState`/acao; a sincronizacao remota marca operacoes como bloqueadas e preserva registros.
- Nao existe fonte remota canonica validada para a configuracao operacional nem modelo relacional remoto de chamadas, corridas, retornos e resultados. Portanto, nao foi criada uma RPC parcial: qualquer acao depende de configuracao/estado ainda nao autoritativos no banco. A implementacao segura requer migration aditiva para configuracao canonica e entidades/acoes ou contrato transacional equivalente, reconciliacao dos snapshots existentes, RPCs por transicao e testes SQL positivos/negativos. Nenhuma regra esportiva foi alterada.

### Ambiente e execucoes desta rodada

| Verificacao | Resultado observado |
|---|---|
| `npm.cmd test` | PASSOU, 50/50, exit 0. |
| `npx.cmd tsc -b` | PASSOU, exit 0, sem diagnosticos. |
| `npm.cmd run build` | PASSOU, exit 0; Vite 6.4.5, 1629 modulos, bundle principal 568.07 kB (aviso acima de 500 kB). |
| `npm.cmd run test:browser` | FALHOU, exit 1; Edge nao carregou a pagina. CDP expirou em `Runtime.enable` apos 43,65 s. Logs: `GPU process isn't usable` (exit `-1073741790`), falha ao abrir chave `EdgeUpdate` (resultado 5), criptografia Windows indisponivel e cache GPU em uso. URL era loopback `127.0.0.1`; preview Vite iniciou; console e requisicoes da pagina ficaram vazios. Nenhuma flag de seguranca foi enfraquecida e nenhum processo Edge preexistente foi encerrado. |
| Docker/Supabase local | BLOQUEADO. `docker info --format '{{.ServerVersion}}'` exit 1: nao foi possivel abrir `npipe:////./pipe/docker_engine`; tambem houve `Acesso negado` ao ler `C:\Users\abreu\.docker\config.json`. A extensao pgTAP nao existe em `C:\Program Files\PostgreSQL\18\share\extension\pgtap.control`. |
| PostgreSQL local | Binarios PostgreSQL 18 presentes (`psql 18.6`, `postgres.exe`, `initdb.exe`, `pg_ctl.exe`). Nenhuma cadeia foi reexecutada nesta rodada, pois nao houve alteracao SQL; os resultados anteriores da cadeia 001-016 e das assercoes via adaptador permanecem conforme registro abaixo e nao equivalem ao Supabase local/pgTAP oficial. |
| Supabase remoto | NAO EXECUTADO. Sem login, consulta, migration ou escrita remota. |

### Integridade, backup e bloqueios

- A cadeia local tem 16 migrations, terminando em `202610220016_legacy_staff_reconciliation.sql`. As correcoes locais nas migrations historicas 012 e 015, e a guarda fail-closed da 015, permanecem documentadas em `REVISAO_EQUIPE_LEGADA_MIGRATION_015.md`. Antes de qualquer deploy, inspecionar o historico real de cada ambiente; nao reparar ou reexecutar versoes sem determinar se 012/015 originais ou corrigidas ja foram aplicadas. O preflight 015 deve ser executado em copia descartavel antes de qualquer plano que ainda tenha 015 pendente.
- `COORDENADOR_LOCAL.md` orienta parar o coordenador ou usar backup SQLite consistente incluindo WAL/SHM e validar health/snapshot apos restauracao. Nenhum backup/restauracao real foi executado nesta rodada; nao declarar recuperacao testada.
- **PASSOU:** testes unitarios, TypeScript e build locais.
- **FALHOU:** inicializacao automatizada do Edge antes do carregamento da aplicacao.
- **BLOQUEADO:** stack Supabase local oficial/pgTAP pelo daemon Docker indisponivel; implementacao/teste PostgreSQL de RPC segura; validacao browser de Connect Admin; recuperacao real de backup; RLS/RBAC, concorrencia e sincronizacao em staging.
- **PENDENTE DE DECISAO HUMANA:** aprovacao da configuracao canonica do evento, unidade de distancia, tabela de pontos, desempates e criterios de classificacao/retorno ainda nao definidos pelo regulamento confirmado.
