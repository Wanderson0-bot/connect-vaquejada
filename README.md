# Connect PDM

Aplicação web em português brasileiro para apoiar a gestão de vaquejadas Pé de Mourão. O repositório segue em desenvolvimento e não está aprovado para operação esportiva real.

## Stack disponível

- React, TypeScript e Vite no frontend.
- IndexedDB para o modo local de um aparelho.
- Supabase Auth e PostgreSQL com Row Level Security no modo conectado.
- Testes unitários das regras de domínio com `node:test`.

## Desenvolvimento

Requer Node.js 20 ou superior e npm.

```powershell
npm install
npm run dev
npm test
npm run build
```

O modo local existente não exige configuração externa. Ele grava no IndexedDB deste navegador e **não é login nem isolamento seguro de parques**.


## Backend multi-parque

1. Crie um projeto Supabase de desenvolvimento e outro de produção.
2. Aplique todos os arquivos de `supabase/migrations` em ordem numérica. As migrações criam o esquema-base, atualizam pagamentos, protegem resultados oficiais, criam correções com justificativa, impõem a capacidade de senhas, validam edições de capacidade e adicionam cancelamento, transferência e reservas históricas.
3. Habilite email/senha em Authentication. Configure confirmação de email, SMTP e as URLs de retorno permitidas para os ambientes local e publicado.
4. Copie `.env.example` para `.env.local`, preencha `VITE_SUPABASE_URL` e a chave pública `VITE_SUPABASE_ANON_KEY`, e reinicie o Vite.
5. Cadastre uma conta de parque. Se a confirmação estiver habilitada, confirme o email e entre para completar o perfil.

O frontend utiliza o SDK oficial e a sessão do Supabase. O cadastro do parque e de vaquejadas chama funções SQL que associam as linhas a `auth.uid()` no servidor. As consultas são filtradas pelas políticas RLS de parque/evento. A chave `anon` é pública; nunca coloque a chave `service_role` em variável `VITE_*` ou no frontend.

O painel administrativo Connect é acessado separadamente em `/connect` e exige sessão Supabase com função administrativa atribuída no servidor. Contas de parque sem essa função não entram no painel Connect. A primeira conta `platform_admin` precisa ser provisionada por operador confiável do banco; não há conta administrativa padrão. Enquanto o site público ainda não foi implementado, `/` continua sendo a entrada do aplicativo operacional. Convites administrativos de parque e evento abrem esse fluxo operacional, não `/connect`.

O painel de controle Connect consulta contagens de parques/eventos e os cinco parques mais recentes pelo RPC `get_connect_admin_dashboard`. O cadastro administrativo permite listar parques com busca por nome/código/cidade, filtros de UF e situação, paginação e perfil resumido com dados cadastrais, equipe, eventos e auditoria. As situações são derivadas no banco: “Provisionado” requer responsável/vínculo ativo, “Pendente de configuração” não tem responsável vinculado, “Suspenso” reflete `access_status`, e “Arquivado” reflete o acesso encerrado. As alterações e recuperações são registradas com ator, data e dados anteriores/novos quando aplicável. Os RPCs `list_connect_parks` e `get_connect_park_profile` e o registro de recuperações estão na migration `202610240019_connect_park_registry.sql`; aplique as migrations `202610240018_connect_admin_dashboard.sql` e `202610240019_connect_park_registry.sql` no Supabase antes de usar o painel atualizado.

Os links copiados para Escritório, Locução e Área operacional abrem uma área/evento como atalho de navegação após login. Não concedem autorização: o backend valida identidade, vínculo e permissões a cada operação. Publicações, coordenador local, erros recentes e alertas de backup/acesso suspeito ainda não têm fontes de monitoramento integradas; a interface os marca como não verificados e não exibe valores de sucesso presumidos.

Eventos, inscrições e resultados já podem ser gravados/consultados no backend quando a configuração acima está ativa. O perfil do parque pode ser editado na tela “Dados do parque”. Eventos indicam o estado conforme as datas. O Escritório permite marcar pagamentos como pendentes, pagos ou isentos, informar valor e forma e atualizar o estado após a inscrição. No modo conectado, o banco registra data/usuário autenticado e guarda antes/depois no log de auditoria. No modo local, as gravações também geram trilha no IndexedDB, identificada como ação local sem identidade autenticada.

O seletor de evento disponibiliza um CSV administrativo com inscrições, categoria, pagamento e pontos informados. Ele é identificado como provisório, não calcula posição oficial e contém dados financeiros/privados: não publique nem distribua como classificação. A tela mostra somente uma soma informativa de pontos registrados, sem posições ou desempates. Não há motor esportivo homologado; aprovação local de configuração não libera classificação oficial. Consulte [Apuração e classificação](./docs/APURACAO_CLASSIFICACAO.md) antes de usar esses dados.

