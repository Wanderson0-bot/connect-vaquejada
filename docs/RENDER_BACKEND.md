# Backend Connect no Render

O backend web deste guia é a API `/api/event-access`, responsável por provisionar e validar acessos operacionais por código e PIN. O app público continua no Vercel e o PostgreSQL/Auth continuam no Neon. O serviço SQLite para coordenador local é outro componente; consulte [RENDER_COORDINATOR.md](./RENDER_COORDINATOR.md).

## Deploy do serviço

O repositório inclui `render.yaml` como Blueprint. No Render, crie um Blueprint a partir do repositório e confira o serviço `connect-vaquejada-backend`. A configuração usa:

- Build: `npm ci && npm run build:backend`
- Start: `npm run start:backend`
- Health check: `/health`
- Serviço HTTP em `0.0.0.0`, na porta `PORT` definida pelo Render.

O plano inicial está definido como Free para evitar cobrança automática. Use-o somente para validar o deploy: o Render informa que o Free não é indicado para produção, suspende o serviço após 15 minutos sem tráfego e pode levar cerca de um minuto para reativá-lo. Para uso operacional, escolha um plano pago ativo no painel do Render antes de liberar o sistema.

## Variáveis no Render

Configure no serviço Render; não use prefixo `VITE_` para esses valores:

- `DATABASE_URL`: conexão do branch Neon que o backend deve usar. Use o branch escolhido para o ambiente; não use a URL direta reservada para migrations.
- `NEON_AUTH_BASE_URL`: endpoint Neon Auth desse mesmo ambiente.
- `NEON_DATA_API_URL`: endpoint Neon Data API desse mesmo ambiente.
- `EVENT_ACCESS_PASSWORD_SECRET`: segredo aleatório forte, com ao menos 32 caracteres, igual em todas as instâncias do mesmo ambiente.
- `BACKEND_ALLOWED_ORIGINS`: origens exatas autorizadas, separadas por vírgula, sem barra no final. Inclua o domínio `vercel.app` do frontend e cada domínio próprio usado.

Insira os segredos pelo painel do Render. Não cole valores secretos em `render.yaml`, Git ou frontend.

## Variável no Vercel

No projeto Vercel do frontend, configure `VITE_BACKEND_API_URL` como a origem pública do Web Service Render, por exemplo `https://nome-do-servico.onrender.com`, sem caminho final. Salve e faça novo deploy do frontend para embutir essa variável no bundle.

Depois do deploy, abra `https://nome-do-servico.onrender.com/health`; a resposta esperada é `{"status":"ok"}`. Em seguida, valide o fluxo de acesso operacional pelo frontend. O health check confirma que o processo HTTP responde, mas não testa Neon; a solicitação protegida deve validar Neon Auth e o banco.

## Segurança e escopo

O serviço permite CORS somente para as origens configuradas. CORS não substitui autenticação: provisionamento exige sessão administrativa Neon e o login exige código/PIN válido. O backend mantém limites de corpo da requisição e registra falhas sem escrever segredos nos logs.

O restante do aplicativo continua acessando Neon Auth e a Data API diretamente do navegador, com as permissões e RLS do banco. Este deploy não aplica migrations, não altera o banco e não move o coordenador SQLite para o Render.
