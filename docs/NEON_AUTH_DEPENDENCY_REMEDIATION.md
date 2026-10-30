# SubstituiÃ§Ã£o da pilha de autenticaÃ§Ã£o (implementaÃ§Ã£o local)

## Comparação de alternativas

- **A — atualizar o SDK/Auth Neon:** menos mudança no banco, mas mantém a camada Neon Auth e seus peers beta/Better Auth UI acoplados. Não resolve a dependência do provedor gerenciado.
- **B — trocar só a UI:** remove a biblioteca de UI conflitante, porém mantém o contrato e a operação Neon Auth; não atende ao objetivo de poder trocar toda a pilha.
- **C — Better Auth self-managed:** remove o SDK/UI beta, dá controle ao backend Render e oferece integração PostgreSQL/JWKS conhecida. Exige schema novo, cópia aditiva de contas, configuração externa da Data API e ensaio separado; é a alternativa escolhida, com maior esforço de corte mas menos acoplamento de runtime.
## Arquitetura escolhida

O Connect usa Better Auth estÃ¡vel (`better-auth@1.7.14`) no serviÃ§o Node/Render, `pg` contra PostgreSQL Neon direto, e o plugin JWT para emitir tokens assinados com JWKS. A Neon Data API valida o JWT por provedor externo; o React consome sessÃµes pelo cliente Better Auth e consultas PostgreSQL pelo cliente HTTP PostgREST.

Essa opÃ§Ã£o remove o acoplamento da UI Neon beta e evita implementar hashes, tokens de reset, sessÃµes ou criptografia prÃ³prios. A troca exige habilitar a Data API externa em branch novo, pois a Neon fixa o provedor da Data API na primeira ativaÃ§Ã£o.

## Funcionalidades ligadas no cÃ³digo

- Email e senha, confirmaÃ§Ã£o de endereÃ§o e redefiniÃ§Ã£o: Better Auth e provedor Resend.
- SessÃ£o persistente e logout: cookies HTTP-only seguros no proxy Vercel/Render.
- RLS: JWT curto (15 minutos) com `sub`, `role=authenticated`, email e confirmaÃ§Ã£o; o banco resolve identidade em `neon_auth_identity_map`.
- Convites: rota `/api/register` verifica token nÃ£o expirado antes de delegar cadastro ao Better Auth.
- CÃ³digo/PIN: backend Render provisiona e valida credenciais usando o mesmo provedor, sem criar um sistema de senha paralelo.
- Identificadores e permissÃµes da aplicaÃ§Ã£o continuam em `public.app_users` e nas tabelas atuais.

## Dados e reversÃ£o

A migration 025 Ã© aditiva e nÃ£o remove o antigo schema `neon_auth`. A implementaÃ§Ã£o local nÃ£o migra credenciais ou registros. Antes do corte, faÃ§a backup em ambiente separado e confirme o formato e a compatibilidade dos hashes antigos. Se nÃ£o forem compatÃ­veis, preserve IDs e vÃ­nculos e solicite redefiniÃ§Ã£o controlada; nÃ£o reutilize sessÃµes antigas. NÃ£o faÃ§a alteraÃ§Ã£o de produÃ§Ã£o sem backup recuperÃ¡vel e plano de rollback aprovado.

## DependÃªncias

Removidos da aplicaÃ§Ã£o: `@neondatabase/neon-js` (e os pacotes de Neon Auth/Auth UI incorporados a ele), Better Auth UI, email rendering transitivo e suas Ã¡rvores vulnerÃ¡veis. Mantidos: `@neondatabase/serverless` para SQL do endpoint de evento; `@supabase/postgrest-js` exclusivamente para falar o protocolo PostgREST da Neon Data API, sem Supabase Auth.

## LimitaÃ§Ãµes verificÃ¡veis

Build e testes locais verificam tipos, rotas, contratos de API e esquema versionado; nÃ£o comprovam autenticaÃ§Ã£o contra Neon nem entrega real de email. A ativaÃ§Ã£o no Neon, migration 025, teste de sessÃ£o/RLS e migraÃ§Ã£o de contas aguardam um branch novo de staging, credenciais privadas configuradas e backup. O `neon.ts` padrÃ£o permanece inalterado para nÃ£o trocar a configuraÃ§Ã£o dos branches existentes.

