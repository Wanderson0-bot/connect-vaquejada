# Neon e autenticação Connect

## Arquitetura no código

O frontend usa Better Auth no backend Render para email/senha, sessões em cookie HTTP-only, confirmação e recuperação de senha. O plugin JWT publica chaves JWKS para emitir tokens curtos que a Neon Data API pode validar como provedor externo. O PostgreSQL guarda autenticação em `connect_auth`; dados e RLS continuam no schema `public`. O email transacional é enviado pelo Resend.

O cliente `@supabase/postgrest-js` é usado somente como cliente HTTP do protocolo PostgREST da Neon Data API. Nenhum endpoint ou serviço Supabase Auth é usado. `@neondatabase/serverless` permanece no endpoint operacional server-side.

## Configuração local e hospedagem

Use `.env.example` como lista de nomes. Frontend: `VITE_NEON_DATA_API_URL`, `VITE_BACKEND_API_URL`, `VITE_PUBLIC_CONTACT_EMAIL`. Backend Render: `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `NEON_DATA_API_URL`, `EVENT_ACCESS_PASSWORD_SECRET` e `BACKEND_ALLOWED_ORIGINS`. Não passe valores privados ao Vite nem os registre no terminal.

Para configurar a Data API externa em um branch novo, use `BETTER_AUTH_JWKS_URL` e `BETTER_AUTH_URL` com `neon.external-auth.ts`. A configuração existente `neon.ts` permanece inalterada porque representa a configuração atual de Neon Auth. A escolha do provedor JWT da Data API fica imutável depois da primeira habilitação; use projeto novo ou branch sem Data API habilitada, e só avance se o plano confirmar provedor externo. Não rode `neon deploy`/`apply` neste arquivo contra produção nem contra o `TESTE` existente.

## Migrations 025/026 e compatibilidade

`202610300025_self_managed_better_auth.sql` cria `connect_auth` de forma aditiva e atualiza `sync_current_app_user()` para resolver o usuário pelo `sub` do JWT via `neon_auth_identity_map`. `202610300026_copy_neon_auth_identities.sql` copia usuários e contas para Better Auth, preservando IDs e o valor do hash existente; a origem permanece intacta. Não copia sessões, tokens temporários nem chaves de assinatura, então todos precisam entrar novamente.

A consulta somente leitura no branch `TESTE` confirmou os campos de `neon_auth.user` e `neon_auth.account`, inclusive `password`. A migration transfere esse valor sem transformá-lo. A compatibilidade real do hash precisa ser comprovada com login de uma conta de teste antes do corte de produção. Se falhar, mantenha Neon Auth ativo e use redefinição controlada; não remova a origem.

## Roteiro de validação seguro

1. Faça backup recuperável do branch fonte e crie um branch Neon de staging separado.
2. Em checkout de staging isolado, use `neon.external-auth.ts` como arquivo `neon.ts`; habilite a Data API externa com o JWKS do backend e confira o plano antes de aplicar.
3. Rode os diagnósticos locais e confira a sequência de migrations.
4. Aplique 025 e 026 apenas no branch de staging, com host direto e confirmação explícita. A cópia aborta a transação se encontrar conflito de email, ID ou vínculo.
5. Compare contagens de origem/destino e teste o login de contas existentes e novas. Não apague `neon_auth`.
6. Teste cadastro com convite, confirmação de email, senha incorreta, redefinição, persistência, logout, acesso por código/PIN, RLS e permissões.
7. Planeje corte e rollback antes da produção. Após o corte, redefinições e contas novas não são sincronizadas de volta para Neon Auth. Mantenha backup e não exclua o schema antigo durante a janela de retorno.

Os testes locais não substituem a integração real do branch Neon. Nenhuma migration ou alteração remota foi executada durante esta implementação.
