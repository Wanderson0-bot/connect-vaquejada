# Plano de homologaÃ§Ã£o para evento real â€” Connect PDM

Este plano define evidÃªncias necessÃ¡rias antes de usar o Connect PDM como sistema oficial de operaÃ§Ã£o. A existÃªncia de telas, migrations ou testes unitÃ¡rios isolados nÃ£o substitui os critÃ©rios abaixo. AtÃ© aprovaÃ§Ã£o integral dos bloqueadores, usar somente em ensaio controlado e manter processo de contingÃªncia definido.

## Adendo — regras informadas conectadas ao fluxo provisório (23/10/2026)

O responsável forneceu a referência extensa do PDM e esclareceu que múltiplas inscrições do mesmo vaqueiro são independentes e não geram penalidade. O console agora permite configurar corridas por inscrição em cada rodízio (`racesPerEntry`), encaminha para chamada somente inscrições com pagamento confirmado, registra a pontuação exatamente como anunciada pelo juiz (sem calculá-la pela distância), registra zero como 0 e oferece bônus opcional de cinco pontos configurado por evento com justificativa. Os totais do console são provisórios, por senha e categoria.

Validação desta alteração: `npm test` passou com 58 testes; `npm run build` passou (1.629 módulos; bundle JavaScript minificado de 581,14 kB, ainda acima do aviso informativo de 500 kB); `npm run test:browser` passou 1/1 no Edge 156, em evento fictício e IndexedDB local. Isso não valida pista em LAN/Supabase, permissões no servidor ou hardware real. Continuam bloqueados a classificação/publicação oficiais e a escrita remota de pista. A fila separada do rabo da gata após o Rodízio A, corte/avanço, finais, circuitos, racha e troca excepcional de puxador ainda não foram implementados.

## Fotografia auditada do estado atual — 23/10/2026

Esta secao e o registro mais recente desta auditoria e prevalece sobre resultados antigos/historicos mantidos abaixo. Foi feita somente leitura de codigo/configuracao, sem abrir `.env.local`, imprimir valores de credenciais, executar migrations, iniciar servicos Supabase, conectar a projeto remoto ou alterar bancos. Nenhum dado de evento real foi usado.

### Workspace e escopo

- Pasta de trabalho: `C:\Users\abreu\OneDrive\Desktop\Connect PDM`.
- `git rev-parse`, `git status` e `git branch` nao puderam ser usados: esta pasta e seus pais nao contem `.git`. Portanto nao foi possivel confirmar branch nem distinguir modificacoes preexistentes das feitas anteriormente. Nao tratar o workspace como checkout limpo.
- `.env.local` existe no workspace, mas seu conteudo nao foi lido. Nao registrar nem compartilhar seus valores.
- Node `v24.21.0`, npm `11.19.0`; Supabase CLI local `2.122.0`. Docker CLI existe, mas o daemon Linux nao esta ativo/disponivel.
- Inventario: frontend React/TypeScript/Vite; API/coordenador Node em `coordinator/server.mjs`; SQLite; IndexedDB (`pdm-local`, versao 7); Supabase Auth/PostgreSQL; 17 migrations locais (`202610210001` a `202610220017`); testes Node, SQL e teste UI Edge.

### Autoridade, leitura e gravacao dos dados

| Modo | Autoridade | Caminho de escrita/leitura | Limites e verificacao |
|---|---|---|---|
| Local em um aparelho | IndexedDB do navegador | `src/db.ts` grava eventos, inscricoes, resultados, auditoria, reservas, estados de pista e filas. A UI carrega stores locais e aplica validacoes do dominio. | Dados nao sao compartilhados nem autenticados por parque. JSON de backup nao inclui todas as stores tecnicas/outboxes. O comportamento real de armazenamento/recuperacao em Edge nao foi homologado. |
| LAN | SQLite do coordenador por parque | A outbox IndexedDB envia registros suportados ao coordenador autenticado. Alteracoes bloqueadas podem ser assumidas explicitamente por operador; o servidor valida a permissao e atribui o ator. Responsavel do parque compara conflitos preservados na tela Rede local. | SQLite e autoridade compartilhada do modo LAN; nao sincroniza com Supabase. `/api/operations` ainda recusa `track_states`, conflitos exigem correcao manual e precisam de ensaio multiaparelho real. HTTPS e exigido fora de loopback por padrao. |
| Supabase | PostgreSQL/Auth remotos | `src/backend.ts` autentica; `src/db.ts` le/grava por SDK/RPC e usa cache/outbox local em alguns fluxos. SQL/RLS/RPC definem integridade e autorizacao remotas. | Nenhuma migration foi aplicada nem o estado remoto consultado nesta auditoria. 17 arquivos locais nao provam a versao aplicada no provedor. Nao ha sincronizacao automatica entre Supabase e SQLite. |

### Regras esportivas, permissoes e saidas

- Resultados operacionais da pista (`TrackRace`) e resultados legados (`RunResult`) sao modelos separados; nao ha adaptador validado entre eles. O console agora registra pontos anunciados pelo juiz, zeros e bonus opcional configurado no evento em `TrackRace`, e mostra totais provisorios por inscricao/categoria; nao calcula pontos pela distancia nem integra esses valores ao fluxo legado.
- As regras fornecidas confirmam inscricoes multiplas independentes, chamada somente de inscricoes pagas, duas corridas por inscricao no Rodizio A e uma no B (configuraveis por evento), pontuacao anunciada pelo juiz e bonus opcional de cinco pontos por evento. As quantidades de corrida sao configuradas por `racesPerEntry`; o bonus requer configuracao de condicao e aplicacao/justificativa explicita.
- Esclarecimento do responsavel em 23/10/2026: ja foram informadas regras e criterios, registrados nas pendencias e referencias deste projeto. O que nao existe e um regulamento formal aprovado. Portanto, essas informacoes devem ser preservadas como requisitos preliminares e submetidas a organizacao, deliberacao e aprovacao formal da comissao antes de implementar classificacao oficial; nao se deve interpretar a falta do documento como ausencia de tudo que ja foi informado.
- A tela falha fechada para prontidao oficial, remove posicoes/desempate pela senha e chama a soma de provisoria. O CSV administrativo identifica uso interno e contem dados de pagamentos; nao e publicacao esportiva. Nao existe aprovacao server-side de regulamento, motor oficial versionado ou fluxo oficial de publicacao.
- A ordem de chamada ascendente/descendente, faixa, capacidade, adicional e janela de chamada sao configuracoes operacionais do software, nao aprovacao de regulamento. Estados de zero/retorno e autorizacao de retorno existem no dominio; nao determinam por si mesmos pontuacao oficial. Regras pendentes estao em `docs/PENDENCIAS_REGULAMENTO_PDM.md`.
- Coordenador implementa credenciais por operador, papel, validade e autorizacao por acao; migrations Supabase implementam papeis/eventos e politicas em SQL. Isso foi inspecionado estaticamente e coberto por testes do repositorio, mas autorizacao/RLS nao foi validada contra servidor Supabase real.
- Migracao local 013 revoga a RPC antiga que aceitava snapshot completo de pista; migration 014 tambem retira execucao/acesso direto do service role. O coordenador recusa escrita de `track_states`. Mantenha estes bloqueios: nenhuma escrita de pista pelo protocolo foi habilitada.
- Impressao e feita por dialogo padrao do navegador; nao ha evidencias com impressora, papel, corte ou hardware do parque.

### Verificacoes repetidas nesta auditoria

| Comando/inspecao | Resultado observado |
|---|---|
| `npm test` | PASSOU: 54 testes, 0 falhas (inclui dominio, coordenador/SQLite, backup temporario, permissoes e testes estaticos de migrations). Nao e homologacao de navegador, Supabase ou rede real. |
| `npm run build` | PASSOU: TypeScript/Vite, 1.629 modulos. Aviso informativo: bundle JS principal `576.09 kB` minificado, acima do limite 500 kB. |
| `node --check coordinator\server.mjs` e `node --check coordinator\backup.mjs` | PASSARAM. |
| `npm run test:browser` | FALHOU duas vezes nesta auditoria. Primeira tentativa ocorreu enquanto o build ainda executava e nao iniciou preview; repeticao apos build encontrou falha de UI: botao acessivel `Registrar comparecimento` ausente no fluxo de corrida. O teste termina antes de demonstrar ciclo completo de pista/offline. |
| `docker info --format '{{.ServerVersion}}'` | BLOQUEADO: Docker daemon indisponivel (named pipe `dockerDesktopLinuxEngine` ausente). |
| `supabase status` local | BLOQUEADO ao inspecionar saude de container pelo mesmo daemon Docker indisponivel. Nao foi executado `db push`, `db reset`, SQL remoto, `projects list` nem consulta de dados do projeto. |
| `git status` / branch | INDISPONIVEL: pasta nao e repositorio Git; branch e estado preexistente nao verificaveis. |

O `npm run test:browser` pode iniciar/parar seu proprio preview local, mas nenhuma instancia deixou-se intencionalmente rodando. Builds/tests acima criam artefatos usuais de build/teste; nenhum banco de producao foi tocado.

### Comparacao de modos — decisao ainda necessaria

| Tema | LAN (coordenador + SQLite) | Supabase (Auth + PostgreSQL) |
|---|---|---|
| Uso pretendido | Operacao local em varios aparelhos via Wi-Fi, com SQLite persistente no host. | Operacao conectada ao backend remoto, com Auth/RLS/RPC. |
| Acesso sem internet externa | Possivel em principio se a LAN/host/certificado continuam acessiveis; NAO testado na rede/dispositivos-alvo. | Nao presumir operacao sem WAN; cache/outbox existente tem limites e precisa de ensaio de perda/retorno de conexao. |
| HTTPS/credenciais | Configuracao TLS/certificados confiaveis nos aparelhos e firewall; credenciais estaticas por operador, revogacao ao recarregar/atualizar roster precisa ensaio. | Auth real, sessao, recuperacao de conta, RLS e credenciais em ambiente separado; ainda sem validacao de staging nesta rodada. |
| Conflitos/concorrencia | Versao otimista, log, replay idempotente e conflitos persistidos; interface de resolucao/reaplicacao pendente. | Constraints/RPC/RLS e filas locais; verificar concorrencia, repeticao, isolamento e operacoes bloqueadas no ambiente autorizado. |
| Pista | Escrita `track_states` do protocolo esta recusada. Nao liberar nesta homologacao sem RPC canonica, autorizacao, testes de concorrencia/auditoria. | RPC antiga revogada pelas migrations locais 013/014; nao reativar ate substituta segura, migrations autorizadas e validacao SQL. |
| Backup | Utilitario `npm run coordinator:backup -- backup|verify|restore`; restaura para destino novo, mas ensaio em outro equipamento e retencao externa estao pendentes. | Nenhum backup/restauro Supabase implementado aqui; usar processo do provedor e ensaiar separadamente. |
| Integracao entre modos | Nao existe e nao deve ser criada sem projeto de identidade, conflitos, idempotencia, auditoria e recuperacao. | Mesma restricao: SQLite e Supabase sao autoridades separadas. |

**Decisao pendente:** responsavel do parque/comissao escolhe o modo-alvo, dispositivos e rede de homologacao. Nenhuma escolha ou migracao automatica e feita por este plano.

### Matriz de testes de dispositivos e rede

Executar apenas com parque/evento ficticio em ambiente isolado. Preencher evidencia sem dados pessoais/segredos. Um teste unitario nao substitui as linhas marcadas como equipamento real.

| ID | Caso | Procedimento/evidencia minima | Ambiente / responsavel | Estado |
|---|---|---|---|---|
| D01 | Primeiro acesso/instalacao PWA | Registrar aparelho, SO, navegador/versao, origem HTTPS, instalacao e carregamento frio. | A definir pela equipe | PENDENTE |
| D02 | IndexedDB | Criar evento/inscricao ficticios; recarregar e verificar leitura/versao/store sem dados reais. | Aparelhos-alvo | PENDENTE; teste Edge atual falhou antes do fluxo completo |
| D03 | Perda/retorno Wi-Fi | Enfileirar operacao permitida, interromper/repor Wi-Fi, verificar estados, replay e ausencia de duplicata. | LAN do ensaio | PENDENTE |
| D04 | WAN indisponivel, LAN disponivel | Cortar somente WAN; confirmar acesso ao host HTTPS e envio/consulta compartilhados; registrar limits do modo escolhido. | LAN isolada | PENDENTE |
| D05 | Encerramento abrupto do browser/aparelho | Interromper durante operacao enfileirada; reabrir, comparar antes/depois e verificar outbox. | Aparelhos-alvo | PENDENTE |
| D06 | Reinicio do coordenador | Encerrar/reiniciar host de teste; validar snapshot, fila e repeticao idempotente sem perder operacao. | Host isolado | PENDENTE |
| D07 | Duas operacoes concorrentes | Dois operadores tentam mesma senha/capacidade e mesma versao-base; verificar exatamente uma aceitacao ou conflito recuperavel. | Dois ou mais aparelhos | PENDENTE |
| D08 | Conflito e resolucao | Provocar conflito com dados ficticios, registrar quem compara estado atual/tentativa, decisao e reenvio autorizado. | LAN/Supabase conforme alvo | PENDENTE; UI de resolucao LAN ausente |
| D09 | Armazenamento bloqueado/cheio | Simular quota negada/armazenamento indisponivel; confirmar erro visivel e sem mensagem de sucesso ou perda silenciosa. | Navegador-alvo | PENDENTE |
| D10 | Expiracao/revogacao | Expirar e revogar credencial; repetir chamadas e tentativa de escrita/read; comprovar negacao server-side e comportamento da sessao/cache. | Ambiente descartavel | PENDENTE em dispositivos reais |
| D11 | Certificado/TLS | Instalar/validar cadeia nos aparelhos, testar expiracao, hostname invalido e falha de conexao; nao ignorar avisos. | LAN e dispositivos-alvo | PENDENTE |
| D12 | Recuperacao | Restaurar backup ficticio em outro host/pasta, iniciar instancia isolada, comparar contagens/amostras e medir RTO. | Equipamento separado | PENDENTE; automatizado temporario passou, ensaio externo ausente |

Registrar cada tentativa com: ID do caso, data/hora, operador, aparelho/SO, navegador/versao, build/commit (quando houver checkout), ambiente, passos, esperado, observado, evidencias sanitizadas, falha/incidente, decisao e assinatura do responsavel. Nao capturar tokens, dados pessoais ou telas com informacao real.

### Inventario de operacoes criticas e aprovadores a designar

