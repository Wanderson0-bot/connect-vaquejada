# Coordenador local Connect PDM

## Componente e requisitos

O coordenador é um processo Node.js separado da PWA, instalado em um computador do parque que permaneça ligado e acessível na rede Wi-Fi local. Ele persiste o estado compartilhado em SQLite (`data/connect-pdm.sqlite`, modo WAL e `synchronous=FULL`). Requer Node.js 22.13 ou superior com `node:sqlite`; o frontend continua sendo compilado pelo Vite. Um roteador ou cache PWA não substitui esse serviço.

O processo atualmente hospeda também o build web em `dist`, e expõe `/api/health`, `/api/snapshot`, `/api/operations`, `/api/changes`, `/api/conflicts` e `/api/operation-attempts`. A rota pública `/api/health` retorna somente `{"status":"ok"}`; dados do parque e cursores de sincronização exigem autenticação. Operações levam ID idempotente, ID do dispositivo, entidade, ação e versão base. O replay compara operador, aparelho, entidade, registro, ação, versão-base e payload (ignorando apenas a ordem das chaves JSON). Uma repetição idêntica devolve o resultado originalmente persistido; o mesmo ID com outro envelope é recusado e registrado em `operation_attempts`, consultável somente pelo responsável do parque. Escritas concorrentes em versões antigas viram conflitos armazenados para revisão e a resposta inclui a versão e o registro atual. Resultados são insert-only; confirmação só altera estado pendente para oficial e correção autorizada exige justificativa e preserva o resultado substituído. A conversão de reserva cria a inscrição e finaliza a reserva numa transação SQLite.

## Configuração

No computador escolhido, instale Node.js 22.13+, faça uma instalação do projeto e gere o build (`npm ci`, `npm run build`). Defina as variáveis abaixo no ambiente do serviço antes de iniciar `npm run coordinator`:

- `CONNECT_PDM_PARK_ID`: ID único do parque associado a esta instância.
- `CONNECT_PDM_OPERATOR_CREDENTIALS`: JSON de credenciais individuais [{"userId":"UUID Auth","token":"segredo aleatorio >=32 chars","role":"office","expiresAt":"ISO-8601 UTC","disabled":false}]. Configure tokens diferentes por usuario; nao inclua no frontend/build.
- `CONNECT_PDM_DB`: caminho persistente do arquivo SQLite (padrão `data/connect-pdm.sqlite`). Inclua essa pasta no plano de backup.
- `CONNECT_PDM_HOST` / `CONNECT_PDM_PORT`: padrão `0.0.0.0:8787`; restrinja a porta no firewall à rede local.
- `CONNECT_PDM_TLS_CERT` e `CONNECT_PDM_TLS_KEY`: configure ambos para HTTPS. Certificado deve ser confiável nos aparelhos, especialmente para instalar/usar PWA.
- `CONNECT_PDM_ALLOWED_ORIGINS`: origens de desenvolvimento autorizadas por CORS. A PWA servida pelo mesmo host não precisa de CORS.

Copie a URL HTTPS e o token individual do operador para a area **Rede local** do aparelho correspondente e use a acao de conexao. O token fica em localStorage; proteja o aparelho e use HTTPS.

O coordenador usa uma instancia/arquivo por parque. Cada token individual identifica usuario e papel no servidor; veja a secao Etapa 6 abaixo. Nao exponha a porta a internet.

## Persistência e recuperação

O coordenador mantém seu próprio banco SQLite e o inicializa/migra até o esquema 2. Uma base com `user_version` superior é recusada; faça backup antes de atualizar a aplicação. Para criar um snapshot consistente enquanto o coordenador está ativo, use o utilitário baseado em `node:sqlite`:

```powershell
# CONNECT_PDM_DB pode ser omitido para usar data/connect-pdm.sqlite
New-Item -ItemType Directory -Force backups
npm run coordinator:backup -- backup .\data\connect-pdm.sqlite .\backups\evento.sqlite
npm run coordinator:backup -- verify .\backups\evento.sqlite
# Restauração sempre exige um novo caminho; o utilitário não sobrescreve arquivos existentes.
npm run coordinator:backup -- restore .\backups\evento.sqlite .\data-restaurada\connect-pdm.sqlite
```

Backup e manifesto `.manifest.json` são arquivos separados. O manifesto registra SHA-256, versão da aplicação/esquema, migrações, contagens e os resultados de `PRAGMA integrity_check`/`foreign_key_check`. O comando `verify` confere o hash antes de abrir o SQLite, depois verifica conteúdo, esquema e contagens. Restaure primeiro para uma pasta isolada e confirme os dados; para ativar a cópia, pare o coordenador, configure `CONNECT_PDM_DB` para o arquivo restaurado e reinicie. Guarde o banco e o manifesto juntos.

Hash e manifesto detectam corrupção acidental, mas não são criptografia nem proteção contra um agente que possa alterar ambos. Restrinja acesso por ACL do Windows, proteja a mídia e mantenha cópias criptografadas/offline fora do host, com retenção definida e responsável designado. Não copie somente o arquivo principal do SQLite ativo pelo Explorer. O utilitário não agenda, cifra, envia, nem apaga/rota backups; diretório e cópia fora do host são responsabilidade operacional. Testes usam apenas bancos fictícios temporários e não comprovam restauração em outro aparelho. Não há ensaio operacional, cópia remota, agendamento ou alerta.

