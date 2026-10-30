# Connect PDM

Aplicação web em português brasileiro para apoiar a gestão de vaquejadas Pé de Mourão. O projeto segue em desenvolvimento e ainda não está aprovado para operação esportiva real. Para escolher a área correta e seguir os passos operacionais, consulte o [guia rápido](./docs/GUIA_RAPIDO.md).

## Stack

- React, TypeScript e Vite no frontend.
- Neon Auth e Neon Data API no backend conectado em migração.
- IndexedDB para operação local em um aparelho e fila offline.
- Serviço Node.js + SQLite opcional para coordenador local em rede.

## Desenvolvimento

Requer Node.js 22.13 ou superior e npm.

```powershell
npm install
npm run dev
npm run build
npm test
```

O modo local não exige configuração externa. Seus dados ficam no IndexedDB deste navegador e não representam login nem isolamento seguro entre parques.

## Backend Neon

O cliente web usa Neon Auth e Data API; a API de acessos operacionais por código/PIN roda como Web Service no Render e usa variáveis privadas do servidor. As 25 migrations estão aplicadas e verificadas no branch `TESTE`. Por decisão do projeto, os registros antigos não foram importados: o ambiente conectado começa sem usuários, parques e eventos, que deverão ser cadastrados novamente.

Consulte [Configuração Neon](./docs/MIGRACAO_NEON.md) e [Backend no Render](./docs/RENDER_BACKEND.md) para variáveis e validações. O esquema versionado em `neon/migrations/` é a fonte atual das migrations. O SDK Neon usa um adaptador de compatibilidade para manter a API de autenticação já chamada pela interface; isso não conecta a um serviço externo.

O cadastro/login por email, redefinição de senha e permissões dependem de Neon Auth configurado e email de saída ativo.

## Áreas e dados

- O site público lista eventos aprovados para publicação e não oferece login.
- `/connect` é o painel administrativo da plataforma; requer função Connect atribuída no banco.
- `/operacao` e suas rotas filhas exigem sessão e vínculo/permissão de parque ou evento.
- Atalhos e IDs na URL selecionam navegação; nunca concedem autorização.
- Dados de negócio conectados usam PostgreSQL. RLS e funções SQL devem ser validadas com múltiplos usuários no Neon antes de uso real.
- No modo local, eventos, inscrições e resultados ficam no IndexedDB. A fila sincroniza quando há backend e conexão; ela não transfere dados automaticamente entre navegadores.

O escritório registra pagamentos, reservas de senhas, cancelamentos e transferências. A locução e a pista atualizam a operação do evento. Resultados confirmados podem ser corrigidos com justificativa, mantendo o histórico. Os relatórios esportivos continuam informativos: não há motor homologado de classificação oficial.

Para configurar o coordenador em rede Wi-Fi, consulte [Coordenador local](./docs/COORDENADOR_LOCAL.md). Para exportação e restauração local, consulte a seção de backup dentro da aplicação; backups JSON não incluem o banco Neon, o SQLite do coordenador nem toda a fila/cache técnico do navegador.

## Verificação e limites

`npm run build` verifica TypeScript e gera o bundle. Os testes locais não substituem a validação real de Auth, Data API, RLS, emails, rotas serverless, migração de dados, uso offline e múltiplos aparelhos. Execute o checklist de staging em `docs/MIGRACAO_NEON.md` antes de apontar usuários para Neon.
# Primeiro administrador

O backend oferece `POST /api/bootstrap-admin` para emitir um único convite de administrador inicial. A rota exige o segredo `ADMIN_BOOTSTRAP_SECRET` no cabeçalho `X-Admin-Bootstrap-Secret`; sem segredo configurado ou com segredo incorreto, responde como rota inexistente. O convite expira em 24 horas e é vinculado ao email informado. A rota não cria uma conta. A pessoa conclui o cadastro em `/cadastro` com o token; Better Auth cria a conta, envia a confirmação de email e continua responsável pelo hash da senha e pela sessão. O papel `platform_admin` só é concedido depois da confirmação do email.

Para configurar no Render, adicione `ADMIN_BOOTSTRAP_SECRET` como variável secreta do serviço backend, com pelo menos 32 caracteres aleatórios. Gere o valor localmente, por exemplo no PowerShell: `$secret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))`. Não compartilhe nem registre esse valor. A migration `202610300027_admin_bootstrap_invitations.sql` precisa estar aplicada no branch Neon usado pelo backend antes de chamar a rota. Este repositório não aplica migrations automaticamente no banco de produção.

Com o serviço atualizado e migration aplicada no branch `TESTE`, emita o convite sem colocar o segredo na linha de comando ou no histórico do terminal: use um cliente HTTP que permita definir `X-Admin-Bootstrap-Secret` de forma segura e envie `{"email":"admin@exemplo.com"}` para `https://<backend>/api/bootstrap-admin`. A resposta 201 contém `invitationToken` e `expiresAt`; entregue o token apenas ao destinatário. Em `/cadastro`, informe o email correspondente, crie uma senha com pelo menos 10 caracteres e cole o token. O cadastro envia uma mensagem de confirmação. Após confirmar o email, a conta recebe o acesso administrativo. O token não pode ser usado outra vez, e não é possível emitir outro convite depois da criação do primeiro administrador.

Se o convite vencer antes do cadastro e confirmação, uma nova emissão é possível enquanto nenhum administrador foi criado e não houver outro convite ativo. Se o endereço já tiver conta, a rota recusa a emissão; a conta precisa ser tratada por um administrador provisionado por procedimento operacional confiável.
