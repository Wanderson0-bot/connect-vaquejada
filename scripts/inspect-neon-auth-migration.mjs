import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const expectedBranch = "TESTE";
const confirmedHost = process.argv[2]?.trim().toLowerCase();
if (process.env.NEON_BRANCH !== expectedBranch) {
  throw new Error("Esta inspeção somente leitura aceita apenas NEON_BRANCH=TESTE.");
}
const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim();
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED não está configurada.");
let url;
try { url = new URL(connectionString); }
catch { throw new Error("DATABASE_URL_UNPOOLED não contém URL PostgreSQL válida."); }
if (!/^ep-[a-z0-9-]+\.c-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.aws\.neon\.tech$/i.test(url.hostname) || url.hostname.includes("-pooler")) {
  throw new Error("Use o endpoint Neon direto (sem -pooler) do branch de teste.");
}
if (!confirmedHost || confirmedHost !== url.hostname.toLowerCase()) {
  throw new Error("O argumento precisa ser o hostname direto exato do branch confirmado.");
}

const migrationNames = [
  "202610300025_self_managed_better_auth.sql",
  "202610300026_copy_neon_auth_identities.sql",
];
const migrationRows = await Promise.all(migrationNames.map(async (name) => ({
  name,
  checksum: createHash("sha256").update(await readFile(new URL(`../neon/migrations/${name}`, import.meta.url))).digest("hex"),
})));
const pool = new Pool({ connectionString, max: 1 });

function safeError(error) {
  const value = error && typeof error === "object" ? error : {};
  return {
    name: String(value.name || "Error"),
    message: String(value.message || "Erro sem mensagem")
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[URL PostgreSQL ocultada]")
      .replace(/password\s*[=:]\s*[^\s;,]+/gi, "password=[oculto]"),
    code: typeof value.code === "string" ? value.code : undefined,
  };
}

try {
  const identity = await pool.query("select current_database() as database_name, current_user as database_user");
  const objects = await pool.query(`
    select
      to_regnamespace('connect_auth') is not null as connect_auth_schema,
      to_regclass('connect_auth."user"') is not null as connect_auth_user,
      to_regclass('connect_auth.account') is not null as connect_auth_account,
      to_regclass('connect_auth.session') is not null as connect_auth_session,
      to_regclass('connect_auth.verification') is not null as connect_auth_verification,
      to_regclass('connect_auth.jwks') is not null as connect_auth_jwks,
      to_regclass('connect_migrations.schema_migrations') is not null as migration_journal,
      to_regclass('neon_auth."user"') is not null as neon_auth_user,
      to_regclass('neon_auth.account') is not null as neon_auth_account
  `);
  const state = objects.rows[0];
  console.log(`Destino read-only: branch ${expectedBranch}; banco ${identity.rows[0].database_name}.`);
  console.log(`Schema connect_auth: ${state.connect_auth_schema ? "existe" : "ausente"}.`);
  for (const key of ["connect_auth_user", "connect_auth_account", "connect_auth_session", "connect_auth_verification", "connect_auth_jwks", "migration_journal", "neon_auth_user", "neon_auth_account"]) {
    console.log(`${key}: ${state[key] ? "existe" : "ausente"}.`);
  }

  if (state.neon_auth_user) {
    const source = await pool.query(`select count(*)::bigint as users from neon_auth."user"`);
    console.log(`neon_auth users: ${source.rows[0].users}.`);
    if (state.neon_auth_account) {
      const accounts = await pool.query("select count(*)::bigint as accounts from neon_auth.account");
      console.log(`neon_auth accounts: ${accounts.rows[0].accounts}.`);
    }
  }
  if (state.connect_auth_user) {
    const target = await pool.query(`select count(*)::bigint as users from connect_auth."user"`);
    console.log(`connect_auth users: ${target.rows[0].users}.`);
  } else console.log("connect_auth users: 0 (tabela ausente). ");
  if (state.connect_auth_account) {
    const target = await pool.query("select count(*)::bigint as accounts from connect_auth.account");
    console.log(`connect_auth accounts: ${target.rows[0].accounts}.`);
  } else console.log("connect_auth accounts: 0 (tabela ausente). ");

  if (state.migration_journal) {
    const rows = await pool.query(
      "select migration_name, checksum_sha256 from connect_migrations.schema_migrations where migration_name = any($1::text[]) order by migration_name",
      [migrationRows.map((row) => row.name)],
    );
    const byName = new Map(rows.rows.map((row) => [row.migration_name, row.checksum_sha256]));
    for (const migration of migrationRows) {
      const actual = byName.get(migration.name);
      console.log(`${migration.name}: ${actual ? actual === migration.checksum ? "registrada; checksum confere" : "registrada; CHECKSUM DIVERGENTE" : "não registrada"}.`);
    }
  }

  if (state.neon_auth_user && state.connect_auth_user && state.neon_auth_account && state.connect_auth_account) {
    const counts = await pool.query(`
      select
        (select count(*)::bigint from neon_auth."user") as source_users,
        (select count(*)::bigint from connect_auth."user") as target_users,
        (select count(*)::bigint from neon_auth.account) as source_accounts,
        (select count(*)::bigint from connect_auth.account) as target_accounts,
        (select count(*)::bigint from neon_auth."user" s join connect_auth."user" t on t.id=s.id::text) as matching_user_ids,
        (select count(*)::bigint from neon_auth."user" s join connect_auth."user" t on lower(t.email)=lower(s.email)) as matching_user_emails,
        (select count(*)::bigint from neon_auth.account s join connect_auth.account t on t.id=s.id::text) as matching_account_ids,
        (select count(*)::bigint from neon_auth.account s join connect_auth.account t on t.id=s.id::text and t."userId"=s."userId"::text and t."providerId"=s."providerId" and t."accountId"=s."accountId") as matching_account_links,
        (select count(*)::bigint from neon_auth.account s join connect_auth.account t on t.id=s.id::text and t.password is not distinct from s.password where s.password is not null) as matching_password_hashes,
        (select count(*)::bigint from neon_auth."user" s left join connect_auth."user" t on t.id=s.id::text where t.id is null) as source_users_missing_target,
        (select count(*)::bigint from neon_auth.account s left join connect_auth.account t on t.id=s.id::text where t.id is null) as source_accounts_missing_target,
        (select count(*)::bigint from neon_auth."user" s left join public.neon_auth_identity_map m on m.neon_subject=s.id::text where m.neon_subject is null) as users_missing_identity_map,
        (select count(*)::bigint from neon_auth.account s join connect_auth.account t on t.id=s.id::text where t."userId"<>s."userId"::text) as accounts_with_wrong_user_link,
        (select count(*)::bigint from neon_auth.account s join connect_auth.account t on t.id=s.id::text where s.password is not null and t.password is distinct from s.password) as password_hash_mismatches
    `);
    for (const [key, value] of Object.entries(counts.rows[0])) console.log(`${key}: ${value}.`);
  }

  if (state.connect_auth_schema) {
    const columns = await pool.query(`
      select table_name, count(*)::int as columns
        from information_schema.columns
       where table_schema='connect_auth'
       group by table_name order by table_name
    `);
    console.log("Estruturas connect_auth:");
    for (const row of columns.rows) console.log(`${row.table_name}: ${row.columns} colunas.`);
  }
} catch (error) {
  console.error("Inspeção read-only falhou:", safeError(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
