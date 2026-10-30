# Backend Connect Vaquejada no Render

O serviÃ§o `connect-vaquejada-backend` atende autenticaÃ§Ã£o Better Auth, cadastro protegido por convite, email de confirmaÃ§Ã£o e recuperaÃ§Ã£o de senha, alÃ©m da API de acesso operacional por cÃ³digo e PIN. O frontend permanece no Vercel e usa a Neon Data API para consultas PostgreSQL/RLS.

## ServiÃ§o

- Build: `npm ci && npm run build:backend`
- Start: `npm run start:backend`
- Health check: `/health`
- Node: `>=22.13.0`

## VariÃ¡veis privadas no Render

- `DATABASE_URL`: conexÃ£o PostgreSQL direta do branch do ambiente (sem `-pooler`); TLS Ã© obrigatÃ³rio.
- `BETTER_AUTH_URL`: URL pÃºblica do serviÃ§o Render, por exemplo `https://connect-vaquejada-backend.onrender.com`.
- `BETTER_AUTH_SECRET`: segredo aleatÃ³rio de pelo menos 32 caracteres, exclusivo do ambiente.
- `RESEND_API_KEY`: chave privada do serviÃ§o de email transacional.
- `AUTH_EMAIL_FROM`: remetente verificado no provedor de email.
- `NEON_DATA_API_URL`: endpoint Data API do mesmo branch.
- `EVENT_ACCESS_PASSWORD_SECRET`: segredo aleatÃ³rio de pelo menos 32 caracteres, estÃ¡vel entre instÃ¢ncias; nÃ£o reutilize `BETTER_AUTH_SECRET`.
- `BACKEND_ALLOWED_ORIGINS`: origens HTTPS exatas do frontend; inclua domÃ­nio de produÃ§Ã£o e domÃ­nio de preview somente se necessÃ¡rio.

Configure segredos pelo painel do Render. NÃ£o os coloque no repositÃ³rio, Vercel ou variÃ¡veis `VITE_`.

## Vercel

Configure `VITE_BACKEND_API_URL` com a URL do serviÃ§o Render e `VITE_NEON_DATA_API_URL` com o endpoint Data API. `vercel.json` encaminha `/api/auth/*` e `/api/register` ao Render para manter cookies HTTP-only no domÃ­nio do frontend. O endereÃ§o destino atual presume o hostname `connect-vaquejada-backend.onrender.com`, conforme `render.yaml`; se o Render mostrar outro hostname, atualize o destino e publique novamente.

## Autenticação externa da Neon Data API

O backend emite JWTs Better Auth pelo plugin JWT (`/api/auth/token` e JWKS em `/api/auth/jwks`). `neon.external-auth.ts` declara a Data API com validação externa de JWKS. A Neon fixa o provedor JWT quando a Data API é habilitada pela primeira vez. Portanto:

1. Use um projeto Neon novo ou um branch em que a Data API ainda não tenha sido habilitada com Neon Auth. Se o branch herdar o provedor atual, use outro projeto.
2. O CLI carrega `neon.ts` por padrão. Em um checkout de staging isolado, use `neon.external-auth.ts` como arquivo `neon.ts`, defina `BETTER_AUTH_URL` e `BETTER_AUTH_JWKS_URL`, e confira `neon config plan` antes de qualquer `apply`.
3. Habilite a Data API externa somente após confirmar o plano. Não aplique essa configuração em produção nem no branch `TESTE` atual.
4. Aplique e valide as migrations 025 e 026 no ambiente de staging antes do deploy do backend. A segunda faz a cópia aditiva de usuários e contas.
5. Teste cadastro/convite, confirmação, login, sessão, redefinição, logout, permissões e PIN operacional com contas de teste.

O schema `connect_auth` é aditivo e a migration mantém `neon_auth`. O provedor Data API não pode ser trocado in-place. Planeje backup e rollback antes do corte.
## Identidades existentes

A consulta read-only no branch `TESTE` confirmou o esquema das tabelas Neon Auth `user` e `account`, incluindo o campo `password`. A migration `202610300026_copy_neon_auth_identities.sql` copia usuários, contas e hashes sem transformar valores, mantendo a origem intacta. A compatibilidade dos hashes precisa ser testada com contas de staging. Sessões, verificações pendentes e chaves JWKS não são copiadas; usuários entram novamente e recebem chaves novas. Se uma senha antiga não for aceita, conduza redefinição de senha e não remova `neon_auth`.

## VerificaÃ§Ã£o

`GET /health` valida somente o processo HTTP. Valide autenticaÃ§Ã£o e banco com os testes de staging apÃ³s configurar os serviÃ§os e executar as migrations com autorizaÃ§Ã£o. Nunca use produÃ§Ã£o para a primeira validaÃ§Ã£o.