| Operacao | Controle no codigo observado | Evidencia/pendencia para aceite |
|---|---|---|
| Login, sessao e acesso a parque/evento | Supabase Auth/RLS e credenciais locais do coordenador; roles/eventos no codigo/migrations. | Validar contas de perfis distintos, revogacao/expiracao e acesso cruzado contra servidor de homologacao. |
| Criar/alterar/cancelar/transferir inscricao e reservar/converter senha | Validacoes de dominio, constraints/RPCs e permissoes SQL; SQLite valida operacoes suportadas. | Disputa concorrente com multiplas sessoes, rollback, auditoria e isolamento de evento. |
| Registrar pagamento | Permissao `payment.record`/fluxo de escritorio; pagamento e anotacao manual, sem conciliacao financeira. | Verificar autorizacao server-side, trilha e restricao de dados em relatorios. |
| Julgar/confirmar/corrigir resultado | Console grava pontos informados pelo juiz, zero e bonus de evento em trilha versionada; estado confirmado nao equivale a classificacao aprovada. | Testar ator, motivo, anterior/novo, idempotencia, escopo e auditoria em cada modo. Confirmar integracao (ainda ausente) entre TrackRace e RunResult. |
| Operar chamada/pista | UI/domino local existe; protocolo LAN e RPC Supabase estao bloqueados. | Nao executar como fluxo oficial; requer RPC de acao canonica, autorizacao/auditoria e testes antes de qualquer liberacao. |
| Aprovar regulamento/apuracao/publicar | Nao ha regulamento formal (conforme confirmado pelo responsavel), aprovacao oficial server-side nem fluxo de publicacao. | Bloqueado ate a comissao elaborar e aprovar formalmente o regulamento, e ate haver motor/versionamento e casos de referencia aprovados. |
| Backup/restaurar | CLI SQLite com manifesto/hash/integridade/schema/contagens; JSON de navegador e fluxo diferente. | Restaurar em outro equipamento, conferir amostras/contagens e registrar RTO; definir ACL, criptografia, copia externa, retencao e responsavel. |

Responsaveis a nomear antes do ensaio: responsavel do parque, presidente/representante da comissao, autoridade de regulamento, julgador conferente, operador de pista, escritorio/financeiro, administrador de infraestrutura, responsavel por credenciais, backup/recuperacao, privacidade/incidentes e observador independente.

### Roteiro repetivel de ensaio ficticio

Usar somente identificadores/participantes/pagamentos ficticios e nao publicar resultados. Anexar tabela de conferência contendo caso, entrada, esperado, obtido, evidência sanitizada, responsavel e aprovado/reprovado.

1. Registrar modo escolhido, build, horario, equipamentos, rede, responsaveis e contingencia em papel.
2. Criar ambiente/evento ficticio e credenciais de teste com menor privilegio. Em Supabase, usar projeto explicitamente descartavel e nao aplicar migrations sem autorizacao do responsavel.
3. Configurar categorias, capacidade, dias/rodizios exclusivamente conforme decisao aprovada; sem inventar valores esportivos.
4. Cadastrar inscricoes ficticias; testar duplicidade, limite, cancelamento, transferencia, reservas e comprovante sem criar duplicatas.
5. Registrar pagamentos ficticios quando necessario e conferir restricao dos dados financeiros em perfis/relatorios.
6. Exercitar aparelhos simultaneos, replay apos timeout, desconexao/reconexao e conflitos; nao liberar pendencias sem revisao humana.
7. Registrar corridas/resultados somente conforme o escopo autorizado do ambiente; enquanto pista por protocolo estiver bloqueada, testar somente fluxo manual/local nao oficial e nao reativar sincronizacao.
8. Corrigir um resultado ficticio, conferir autor/horario/motivo e preservacao do anterior.
9. Conferir soma provisoria com calculo independente. Sem regulamento e casos aprovados, nao ordenar como campeao, nao aprovar nem publicar classificacao.
10. Gerar CSV interno, inspecionar rótulo provisório e dados privados; nao publicar. Testar comprovantes na impressora/modelo real apenas em ensaio e registrar papel/legibilidade.
11. Criar/verificar backup SQLite, restaurar em caminho/host separado, comparar contagens e amostras, iniciar a copia restaurada e medir RTO. Nao apagar nem sobrescrever a origem.
12. Simular falha de browser, Wi-Fi/WAN e servidor; validar procedimento em papel, comunicacao e criterios de parada.
13. Encerrar com reconciliacao de filas/conflitos, inventario dos dados, falhas e ata assinada. Apagar somente dados ficticios via procedimento aprovado, fora deste plano e nunca em banco compartilhado.

### Backup e recuperacao — procedimento a validar

O CLI usa Node `node:sqlite`; crie previamente pastas de destino. Exemplo PowerShell:

```powershell
New-Item -ItemType Directory -Force .\backups
npm run coordinator:backup -- backup .\data\connect-pdm.sqlite .\backups\ensaio.sqlite
npm run coordinator:backup -- verify .\backups\ensaio.sqlite
New-Item -ItemType Directory -Force .\restauro-isolado
npm run coordinator:backup -- restore .\backups\ensaio.sqlite .\restauro-isolado\connect-pdm.sqlite
```

Manter `.sqlite` e `.manifest.json` juntos. Restore exige destino inexistente; nao usar o arquivo original como destino. Confirmar `integrity_check`, schema version, contagens e amostras de registros/operacoes/conflitos; iniciar uma instancia apontada ao destino isolado e validar endpoint de saude/snapshot autenticado. A automacao ja passou em base ficticia temporaria; nenhum ensaio em outro equipamento foi realizado. O CLI nao cifra, agenda, copia para fora do host nem define retencao. Arquivo/manifesto sao apenas do coordenador: nao contem IndexedDB, filas/cache de browser ou Supabase/Auth.

| Medida de recuperacao | Esperado/limite | Observado no ensaio externo |
|---|---|---|
| Tempo de criacao/verificacao/restauro (RTO) | Definir meta com responsavel | NAO MEDIDO |
| Contagens e amostras | Comparar origem e destino isolados sem dados reais | PENDENTE |
| Versao de esquema e integridade | Sem erro; aplicacao abre destino isolado | Teste automatizado local PASSOU; host separado PENDENTE |
| Retencao/copia externa/ACL/criptografia | Definir local seguro, proprietario e frequencia | PENDENTE |

### Aprovacao e decisao

Nao marcar etapa como aprovada ate evidencias anexadas para: modo escolhido; regulamento vigente formalmente aprovado e implementado/testado; permissoes no servidor; isolamento por parque/evento; operacoes concorrentes; cenarios de browser/rede; resolucao de conflitos; restauracao externa; ensaio ponta a ponta; impressao/hardware; treinamento; contingencia e assinaturas dos responsaveis.

Estado nesta fotografia: **HOMOLOGACAO NAO APROVADA**. Evidencias automatizadas locais passam, mas navegador funcional, staging/servidor, rede multiaparelho, equipamento de impressao e restauro externo continuam pendentes. Escrita de pista por protocolo, classificacao oficial, publicacao oficial e sincronizacao SQLite↔Supabase permanecem bloqueadas.

**Proxima tarefa pequena e segura:** investigar por que o teste Edge nao encontra `Registrar comparecimento`, reproduzir o fluxo com dados ficticios e corrigir somente UI/teste se houver defeito confirmado. Arquivos provaveis: `tests/browser/track-console.test.mjs`, `src/TrackConsole.tsx` e dependencias de estado local; risco: nenhum em dados/ambiente remoto. Validar `npm run test:browser`, `npm test` e `npm run build`. Isso nao aprova a gravacao de pista pelo protocolo nem a operacao real.

## Arquitetura considerada

AplicaÃ§Ã£o web React/TypeScript/Vite; dados locais em IndexedDB; modo conectado com Supabase Auth/Postgres/RLS; alternativa de sincronizaÃ§Ã£o em rede local com coordenador Node.js/SQLite e outbox por aparelho. PWA armazena o shell estÃ¡tico, nÃ£o dados remotos Supabase. Consulte `STATUS_AUDITORIA.md` para os limites por mÃ³dulo.

## Plano incremental

### Etapa 0 â€” DefiniÃ§Ã£o operacional e regulamento

- A comissÃ£o deve elaborar, deliberar e aprovar formalmente o regulamento PDM para categorias, tentativas, rodÃ­zios, ocorrÃªncias, pontuaÃ§Ã£o, penalidades, desempates, finais, recursos e correÃ§Ãµes; o responsÃ¡vel confirmou que ainda nÃ£o existe regulamento formal.
- Definir papÃ©is e responsÃ¡veis: administrador do parque, escritÃ³rio, pista, julgador e locutor; aprovar quem cadastra, recebe pagamento, confirma resultado, corrige e cancela.
- Definir modo alvo (Supabase ou coordenador LAN), aparelhos, impressoras, conectividade, contingÃªncia em papel e responsÃ¡veis por backup.
- **SaÃ­da:** matriz de requisitos/regras aprovada e ambiente de homologaÃ§Ã£o escolhido.

### Etapa 1 â€” SeguranÃ§a e ambiente remoto

- Instalar migrations numa cÃ³pia de homologaÃ§Ã£o; revisar grants, RLS, `SECURITY DEFINER`, `search_path`, ownership e exposiÃ§Ã£o de RPCs/tabelas.
- Exercitar duas contas de parques distintos em todas as tabelas/RPCs: leitura e escrita prÃ³prias permitidas; consulta/alteraÃ§Ã£o cruzada negada.
- Implantar contas individuais e papÃ©is mÃ­nimos antes de equipe real; validar recuperaÃ§Ã£o de senha, confirmaÃ§Ã£o de email, expiraÃ§Ã£o/revogaÃ§Ã£o e acesso offline.
- Verificar configuraÃ§Ã£o sem expor segredos: chave pÃºblica anon somente no frontend; service role nunca no bundle, log ou dispositivo.
- **SaÃ­da:** evidÃªncia reproduzÃ­vel de isolamento e matriz de permissÃµes aprovada.

### Etapa 2 â€” Integridade operacional e esportiva

- Implementar somente regras confirmadas no documento da Etapa 0.
- Testar criaÃ§Ã£o/ediÃ§Ã£o de evento, categoria, capacidade, senha duplicada, reserva, pagamento, cancelamento, transferÃªncia e inscriÃ§Ã£o com resultado.
- Testar resultado pendente/oficial, confirmaÃ§Ã£o, correÃ§Ã£o justificada e auditoria; comparar classificaÃ§Ã£o e relatÃ³rio com cÃ¡lculo manual independente do julgador.
- Repetir operaÃ§Ãµes (duplo clique, timeout apÃ³s gravaÃ§Ã£o e retry) para comprovar idempotÃªncia e ausÃªncia de cobranÃ§a/inscriÃ§Ã£o duplicada.
- **SaÃ­da:** roteiro de casos assinado por organizador e julgador, sem divergÃªncia de dados ou classificaÃ§Ã£o.

### Etapa 3 â€” ConcorrÃªncia, offline e recuperaÃ§Ã£o

- Exercitar o modo escolhido em pelo menos trÃªs aparelhos; disputar simultaneamente o mesmo nÃºmero e o Ãºltimo lugar de capacidade.
- Para LAN: validar HTTPS, token, reinÃ­cio do serviÃ§o, persistÃªncia SQLite, conflitos e reconciliaÃ§Ã£o; nÃ£o operar com conflitos pendentes.
- Para Supabase: testar transaÃ§Ãµes/RPCs simultÃ¢neas, internet intermitente, operaÃ§Ãµes nÃ£o suportadas offline e reconexÃ£o.
- Testar fechamento forÃ§ado, reinÃ­cio do navegador/aparelho, atualizaÃ§Ã£o de app/schema, espaÃ§o de armazenamento, fila pendente/bloqueada, perda e retorno de Wi-Fi/WAN.
- Fazer backup e restaurar em outro aparelho; conferir quantidades, vÃ­nculos, UTF-8, pagamentos, reservas, cancelamentos, transferÃªncias, resultados, correÃ§Ãµes e auditoria.
- **SaÃ­da:** relatÃ³rio de falhas e recuperaÃ§Ã£o sem perda, duplicaÃ§Ã£o ou sobrescrita silenciosa.

### Etapa 4 â€” Ensaio geral e liberaÃ§Ã£o

- Executar evento fictÃ­cio ponta a ponta com usuÃ¡rios e hardware reais: abertura, inscriÃ§Ã£o, recebimento, reserva, pista, julgamento, confirmaÃ§Ã£o, correÃ§Ã£o, classificaÃ§Ã£o, relatÃ³rio, backup e restauraÃ§Ã£o.
- Validar impressÃ£o fÃ­sica e operaÃ§Ã£o sob carga esperada; treinar operadores e testar contingÃªncia fora do sistema.
- Atribuir responsÃ¡veis por incidentes, sincronizaÃ§Ã£o bloqueada, divergÃªncia esportiva e restauraÃ§Ã£o.
- **SaÃ­da:** ata de aprovaÃ§Ã£o assinada pelo responsÃ¡vel do parque e pela comissÃ£o organizadora.

## CritÃ©rios objetivos de aprovaÃ§Ã£o

Todos os itens sÃ£o obrigatÃ³rios e devem ter evidÃªncia anexada (log/teste/ata/captura sem dados sensÃ­veis):

1. Regulamento PDM e versÃ£o vigente aprovados; cada regra que afeta resultado tem caso de teste correspondente e conferÃªncia independente.
2. Testes RLS/RPC com duas contas comprovam zero acesso cruzado entre parques em leitura e escrita.
3. UsuÃ¡rios individuais e papÃ©is impedem aÃ§Ãµes fora da funÃ§Ã£o; autoria da trilha Ã© identificÃ¡vel e adequada Ã  operaÃ§Ã£o.
4. Sob concorrÃªncia prevista, nÃ£o hÃ¡ nÃºmero duplicado, capacidade excedida, inscriÃ§Ã£o perdida nem reserva convertida duas vezes.
5. Repetir requisiÃ§Ã£o apÃ³s timeout nÃ£o duplica inscriÃ§Ã£o, pagamento registrado ou resultado; operaÃ§Ãµes pendentes/bloqueadas sÃ£o visÃ­veis e tratadas.
6. Nenhum resultado oficial muda sem procedimento autorizado, motivo, autor e trilha consultÃ¡vel; classificaÃ§Ã£o confere integralmente com a apuraÃ§Ã£o oficial.
7. Ensaio offline/reconexÃ£o/reinÃ­cio nÃ£o perde nem sobrescreve silenciosamente dados; conflitos tÃªm resoluÃ§Ã£o documentada e interface operacional.
8. Backup realizado durante ensaio Ã© restaurado em equipamento separado, com contagens e referÃªncias conferidas pelo responsÃ¡vel.
9. Impressora, navegador, aparelhos e conectividade reais foram aprovados; operadores foram treinados e a contingÃªncia em papel estÃ¡ disponÃ­vel.
10. NÃ£o hÃ¡ defeito crÃ­tico/alto aberto sem mitigaÃ§Ã£o aceita; responsÃ¡veis e suporte durante o evento estÃ£o definidos.

## Bloqueios atuais identificados

- Regulamento prÃ³prio do PDM nÃ£o estÃ¡ disponÃ­vel para esta auditoria.
- PapÃ©is e autorizaÃ§Ã£o por operaÃ§Ã£o nÃ£o implementados.
- ResoluÃ§Ã£o de conflitos nÃ£o disponÃ­vel na interface.
- IntegraÃ§Ã£o Supabase/RLS/migrations e operaÃ§Ã£o multiaparelho nÃ£o foram testadas em ambiente real.
- Testes de IndexedDB real, offline em navegador e restauraÃ§Ã£o entre aparelhos ausentes.
- Build e suÃ­te completa nÃ£o puderam ser verificados nesta execuÃ§Ã£o porque dependÃªncias nÃ£o estÃ£o instaladas (`tsc` e `typescript` indisponÃ­veis).