Este backup cobre somente o SQLite do coordenador: registros/versões, operações, conflitos, tentativas registradas e migrações. Não contém IndexedDB/outboxes/cache de cada navegador, nem dados remotos Neon/PostgreSQL/Auth. O backup JSON da seção “Backup e restauração” é outro fluxo e não inclui este banco SQLite.

## Limites verificados

A PWA mantem uma outbox IndexedDB por aparelho e reenvia operacoes quando conecta. Dispositivos conectados recebem notificacoes autenticadas pelo fluxo SSE e atualizam seus snapshots; uma consulta a cada 30 segundos e ao voltar para a aba recupera notificacoes perdidas. Alteracoes offline aguardam revisao; o operador autenticado pode assumir o envio individual, e o coordenador valida permissao e grava sua identidade. Em conflito de versao, o servidor preserva a tentativa e a versao central; o aparelho adota a versao central e o responsavel do parque pode comparar os dois conteudos na tela Rede local. Ainda nao ha mesclagem automatica: apos revisar, edite o registro e envie uma nova operacao. O compartilhamento nao e uma transacao atomica entre IndexedDB e outbox: uma interrupcao abrupta entre gravacao local e enfileiramento ainda pode exigir recuperacao manual.

O estado “conectado” na interface só aparece depois de uma consulta autenticada bem-sucedida ao coordenador; antes disso é mostrado “verificando”. Falhas de transporte indicam indisponibilidade/reconexão, credenciais recusadas são separadas, e itens pendentes ou bloqueados não são apresentados como confirmados.

O coordenador nao sincroniza dados para Neon quando a internet retorna. O modo conectado Neon segue seu fluxo remoto e nao foi conectado ao SQLite. CORS nao substitui autenticacao; o coordenador local tem autenticacao individual estaticamente configurada, sem introspeccao online do Neon Auth.

Os testes automatizados usam o processo Node real, HTTP e SQLite temporário, cobrindo UTF-8, retomada após reinicialização, repetição após resposta perdida, recusa e auditoria de reuso adulterado de ID, disputa concorrente de versão entre duas identidades/dispositivos, rollback de conversão inválida, conflito recuperável, restauração de cópia isolada, e imutabilidade/confirmação/correção de resultado. Esses testes não simulam navegador/IndexedDB real. Ainda não houve ensaio com aparelhos físicos, Wi-Fi sem internet externa, certificados instalados nos dispositivos, hardware de pista ou carga de um evento real. Portanto esta etapa está parcialmente implementada e o sistema não está liberado para evento real.


## Bloqueio de segurança para rede local

O coordenador agora recusa iniciar em `0.0.0.0` ou em um endereço de rede sem TLS configurado. Configure `CONNECT_PDM_TLS_CERT` e `CONNECT_PDM_TLS_KEY` com um certificado confiável pelos aparelhos. O token é uma credencial de acesso: sem HTTPS ele poderia ser capturado por alguém conectado à mesma rede Wi-Fi. Para testes estritamente isolados em laboratório, `CONNECT_PDM_ALLOW_INSECURE_LAN=true` desativa essa proteção explicitamente; não use essa exceção em eventos ou redes compartilhadas. Para testes locais no mesmo computador, use `127.0.0.1` ou `localhost`.


## Etapa 6: identidade e autorizacao local

A autenticacao do coordenador usa a lista de operadores configurada no processo. Cada token se vincula a um UUID de usuario, papel, expiracao e estado ativo; a identidade do operador e gravada em cada operacao idempotente. `/api/operations` autoriza por entidade/acao. Leitura de snapshot/alteracoes filtra entidades e campos financeiros por papel; conflitos sao restritos ao responsavel do parque. Token ausente, expirado ou desativado recebe HTTP 401. Operador e perfil sao configuracao de servidor, nao dados aceitos do navegador.

Para emitir, rotacionar ou revogar token, atualize `CONNECT_PDM_OPERATOR_CREDENTIALS` no host e reinicie o processo. Isso ainda nao consulta Neon Auth nem percebe automaticamente alteracao de membership; portanto credenciais precisam ser provisionadas e revogadas no coordenador e na aplicacao conectada ate existir validacao online de JWT/claims com consulta remota. Nunca compartilhe token entre operadores. A credencial guardada em localStorage permite que outra pessoa com acesso ao aparelho a reutilize; use contas do sistema operacional, bloqueio de tela, HTTPS e sessao individual.

Papel aplicado pelo coordenador (sem permissao implicita global): park_manager administra operacoes do proprio coordenador; office administra cadastros/pagamento; announcer somente leitura operacional; judge registra julgamento/decisao; track_operator opera fila/rodizio. Resultado corretivo e encerramento/reabertura sao reservados ao responsavel. A instancia SQLite representa um unico parque; registros vinculados a outro parque/evento sao rejeitados/filtrados.

O modo local sem Neon Auth nao comprova identidade do operador dentro do PWA: token individual so autoriza o servidor quando sincroniza. Operacoes locais/outbox continuam nao confirmadas ate validacao e podem ser colocadas em conflito/rejeitadas. O coordenador nao substitui politicas RLS do Neon nem sincroniza os dois bancos.