A quantidade configurada de senhas também é revalidada na gravação: o modo local confere categoria, número e capacidade numa transação IndexedDB; a migração Supabase `202610210004_ticket_capacity.sql` serializa inscrições concorrentes com contador privado no banco. A contagem da tela é uma verificação antecipada; em modo conectado, o banco decide a gravação.

Resultados são inseridos sem sobrescrever registros existentes. A confirmação altera somente o estado técnico de pendente para confirmado e é condicional no backend, permitindo repetição segura após falha de resposta. Para corrigir um resultado confirmado, use “Corrigir”: o sistema exige justificativa, cria um substituto e preserva o anterior como “Substituído”. Esses estados registram confirmação/correção operacional e não significam que pontos ou classificação foram homologados pela comissão.

No modo Supabase, a navegação “Auditoria” lista as 250 alterações mais recentes com horário, ação, registro, evento, conta responsável e dados anteriores/atuais. O escopo é controlado pela política RLS; o frontend não seleciona o parque da consulta. Essa consulta depende da migração inicial e não existe no modo local IndexedDB.

## Instalação PWA e disponibilidade offline

O build de produção gera um service worker que pré-carrega o app shell, JavaScript, CSS e ícone. Ele não armazena respostas das rotas de autenticação, banco ou armazenamento do Supabase. A atualização do shell mantém o IndexedDB intacto. Publique em HTTPS (ou execute em `localhost`) e abra no navegador compatível para instalar o Connect PDM.

Com backend configurado, o app mantém no IndexedDB um cache separado pelo identificador autenticado do parque, válido por até sete dias desde a última leitura confirmada. Após validar a conta online, uma sessão local válida e o perfil em cache permitem reabrir os dados já carregados sem rede. Inclusões de eventos/inscrições/resultados, pagamentos e confirmações são gravadas numa fila local persistente e exibidas de forma otimista; o app tenta sincronizar ao abrir, ao recuperar a conexão ou pelo botão da fila. Operações são enviadas em ordem de dependência (evento, inscrição, pagamento, resultado, confirmação), com IDs estáveis e verificação de repetição. Conflitos/erros de validação ficam bloqueados e a tela mostra a mensagem retornada pelo servidor. É possível reenviar a fila, mas ainda não editar ou descartar uma operação bloqueada pela interface; corrija a causa no servidor/fluxo operacional e reenvie. A correção de resultado oficial e a edição do perfil exigem conexão.

Esse cache e essa fila são locais ao navegador/aparelho e não sincronizam diretamente entre aparelhos sem backend. O backend Supabase continua sendo autoridade para operações conectadas. O coordenador LAN do modo local agora compartilha dados entre aparelhos; sua integração com Supabase ainda falta. A validade offline do perfil Supabase continua sujeita à janela local de até sete dias.

## Coordenador local em rede Wi-Fi

O modo local agora pode compartilhar alterações entre navegadores por um serviço Node.js separado com armazenamento SQLite persistente. Configure o servidor conforme `docs/COORDENADOR_LOCAL.md`, compile o app e informe URL/token na tela "Rede local". O navegador sincroniza a fila ao atualizar os dados e consulta o estado compartilhado a cada cinco segundos enquanto a página está visível. Resultados oficiais não podem ser alterados diretamente pelo protocolo: confirmação preserva a pontuação e correção registra justificativa e mantém o original.

Esta etapa ainda não configura o serviço como daemon, não oferece usuários/perfis de equipe, não resolve conflitos pela interface e não sincroniza o coordenador ao Supabase. A fila IndexedDB e a gravação de negócio não são atômicas entre si. HTTPS com certificado confiável é requisito recomendado para proteger dados e habilitar recursos PWA em endereços da LAN. Não use como pronto para evento real antes de validar a implantação, restauração, permissões e múltiplos aparelhos.

## Backup local

Na seção “Backup e restauração”, exporte um JSON com vaquejadas, inscrições, resultados e (no modo local) trilha de auditoria. No modo IndexedDB local, também é possível restaurar o arquivo; a importação valida vínculos evento/inscrição/resultado, categorias e números de senha, e grava tudo numa transação. IDs idênticos com conteúdo igual são ignorados; colisões com conteúdo diferente abortam a importação sem substituir registros. No modo Supabase, a exportação respeita a consulta autorizada da conta e a importação é desabilitada. O arquivo não é criptografado nem assinado: armazene-o em local protegido e mantenha cópias fora do aparelho.

Esse JSON não é backup do SQLite do coordenador. Para uma instância LAN, use `npm run coordinator:backup -- backup <banco.sqlite> <backup.sqlite>`, depois `verify`; `restore` exige novo caminho e não sobrescreve. O manifesto lateral deve ser guardado junto ao arquivo. O utilitário não cifra, agenda nem envia backups. Nenhum desses fluxos restaura dados Supabase ou toda a fila/cache técnico de cada navegador; veja a [matriz de persistência e recuperação](./docs/INVENTARIO_DADOS.md) e o [guia do coordenador](./docs/COORDENADOR_LOCAL.md).