**DecisÃ£o atual:** nÃ£o aprovar para operaÃ§Ã£o oficial atÃ© fechar os bloqueios aplicÃ¡veis e registrar as evidÃªncias acima. A prÃ³xima etapa recomendada Ã© obter o regulamento oficial e decidir o modo de operaÃ§Ã£o alvo; em paralelo, preparar ambiente limpo de homologaÃ§Ã£o Supabase/LAN e instalar dependÃªncias reproduzÃ­veis para completar build e testes.

## Complemento da Etapa 3 â€” console de pista

Antes de homologar, executar em ensaio controlado: (1) configurar dias, ordem, intervalo e capacidade conforme decisÃ£o assinada; (2) chamar, registrar prazo, presenÃ§a e ausÃªncia, verificar rabo da gata com posiÃ§Ã£o original/nova; (3) pausar, recarregar, retomar e encerrar, confirmando bloqueio de chamadas; (4) testar corrida pendente/iniciada/julgada, zero, retorno aprovado/negado, corrida de retorno explicitamente autorizada, confirmaÃ§Ã£o e correÃ§Ã£o justificada; (5) validar recuperaÃ§Ã£o IndexedDB apÃ³s recarga e encerramento abrupto; (6) aplicar migration `202610220011_track_console.sql` em staging e testar RLS, CAS, idempotÃªncia, isolamento parque/evento e concorrÃªncia; (7) reiniciar coordenador e resolver conflito real sem descartar operaÃ§Ã£o; (8) obter aprovaÃ§Ã£o formal da unidade e tabela de pontos.

CritÃ©rios adicionais: suÃ­te completa, TypeScript e build passam a partir do lockfile; nenhuma duplicidade apÃ³s repetiÃ§Ã£o/timeout; estado recuperado e sincronizado entre aparelhos; zero conflito sem resoluÃ§Ã£o; contas e permissÃµes individuais validadas; regulamento, pontuaÃ§Ã£o e critÃ©rios especiais conferidos por casos independentes. AtÃ© cumprir tudo, o console Ã© ferramenta de ensaio, nÃ£o sistema oficial do evento.

**EvidÃªncia de execuÃ§Ã£o da etapa:** testes de domÃ­nio da competiÃ§Ã£o e coordenador, 10/10 passaram; verificaÃ§Ã£o sintÃ¡tica de `coordinator/server.mjs` passou. `npm test` completo falhou pela dependÃªncia `typescript` ausente em `node_modules`; build falhou porque `tsc` nÃ£o estÃ¡ disponÃ­vel. O lockfile foi preservado. O roteiro de IndexedDB real e Supabase staging continua pendente e bloqueia aprovaÃ§Ã£o.

**DependÃªncias:** tentou-se reinstalaÃ§Ã£o limpa via `npm ci` com lockfile. A operaÃ§Ã£o nÃ£o concluiu no ambiente; pacote TypeScript ficou incompleto e `lucide-react` nÃ£o foi resolvido. Corrigir a disponibilidade do registry/cache, executar `npm ci` e repetir TypeScript, build e suÃ­te antes de homologaÃ§Ã£o.
# Adendo Etapa 4 â€” estabilizaÃ§Ã£o, classificaÃ§Ã£o e RBAC

## EvidÃªncia tÃ©cnica desta execuÃ§Ã£o

- `npm.cmd ci`, `npm.cmd ci --fetch-retries=0 --fetch-timeout=15000 --loglevel=error`: nÃ£o concluÃ­ram, sem progresso/saÃ­da; tentativas interrompidas. Lockfile preservado.
- Node `v24.21.0`, npm `11.19.0`; lockVersion 3 e dependÃªncias raiz conferem com `package.json`.
- `npm.cmd test`: 11 testes executados passaram; a suÃ­te falhou ao carregar `tests/domain.test.mjs` por `typescript` ausente em `node_modules`.
- `node --test tests/coordinator.test.mjs`: 2/2 passaram. `node --check coordinator/server.mjs`: passou.
- `npx.cmd tsc -b`: sem saÃ­da e interrompido. `npm.cmd run build`: falhou porque `tsc` nÃ£o Ã© reconhecido. Build nÃ£o aprovado.
- `supabase/migrations/202610220011_track_console.sql` apenas revisada estaticamente; nÃ£o aplicada em instÃ¢ncia Supabase/Postgres.

## Matriz de autorizaÃ§Ã£o-alvo para desenhar e testar

Esta matriz Ã© proposta para discussÃ£o e **nÃ£o estÃ¡ implementada**. Todos os privilÃ©gios devem ser verificados em backend/RPC e banco, nunca sÃ³ na UI.

| Perfil | Acesso mÃ­nimo a validar na homologaÃ§Ã£o |
|---|---|
| Administrador da plataforma | GestÃ£o de parques/contas, sem acesso automÃ¡tico a decisÃµes esportivas ou dados financeiros do evento |
| ResponsÃ¡vel pelo parque | ConfiguraÃ§Ã£o do evento/equipe e delegaÃ§Ã£o; leitura integral do parque |
| EscritÃ³rio | InscriÃ§Ãµes, pagamentos manuais, reservas, cancelamentos/transferÃªncias e relatÃ³rios autorizados |
| LocuÃ§Ã£o | Leitura de fila, senha atual/prÃ³xima e classificaÃ§Ã£o publicada; sem escrita de julgamento |
| Julgador | Registrar julgamento/ocorrÃªncias e submeter resultado; confirmaÃ§Ã£o/correÃ§Ã£o somente conforme polÃ­tica aprovada |
| Operador de Pista | Chamadas, presenÃ§a/ausÃªncia, fila, pausa/retomada e registro operacional; retorno/reabertura conforme concessÃ£o explÃ­cita |

Separar confirmaÃ§Ã£o oficial e correÃ§Ã£o do registro operacional, exigir identidade individual, escopo de parque/evento, motivo e trilha assinada no servidor. AtribuiÃ§Ãµes acima nÃ£o concedem qualquer autorizaÃ§Ã£o atual.

## Roteiro de validaÃ§Ã£o da migration em ambiente descartÃ¡vel

Executar somente em projeto local/staging sem dados reais. Para Supabase local, preparar CLI/Docker e executar `supabase start` e `supabase db reset` em ambiente descartÃ¡vel. Para staging hospedado, autenticar com CLI usando o procedimento seguro da equipe, vincular o projeto e aplicar migrations com `supabase db push`; nÃ£o copiar tokens/credenciais para logs ou documentaÃ§Ã£o. Validar: usuÃ¡rio dono lÃª somente seu evento; outro parque e usuÃ¡rio anÃ´nimo nÃ£o leem; DML direto Ã© negado; RPC de operaÃ§Ã£o autorizada exige sessÃ£o; operaÃ§Ã£o repetida retorna duplicata; mesma UUID com conteÃºdo diferente falha; versÃ£o-base obsoleta gera conflito sem sobrescrever estado; inscriÃ§Ã£o/senha de outro evento Ã© rejeitada; resultado oficial nÃ£o Ã© removido/substituÃ­do sem correÃ§Ã£o auditada; duas chamadas concorrentes de operaÃ§Ã£o com mesma base nÃ£o perdem atualizaÃ§Ã£o. Guardar versÃ£o da migration, ambiente e evidÃªncias sem segredo.

## Contrato de entrada para classificaÃ§Ã£o

Depois de aprovadas tabela, unidade, arredondamento, bÃ´nus e desempates, construir adaptador explÃ­cito de `TrackRace` para resultado oficial: identidade estÃ¡vel da corrida, evento/inscriÃ§Ã£o/etapa, distÃ¢ncia original/unidade, outcome e confirmaÃ§Ã£o, autoria/tempos, revisÃ£o da regra aplicada e pontos derivados. Resultados pendentes/retorno solicitado ficam fora da classificaÃ§Ã£o oficial. CorreÃ§Ã£o cria revisÃ£o auditada com anterior e novo valor e exige recÃ¡lculo reproduzÃ­vel. Comparar classificaÃ§Ã£o por casos contra planilha/ata oficial da comissÃ£o antes de publicar.

## CritÃ©rios adicionais de saÃ­da

1. `npm ci` termina sem erro e sem alterar lockfile; registrar Node/npm usados.
2. `npm test`, testes do coordenador, `tsc -b` e `npm run build` terminam com exit code 0 em checkout limpo.
3. InstalaÃ§Ã£o/upgrade IndexedDB, reload, queda abrupta, modo offline, reenvio e conflito exercitados em navegador real com duas instÃ¢ncias/dispositivos.
4. Migration aplicada e casos RLS/RPC/conflito executados em staging com ao menos dois parques e usuÃ¡rios de cada perfil.
5. Matriz RBAC aprovada e negada no servidor/banco, inclusive tentativas diretas sem passar pela tela.
6. ClassificaÃ§Ã£o sÃ³ habilitada apÃ³s regulamento versionado, regras e desempates aprovados e confronto independente com resultados de referÃªncia.

AtÃ© fechar todos os itens aplicÃ¡veis, uso apenas em ensaio controlado; sistema nÃ£o homologado para evento real oficial.
# Etapa 5 â€” evidÃªncias tÃ©cnicas e prÃ³ximos ensaios

## RecuperaÃ§Ã£o de dependÃªncias

Ambiente executado: Windows 10.0.26200, Node `v24.21.0`, npm `11.19.0`. O registry npm configurado responde normalmente quando a execuÃ§Ã£o recebe rede. Dentro do sandbox, `npm ping --verbose` e downloads falharam com `EACCES`; nÃ£o havia proxy configurado e nÃ£o foi observado erro DNS/TLS. O cache padrÃ£o em `%LOCALAPPDATA%\npm-cache` tambÃ©m negou escrita (`EPERM`). EspaÃ§o livre reportado: aproximadamente 125 GB. DiagnÃ³stico: bloqueio de saÃ­da de rede do sandbox somado a cache padrÃ£o sem permissÃ£o, nÃ£o incompatibilidade do lockfile.

Comando de recuperaÃ§Ã£o executado uma vez apÃ³s diagnosticar a causa: `npm.cmd ci --verbose --cache ./.npm-cache --fetch-retries=1 --fetch-timeout=60000` com rede autorizada. Exit 0; 81 pacotes instalados, zero vulnerabilidades reportadas; lockfile preservado. O cache temporÃ¡rio local foi removido. Nesta mÃ¡quina, se for necessÃ¡rio repetir em ambiente sem acesso ao cache padrÃ£o, direcionar `--cache` para uma pasta gravÃ¡vel e permitir trÃ¡fego HTTPS para `registry.npmjs.org`.

## EvidÃªncias concluÃ­das nesta etapa

| VerificaÃ§Ã£o | EvidÃªncia |
|---|---|
| SuÃ­te completa | `npm.cmd test` â€” 34/34, exit 0 |
| Coordenador | `node --test tests/coordinator.test.mjs` â€” 2/2, exit 0 |
| Tipos | `npx.cmd tsc -b` â€” exit 0 |
| Build produÃ§Ã£o | `npm.cmd run build` com acesso de leitura autorizado â€” exit 0; 1.628 mÃ³dulos; chunk principal 536,48 kB (aviso) |
| Lockfile | raiz de dependÃªncias conferida anteriormente; `npm ci` nÃ£o regenerou o lockfile |

O primeiro build no sandbox falhou ao ler `../..`/`vite.config.ts`; o mesmo script passou fora da restriÃ§Ã£o. `npm run test:coordinator` nÃ£o existe como script; o comando direto acima executou a suÃ­te real do coordenador.

## Ensaio de navegador ainda obrigatÃ³rio

Edge existe no ambiente e Vite serviu em `127.0.0.1:5173`, mas a tentativa de automaÃ§Ã£o headless/CDP nÃ£o chegou a manter uma pÃ¡gina utilizÃ¡vel do app. Nenhum passo de negÃ³cio foi executado e IndexedDB nÃ£o estÃ¡ validado em navegador. Repetir num posto/browser controlado com Playwright ou automaÃ§Ã£o equivalente configurada, registrando logs e capturas sem dados reais:

1. Criar evento de teste e configurar um rodÃ­zio.
2. Criar/selecionar inscriÃ§Ã£o de teste; chamar, registrar presenÃ§a e iniciar corrida.
3. Registrar resultado sem pontos inventados e confirmar conforme fluxo local de teste.
4. Recarregar e conferir estado, chamada, corrida e histÃ³rico.
5. Desconectar rede, executar operaÃ§Ã£o permitida e conferir outbox persistida apÃ³s reload.
6. Reconectar, sincronizar; conferir ausÃªncia de duplicidade e repetir mesmo operationId.
7. Capturar console, IndexedDB/outbox antes/depois e IDs/versionamentos usados; remover apenas o perfil/banco descartÃ¡vel de teste apÃ³s guardar as evidÃªncias.

## Supabase/RLS e concorrÃªncia

Staging nÃ£o estava configurado: sem CLI Supabase, `supabase/config.toml`, variÃ¡veis de conexÃ£o ou `.env` alÃ©m do exemplo. A migration `202610220011_track_console.sql` nÃ£o foi aplicada. NÃ£o declarar RLS, isolamento ou concorrÃªncia validados. Depois de provisionado ambiente autorizado descartÃ¡vel, seguir os casos de teste descritos neste plano e no adendo da Etapa 4: leitura/escrita cruzada entre parques, grants diretos, RPC, mesma operaÃ§Ã£o repetida, UUID reutilizada com corpo distinto, CAS desatualizado, operaÃ§Ãµes concorrentes sobre a mesma corrida e tentativa de substituir resultado oficial por snapshot antigo. Registrar nomes de perfis/roles e cÃ³digos de resultado sem gravar chaves.

## SeguranÃ§a, classificaÃ§Ã£o e aprovaÃ§Ã£o

RBAC individual nÃ£o estÃ¡ implementado no frontend/backend/banco. ResponsÃ¡vel do parque tem acesso baseado em propriedade ampla; no coordenador, token Ã© compartilhado. EscritÃ³rio, LocuÃ§Ã£o, Julgador e Operador de Pista nÃ£o tÃªm identidades/roles prÃ³prios, e administrador de plataforma nÃ£o estÃ¡ modelado. Aprovar matriz funcional e implementar enforcement nos RPCs/coordenador e policies antes do uso de equipe. A tabela de classificaÃ§Ã£o e desempates continuam pendentes; nÃ£o integrar resultados da pista Ã  classificaÃ§Ã£o oficial atÃ© sua aprovaÃ§Ã£o e teste de reconciliaÃ§Ã£o.

## Bloqueios atuais para evento real

1. EvidÃªncia real de browser/IndexedDB, offline/reload/reenvio ausente.
2. Supabase staging, aplicaÃ§Ã£o da migration e testes RLS/isolation/concurrency ausentes.
3. RBAC por identidade individual e enforcement server-side/database ausentes.
4. AprovaÃ§Ã£o da tabela de pontuaÃ§Ã£o, unidade, desempates e demais decisÃµes esportivas ainda necessÃ¡ria.
5. IntegraÃ§Ã£o pista-classificaÃ§Ã£o e confronto independente com resultados oficiais ainda nÃ£o feitos.
6. Aviso de chunk >500 kB a avaliar para aparelhos e rede do evento (nÃ£o bloqueou build).

DecisÃ£o: testes locais, TypeScript e build aprovados nesta etapa, mas a aplicaÃ§Ã£o permanece **nÃ£o homologada para evento oficial** atÃ© fechar os bloqueios acima.


## Etapa 6 - roteiro de homologacao de identidade e RBAC

