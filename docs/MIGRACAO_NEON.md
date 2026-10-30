# Migração do Connect Vaquejada para Neon

## Estado atual

O aplicativo conectado usa Neon Auth, Neon Data API e PostgreSQL. As 25 migrations versionadas em `neon/migrations/` foram aplicadas e verificadas no branch `TESTE`. Por decisão do projeto, não foram importados registros antigos; parques, usuários, eventos e demais dados de negócio devem ser cadastrados novamente no Neon.

O diretório e os utilitários do serviço anterior foram removidos. O SDK Neon ainda expõe o adaptador `SupabaseAuthAdapter` por compatibilidade de interface; ele é executado contra o endpoint Neon configurado e não conecta ao serviço Supabase.

## Variáveis de ambiente

Use `.env.example` como referência e mantenha segredos somente em `.env.local` e nas configurações privadas do servidor.

| Variável | Uso |
| --- | --- |
| `VITE_NEON_AUTH_BASE_URL` | Endpoint Neon Auth usado no navegador. |
| `VITE_NEON_DATA_API_URL` | Endpoint Neon Data API usado no navegador. |
| `VITE_NEON_URL` | Alternativa para derivar os endpoints públicos Neon. |
| `DATABASE_URL` | Conexão PostgreSQL usada pelo backend Render; apenas no servidor. |
| `NEON_AUTH_BASE_URL` | Endpoint Neon Auth usado pelo backend de acesso operacional. |
| `NEON_DATA_API_URL` | Endpoint Data API usado para validar a sessão administrativa pelo backend. |
| `EVENT_ACCESS_PASSWORD_SECRET` | Segredo do backend, aleatório e com pelo menos 32 caracteres. |
| `BACKEND_ALLOWED_ORIGINS` | Origens HTTPS exatas do frontend permitidas pelo CORS no backend Render. |
| `VITE_BACKEND_API_URL` | Origem pública do Web Service Render; configurada no Vercel para o frontend. |
| `NEON_BRANCH` | Nome exato do branch isolado ao verificar/aplicar migrations. |
| `DATABASE_URL_UNPOOLED` | Conexão PostgreSQL direta, sem `-pooler`, usada pelo aplicador local. |
| `VITE_PUBLIC_CONTACT_EMAIL` | Destinatário opcional do formulário de contato. |

Nunca use prefixo `VITE_` em credenciais ou segredos. `DATABASE_URL_UNPOOLED` deve apontar para o branch de teste explicitamente confirmado. A API operacional compilada a partir de `backend/event-access.ts` roda no Web Service Render; a aplicação de migrations continua local.

## Verificação do branch TESTE

O comando abaixo lista hashes locais sem conexão. A verificação remota é somente leitura, exige hostname direto completo e confere o journal e os checksums:

```powershell
npm.cmd run db:check-neon
$testHost = Read-Host "Hostname direto do branch TESTE no Neon Console"
npm.cmd run db:verify-neon -- --confirm-branch TESTE --confirm-host $testHost
```

O aplicador exige `NEON_BRANCH=TESTE` e `DATABASE_URL_UNPOOLED` apontando para o mesmo host informado. Não use endpoint `-pooler`. Não execute `db:migrate-neon` no branch já aplicado sem uma alteração de schema revisada e autorização explícita.

Neon Auth e as extensões PostgreSQL exigidas pelo schema devem estar disponíveis antes das migrations. A Data API não é necessária para executar SQL por conexão direta, mas deve estar habilitada para o aplicativo conectado e validada com Auth/JWT antes do uso.

## Novos ambientes

Para preparar um branch novo e vazio, revise a lista local com `npm.cmd run db:check-neon`, confirme que Auth e extensões estão provisionados e use o aplicador apenas no branch de teste. O aplicador executa os arquivos em ordem, cada um em uma transação, e registra o nome e o checksum após o `COMMIT`. Em falha, desfaz a migration atual e para.

As migrations 023 e 024 alteram o corte de acesso legado e a associação de identidade. Em uma instalação intencionalmente vazia, a confirmação correspondente é `--confirm-empty-database`; o aplicador confere que as tabelas da aplicação estão vazias antes de prosseguir. Não há etapa de carga ou importação de dados antigos.

Para conferir journal e tabelas no Neon SQL Editor, use consultas `SELECT`:

```sql
select migration_name, applied_at
from connect_migrations.schema_migrations
order by migration_name;

select table_schema, table_name
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
```

## Autenticação e acesso operacional

O login, cadastro e redefinição de senha usam Neon Auth; verifique email de saída, domínio permitido e URL de retorno no projeto Neon. O acesso operacional por código e PIN é atendido pelo backend Render descrito em [RENDER_BACKEND.md](./RENDER_BACKEND.md); `EVENT_ACCESS_PASSWORD_SECRET` precisa ser estável entre instâncias do mesmo ambiente, pois sua troca invalida acessos operacionais já emitidos.

Valide no branch de teste cadastro, confirmação de email, login, recuperação, permissões por parque/evento, provisionamento e revogação de código/PIN antes de liberar um deploy.