Os eventos podem ser editados pelo painel de vaquejadas ou pela ação na visão geral; inscrições/resultados permanecem vinculados e preservados. O backend rejeita desabilitar categorias com inscrições e reduzir a capacidade abaixo das inscrições e reservas ativas. No backend remoto, editar eventos exige conexão e a atualização é registrada na auditoria. Inscrições podem ser canceladas com motivo, mantendo número, pagamento e histórico; não são reutilizadas nem classificadas, e não recebem novos resultados. Também é possível transferir uma senha ativa para outro vaqueiro, cavalo, representação ou categoria habilitada, informando o motivo. Transferências e cancelamentos preservam o número e entram no histórico anterior/depois da auditoria; senhas com resultados não podem ser transferidas nem canceladas. Ambos os fluxos são enfileirados offline e revalidados no servidor. O escritório e o CSV mostram estados e motivos. O escritório também permite reservar números de senha por até 30 dias, liberar com justificativa ou converter a reserva em inscrição sem perder a numeração. No Supabase, criar/liberar/converter reservas exige conexão para manter capacidade compartilhada consistente; no modo local, as mudanças são transacionais no IndexedDB. Reservas são preservadas no backup JSON. Ainda não há arquivamento de eventos, reembolsos registrados separadamente ou equipe/permissões.

## Estrutura de dados e preservação

`parks.owner_user_id` identifica uma conta por parque; `events.park_id` cria a relação um-para-muitos; inscrições e resultados são filhos de um evento. RLS aplica o isolamento no banco, e a função de criação de eventos determina o parque pela sessão. As categorias oferecidas são gravadas por evento, e o banco rejeita inscrições em categoria desabilitada. Campos JSONB preservam configuração/regulamento específico do evento.

Os eventos antigos continuam disponíveis no IndexedDB quando o app funciona em modo local. Não há importação automática deles para uma conta remota; não misture os dados antes de revisar e associar cada evento ao parque correto.

## Limitações que impedem uso operacional

- O coordenador LAN está implementado como serviço Node.js + SQLite, com fila, versões e conflitos. Integração com Supabase, RBAC, resolução de conflitos pela interface e ensaios com vários aparelhos ainda faltam.
- O cache PWA cobre app shell e arquivos estáticos. Não há dispositivos/equipamentos validados, backup remoto/agendado, monitoramento ou implantação configurada. A fila/caches IndexedDB ainda não foram exercitados em navegador real e não há testes automatizados de conflitos concorrentes multi-aparelho.
- Não há equipe, RBAC por ação/evento, dispositivos autorizados ou fluxo de aprovação por outro usuário para corrigir resultado oficial. Existe tela de auditoria; a migração cria o log remoto protegido contra escrita por clientes autenticados, mas seu comportamento ainda não foi exercitado no PostgreSQL.
- Não há regras esportivas completas de rodízio, retorno, desempate, classificação ou fechamento. Não inferimos regras pendentes.
- Existe relatório CSV por evento e backup JSON manual; ainda faltam relatórios operacionais/esportivos completos, importação histórica entre modos e publicação pública.
- O reset de senha depende de email/SMTP e URLs de retorno do projeto Supabase corretamente configurados.
- A migração SQL ainda precisa ser aplicada e validada em ambiente Supabase. Este ambiente não tem credenciais de projeto nem PostgreSQL/Supabase CLI para provar isolamento entre duas contas.

A implantação LAN usa um computador do parque com o coordenador persistente. Consulte `docs/COORDENADOR_LOCAL.md`; Wi-Fi sem internet externa e operação com vários aparelhos ainda não foram validados.

## Verificação atual

- `npm test`: 54/54 passaram nesta validação, incluindo os testes de bloqueio da classificação oficial, empates sem desempate pela senha, rótulos provisórios e backup/verify/restore SQLite. IndexedDB real, Supabase e aparelhos LAN continuam fora deste escopo.
- `npm run build`: TypeScript e Vite passaram; o Vite emitiu apenas o aviso informativo existente de chunk principal acima de 500 kB.
- `node --check coordinator\server.mjs` e `node --check coordinator\backup.mjs`: passaram.
- `npm run test:browser`: falhou antes de completar o fluxo de pista, pois o teste não encontrou o botão acessível “Registrar comparecimento”; não valida este fluxo e segue pendente de investigação.
- Instalação e comportamento real do service worker em navegadores/dispositivos não foram exercitados; a disponibilidade offline validada aqui é somente a geração e sintaxe dos arquivos.
- Testes de Auth, RLS/multi-parque, integração da fila/IndexedDB, reconexão real, recuperação, impressão e regras esportivas ainda não existem ou não podem ser executados sem infraestrutura e decisões operacionais externas. O teste unitário cobre apenas a lógica pura de sobreposição e ordenação da fila.