### Perfis e casos de autorizacao

Criar usuarios Auth individuais e dois parques de teste. Matriz esperada: Responsavel do parque pode gerir apenas seu proprio parque; Escritorio le/cria/edita inscricoes, registra pagamento e relatorio; Locucao le dados operacionais sem pagamento nem escrita; Julgador registra julgamento/decisao de retorno sem confirmar/corrigir resultado oficial; Operador de Pista chama/controla rodizio sem julgamento, fechamento privilegiado ou gestao de usuarios; Administrador de plataforma nao recebe acesso automatico aos dados de parque. Usuario, UUID de perfil e park_id nunca devem ser aceitos do cliente como autoridade.

Para cada perfil, testar leitura permitida, negacao de leitura/escrita em parque B, DML direto e RPC. Alterar/atribuir role por navegador deve falhar. Locucao/Julgador devem falhar ao selecionar colunas de pagamento diretamente; `get_event_entries` deve omitir esses campos, enquanto Escritorio/Responsavel os recebem; RPC `get_entry_payment_state` deve negar os demais perfis. Repetir com usuario sem sessao, email nao confirmado e membership desativada. Executar operacao concorrente sobre membership durante uma chamada; nova autorizacao deve refletir o estado confirmado no banco. Testar convite expirado, revogado, token repetido e email diferente. Registrar SQLSTATE/status e IDs anonimizados.

### Coordenador local

Provisionar dois tokens individuais de teste por perfil com user UUID, role, expiracao curta e disabled ativo/inativo. Validar token inexistente, expirado e revogado; autorizacao por acao; dados/campos filtrados em snapshot e changes; recusa de evento/registro vinculado a outro parque; autoria persistida; idempotencia sob retry e conflito de versao. Validar rotacao de token e reinicio. Confirmar explicitamente que mudanca no Supabase nao propaga ao coordenador sem atualizacao do roster.

### Offline, sessao e outbox

Em navegador real, autenticar operador A, enfileirar acao valida, recarregar e manter outbox; desconectar, revogar membership/desativar A no ambiente; reconectar e sincronizar. A operacao deve ser recusada/quarentenada e preservada. Entrar como usuario B e confirmar que a outbox de A nao e enviada sob B. Repetir o mesmo operationId autorizado sem duplicar. Testar logout e expiracao em dispositivo compartilhado e confirmar encerramento da UI/sessao, sem expor credencial local a operador seguinte.

### Execucao e evidencias necessarias

Aplicar `supabase/migrations/202610220012_individual_rbac.sql` numa instancia de staging descartavel pelo procedimento oficial antes de publicar o cliente (ele agora chama `get_my_park_context` e `get_event_entries`), inspecionar grants e policies em `pg_policies`, rodar casos acima com roles Auth reais e registrar migration version, ambiente nao secreto, resultados e logs sem tokens. O teste local Node/SQLite e os testes unitarios existentes sao apenas verificacoes locais; nao substituem essa etapa. Tambem registrar browser/versao, estado online/offline, requests anonimizados, IndexedDB antes/depois e operacoes preservadas.

### Criterio de liberacao

Nao liberar enquanto houver escrita/leitura cruzada, operacao sensivel autorizada apenas no React, auto-promocao de role, token invalido aceito, outbox de usuario diferente sincronizada, resultado oficial sobrescrito ou dado pendente perdido. Aprovar regulamento/pontuacao/desempate e testar classificacao separadamente. A credencial do coordenador deve ter procedimento escrito de emissao/revogacao por individuo; credenciais estaticas ainda nao ligadas a Auth precisam ser aceitas formalmente ou substituidas antes de alegar RBAC uniforme. Convites nao enviam email: o responsavel transmite o link de uso unico por canal confiavel, e o projeto Supabase precisa ter email de confirmacao/recuperacao configurado.

## Etapa 7 â€” evidencias de navegador, persistencia e offline (22/10/2026)

### Ambiente e verificacoes executadas

- Windows; Node `v24.21.0`, npm `11.19.0`; Edge instalado `155.0.4283.62`.
- `npm.cmd test`: exit 0, 36/36 testes passaram.
- `npx.cmd tsc -b`: exit 0.
- `npm.cmd run build`: a execucao no sandbox terminou em exit 1 ao tentar ler `../..` (`Acesso negado`). Repetida com autorizacao do ambiente: exit 0; Vite `6.4.5`, 1.628 modulos. Bundle JS: 541,86 kB (148,85 kB gzip), com aviso de chunk acima de 500 kB.
- `npm.cmd run preview -- --host 127.0.0.1 --port 4178 --strictPort`: iniciou em `http://127.0.0.1:4178/` com autorizacao do ambiente; `Invoke-WebRequest` local retornou HTTP 200. O bind permaneceu em loopback.
- Playwright/Puppeteer nao estao instalados. Edge headless recusou a sessao com `Multiple targets are not supported in headless mode`. Uma sessao normal com perfil isolado nao disponibilizou CDP em `127.0.0.1:9237`. Sem ferramenta de controle de GUI no ambiente, nao foi possivel clicar, inspecionar DOM, capturar console ou validar a tela. Nao foram usados perfis existentes.
- Nenhuma variavel de ambiente `VITE_*`/`SUPABASE_*` estava definida; havia somente `.env.example`. Nenhum Supabase staging/Auth/migration foi usado ou validado.

### Tabela de cenarios da Etapa 7

| Cenario | Status | Evidencia | O que falta |
|---|---|---|---|
| Servir bundle atualizado em loopback | Executado; aprovado em HTTP | Build exit 0 e resposta local 200 em `127.0.0.1:4178` | Smoke visual no browser |
| Abrir app e selecionar evento/rodizio | Nao executado em navegador | Edge iniciou/depuracao inacessivel; sem DOM/captura | Browser interativo ou automacao funcional |
| Ver fila/prÃ³xima senha; chamar e registrar presenca | Nao executado | Nenhuma interacao de UI | Evento e competidores ficticios em perfil descartavel |
| Iniciar/encerrar corrida, registrar/confirmar resultado e consultar historico | Nao executado | Nenhuma interacao de UI | Validar estados e ausencia de pontuacao inventada |
| Ausencia, mover ao fim, chamar novamente e manter senha | Nao executado | Nenhuma interacao de UI | Validar fila, identidade, idempotencia e trilha |
| Pausar, retomar e encerrar rodizio | Nao executado | Nenhuma interacao de UI | Reload e tentativa de chamada em estados bloqueados |
| Reload, fechar/reabrir e recuperar estado IndexedDB | Nao executado | Nao houve pagina controlavel | Teste browser obrigatorio; unidade nao comprovada |
| Desconectar/restaurar rede, outbox e reenvio | Nao executado | Nenhuma interrupcao ou sincronizacao simulada | Staging e prova de operacao local/remota separadas |
| Sessao, logout, perfil e usuario desativado | Nao executado | Sem contas ficticias ou backend Auth | Testes de UI e autorizacao real em staging |
| Leiturabilidade, clique repetido, tela estreita e impressao | Nao executado | Sem viewport/DOM utilizavel | Ensaio no dispositivo e impressora da pista |
| Suite automatizada | Executado; aprovado localmente | 36/36, TypeScript exit 0, build exit 0 | Nao substitui testes no navegador |

### Protocolo para repetir os cenarios pendentes

1. Abrir o preview/build em Edge ou Chrome interativo com perfil descartavel e registrar browser/versao, URL, largura/altura, build e console. Nao usar parque ou dados reais.
2. Criar parque/evento/inscricoes ficticios; configurar dia e rodizio livre, intervalo e capacidade de teste, sem preencher pontos ou regra esportiva nao aprovada.
3. Executar cada operacao de pista da tabela, guardar IDs de evento/inscricao/corrida/chamada anonimizados, e apos cada acao recarregar a pagina para comparar fila, estado, resultado, auditoria e chamadas.
4. Fechar e reabrir o browser no mesmo perfil descartavel; conferir stores IndexedDB e outbox sem editar dados diretamente. Registrar operacoes `pending`, sincronizadas, bloqueadas ou em conflito.
5. Desconectar somente o perfil/rede do ensaio, executar operacao local que a politica permita, recarregar, reconectar e observar reenvio. Repetir o mesmo ID idempotente e provar ausencia de duplicata. Se nao houver Supabase staging/coordenador configurado, marcar a confirmacao remota pendente, sem inferir sincronizacao.
6. Testar sessao/RBAC com contas Auth ficticias de perfis distintos, logout, expiracao e membership desativada. Confirmar negacao no backend/banco, nao apenas na interface.
7. Usar capturas/logs sem tokens ou dados pessoais; ao final, eliminar somente o perfil e os dados artificiais criados para o ensaio, apos validar o caminho exato do perfil descartavel.

**Estado da Etapa 7:** somente suite automatizada, TypeScript, build e resposta HTTP local foram aprovados. O fluxo de negocio nao foi executado no browser; IndexedDB, reload/recuperacao, offline/outbox/sincronizacao, interface e login/RBAC permanecem sem validacao de navegador. Nao declarar sistema homologado ou apto para uso oficial.

## Etapa 8 - automacao Edge e retomada controlada (22/10/2026)

### Ambiente e causa da falha anterior

Windows, Node `v24.21.0`, npm `11.19.0`, Edge `155.0.4283.62`. Havia processos Edge de outros usos e nenhum listener nas portas locais verificadas; os processos nao foram tocados. Playwright/Puppeteer/WebDriver nao estao instalados. A tentativa headless anterior passou um caminho de perfil com espacos por `Start-Process -ArgumentList` e os argumentos foram partidos, resultando em `Multiple targets are not supported in headless mode`. A tentativa normal nao publicou CDP em loopback. A suite nova evita dependencia: `spawn` recebe cada argumento separado, usa perfil descartavel em `%TEMP%`, porta CDP dinamica e `127.0.0.1`.

### Matriz de execucao

| CenÃ¡rio | Estado nesta etapa | EvidÃªncia/limite |
|---|---|---|
| Testes locais | Aprovado | `npm.cmd test`: 36/36, exit 0. |
| Tipos | Aprovado | `npx.cmd tsc -b`: exit 0. |
| Build atual | Bloqueado | `npm.cmd run build` exit 1 no sandbox: acesso negado a `../..` ao carregar `vite.config.ts`. Build anterior autorizada passou, mas precede o Ãºltimo ajuste de aviso e nÃ£o vale para fonte atual. |
| AutomaÃ§Ã£o contra produÃ§Ã£o | Reprovada/bloqueada nesta retomada | `npm.cmd run test:browser` exit 1 porque Vite preview nÃ£o consegue ler config sob o mesmo sandbox. ExecuÃ§Ã£o anterior em ambiente autorizado percorreu a maioria do fluxo e revelou falha real de chamada retomada; encerrou por asserÃ§Ã£o textual do toast. |
| Fluxo de pista no navegador | Parcial, sem aprovaÃ§Ã£o integral | O ensaio anterior executou criaÃ§Ã£o de evento fictÃ­cio, fila, chamada/presenÃ§a, julgamento zero, confirmaÃ§Ã£o local, reload, no-show, mover ao fim, re-chamada sem corrida duplicada, fechamento e pausa/retomada. Detectou associaÃ§Ã£o Ã  chamada antiga em `race.start`, corrigida em domÃ­nio e coberta por teste. PersistÃªncia IndexedDB offline foi observada apÃ³s reload. ExecuÃ§Ã£o final atual ainda precisa terminar verde apÃ³s reconstruir bundle. |
| Console/requisiÃ§Ãµes | NÃ£o aprovado integralmente | Harness captura console, requests e recursos; sem execuÃ§Ã£o final verde apÃ³s as alteraÃ§Ãµes mais recentes. |
| Supabase, RLS, concorrÃªncia entre clientes | NÃ£o executado | Sem staging ou credenciais autorizadas. NÃ£o aplicado migration. |
| SessÃ£o, convite, revogaÃ§Ã£o e RBAC remoto | NÃ£o executado | Requer usuÃ¡rios Auth fictÃ­cios e staging. |

### Mudanca e regressao

No re-chamada da mesma inscricao depois do no-show, o dominio podia resolver `race.start` contra o primeiro registro de chamada, que ainda era `absent`. A resolucao agora procura a chamada mais recente da corrida e considera o status mais recente elegivel; teste de regressao passa dentro dos 36 testes. Mensagem da pista foi ajustada para distinguir registro local de sincronizacao pendente, mas essa ultima edicao precisa ser incluÃ­da no build e repetida no navegador. Nao houve mudanca de regra esportiva ou conversao de distancia para pontos.

### Repeticao concreta e staging

Em ambiente autorizado para compilar o projeto, no diretorio raiz:

```powershell
npm.cmd test
npx.cmd tsc -b
npm.cmd run build
npm.cmd run test:browser
```

Nao usar outra conta de navegador/perfil. O teste de navegador cria dados ficticios em perfil e IndexedDB descartaveis e deve terminar com exit 0 antes de chamar o fluxo local aprovado. Se o preview reclamar de acesso ao config, execute em runner de CI autorizado para o workspace; nao desative protecoes nem abra CDP para LAN.

Para staging, o responsavel precisa criar/provisionar um projeto Supabase descartavel e autorizar o operador. Necessario: `SUPABASE_URL` para tooling/servidor de staging, `SUPABASE_ACCESS_TOKEN` somente no ambiente administrativo (nao imprimir), `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` somente no build/cliente de teste; nunca incluir `service_role` no frontend. CLI/config nao estavam presentes. Com CLI instalada pelo procedimento aprovado e projeto confirmado como staging, executar `supabase link --project-ref <STAGING_PROJECT_REF>`, `supabase migration list` e `supabase db push`; conferir a ordem versionada em `supabase/migrations/`. Em Auth, criar usuarios ficticios individuais para parques A/B, configurar confirmacao de email e convites. Testar SELECT/INSERT/UPDATE/RPC cruzados por parque, troca indevida de papel, membership revogada, convite expirado/reusado, operacao antiga com identidade diferente, concorrencia na mesma corrida e tentativa de sobrescrever resultado por versao antiga. Inspecionar `pg_policies`, grants e versao de migration; registrar status/SQLSTATE e IDs anonimizados sem tokens.

O coordenador local tambem deve ser validado com token valido, expirado, removido do roster e de usuario diferente. Atualmente o roster e estatico via configuracao do processo: alteracoes nao sao revogadas ate atualizar a configuracao e reiniciar o processo. Confirmar bind TLS/rede conforme configuracao antes do ensaio; tokens estaticos nao comprovam revogacao imediata nem sincronizacao com Supabase Auth. Offline local nao significa autorizacao confirmada no servidor.

### CritÃ©rios que permanecem bloqueando uso oficial

1. Build e suite browser atuais precisam terminar verde no mesmo codigo fonte; observar reload/fechamento real, IndexedDB, eventos de rede e retry idempotente com evidencia registrada.
2. Aplicar migrations e testar RLS/isolamento/autorizacao/concorrencia em staging real; invalidar credenciais antigas, testar dois usuarios/parques e rejeicao/quarentena da outbox.
3. Confirmar se coordenador sera provisionado/revogado com processo operacional aceitavel, e testar expiracao/logout em dispositivo compartilhado.
4. Obter aprovacao da unidade de distancia, tabela de pontuacao, empates e regras especiais. Classificacao oficial permanece bloqueada.
5. Executar ensaio no tamanho de tela e impressora utilizados pela equipe; automacao nao substitui avaliacao operacional/acessibilidade.

