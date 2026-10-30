import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../neon/migrations/202610220015_connect_pdm_operations.sql", import.meta.url), "utf8");
const reconciliation = await readFile(new URL("../neon/migrations/202610220016_legacy_staff_reconciliation.sql", import.meta.url), "utf8");
const legacyPreflight = await readFile(new URL("../neon/diagnostics/legacy_staff_cutover_preflight.sql", import.meta.url), "utf8");
const account = await readFile(new URL("../src/Account.tsx", import.meta.url), "utf8");
const brazilFields = await readFile(new URL("../src/BrazilFields.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const connectAdmin = await readFile(new URL("../src/ConnectAdmin.tsx", import.meta.url), "utf8");
const connectAdminComponents = await readFile(new URL("../src/ConnectAdminComponents.tsx", import.meta.url), "utf8");
const connectParkProfilePage = await readFile(new URL("../src/ConnectParkProfilePage.tsx", import.meta.url), "utf8");
const coordinatorQueueReview = await readFile(new URL("../src/CoordinatorQueueReview.tsx", import.meta.url), "utf8");
const backend = await readFile(new URL("../src/backend.ts", import.meta.url), "utf8");
const publicSite = await readFile(new URL("../src/PublicSite.tsx", import.meta.url), "utf8");
const coordinatorClient = await readFile(new URL("../src/coordinator.ts", import.meta.url), "utf8");
const trackStop = await readFile(new URL("../neon/migrations/202610220013_suspend_unvalidated_track_rpc.sql", import.meta.url), "utf8");
const serviceStop = await readFile(new URL("../neon/migrations/202610220014_track_service_role_stop.sql", import.meta.url), "utf8");
const rbac = await readFile(new URL("../neon/migrations/202610220012_individual_rbac.sql", import.meta.url), "utf8");
const parkRegistryMigration = await readFile(new URL("../neon/migrations/202610240019_connect_park_registry.sql", import.meta.url), "utf8");
const parkNameIdentityMigration = await readFile(new URL("../neon/migrations/202610240020_park_name_identity.sql", import.meta.url), "utf8");
const publicPublicationMigration = await readFile(new URL("../neon/migrations/202610250021_public_event_publication.sql", import.meta.url), "utf8");
const parkCodeMigration = await readFile(new URL("../neon/migrations/202610250022_connect_park_code.sql", import.meta.url), "utf8");

test("parque é identificado pelo nome e local e provisionamento é idempotente", () => {
  assert.match(parkNameIdentityMigration, /drop column connect_code/i);
  assert.match(parkNameIdentityMigration, /create unique index parks_name_city_state_ci_uidx/i);
  assert.match(parkNameIdentityMigration, /pg_advisory_xact_lock/);
  assert.match(parkNameIdentityMigration, /park\.recover/);
  assert.match(parkCodeMigration, /add column if not exists connect_code text/i);
});

test("parques recebem código Connect único, pesquisável e sem função de credencial", () => {
  assert.match(parkCodeMigration, /parks_connect_code_ci_uidx/);
  assert.match(parkCodeMigration, /assign_connect_park_code/);
  assert.match(parkCodeMigration, /to_jsonb\(new\) - 'connect_code'[\s\S]*new\.connect_code = 'CV-' \|\| upper\(new\.id::text\)/);
  assert.match(parkCodeMigration, /connect_code ilike/);
  assert.match(parkCodeMigration, /has_platform_permission\('platform\.park\.read'\)/);
  assert.match(backend, /get_connect_park_code/);
  assert.match(connectAdmin, /Parque ou codigo Connect/);
  assert.match(connectAdmin, /Codigo Connect/);
  assert.match(parkCodeMigration, /never credentials|never access tokens/i);
});

test("cadastro de parque não é oferecido como autosserviço na aplicação", () => {
  assert.doesNotMatch(account, /createParkProfile|create_park_account/);
  assert.match(account, /Acesso ainda não associado/);
  assert.match(migration, /revoke all on function public\.create_park_account/);
});

test("criação de conta só é oferecida durante a ativação de um convite", () => {
  assert.doesNotMatch(account, /Criar identidade individual/);
  assert.doesNotMatch(account, /Acesso compartilhado do responsável|signInEventRole|operationalLogin/);
  assert.match(account, /invitationMode = false/);
  assert.match(account, /const canActivateInvitation = !connectRoute && invitationMode/);
  assert.match(account, /if \(!register \|\| !canActivateInvitation\)/);
  assert.match(account, /\{canActivateInvitation && \(/);
  assert.match(account, /Ativar convite/);
});

test("UF é selecionável e telefone usa +55 com DDD padrão pela UF", () => {
  const states = [...brazilFields.matchAll(/^\s*\["([A-Z]{2})",/gm)].map((match) => match[1]);
  assert.equal(states.length, 27);
  assert.deepEqual([...states].sort(), [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS",
    "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC",
    "SE", "SP", "TO",
  ]);
  assert.match(account, /BrazilianStateOptions/);
  assert.match(connectAdmin, /BrazilianStateOptions/);
  assert.match(brazilFields, /DEFAULT_DDD_BY_STATE/);
  assert.match(brazilFields, /pattern="\\\+55 \[0-9\]\{2\} \[0-9\]\{9\}"/);
  assert.match(brazilFields, /value=\{value\}/);
  assert.match(brazilFields, /const phone = `\+55\$\{ddd\}\$\{localNumber\}`/);
  assert.match(brazilFields, /type="hidden" name=\{name\} value=\{phone\}/);
  assert.match(brazilFields, /setDdd\(DEFAULT_DDD_BY_STATE\[state\]/);
  assert.doesNotMatch(brazilFields, /aria-label="DDD"/);
  assert.doesNotMatch(brazilFields, /Informe somente os 9 dígitos, sem DDD ou código do país\./);
});

test("o painel Connect tem rota própria e nega acesso administrativo a perfis de parque", () => {
  assert.match(account, /pathname === "\/connect"/);
  assert.match(account, /if \(!backendConfigured\)[\s\S]*?Área protegida indisponível[\s\S]*?não autentica usuários nem concede acesso a áreas internas/);
  assert.doesNotMatch(account, /if \(!backendConfigured\)\s*return children/);
  assert.match(account, /connectRoute && session && platformContext && canAccessPlatform/);
  assert.match(account, /connectRoute && session && !canAccessPlatform/);
  assert.doesNotMatch(account, /onOpenPlatform|openPlatform|openOperations/);
  assert.doesNotMatch(connectAdmin, /onOpenOperations/);
  assert.equal((connectAdmin.match(/new URL\("\/entrar", window\.location\.origin\)/g) || []).length, 2);
  assert.equal((connectAdmin.match(/new URL\("\/operacao", window\.location\.origin\)/g) || []).length, 1);
});

test("perfil do parque abre informações e equipe por um card de logo único", () => {
  assert.match(app, /className=\{tab === "park" \? "park-profile-card active" : "park-profile-card"\}/);
  assert.match(app, /Simbolo-Principal-Connect-Vaquejada\.png/);
  assert.match(app, /Perfil do parque/);
  assert.match(app, /<ParkEditor park=\{park\}/);
  assert.match(app, /<TeamManager park=\{park\}/);
  assert.doesNotMatch(app, /tab === "team"|setTab\("team"\)/);
});

test("cadastro Connect lista e detalha parques com filtros, estados reais e autorização no servidor", () => {
  assert.match(parkRegistryMigration, /has_platform_permission\('platform\.park\.read'\)/);
  assert.match(parkNameIdentityMigration, /ps\.name ilike[\s\S]*ps\.city ilike/i);
  assert.doesNotMatch(parkNameIdentityMigration, /p\.connect_code|connect_code text/i);
  assert.match(parkNameIdentityMigration, /lower\(ps\.city\) = lower\(trim\(p_city\)\)/i);
  assert.match(parkNameIdentityMigration, /upper\(ps\.state::text\) = upper\(trim\(p_state\)\)/i);
  assert.match(parkRegistryMigration, /when p\.access_status = 'suspended' then 'suspended'[\s\S]*when p\.access_status = 'closed' then 'archived'[\s\S]*park_manager[\s\S]*'provisioned'[\s\S]*'pending_configuration'/i);
  assert.match(parkRegistryMigration, /create or replace function public\.get_connect_park_profile/);
  assert.match(parkRegistryMigration, /event_staff_memberships/);
  assert.match(parkRegistryMigration, /completed_event_count/);
  assert.match(parkRegistryMigration, /'park\.recover'/);
  assert.match(parkRegistryMigration, /'before',jsonb_build_object/);
  assert.match(parkRegistryMigration, /actor_email text/);
  assert.match(connectAdmin, /listConnectParks/);
  assert.match(connectAdmin, /getConnectParkProfile/);
  assert.match(connectAdmin, /Pendente de configuração/);
  assert.match(connectParkProfilePage, /Copiar link Escritório/);
  assert.match(connectParkProfilePage, /Copiar link Locução/);
  assert.match(connectParkProfilePage, /Copiar link operacional/);
  assert.match(connectAdmin, /identidade e permissão válidas/);
  assert.match(app, /requestedEventIsAuthorized/);
  assert.match(app, /areaAllowed/);
});

test("painel Connect consulta métricas e parques reais e marca integrações não verificadas", () => {
  assert.match(parkNameIdentityMigration, /has_platform_permission\('platform\.park\.read'\)/);
  assert.match(parkNameIdentityMigration, /select count\(\*\) from public\.parks/);
  assert.match(parkNameIdentityMigration, /select count\(\*\) from public\.events/);
  assert.match(parkNameIdentityMigration, /order by p\.created_at desc, p\.id\s+limit 5/i);
  assert.match(parkNameIdentityMigration, /'publication_count', null/);
  assert.match(connectAdmin, /getConnectAdminDashboard/);
  assert.match(backend, /get_connect_admin_dashboard", "202610240020_park_name_identity\.sql"/);
  assert.match(backend, /list_connect_parks", "202610240020_park_name_identity\.sql"/);
  assert.match(connectAdmin, /Servidor local[\s\S]*Não verificado/);
  assert.match(connectAdmin, /Erros recentes[\s\S]*Não verificado/);
  assert.match(connectAdmin, /falhas de backup, conectividade ou acessos suspeitos/);
});

test("seções Connect explicam contexto de parque e limitam estados por permissão", () => {
  assert.match(connectAdmin, /pageDescription: Record<AdminView, string>/);
  assert.match(connectAdmin, /Selecione um parque/);
  assert.match(connectAdmin, /Seu perfil não tem permissão para criar ou administrar eventos/);
  assert.match(connectAdmin, /A gestão da equipe Connect está disponível somente para administradores de plataforma/);
  assert.match(connectAdmin, /Sessão autenticada · autorização ativa/);
  assert.match(connectAdmin, /Confirmar \$\{action\} o acesso de/);
  assert.match(connectAdmin, /Revogar este acesso compartilhado/);
  assert.match(connectAdmin, /Retirar “\$\{row\.event_name\}” do site público/);
  assert.match(connectAdminComponents, /connect-admin-state-card/);
  assert.match(connectAdminComponents, /connect-admin-section-header/);
  assert.match(connectAdmin, /parkListLoading \|\| parkListError \? "—"/);
});

test("site público libera somente eventos confirmados pelo parque, aprovados e publicados pela Connect", () => {
  assert.match(publicPublicationMigration, /create table public\.connect_event_publications/);
  assert.match(publicPublicationMigration, /confirm_park_event_publication/);
  assert.match(publicPublicationMigration, /event\.manage/);
  assert.match(publicPublicationMigration, /current_status <> 'park_confirmed'/);
  assert.match(publicPublicationMigration, /changes_requested/);
  assert.match(publicPublicationMigration, /next_status = 'published' and current_status <> 'approved'/);
  assert.match(publicPublicationMigration, /pub\.status = 'published' and p\.access_status = 'active'/);
  assert.match(publicPublicationMigration, /public_snapshot/);
  assert.match(publicPublicationMigration, /connect_platform_audit/);
  const publicRpc = publicPublicationMigration.match(/create or replace function public\.list_public_events\([\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(publicRpc, /public_prizes/);
  assert.doesNotMatch(publicRpc, /entries|payment|run_results|audit|competition/i);
  assert.match(app, /pathnam[e] === "\/eventos"/);
  assert.match(connectAdmin, /Aprovar informa\u00e7\u00f5es/);
  assert.match(connectAdmin, /Solicitar corre\u00e7\u00f5es/);
  assert.match(connectAdmin, /Publicar evento/);
  assert.match(backend, /list_public_events/);
});

test("fila offline exige adoção pelo operador e compara conflitos armazenados no coordenador", () => {
  assert.match(coordinatorQueueReview, /Assumir e enviar/);
  assert.match(coordinatorQueueReview, /getCoordinatorOperator/);
  assert.match(coordinatorQueueReview, /getCoordinatorConflicts/);
  assert.match(coordinatorQueueReview, /versão central mantida/i);
  assert.match(coordinatorQueueReview, /disabled=\{!operator \|\| Boolean\(busyId\) \|\| item\.entityType === "track_states"\}/);
  assert.match(coordinatorClient, /adoptCoordinatorOperation/);
  assert.match(coordinatorQueueReview, /adoptCoordinatorReviewOperation/);
});

test("the Neon legacy access cutover has a read-only release preflight", () => {
  assert.match(legacyPreflight, /READ ONLY/i);
  assert.match(legacyPreflight, /legacy_access_cutover_preflight/);
  assert.match(legacyPreflight, /BLOCK cutover: park membership is not proof of event assignment/i);
  assert.match(legacyPreflight, /park_invitations/i);
  assert.doesNotMatch(legacyPreflight.replace(/--.*$/gm, ""), /^\s*(update|delete|insert|revoke|grant)\s+/im);
});

test("reconciliation snapshots do not grant or revoke, and activation needs reviewed event evidence", () => {
  const prep = reconciliation.match(/create or replace function public\.prepare_legacy_staff_reconciliation[\s\S]*?\$\$;/i)?.[0] ?? "";
  const review = reconciliation.match(/create or replace function public\.review_legacy_staff_mapping[\s\S]*?\$\$;/i)?.[0] ?? "";
  const activate = reconciliation.match(/create or replace function public\.activate_legacy_staff_mapping[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(prep, /insert into public\.legacy_staff_reconciliation_items/i);
  assert.doesNotMatch(prep, /insert into public\.event_staff_memberships|update public\.(park_memberships|park_invitations|event_staff_memberships)/i);
  assert.match(prep, /'ambiguous'|proof\.evidence/i);
  assert.match(prep, /'no_destination'/i);
  assert.match(review, /reviewed_by=public\.current_app_user_id\(\)/i);
  assert.match(review, /evidence reference/i);
  assert.match(activate, /item\.classification<>'proven'/i);
  assert.match(activate, /item\.reviewed_by=public\.current_app_user_id\(\)/i);
  assert.match(activate, /Conflicting or inactive event membership/i);
  assert.match(activate, /insert into public\.event_staff_memberships/i);
  assert.doesNotMatch(reconciliation, /update public\.park_memberships|update public\.park_invitations/i);
});

test("Connect Admin exposes the server-owned legacy roster review workflow", () => {
  assert.match(connectAdmin, /Reconciliação de equipes legadas/);
  assert.match(connectAdmin, /Preparar ou repetir inventário/);
  assert.match(connectAdmin, /Ativar com segundo operador/);
  assert.match(connectAdmin, /reviewLegacyStaffMapping\(item\.item_id/);
  assert.match(connectAdmin, /activateLegacyStaffMapping\(item\.item_id\)/);
  assert.match(backend, /rpc\("prepare_legacy_staff_reconciliation"/);
  assert.match(backend, /rpc\("review_legacy_staff_mapping"/);
  assert.match(backend, /rpc\("activate_legacy_staff_mapping"/);
  assert.doesNotMatch(connectAdmin, /\.from\("event_staff_memberships"\)/);
});

test("event permissions do not fall back to legacy park-wide operational roles", () => {
  const permission = reconciliation.match(/create or replace function public\.has_event_permission[\s\S]*?\$\$;/i)?.[0] ??
    migration.match(/create or replace function public\.has_event_permission[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(permission, /event_staff_memberships/i);
  assert.doesNotMatch(permission, /park_memberships[\s\S]*?when 'office'|park_memberships[\s\S]*?when 'announcer'/i);
});

test("event-scoped temporary staff access is explicit and expiring", () => {
  assert.match(migration, /create table public\.event_staff_memberships/);
  assert.match(migration, /expires_at timestamptz not null/);
  assert.match(migration, /create or replace function public\.has_event_permission/);
  assert.match(migration, /when 'announcer' then p_permission in/);
  assert.match(migration, /when 'office' then p_permission in/);
  assert.match(migration, /when 'judge' then p_permission in/);
  assert.match(migration, /when 'track_operator' then p_permission in/);
});

test("coordinator credentials can be cleared from the device and on authenticated logout", () => {
  assert.match(coordinatorClient, /export function clearCoordinatorSettings\(\)[\s\S]*localStorage\.removeItem\(SETTINGS_KEY\)/);
  assert.match(app, /Remover credencial deste aparelho/);
  assert.match(app, /\[backendConfigured, coordinatorConfigured\]/);
  assert.match(account, /clearCoordinatorSettings\(\)/);
});

test("telas operacionais são separadas por perfil no cliente e continuam subordinadas ao banco", () => {
  assert.match(app, /allowedTabs/);
  assert.match(app, /canChangePayments/);
  assert.match(rbac, /create policy entries_member_read/);
  assert.match(rbac, /create policy events_member_read/);
});

test("bloqueios da RPC antiga e das gravações diretas da pista permanecem", () => {
  assert.match(trackStop, /revoke all on function public\.apply_event_track_operation/);
  assert.match(serviceStop, /from service_role/);
  assert.match(migration, /comment on function public\.has_event_permission/);
});

test("dados históricos e eventos não recebem comandos de remoção na migration aditiva", () => {
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\./i);
  assert.match(migration, /on delete set null/);
  assert.match(migration, /on delete restrict/);
});

test("public event pages use the public RPC and never render administrative park or participant fields", () => {
  assert.match(publicSite, /getPublicEvents\(\)/);
  assert.match(publicSite, /Simbolo-(?:Principal-)?Connect-Vaquejada\.png/);
  assert.match(publicSite, /publicRouteForPath/);
  assert.match(publicSite, /Perfil p(?:\\u00fa|ú)blico do parque indispon(?:\\u00ed|í)vel/);
  assert.match(app, /isPublicParkPath\(pathname\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/PublicSite"\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/TrackConsole"\)/);
  assert.match(app, /<Suspense fallback=/);
  assert.match(account, /lazy\(\(\) => import\("\.\/ConnectAdmin"\)/);
  assert.doesNotMatch(publicSite, /manager_name|owner_user_id|access_role|paymentStatus|vaqueiro|auditRecords/);
  const publicRpc = publicPublicationMigration.match(/create or replace function public\.list_public_events\([\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.doesNotMatch(publicRpc, /manager_name|phone|owner_user_id|entries|payment|audit/i);
});