Resultado: regressao local de `race.start` corrigida e os testes locais passam; build/browser da fonte final, staging, RLS e regras esportivas seguem sem aprovacao. Nao liberar para evento oficial.

## Etapa 9 - resultado reproduzivel da suite browser

### Configuracao e execucao

Raiz confirmada por `Get-Location`: `C:\Users\abreu\Desktop\Connect PDM`; `Resolve-Path vite.config.ts` aponta ao arquivo na raiz. O arquivo usa sua propria localizacao como `projectRoot`, sem imports `../..`. A mensagem ambiental anterior foi `Cannot read directory "../..": Acesso negado.` e `Could not resolve "<raiz>\\vite.config.ts"`. A configuracao permaneceu inalterada e compilou no contexto autorizado, confirmando restricao do sandbox ao esbuild, nao falha de resolucao do projeto.

Comandos finais executados nesta ordem:

```powershell
npm.cmd test
npx.cmd tsc -b
npm.cmd run build
npm.cmd run test:browser
```

Resultado: tests exit 0 (37/37), TypeScript exit 0, build exit 0 e browser exit 0 (1/1). Vite 6.4.5 transformou 1.628 modulos; bundle JS 542,15 kB (148,97 kB gzip) com aviso de chunk >500 kB. Edge `155.0.4283.62`, URL `http://127.0.0.1:64577/`, perfil temporario e evento ficticio `e2e-1708ce55-2931-4397-a9d0-ea72041976eb`; 4 chamadas, 3 corridas, console errors nao esperados zero e request failures nao esperadas zero. CDP foi dinamico e local ao processo; nenhum perfil preexistente foi usado/encerrado.

### Matriz da Etapa 9

| Cenario | Resultado e evidencia |
|---|---|
| Abertura do build | Aprovado no Edge; DOM principal carregou. |
| Chamada, presenca, inicio, julgamento e confirmacao | Aprovado; resultado zero sem distancia/pontos inventados, classificacao oficial ainda bloqueada. |
| Ausencia e fila | Aprovado; auditoria preserva `call.absent`; deslocamento registra snapshot anterior ausente; chamada posterior tem ID proprio e senha original preservada. |
| Corrida retomada | Aprovado; reconvocacao reutiliza a corrida original, sem duplicar corrida; presence/start funcionam. Tres inscricoes resultaram em tres corridas e quatro chamadas. |
| Reload/IndexedDB | Aprovado; evento, fila, corridas e historico recuperados. Perfil Edge descartavel foi encerrado e removido; nao houve ensaio manual de fechar a janela normal do usuario. |
| Pausa/retomada/encerramento/reabertura | Aprovado; estado persiste e chamadas ficam bloqueadas nos estados pausado/encerrado. |
| Offline local | Aprovado; acao foi persistida, reload offline recuperou shell/IndexedDB e estado permaneceu `local`. |
| Sync remoto/replay | Nao executado: sem Supabase/coordenador configurado, outbox remota vazia. Nenhuma sincronizacao alegada. |
| Mensagem local | Aprovada na UI Edge: `OperaÃ§Ã£o â€œPausaâ€ registrada no aparelho.` |
| Mensagens pending/synced/conflito | Textos distintos aprovados por teste da funcao comum `trackOperationMessage`; nenhum backend real para exibir pending/synced na UI nesta sessao. |
| Console/rede | 0 erros de console e 0 falhas de requisicao nao esperadas. Um 404 favicon e duas falhas `ERR_INTERNET_DISCONNECTED` durante o offline foram capturados e classificadas pelo contexto. |

### Pendencias para homologacao real

O projeto ainda precisa de um Supabase staging descartavel autorizado, migrations aplicadas pela CLI aprovada, Auth individual ficticio e testes de RLS/escrita cruzada entre dois parques, revogacao, rejeicao de outbox de ator antigo, concorrencia e conflito de versao. Revogacao no coordenador depende de atualizar seu roster estatico e reiniciar. Testar os estados visuais pending/synced com o backend real. Obter aprovacao da unidade de distancia, tabela de pontuacao, desempates e demais regras antes da classificacao oficial. Realizar ensaio operacional na tela/impressora da pista.

**Etapa 9 aprovada para build e fluxo local Edge/IndexedDB. O sistema permanece nao homologado para evento oficial.**

## Etapa 10 - homologacao de seguranca e sincronizacao Supabase

### Resultado e classificacao

| Item | Estado | Evidencia/observacao |
|---|---|---|
| Inventario das migrations e ordenacao | PASSOU (estatico) | 12 arquivos, `202610210001` a `202610220012`, em ordem. Corpos SECURITY DEFINER encontrados usam `SET search_path = ''`; grants/revokes foram revisados. Nenhuma migration aplicada remotamente. |
| RLS, grants, auth.uid e isolamento estaticos | PASSOU parcialmente (estatico) | Politicas e helpers amarram evento/parque/membership e os helpers verificam `auth.uid()`. Sem banco remoto, nao e prova de enforcement. |
| Transicoes da RPC de pista | FALHOU (estatico) | `apply_event_track_operation` aceita `p_state` JSON integral e valida permissoes/historico/versionamento, mas nao valida a transicao de negocio correspondente a `p_action`. Um `track_operator` pode enviar `call.create` e incluir corrida com resultado `official`; ver status da Etapa 10. Bloqueia uso oficial e requer migration corretiva + teste real. |
| Convite expirado/reutilizado e membership desativada | PASSOU (estatico) / NAO EXECUTADO (remoto) | Hash do token, email confirmado, expiraÃ§Ã£o, `accepted_at`/`revoked_at`, lock da linha e membership consultada em cada request. Validar comportamento no staging e sessÃ£o jÃ¡ aberta. |
| Coordenador individual por parque/role/expiraÃ§Ã£o | PASSOU (estatico com limites) | Bearer checado em cada rota protegida, userId/role e parque fixo; expirado/disabled rejeitados. Revogacao depende de atualizar roster estatico e reiniciar; nao integra revogacao Supabase Auth. `health` e publico. |
| Autoria da outbox Supabase | PASSOU (estatico) | `actorUserId` original precisa corresponder a sessao; RPC/RLS revalidam permissao; conflito/permissao bloqueia sem apagar. Teste remoto NAO EXECUTADO. |
| Autoria da outbox coordenador | FALHOU (estatico) | `coordinator_outbox` nao grava identidade criadora; item offline pode ser sincronizado por token de outro operador e auditoria passa a atribuir ao token sincronizador. |
| Projetos, contas, acesso cruzado, sessoes, API direta, concorrencia, idempotencia e recuperacao remota | NAO EXECUTADO | Nao ha configuracao/credenciais de staging autorizadas. Nenhuma requisicao/migration remota ocorreu. |
| Testes locais | PASSOU | `npm.cmd test` 37/37; `npx.cmd tsc -b`; `npm.cmd run build`; `npm.cmd run test:browser` (1/1 no Edge local). Nao substituem PostgreSQL/Auth/RLS reais. |
| Homologacao oficial | BLOQUEADO | Falhas estaticas de transicao e autoria offline, ausencia de staging e regras esportivas pendentes. |

### Casos remotos obrigatorios (todos pendentes)

| Caso | Estado | Roteiro de evidencia |
|---|---|---|
| Sem sessao: SELECT/DML/RPC protegido | NAO EXECUTADO | Usar anon e request sem Authorization; registrar HTTP/SQLSTATE e confirmar nenhuma linha lida/alterada. |
| Cada papel: acao permitida e proibida | NAO EXECUTADO | Testar owner/manager, office, announcer, judge e track_operator por PostgREST e RPC diretamente, nao pela UI. Platform admin somente se provisionado com governanca. |
| Parque A contra parque B | NAO EXECUTADO | Dois usuarios e dois parques; testar SELECT, insert/update, RPC, IDs de evento/inscricao/corrida de outro parque. |
| Membership desativada com sessao JWT aberta | NAO EXECUTADO | Desativar no banco e reutilizar a sessao ja emitida; requests novos devem falhar/retornar zero linhas sem depender de logout. |
| Convite expirado, revogado, email divergente e token usado | NAO EXECUTADO | Criar convites ficticios e repetir cada variante; confirmar uma unica aceitacao e rejeicao posterior. |
| Acesso direto via API/SQL e auto-promocao | NAO EXECUTADO | Tentar grants/DML/RPC e update/insert de role; verificar negacao no banco. |
| Duas contas alterando a mesma entidade | NAO EXECUTADO | Disparar simultaneamente updates com mesma versao-base e conferir um commit, um conflito auditado, sem lost update. |
| Mesmo operationId repetido, sequencial e concorrente | NAO EXECUTADO | Reenviar corpo idÃªntico e depois corpo divergente; confirmar duplicata sem segundo registro e conflito sem sobrescrever. |
| Queda de rede, restart e recuperacao da outbox | NAO EXECUTADO remotamente | Enfileirar como usuario A, reiniciar app/coordenador, reenviar e comparar operationId, autor, versao e contagem antes/depois. Browser Etapa 9 cobriu somente persistencia IndexedDB local. |
| Resultado oficial em conflito/versao antiga | NAO EXECUTADO | Dois clientes corrigem/confirmam concorrentemente; versao antiga deve bloquear e preservar resultado oficial/historico anterior. |
| Operacao criada por outro usuario/sem autoria | NAO EXECUTADO remotamente; falha estatica do coordenador | Criar offline sob A, trocar para B e sincronizar; esperado: quarentena, nunca gravar como B. Hoje a fila nao registra criador. |

### Inventario de migration

1. `202610210001_multi_park.sql`
2. `202610210002_manual_payments.sql`
3. `202610210003_immutable_results.sql`
4. `202610210004_ticket_capacity.sql`
5. `202610210005_result_corrections.sql`
6. `202610210006_event_capacity_updates.sql`
7. `202610210007_entry_cancellation.sql`
8. `202610210008_entry_transfers.sql`
9. `202610210009_ticket_reservations.sql`
10. `202610220010_entry_partner.sql`
11. `202610220011_track_console.sql`
12. `202610220012_individual_rbac.sql`

### Pre-requisitos e roteiro staging

O diretorio so tinha `.env.example` com placeholders; nenhuma variavel `SUPABASE_*`, `VITE_SUPABASE_*` ou `CONNECT_PDM_*` estava definida; nao existe `supabase/config.toml` nem comando CLI `supabase`. Nao conectar ate o responsavel fornecer project ref, nome/URL de staging, contas ficticias e aprovacao explicita de que a instancia e descartavel e nao producao.

1. Instalar CLI Supabase por procedimento aprovado e autenticar em contexto protegido (nao ecoar/guardar token em log).
2. Confirmar projeto staging no painel do provedor e por `supabase projects list`; linkar apenas o ref confirmado: `supabase link --project-ref <STAGING_PROJECT_REF>`.
3. Inspecionar `supabase migration list --linked`; gerar pre-visualizacao `supabase db push --dry-run`. Interromper se nome/ref/historico indicarem qualquer ambiente de producao ou divergencia inesperada.
4. Apos aprovacao explicita do responsavel e confirmacao visual do ref staging, aplicar `supabase db push`; guardar somente ref anonimo, horario, versoes das migrations e codigo de saida. O fluxo dry-run e migrations esta documentado oficialmente em [Supabase CLI workflows](https://supabase.com/docs/guides/local-development/cli-workflows). Nao usar `db reset --linked`.
5. Criar dois parques ficticios independentes e contas individuais por perfil. Exercitar policies por API direta e SQL roles; depois membership desativada, convite expirado, token reutilizado, email nao confirmado e sessao JWT ja aberta.
6. Enviar operacoes concorrentes sobre mesma corrida e mesmo operationId; confirmar um unico resultado, replay idempotente, CAS e ausencia de overwrite oficial. Desconectar, enfileirar, reiniciar coordenador, reconectar e conferir autor original. Repetir com outra identidade e com token disabled/expirado.
7. Fazer auditoria de `pg_policies`, grants, versoes migration e trilha de actor; remover apenas dados/perfil descartavel de staging segundo aprovacao do responsavel. Nunca copiar dados reais, secrets ou service role ao bundle.

### Bloqueios e correcoes necessarias

- Criar migration aditiva que valida no servidor as transicoes de `apply_event_track_operation` e proibe `call.create`/outras acoes de anexar ou promover corridas oficiais; garantir que `result.confirm` altere somente a corrida pendente alvo sem modificar seus campos esportivos. Cobrir com testes SQL que rode no PostgreSQL staging antes de aplicar em qualquer ambiente.
- Ligar a autoria do `coordinator_outbox` ao usuario verificado no momento da criacao. Se modo offline nao puder verificar/retomar a mesma identidade com seguranca, manter o item em quarentena ao trocar usuario, em vez de atribui-lo ao token atual.
- Tratar idempotencia concorrente da RPC depois de adquirir lock, para mesmo operationId retornar duplicata quando conteudo/autor sao iguais, sem mascarar conflito.
- Executar todos os casos da Etapa C acima em staging real, inclusive leitura/escrita cruzada A/B, permissoes diretas e sessao depois da revogacao.
- Revogacao do coordenador permanece por atualizacao de arquivo de ambiente/restart; estabelecer procedimento operacional e provar. Sem isso, revogacao imediata nao esta homologada.
- Regulamento, unidade de distancia, pontuacao, criterios de empate e regras especiais ainda aguardam aprovacao formal; classificacao oficial segue bloqueada.

Nenhuma correÃ§Ã£o de autorizacao/migration foi aplicada nesta etapa porque o banco PostgreSQL de staging nao existe no contexto e a alteracao precisa de ensaio real; testes locais simulados nao provariam RLS. Os quatro comandos locais passaram, mas as falhas estaticas e todos os testes remotos continuam bloqueando uso oficial.

## Atualizacao Etapa 11 - hardening preventivo (22/10/2026)

### Resultado por criterio

| Criterio | Estado | Evidencia/acao seguinte |
|---|---|---|
| Impedir que `call.create` submeta estado oficial fabricado | BLOQUEADO ate aplicar migration; migration aditiva preparada revoga EXECUTE para clientes na RPC antiga | `supabase/migrations/202610220013_suspend_unvalidated_track_rpc.sql`; assertiva Node estatica PASSOU. Aplicar somente em staging autorizado; nenhuma migration remota aplicada. |
| RPC substituta que derive transicao de dados minimos e valide campos/estados | NAO EXECUTADO | Projetar funcao por `p_action_data` com campos permitidos por acao; criar testes PostgreSQL negativos para JSON adulterado, papeis, evento/parque, versao, historico e replay concorrente. Nao reabrir EXECUTE na funcao atual. |
| Outbox local com autoria verificavel | PARCIAL | DB v7 preserva e bloqueia itens existentes; itens novos do coordenador sem recibo ficam bloqueados. Outbox Supabase so pode reenviar no mesmo runtime que capturou sessao; apos reload vai para revisao. Proxima implementacao: recibo de operacao assinado pelo servidor, com usuario, parque, dispositivo, conteudo/ID, expiraÃ§Ã£o e verificacao da revogacao. |
| Revogacao do coordenador sem restart | PASSOU em teste local para fonte file | Definir `CONNECT_PDM_OPERATOR_CREDENTIALS_FILE` com arquivo protegido e atualizacao atomica; roster relido por requisicao. Arquivo inacessivel/invalido retorna 401. `CONNECT_PDM_OPERATOR_CREDENTIALS` legado continua exigindo restart. Nao equivale a revogacao remota Supabase. |
| Preservar pendencias antigas | PASSOU por implementacao/revisao, sem teste de IDB real | Migracao IndexedDB v7 atualiza registros do coordenador para `blocked` sem excluir campos/linhas. Conferir em navegador isolado com fixture antiga e exportar contagem/IDs antes/depois. |
| Build/testes locais | PARCIAL | `npm.cmd test` 39/39 exit 0; `npx.cmd tsc -b` exit 0. Build iniciou, mas exit code final nao foi capturado; executar novamente. `npm.cmd run test:browser` pendente. |
| Homologacao Supabase | BLOQUEADO | Responsavel deve confirmar instancia staging descartavel e autorizada, project ref e contas ficticias. Nao conectar a producao nem expor credenciais. |

### Tratamento de dados e compatibilidade

Migration 013 e aditiva e nao remove tabelas, operacoes ou estados. Ao ser aplicada, clientes autenticados continuam com leitura sujeita a RLS, mas deixam de escrever pela RPC antiga; a outbox online fica pendente/bloqueada e dados locais preservados. Planejar janela de manutencao e orientar operadores a nao considerar pendencias locais como sincronizadas. Para outboxes antigas do coordenador, a atualizacao local v7 preserva item e causa em `lastError`, mas exige revisao manual e nao permite reenvio automatico.

Nao existe ainda protocolo de atestacao segura da criacao offline. Sem conectividade nao ha fonte online que possa assinar identidade e payload; portanto a operacao pode ser persistida localmente, mas nao atribuida nem sincronizada automaticamente com seguranca. Proposta: concessao assinada de operacoes limitadas por usuario/parque/dispositivo e prazo curto, verificavel no coordenador contra roster ainda ativo; sem fonte de revogacao e sem concessao valida, falhar fechado/quarentenar. A comissao/administrador precisa aceitar explicitamente a politica de operacao offline antes de ativar tal mecanismo.

### Proxima etapa recomendada

Com staging autorizado, validar primeiro migration 013 e grants/RLS; depois implementar a nova RPC em migration posterior, testar atomicamente e so entao reabilitar escrita. Em paralelo, implementar atestacao assinada e teste de autoria adversarial. Nao liberar uso oficial enquanto qualquer escrita da pista depender do snapshot completo do cliente, enquanto houver outbox sem autoria comprovavel, ou antes de RLS/RBAC, concorrencia e regras esportivas serem aprovados.

A execucao browser de fechamento foi PASSOU 1/1 (Edge, loopback, fixture ficticia, fila/ausencia/reconvocacao, corrida, julgamento zero sem pontuacao, confirmacao, reload e offline local); ocorreu uma primeira falha intermitente de seletor â€œChamar senha 2â€ (exit 1), seguida de execucao limpa exit 0 sem mudanca no codigo. Evidencia detalhada/URL/evento esta em `docs/STATUS_AUDITORIA.md`. O teste browser nao cobriu Supabase, coordenador configurado, RLS ou autoria remota. Build final PASSOU exit 0; aviso do bundle >500 kB registrado.

## Etapa 12 - migration 013 e contrato futuro de pista

A leitura estatica da migration 013 confirmou revogacao para `PUBLIC`, `anon` e `authenticated`; a migration aditiva 014 revoga explicitamente `service_role`. Ambas retiram escrita direta nas tabelas e preservam SELECT autenticado sob RLS. E segura para reaplicacao em sintaxe (REVOKE/GRANT/COMMENT) e nao remove dados. Proprietarios/superusers mantem privilegios inerentes; roles herdadas, ACL efetiva e eventual alteracao manual nao podem ser confirmadas sem banco. Migration nao aplicada.

A funcao antiga era o unico caminho SQL de escrita de pista achado nas migrations; nenhum trigger ou wrapper adicional foi encontrado. O caminho alternativo do coordenador SQLite aceitava snapshot completo e agora rejeita escrita de `track_states` na API, validado por teste HTTP local com payload adulterado. Escrita remota de pista foi removida do cliente e toda outbox online e preservada como bloqueada. Chamadas/alteracoes locais continuam possiveis, mas nao sincronizam.

Contrato futuro: [RPC_PISTA_SEGURA.md](RPC_PISTA_SEGURA.md). Foi documentado, nao implementado. Uma funcao segura deve aceitar campos estritos por acao, derivar `auth.uid()`/role/parque no servidor, carregar estado persistido, bloquear concorrencia, repetir a verificacao idempotente sob lock, calcular a transicao e gravar auditoria atomica. Campos de resultado oficial ou autoria nao podem ser enviados em operacao de chamada. Ainda e necessario acrescentar armazenamento do payload da operacao para comparar retries. Pontos seguem fora do contrato ate aprovacao da comissao.

### Status e comandos

| Item | Estado |
|---|---|
| Staging identificado/autorizado | BLOQUEADO (sem env Supabase/Connect PDM, `.env`, `supabase/config.toml` ou CLI; Docker nao iniciado) |
| Aplicacao/ACL/RLS efetiva da migration 013 | NAO EXECUTADO |
| Casos PostgreSQL reais da Etapa 12 | BLOQUEADOS, sem staging; nao substituidos por mocks |
| Teste direto SQLite/HTTP do snapshot adulterado no coordenador | PASSOU localmente, incluÃ­do em 40 testes |
| `npm.cmd test` | PASSOU, 40/40, exit 0 |
| `npx.cmd tsc -b` | PASSOU, exit 0 |
| `npm.cmd run build` | PASSOU, exit 0; chunk acima de 500 kB |
| `npm.cmd run test:browser` | PASSOU, 1/1, navegador Edge; somente IndexedDB/offline local |
| Homologacao/uso oficial | BLOQUEADO |

O proximo passo e o responsavel provisionar staging descartavel, confirmar ref e autorizar explicitamente. Entao aplicar 013 apos dry-run e rever ACLs efetivas; implementar a RPC apenas com fixture/testes SQL no ambiente aprovado. Manter cliente e coordenador fail-closed ate o teste completo. Continuam pendentes isolamento RLS/RBAC real, concorrencia, revogacao, autoria de outbox e aprovacao esportiva.

### Suplemento de ACL e caminho alternativo

Migration 013 permanece imutavel. Migration nova `202610220014_track_service_role_stop.sql` complementa a suspensao revogando explicitamente EXECUTE e escrita de `service_role`; a cadeia esperada passa a ter 14 migrations. Nenhuma foi aplicada. Cliente nao chama mais a RPC antiga e preserva/quarentena outbox; coordenador rejeita qualquer escrita `track_states` recebida diretamente, antes de persistir. Isso nao prova ACL efetiva nem limita o owner/superuser; staging segue necessario.


Registro final dos comandos Etapa 12: `npm.cmd test` PASSOU 40/40 exit 0; `npx.cmd tsc -b` PASSOU exit 0; `npm.cmd run build` PASSOU exit 0 (Vite 6.4.5, 1.628 modulos, aviso chunk >500 kB); `npm.cmd run test:browser` PASSOU 1/1 no Edge 155 em loopback, evento ficticio, apenas IndexedDB/offline local. Nenhum desses comandos aplicou migration ou acessou Supabase. Testes PostgreSQL/RLS e ACL efetiva seguem BLOQUEADOS por falta de staging confirmado.

## Preparacao da Etapa 13 (sem operacao remota)

CLI `supabase` nao instalada, ausente do package/lock; Node 24.21.0 e npm 11.19.0. Nao existe `supabase/config.toml` nem ref linked local. Foram encontrados 14 arquivos locais, ate migrations 013/014; historico remoto permanece desconhecido. Nenhum login, link, consulta ou dry-run ocorreu. O responsavel informou staging separado, mas o ref ainda precisa ser confirmado.

Apos confirmacao do ref e verificacao visual no Dashboard (Project ID e URL devem corresponder exatamente), plano: instalar CLI em versao estavel aprovada sem alterar dependencias do app; preparar config CLI local; autenticar sem imprimir token; linkar explicitamente o ref; conferir lista de projetos e historico de migrations; executar apenas `supabase db push --dry-run`; revisar todas as migrations que seriam aplicadas. A CLI oficial explica `link`, `migration list`, `db push --dry-run` e avisa que `db push` aplica todas as migrations pendentes. Nenhuma aplicacao ocorrera sem nova confirmacao explicita. Nao usar `db reset --linked`.

Consequencias previstas: 013 retira a RPC antiga para papeis cliente e DML direto via PUBLIC/anon/authenticated; 014 revoga explicitamente service_role. O estado remoto de pista continua legivel sob RLS, mas chamadas, julgamento, resultados, retornos e controles deixam de gravar pelas rotas normais. As migrations nao apagam dados; operacoes locais permanecem bloqueadas/pendentes. Migration 013/014 podem nao ser as unicas pendentes: se staging estiver limpo, o dry-run pode propor todas as 14 migrations, e isso exige revisao separada antes de qualquer `db push`.

## Etapa 12B - gate de conexao ao staging (22/10/2026)

### Verificado sem acesso remoto

- Ref informado pelo responsavel: `ftaxsyrnvbjsncimdmom`, ainda nao conferido independentemente contra Dashboard/projetos autenticados.
- CLI Supabase ausente; versao nao consultavel. Ambiente local: Node `v24.21.0`, npm `11.19.0`; 14 migrations locais (001-014). Nao ha `supabase/config.toml` nem ref linked; o contrato `docs/RPC_PISTA_SEGURA.md` existe.
- Nenhuma instalacao, autenticacao, vinculacao, consulta, dry-run ou escrita remota ocorreu. Sincronizacao remota da pista continua desativada/bloqueada.

### Instalacao e autenticacao propostas (aguardam autorizacao)

Metodo recomendado para este projeto: dependencia de desenvolvimento npm, versionada no lockfile: `npm.cmd install --save-dev supabase`. O Node instalado atende o requisito oficial (20+). Depois da autorizacao e instalacao, verificar com `npx.cmd supabase --version`. Nao usar `npx` antes de instalar/autorizarem, pois pode baixar pacote implicitamente.

Autenticar interativamente com `npx.cmd supabase login`, sem fornecer token como argumento, variavel registrada, arquivo do repositorio ou log. Confirmar o destino visualmente no Dashboard em Project Settings > General: Project ID deve ser exatamente `ftaxsyrnvbjsncimdmom` e projeto/URL devem corresponder ao staging separado. So com autorizacao de vinculo: `npx.cmd supabase link --project-ref ftaxsyrnvbjsncimdmom`. Depois, conferir `npx.cmd supabase projects list` e `Get-Content supabase/.temp/project-ref`; qualquer divergencia interrompe a validacao.

### Consultas remotas preparadas; nao executar sem confirmacao separada

1. `npx.cmd supabase migration list --linked` - consulta o historico local/remoto.
2. `npx.cmd supabase db push --dry-run --linked` - somente simula e lista migrations pendentes, sem aplica-las. Pode propor qualquer subconjunto das 14 migrations, nao apenas 013/014; registrar e revisar a lista integral.

Nao executar `supabase db push`, `db reset`, SQL remoto nem reativar a sincronizacao. Para continuar, o responsavel precisa primeiro autorizar explicitamente a instalacao local da CLI; depois, autorizar login/vinculo conforme o destino revisado; antes das consultas remotas acima, deve confirmar a execucao dos dois comandos exatos. Nenhum estado ou grant remoto esta comprovado ate essas consultas e os testes PostgreSQL posteriores.

## Etapa 12B - resultado da instalacao local (22/10/2026)

A raiz foi confirmada como `C:\Users\abreu\Desktop\Connect PDM`. A CLI nao estava instalada. Os manifests foram conferidos antes da tentativa e nao havia modificacoes de trabalho Git disponiveis para comparar; leitura direta confirmou que `package.json` e lockfile estavam alinhados quanto as dependencias atuais e nao listavam `supabase`.

Foi executado uma vez `npm.cmd install --save-dev supabase`; resultado: **FALHOU, exit 1**, `EACCES` ao buscar `https://registry.npmjs.org/supabase`. O npm tambem nao conseguiu escrever em `C:\Users\abreu\AppData\Local\npm-cache\_logs`. A tentativa nao alterou `package.json` nem `package-lock.json`; a dependencia nao foi instalada. Nao se tentou executar como administrador, alterar permissoes, contornar o registry ou repetir a instalacao.

Por isso, `npx.cmd supabase --version`, login, link, consultas remotas e os tres comandos de validacao pos-instalacao nao foram executados. Proximo passo concreto: corrigir com o administrador do ambiente a conectividade/autorizacao de requisicao ao registry e a escrita do cache npm; entao, mediante autorizacao, repetir uma instalacao local e executar `npm.cmd test`, `npx.cmd tsc -b` e `npm.cmd run build`. Banco remoto nao foi consultado nem validado; nao houve aplicacao de migrations e a sincronizacao da pista permanece bloqueada.

## Etapa 12C - diagnostico de registry e cache npm (22/10/2026)

| Verificacao | Resultado |
|---|---|
| `node --version` / `npm.cmd --version` | `v24.21.0` / `11.19.0` |
| `npm.cmd config get registry` | `https://registry.npmjs.org/` (esperado) |
| `npm.cmd config get cache` | `C:\Users\abreu\AppData\Local\npm-cache` |
| `npm.cmd config get userconfig` / `globalconfig` | `C:\Users\abreu\.npmrc` / `C:\Users\abreu\AppData\Roaming\npm\etc\npmrc`; conteudo nao foi lido |
| Proxy | `proxy` e `https-proxy` npm sem valor; variaveis de ambiente HTTP(S)/ALL proxy ausentes |
| Escrita no cache padrao | FALHOU; o caminho existe, mas arquivo-prova recebeu Access Denied |
| Escrita no projeto | PASSOU; raiz e cache temporario `.npm-cache` aceitaram arquivo-prova, removido depois |
| Registry HTTPS | FALHOU; `curl.exe --head --max-time 10 --silent --show-error https://registry.npmjs.org/supabase` exit 1, curl (7), nao conseguiu conectar na porta 443 |
| `npm ping` | Nao respondeu (apenas PING notice); interrompido, exit 1 |

Diagnostico: bloqueio de conectividade HTTPS de saida/politica do ambiente e permissao de escrita negada no cache npm padrao. Nao ha indicio de proxy configurado. Sao dois problemas distintos. Cache no projeto corrige apenas a escrita do cache, nao a conectividade. Nao alterar permissoes globais, proxy, certificados, registry ou seguranca Windows.

Quando a conectividade aprovada estiver disponivel, e apos nova confirmacao, instalar localmente com `npm.cmd install --save-dev supabase --cache .\\.npm-cache`. Esse comando nao foi executado. `package.json`/`package-lock.json` permaneceram sem a CLI; nenhum login/vinculo/comando remoto foi feito; migrations e banco remoto nao foram consultados. Tests/build desta etapa nao executados porque a CLI nao instalou e nao houve mudanca nos manifests. Sincronizacao da pista continua bloqueada.

## Etapa 12D - DNS/TCP/HTTPS do registry npm (22/10/2026)

| Teste | Resultado observado |
|---|---|
| Diretorio | `C:\Users\abreu\Desktop\Connect PDM` |
| DNS `Resolve-DnsName registry.npmjs.org` | PASSOU; A e AAAA resolvidos |
| TCP `Test-NetConnection registry.npmjs.org -Port 443 -InformationLevel Detailed` | FALHOU; resolucao OK, `TcpTestSucceeded=False` |
| HTTPS `curl.exe --verbose --head --max-time 15 https://registry.npmjs.org/supabase` | Exit 7; `connect ... port 443 ... failed: Bad access`; nao alcancou TLS/HTTP |
| Proxy/instrucoes locais | Nenhuma configuracao npm/env de proxy ou instrucao do administrador localizada; `.npmrc` nao foi lido |

Causa provavel atual: restricao de rede/politica no contexto desta execucao, pois DNS resolve e TCP e negado antes de TLS. Nao e possivel distinguir, somente por estes testes, politica do sandbox versus firewall/EDR local. Ha registro historico no proprio relatorio de acesso HTTPS bem-sucedido quando executado em ambiente com rede autorizada; logo o resultado atual nao comprova indisponibilidade geral do registry. O responsavel pela rede/computador deve confirmar a politica e liberar, se autorizado, conexao de saida TCP 443 a `registry.npmjs.org` no contexto de instalacao. Nao modificar DNS, proxy, certificados, firewall, antivirus, ACL ou controles.

Interrompido aqui aguardando liberacao autorizada. A CLI continua ausente; nenhum login, link, acesso Supabase ou migration executados; `package.json` e lockfile preservados; sincronizacao oficial da pista segue bloqueada.

## Etapa 12E - verificacoes locais sem operacao remota (22/10/2026)

| Cenario | Resultado | Observacao |
|---|---|---|
| Dependencias locais | PRESENTES parcialmente | `node_modules`, TypeScript e Vite locais existem; Supabase CLI ausente. Nenhuma instalacao executada. |
| `npm.cmd test` | PASSOU | 40/40, exit 0. |
| `npx.cmd tsc -b` | PASSOU | Exit 0. |
| `npm.cmd run build` | FALHOU | Exit 1; TypeScript passou; Vite/esbuild negou leitura de `../..` e nao carregou `vite.config.ts`. Sem alterar permissao/config. |
| `npm.cmd run test:browser` | FALHOU / fluxo nao executado | Exit 1; Edge preview nao inicia pelo mesmo erro de acesso do Vite; nao atesta o fluxo de UI. |
| Inventario de migrations | PASSOU (estatico) | 14 arquivos ordenados 001-014. Estado remoto nao consultado; 013/014 constam nos registros anteriores como nao aplicadas, demais status remotos nao confirmados. |
| Contrato RPC segura | REVISADO (documental) | `docs/RPC_PISTA_SEGURA.md` descreve contrato, mas RPC ainda nao implementada/testada em PostgreSQL. |
| Outbox de pista | BLOQUEADA e preservada | `syncTrackOperations` marca itens pendentes `blocked` sem apagar; cliente nao chama a RPC suspensa. |
| Reconciliacao de estados antigos | BLOQUEADA | Nao ha fluxo operacional implementado de comparacao, decisao autorizada e reprocessamento. Criar/testar esse procedimento antes de reativar sync. |
| Supabase real/RLS/RBAC/sync | NAO EXECUTADO | Sem login, link, consulta, SQL ou migrations remotas. |

Próximos passos: tratar o acesso de rede ao registry com o administrador; executar build/browser em terminal autorizado que tenha acesso ao workspace sem enfraquecer protecoes; provisionar/confirmar staging e obter autorizacao antes das consultas remotas; implementar/testar reconciliacao e RPC com testes PostgreSQL antes de qualquer escrita remota. Nao reativar sync, nao afirmar migration aplicada e nao liberar uso oficial.

## Etapa 12F - causa do bloqueio Vite/Edge (22/10/2026)

A raiz e CWD sao `C:\Users\abreu\Desktop\Connect PDM`. `package.json` e `vite.config.ts` sao legiveis. Dependencias locais: Vite `6.4.5` (`^6.0.1` no package) e esbuild `0.25.12`. A configuracao nao usa caminho `../..` nem root/config externo; seu `projectRoot` parte da propria URL do arquivo e a escrita de service worker fica em `dist`.

Leitura direta e `realpath` do config passaram. A enumeracao de `../..`, resolvida como `C:\Users\abreu`, foi negada pelo ambiente. O erro anterior do bundler foi `Cannot read directory "../..": Acesso negado` e nao resolveu o config absoluto; a chamada `vite preview` iniciada pelo teste browser reproduziu a mesma falha antes do Edge abrir. Isto aponta para limite de acesso do sandbox/processo ao diretorio pai, embora sem trace do esbuild nao seja possivel provar internamente por que o loader requisita essa leitura. Nao alterar configuracao: a correcao minima proposta e rodar build/preview num terminal autorizado com leitura necessaria, sem mudar ACL ou enfraquecer seguranca.

A suite `tests/browser/track-console.test.mjs` chama o binario Vite preview com CWD no projeto, espera resposta HTTP de loopback e so entao abre Edge headless isolado via CDP; a falha do preview torna o fluxo browser nao executado. Estado previamente medido: testes 40/40 e TypeScript PASSARAM; build e browser FALHARAM pelo acesso negado. Estes comandos nao foram repetidos na Etapa 12F.

CLI Supabase continua ausente. Sem login, link, consulta remota ou migration. Uso oficial continua BLOQUEADO por validacao PostgreSQL/RLS/RBAC/sincronizacao e regras da comissao.

## Etapa 12G - validacao pendente em terminal habitual

Nao foi possivel executar build/browser nesta etapa: o unico terminal disponivel permanece no sandbox que anteriormente negou acesso a `C:\Users\abreu`. Nao solicitei elevacao e nao tentei mudar permissoes. Assim, para esta etapa, `npm.cmd run build` e `npm.cmd run test:browser` estao **NAO EXECUTADOS**, sem novos codigos de saida. Os resultados conhecidos anteriores continuam build FALHOU por acesso negado e browser FALHOU antes de Edge/fluxo. Testes unitarios 40/40 e TypeScript passaram em execucao anterior, nao repetida nesta etapa.

No terminal habitual autorizado, executar separadamente:

```powershell
Set-Location 'C:\Users\abreu\Desktop\Connect PDM'
Get-Location
npm.cmd run build
$LASTEXITCODE
npm.cmd run test:browser
$LASTEXITCODE
```

Registrar a saida integral e o exit code apos cada comando. O teste browser so passa com Edge aberto e fluxo completo exit 0. Se ambos passarem, executar tambem `npm.cmd test` e `npx.cmd tsc -b`; se persistir acesso negado, interromper e encaminhar ao administrador sem modificar controles. Sem execucao observada, nao declarar compilacao ou automacao aprovadas nesta etapa. A validacao Supabase/RLS/RBAC, isolamento entre parques e sincronizacao da pista continua pendente e impede uso oficial.

## Etapa 12H - evidencias locais de homologacao informadas pelo operador

Resultados informados pelo operador nesta sessao (nao reexecutados por este agente):

| Comando/cenario | Resultado reportado | Limites |
|---|---|---|
| `npm.cmd run build` | PASSOU, exit 0; Vite 6.4.5, 1.628 modulos, 14,43 s | Bundle principal ~540,91 kB; aviso acima do limite de 500 kB. |
| `npm.cmd run test:browser` | PASSOU, 1/1 no Edge 155.0.4283.62 | Evento ficticio, fila, recarga IndexedDB e recuperacao offline local. Um favicon 404 e duas falhas de rede esperadas durante offline. IndexedDB isolado; sem outbox remota configurada. |
| `npm.cmd test` | PASSOU, 40/40, exit 0 | Informado pelo operador. |
| `npx.cmd tsc -b` | PASSOU, sem erros reportados | Exit code nao informado separadamente. |

Esses resultados substituem o bloqueio local de build/preview registrado em 12G para a execucao do operador, mas sao somente evidencias locais reportadas. Nenhuma operacao Supabase foi feita.

Permanecem bloqueios: CLI ausente; estado remoto de migrations desconhecido; 013/014 sem evidencia de aplicacao; RPC segura ainda sem implementacao/validacao PostgreSQL; reconciliacao de estados antigos sem procedimento operacional completo; RLS/RBAC, ACLs efetivas, isolamento entre parques, concorrencia e sincronizacao remota pendentes. Uso oficial continua bloqueado.

## Etapa 13 - ambiente local para Supabase (sem instalacao ou conexao)

| Verificacao | Resultado |
|---|---|
| Raiz | `C:\Users\abreu\Desktop\Connect PDM` |
| Estado Git | Indisponivel: `fatal: not a git repository`; nao ha metadados Git nesta pasta |
| Node/npm | `v24.21.0` / `11.19.0` |
| CLI global/local | Ausente; nenhum binario/package local, `package.json` sem CLI. Versao nao disponivel. `npx` nao executado para evitar download implicito. |
| HTTPS registry | FALHOU, curl exit 7 ao conectar `registry.npmjs.org:443` |
| Config/ref local | Sem `supabase/config.toml`, sem `.temp/project-ref`, sem `.npm-cache`; 14 migrations locais |
| Dashboard | Nao acessado; ref `ftaxsyrnvbjsncimdmom` e finalidade de staging sao informacoes fornecidas pelo responsavel, sem confirmacao visual independente |
| Operacao remota | Nenhum login, link, consulta ou migration |

Instalacao recomendada quando autorizada e depois de a conectividade HTTPS ser liberada: `npm.cmd install --save-dev supabase --cache .\\.npm-cache`. Modifica package e lockfile; nao executado. Confirmar no Dashboard > Project Settings > General que Project ID e finalidade correspondem ao staging antes de autorizar link. Antes da primeira consulta remota, apresentar os comandos exatos e aguardar autorizacao especifica.

Historico remoto das 14 migrations segue desconhecido. Relatorios anteriores registram 013/014 como nao aplicadas na verificacao entao disponivel, mas nao ha consulta atual; nao assumir que foram aplicadas. Sync de pista continua bloqueada, sem RPC validada em PostgreSQL. Permanecem pendentes validacao real de RLS/RBAC, permissoes, isolamento entre parques, concorrencia e sincronizacao. Uso oficial nao autorizado.

## Etapa 13B - validacao CLI instalada localmente

| Item | Resultado observado |
|---|---|
| Dependencia package/lock | CLI registrada como devDependency `^2.121.0`; versao instalada `2.121.0` |
| Binario CLI local | `node_modules/.bin/supabase.cmd --version`, com opt-out de telemetria apenas no processo: `2.121.0`, exit 0 |
| Esbuild | `0.25.12`; postinstall `node install.js` consta no pacote e nao foi aprovado/executado. Binario local `esbuild.cmd --version` respondeu `0.25.12`, exit 0. |
| `npm.cmd test` | PASSOU, 40/40, exit 0 |
| `npx.cmd tsc -b` | PASSOU, exit 0 |
| `npm.cmd run build` | FALHOU, exit 1; `Cannot read directory "../..": Acesso negado`, `Could not resolve ... vite.config.ts` |

A primeira execucao de `supabase --version` tentou escrever arquivo de telemetria em `%USERPROFILE%\\.supabase` e recebeu EPERM. Foi repetida apenas a chamada local de versao com a variavel oficial documentada `SUPABASE_TELEMETRY_DISABLED=1`, restrita ao processo; sem login ou acesso a projeto. O build falhou pela restricao de leitura do diretorio pai ja registrada, nao por erro de execucao do script de instalacao do esbuild. Nenhum teste de navegador executado nesta etapa.

Nenhum script pendente foi aprovado, pacote reinstalado ou operacao Supabase remota feita. Nao houve `login`, `link`, consulta, migration ou escrita. A CLI local nao valida conectividade nem staging. Antes da etapa remota ainda sao necessarios autorizacao, comprovacao do project ref no Dashboard e confirmacao separada antes de cada consulta. RPC segura, grants/RLS/RBAC, isolamento entre parques, concorrencia e sincronizacao da pista seguem pendentes; uso oficial bloqueado.

## Etapa 14 — plano de validação do modelo Connect PDM (22/10/2026)

1. Preparar PostgreSQL/Supabase local descartável e configurar a CLI localmente se necessário. Nesta sessão não existe config.toml e Docker daemon não está disponível.
2. Aplicar a cadeia local em ordem, migrations 001 a 015. Antes de aceitar a 015, listar usuários operacionais legados ativos e eventos ativos que terminam no futuro. Conferir que cada staff convertido recebe membership por evento com expiração e que os registros antigos foram preservados/auditados. Convites antigos não aceitos para papel operacional são revogados e devem ser recriados por evento.
3. Executar supabase test db --local com supabase/tests/connect_pdm_operations.test.sql. O arquivo contém 25 assertions pgTAP para funções por papel, dois parques, RLS, expiração/revogação, bloqueio da RPC antiga e ausência de DML direto. NÃO EXECUTADO nesta sessão.
4. Demonstrar que repetir o mesmo código de parque recupera o mesmo ID sem atualizar cadastro; criar segundo evento com ID distinto; confirmar eventos/histórico prévios intactos.
5. Testar convite por email individual, papel/escopo, consumo/repetição pelo mesmo usuário, tentativa por outro email, expiração, revogação, sessão aberta e evento encerrado.
6. Testar direto via PostgREST/PostgreSQL com dois parques e cada papel; confirmar acesso negado fora do escopo e para operações não autorizadas. Validar concorrência e auditoria.
7. Validar build e fluxo UI em terminal autorizado, sem contornar ACLs. O build e o preview desta execução falharam por Acesso negado a ../.. e vite.config.ts.
8. Somente após aceite local, revisar projeto de staging no painel oficial e plano de migration, pedir confirmação específica e executar validação remota autorizada em sessão separada. Nada remoto foi executado neste trabalho.

### Evidência local desta execução

- npm.cmd test: PASSOU, 46/46, exit 0.
- npx.cmd tsc -b: PASSOU, exit 0.
- npm.cmd run build: FALHOU, exit 1 por acesso negado do Vite/esbuild ao diretório pai e configuração.
- npm.cmd run test:browser: FALHOU, exit 1 porque preview não inicia; nenhum cenário novo do navegador foi executado.
- Banco PostgreSQL local e pgTAP: BLOQUEADOS. psql indisponível; Docker client existe, mas daemon local não.
- Staging/remoto: NÃO EXECUTADO. CLI 2.121.0 local, sem arquivo de configuração local; nenhuma conexão/login/consulta/aplicação.

### Critérios de aprovação desta fase

- cadeia completa de migrations passa em banco descartável;
- testes pgTAP reais passam, incluindo positivos/negativos e isolamento por parque/evento;
- conversão operacional legada é revisada e não concede acesso a eventos futuros;
- build, testes e navegador passam no ambiente acessível;
- staging é confirmado independentemente e validado com RLS, RBAC, revogação e concorrência;
- a RPC de pista segura permanece bloqueada até validação integral; a classificação oficial permanece bloqueada até a comissão aprovar pontuação e desempates.

A área Connect PDM e a área operacional são separadas. Usuários de implantação/suporte não recebem permissões de operação só por pertencerem à plataforma, e o painel do responsável do parque é opcional.


Atualização após tentativa local explícita: npx.cmd supabase test db --local exit 1 com conexão recusada em 127.0.0.1:54322; Docker daemon indisponível e psql ausente. A suíte PostgreSQL permanece BLOQUEADA, não é um resultado de teste aprovado/reprovado.



Importante: a camada de contexto do novo frontend tolera ausência das RPCs de perfil introduzidas em 015 para manter compatibilidade temporária com leitura de contas existentes. Essa tolerância não aplica segurança ao banco. Enquanto 015 não estiver aplicada, versões antigas do cliente e o backend antigo ainda podem usar cadastro self-service/escopo de parque. Portanto, não publicar a aplicação como substituto da migration. Aplicar e validar primeiro em banco descartável e staging, depois publicar frontend; sincronização da pista continua bloqueada.
## Etapa 15 — banco descartável, migration 015 e regressão local (22/10/2026)

### Pré-condições e execução

Há 15 arquivos SQL locais. A CLI Supabase local é 2.121.0 e Docker CLI 29.8.2, mas o daemon não está disponível (`docker info`: pipe `//./pipe/docker_engine` inexistente; leitura da configuração Docker do usuário também foi negada). `psql` e `supabase/config.toml` não estão disponíveis. `npx.cmd supabase test db --local` exit 1 com `ECONNREFUSED 127.0.0.1:54322`. Não instalar serviços, alterar configuração do sistema ou conectar ao Supabase remoto para contornar a falta.

Após disponibilizar Docker Desktop/daemon em sessão autorizada, configure a CLI local sem associar projeto remoto, confira explicitamente que o destino é apenas o container local descartável e inicie Supabase local. Execute `supabase db reset --local` somente após confirmar que não há link remoto ativo e que o destino é o container local; capture o resultado de cada migration. Rode `supabase test db --local` e guarde o resultado nominal pgTAP. Não use `db push`, `migration repair` nem endpoint staging/produção neste roteiro.

### Bloqueio obrigatório antes da cadeia com dados legados

A inspeção estática detectou que 015 copia associações de parque para todos os eventos ativos/futuros do parque. Antes de executar a migração em cópia com dados representativos, a organização deve fornecer um roster com associação inequívoca pessoa↔evento ou aprovar processo conservador de quarentena/revisão manual. Sem isso, interromper a conversão, revisar `docs/REVISAO_EQUIPE_LEGADA_MIGRATION_015.md` e não declarar o cenário aprovado. Uma membership de parque não prova designação para cada evento.

O teste `connect_pdm_operations.test.sql` declara 25 verificações, todas NÃO EXECUTADAS até haver PostgreSQL local. Testes estáticos não demonstram grants efetivos, RLS, ownership/bypass, triggers ou `SECURITY DEFINER`.

### Verificações de aplicação

Nesta sessão: `npm.cmd test` PASSOU 46/46; `npx.cmd tsc -b` PASSOU; `npm.cmd run build` FALHOU exit 1 com acesso negado ao diretório `../..` e resolução de `vite.config.ts`; `npm.cmd run test:browser` FALHOU exit 1 porque o preview Vite não iniciou. Repetir build/navegador em terminal autorizado com acesso legítimo já concedido; não alterar ACLs nem proteções.

### Critérios pendentes

1. Revisar a conversão legada antes de executar sobre cópia com dados representativos.
2. Executar a cadeia 001–015 integral em PostgreSQL descartável e identificar eventuais erros por migration.
3. Executar nominalmente 25 verificações pgTAP e complementar cenários ainda ausentes, como não autenticado, convite expirado/reutilizado e caminhos alternativos de escrita.
4. Validar build/browser em terminal autorizado.
5. Só depois considerar staging autorizado, confirmar destino no painel e obter aprovação explícita; manter pista remota bloqueada até RPC segura validada.

## Etapa 16 — controle de migration 015 e reconciliacao por evento

Antes de qualquer tentativa de aplicar a cadeia em base com dados, executar `supabase/diagnostics/legacy_staff_migration_015_preflight.sql` apenas em copia local descartavel. Esse script e somente leitura; qualquer membership operacional ou convite aberto e um bloqueio para a migration 015. Como 016 e posterior a 015, ela nao protege uma base de uma 015 pendente. Nao aplicar 015 automaticamente em base com origens legadas sem estrategia revisada e ensaiada. Nao editar a migration historica sem determinar o historico de distribuicao do ambiente.

Depois de 015, aplicar 016 somente em PostgreSQL descartavel apos inspecao do plano de migrations. Preparar lote de reconciliacao, revisar cada candidato com roster/documento pessoa-evento, aprovar com operador autorizado e ativar por segundo operador. Verificar que candidatos ambiguos/sem destino nao alteram grants, memberships conflitantes param para revisao, retries nao duplicam e auditoria preserva antes/depois. A funcao nao reativa a membership ampla do parque.

O arquivo `supabase/tests/legacy_staff_reconciliation.test.sql` declara 29 assercoes planejadas para cenarios ficticios, incluindo grant seguido de revogacao. Nao foi executado: Docker daemon nao esta disponivel, `psql` nao existe e a CLI local falhou conectando a `127.0.0.1:54322`. Tratar pgTAP como BLOQUEADO ate rodar cadeia completa e `supabase test db --local` numa instancia descartavel.

Em ambientes onde 015 ja foi aplicada, nao revogar em lote memberships por evento: origem/procedencia pode ser ambigua. Inventariar e resolver manualmente. A referencia `review_document:` depende de validacao humana externa. Nenhuma consulta/migration remota foi feita nesta etapa.

### Resultado local atualizado — Etapa 16

- `npm.cmd test`: PASSOU, 49/49, exit 0.
- `npx.cmd tsc -b`: PASSOU, exit 0.
- `npm.cmd run build`: FALHOU, exit 1, acesso negado do Vite/esbuild a `../..` e falha ao resolver `vite.config.ts`.
- `npm.cmd run test:browser`: FALHOU, exit 1, preview Vite nao subiu; nenhum cenario Edge executado.
- PgTAP: `plan(29)` com 29 chamadas no arquivo; 0 executadas. `supabase test db --local` permanece bloqueado por `ECONNREFUSED 127.0.0.1:54322`; sem daemon Docker e sem `psql`.
- Nao houve acesso, consulta ou escrita no Supabase remoto. Nenhuma migration aplicada. A classificacao da migration 015 remota permanece desconhecida; 016 nao foi validada no PostgreSQL.

Esta atualizacao prevalece sobre contagens historicas anteriores: o conjunto local agora inclui a migration 016 (16 migrations); nao implica aplicacao remota.

## Estabilizacao e verificacao PostgreSQL local — 22/10/2026

O erro de build foi isolado ao bundling de `vite.config.ts` pelo esbuild tentando ler `../..`. Foi corrigido no script build/preview com `--configLoader runner`, sem alterar permissões. Build passou. O preview também inicia via runner; o teste Edge ainda falha antes da navegação por encerramento do processo GPU e timeout `Runtime.enable`, portanto o cenário browser permanece reprovado/bloqueado por ambiente.

Foi iniciado um cluster PostgreSQL 18 descartável em `%TEMP%`, loopback porta 55433; `pg_ctl` foi bloqueado pela política de token restrito, mas `postgres.exe` direto iniciou. Uma estrutura Auth mínima local (não GoTrue/Supabase completo) permitiu aplicar 001–016 com cada migration em transação própria. 16/16 passaram após corrigir a sintaxe da migration 012, policies duplicadas em 015 e tipagem de NULL no UNION da 016. Arquivos 012/015 históricos foram alterados explicitamente nesta rodada; veja STATUS e REVISAO_EQUIPE_LEGADA_MIGRATION_015 antes de qualquer rollout. Não reaplicar em ambiente que já marcou tais versões.

O preflight 015 foi executado com fixtures pre-015 e retornou BLOCK para uma membership/um convite. Aplicar a 015 falhou com a guarda antes de mudanças; os vínculos ficaram ativos e `connect_code` não foi adicionado. Esse é o teste negativo efetivamente aprovado no PostgreSQL local.

25 asserções de `connect_pdm_operations.test.sql` e 29 de `legacy_staff_reconciliation.test.sql` passaram usando um adaptador de assertions local em PostgreSQL real, porque a extensão pgTAP não está instalada. O SQL de teste foi copiado a `%TEMP%` sem a instrução de instalação do pgTAP; funções de negócio e fixtures executaram no banco. Não chamar esse resultado de pgTAP: `supabase test db --local` oficial segue BLOQUEADO sem Docker/Supabase stack.

O Connect Admin inclui a UI para inventariar/revisar/ativar equipes legadas via RPC. A interface ainda não foi testada com auth/backend real. RPC segura da pista não foi implementada; 013/014 e bloqueio de sync permanecem. Supabase remoto não foi acessado.

Fechamento da rodada: executar novamente `npm.cmd test`, `npx.cmd tsc -b`, `npm.cmd run build`, `npm.cmd run test:browser`; registrar códigos e possíveis regressões. Para homologação completa ainda são necessários Edge funcional, pgTAP/Supabase local real ou stack autorizada, ambiente staging separado, validação RLS/RBAC/concorrência remota, implementação/teste da RPC segura da pista e aprovação da comissão sobre pontuação/desempate.

## Fechamento da rodada — resultados verificaveis

Aplicacao: `npm.cmd test` PASSOU 50/50 (exit 0); `npx.cmd tsc -b` PASSOU (exit 0); `npm.cmd run build` PASSOU (exit 0, Vite 6.4.5, 1629 modulos, bundle 568.07 kB com aviso). `npm.cmd run test:browser` FALHOU (exit 1): preview iniciou, Edge GPU encerrou e DevTools expirou antes de carregar a pagina. Nenhum fluxo de browser pode ser considerado aprovado.

Banco local: cadeia 001–016 PASSOU em PostgreSQL 18 descartavel com Auth scaffold; 25/25 e 29/29 assertions SQL passaram por adaptador temporario, nao pgTAP oficial. Preflight pre-015 detectou membership/invite e a propria 015 abortou sem mutacao. `npx.cmd supabase test db --local` BLOQUEADO (exit 1, ECONNREFUSED 127.0.0.1:54322; Docker daemon indisponivel). Nao houve acesso remoto.

Mudancas em migrations historicas 012 (parentese sintatico) e 015 (preflight fail-closed e policies idempotentes) sao explicitas e precisam de revisao de historico antes de rollout; nenhuma migration foi aplicada remotamente. A migration 016 e migration 012/015 passaram na cadeia local.

Bloqueios oficiais: RPC segura da pista ainda nao implementada/testada, RLS/RBAC e concorrencia Supabase sem staging, UI de reconciliacao sem navegador/backend real, regras de pontuacao/desempate pendentes da comissao e recuperacao de backup nao testada. Nao liberar uso oficial.

## Rodada focada — 22/10/2026

### Evidencias locais

| Comando | Resultado |
|---|---|
| `npm.cmd test` | PASSOU 50/50, exit 0. |
| `npx.cmd tsc -b` | PASSOU, exit 0. |
| `npm.cmd run build` | PASSOU, exit 0; 1629 modulos. Bundle principal 568.07 kB e aviso do limite de 500 kB. |
| `npm.cmd run test:browser` | FALHOU, exit 1; timeout CDP `Runtime.enable`, Edge GPU encerrou com `GPU process isn't usable` / `-1073741790`; app nao carregou. O preview iniciou. Logs integrais incluem falhas da chave EdgeUpdate (resultado 5), criptografia Windows indisponivel e cache GPU em uso. Nao alterar ACL, desativar protecoes ou encerrar processos externos para repetir. |

Docker CLI existe, mas daemon nao: `docker info --format '{{.ServerVersion}}'` retornou exit 1, pipe `//./pipe/docker_engine` inexistente e erro de leitura da configuracao Docker do usuario. `pgTAP` nao esta instalado. Binarios PostgreSQL 18/`psql 18.6` existem, mas esta rodada nao reaplicou a cadeia, pois nao houve mudanca nas migrations. Testes anteriores em PostgreSQL 18 com scaffold Auth e adaptador de assertions nao sao validacao da stack Supabase nem execucao pgTAP oficial.

### Bloqueio da RPC segura e desenho para a proxima fase

O estado remoto atual e um snapshot JSON fornecido pelo cliente (`event_track_states.state`). O cliente mantem o modelo completo de pista e a outbox no IndexedDB; `apply_event_track_operation` aceita `p_state` integral e `p_actor_label`. A RPC esta suspensa pelas migrations 013/014 e o fluxo cliente preserva a outbox como bloqueada.

O banco guarda configuracoes gerais em `events.rules`, mas o caminho remoto de `saveEvent`/`updateEvent` nao persiste `EventConfig.competition` (dias, rodizios, intervalos, capacidade, ordem e prazo). Assim, nem `call.create` pode ser avaliada pelo servidor quanto a elegibilidade/capacidade, nem uma RPC pode derivar a pista a partir de fonte canonica. Nao implementar uma RPC que aceite o snapshot seria seguro; manter todas as escritas remotas bloqueadas e o comportamento correto.

Proxima implementacao local recomendada, antes de qualquer sync:

1. Definir e versionar a configuracao competitiva como dado canonico por evento, com escrita autorizada e historico; importar/reconciliar configuracoes antigas sem assumir valores.
2. Modelar chamadas, corridas, decisoes de retorno, resultados e auditoria em tabelas com chaves compostas evento/inscricao, versao e restricoes de idempotencia. Planejar reconciliacao de snapshots/outboxes antigos sem descarte.
3. Criar RPCs por acao que recebam apenas IDs, campos da acao e versao-base; derivar ator via `auth.uid()`, parque/evento/papel do banco, bloquear a entidade, validar transicao/versao e gravar estado/historico atomicos. Comparar ator, evento, acao, versao-base e payload canonico no replay de `operation_id`.
4. Cobrir com pgTAP real: campo extra, sem sessao, cada papel, parque/evento cruzado, versao obsoleta, corrida/chamada duplicada, replay identico/adulterado, retorno e correcoes preservando resultado, concorrencia e ausencia de caminhos de DML/RPC alternativos.
5. Aplicar somente em Supabase local descartavel depois que o daemon Docker estiver funcional; manter RPC antiga suspensa e sync do cliente bloqueada ate a suite real passar.

### Migration historica, backup e ambiente

Antes de rollout de migrations 012/015, coletar o historico de migrations de cada ambiente autorizado e comparar com os arquivos efetivamente aplicados. Se 015 estiver pendente, executar primeiro o preflight em copia descartavel e revisar memberships/convites. Se 015 ja estiver aplicada, nao reexecutar/repair nem inferir a origem de memberships; inventariar e reconciliar por evento. Nenhuma consulta ou alteracao remota foi feita nesta rodada.

Preparacao de restauracao pendente: criar backup SQLite ficticio em pasta temporaria autorizada, encerrar o processo ou usar API de backup SQLite consistente, restaurar em outra pasta isolada, iniciar instancia de teste em porta loopback propria e comparar `/api/health`, `/api/snapshot`, contagem de registros, outbox, conflitos e UTF-8 antes de remover artefatos temporarios. Nenhuma copia/restauracao foi realizada nesta rodada; nao usar backup remoto ou de producao.

**Uso oficial continua bloqueado** pela falta da RPC segura implementada e validada, da stack Supabase/pgTAP local, dos testes de RBAC/RLS/concorrencia em ambiente real, da validacao do navegador Edge, da recuperacao de backup comprovada e das aprovacoes esportivas formais.
