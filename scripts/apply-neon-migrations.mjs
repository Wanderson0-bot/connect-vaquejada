import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "neon", "migrations");
const journalSchema = "connect_migrations";
const journalTable = `${journalSchema}.schema_migrations`;
const lockKey = 731042881;

function parseArgs(args) {
  const parsed = { mode: "check", confirmBranch: null, confirmHost: null, through: null, confirmDataImport: false, confirmEmptyDatabase: false };
  let modeWasSet = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--check", "--verify", "--apply"].includes(arg)) {
      if (modeWasSet) throw new Error("Use apenas um modo: --check, --verify ou --apply.");
      parsed.mode = arg.slice(2);
      modeWasSet = true;
    }
    else if (arg === "--confirm-branch" || arg === "--confirm-host" || arg === "--through") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requer um valor.`);
      const key = arg === "--confirm-branch" ? "confirmBranch" : arg === "--confirm-host" ? "confirmHost" : "through";
      if (parsed[key] !== null) throw new Error(`${arg} pode ser informado apenas uma vez.`);
      parsed[key] = value;
      index += 1;
    } else if (arg === "--confirm-data-import") {
      if (parsed.confirmDataImport) throw new Error("--confirm-data-import pode ser informado apenas uma vez.");
      parsed.confirmDataImport = true;
    } else if (arg === "--confirm-empty-database") {
      if (parsed.confirmEmptyDatabase) throw new Error("--confirm-empty-database pode ser informado apenas uma vez.");
      parsed.confirmEmptyDatabase = true;
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }
  return parsed;
}

async function loadMigrations() {
  const names = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right, "en"));

  if (names.length !== 25 || names[0] !== "000_neon_identity_compat.sql" || !names.includes("202610250023_legacy_staff_access_cutover.sql") || names.at(-1) !== "202610250024_harden_auth_identity_link.sql") {
    throw new Error("Esperava 000_neon_identity_compat.sql, as 22 migrations históricas e as migrations Neon 023/024 em neon/migrations/.");
  }
  if (names.slice(1).some((name) => !/^\d{12}_[a-z0-9_-]+\.sql$/i.test(name))) {
    throw new Error("Há arquivo SQL fora do padrão de migration numerada em neon/migrations/.");
  }

  return Promise.all(names.map(async (name) => {
    const sql = await readFile(join(migrationsDir, name), "utf8");
    if (!sql.trim()) throw new Error(`Migration vazia: ${name}`);
    return {
      name,
      sql,
      checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
    };
  }));
}

function connectionConfig(mode, args) {
  // Allow only explicitly named non-production branches; the confirmation must match .env.local exactly.
  const allowedBranches = new Set(["staging", "TESTE"]);
  if (!allowedBranches.has(args.confirmBranch) || process.env.NEON_BRANCH !== args.confirmBranch) {
    throw new Error("A opera\u00e7\u00e3o remota exige --confirm-branch igual a NEON_BRANCH e limitado a staging ou TESTE; n\u00e3o aplique diretamente em produ\u00e7\u00e3o.");
  }
  if (!process.env.DATABASE_URL_UNPOOLED) {
    throw new Error("Defina DATABASE_URL_UNPOOLED com a conex\u00e3o direta do branch confirmado.");
  }

  let url;
  try {
    url = new URL(process.env.DATABASE_URL_UNPOOLED);
  } catch {
    throw new Error("DATABASE_URL_UNPOOLED não contém uma URL PostgreSQL válida.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL_UNPOOLED precisa usar o protocolo PostgreSQL.");
  }
  if (!url.hostname.toLowerCase().endsWith(".neon.tech")) {
    throw new Error("DATABASE_URL_UNPOOLED precisa apontar para um endpoint Neon.");
  }
  if (url.hostname.toLowerCase().includes("-pooler")) {
    throw new Error("Use a conexão direta (sem -pooler) para aplicar migrations.");
  }
  if (!args.confirmHost || args.confirmHost.toLowerCase() !== url.hostname.toLowerCase()) {
    throw new Error("--confirm-host deve corresponder exatamente ao host da conexão direta do branch confirmado.");
  }

  return { connectionString: process.env.DATABASE_URL_UNPOOLED, url };
}

async function verifyPrerequisites(client) {
  const result = await client.query(`
    select
      to_regclass('neon_auth."user"') is not null as neon_auth_user_exists,
      exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_session_jwt') as pg_session_jwt_available,
      exists (select 1 from pg_catalog.pg_available_extensions where name = 'pgcrypto') as pgcrypto_available,
      exists (
        select 1
          from pg_catalog.pg_extension extension_row
          join pg_catalog.pg_namespace extension_schema on extension_schema.oid = extension_row.extnamespace
         where extension_row.extname = 'pgcrypto' and extension_schema.nspname <> 'extensions'
      ) as pgcrypto_wrong_schema
  `);
  const state = result.rows[0];
  const missing = [];
  if (!state.neon_auth_user_exists) missing.push("Neon Auth habilitado (neon_auth.user)");
  if (!state.pg_session_jwt_available) missing.push("extensão pg_session_jwt disponível (auth.user_id())");
  if (!state.pgcrypto_available) missing.push("extensão pgcrypto disponível");
  if (state.pgcrypto_wrong_schema) missing.push("pgcrypto já instalado fora do schema extensions; revise antes de continuar");
  if (missing.length) {
    throw new Error(`Pré-requisitos ausentes: ${missing.join(", ")}. Nenhuma migration foi iniciada.`);
  }
}

async function ensureJournal(client) {
  await client.query(`create schema if not exists ${journalSchema}`);
  await client.query(`
    create table if not exists ${journalTable} (
      migration_name text primary key,
      checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz not null default now()
    )
  `);
  await client.query(`revoke all on schema ${journalSchema} from public`);
  await client.query(`revoke all on table ${journalTable} from public`);
}

async function readJournal(client) {
  const exists = await client.query("select to_regclass($1) as journal", [journalTable]);
  if (!exists.rows[0].journal) return [];
  const result = await client.query(`select migration_name, checksum_sha256 from ${journalTable} order by migration_name`);
  return result.rows;
}

function compareJournal(migrations, journalRows) {
  const byName = new Map(journalRows.map((row) => [row.migration_name, row.checksum_sha256]));
  const knownNames = new Set(migrations.map((migration) => migration.name));
  const unknown = [...byName.keys()].filter((name) => !knownNames.has(name));
  if (unknown.length) throw new Error(`O histórico contém migrations que não existem neste código: ${unknown.join(", ")}.`);

  for (const migration of migrations) {
    const existingChecksum = byName.get(migration.name);
    if (existingChecksum && existingChecksum !== migration.checksum) {
      throw new Error(`Checksum divergente em ${migration.name}; arquivo já aplicado foi alterado. Não reaplique nem edite o histórico automaticamente.`);
    }
  }

  let foundPending = false;
  for (const migration of migrations) {
    if (!byName.has(migration.name)) foundPending = true;
    else if (foundPending) {
      throw new Error(`Histórico fora de ordem: ${migration.name} consta aplicada depois de uma migration pendente. Revise o banco antes de continuar.`);
    }
  }
}

async function verifyEmptyAppSchema(client, journalRows) {
  if (journalRows.length) return;
  const result = await client.query(`
    select exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
    ) as has_public_tables
  `);
  if (result.rows[0].has_public_tables) {
    throw new Error("Encontrei tabelas de aplicação sem journal de migrations. Estado ambíguo; interrompi antes de alterar o schema.");
  }
}

async function verifyEmptyApplicationData(client, migrations) {
  const tableNames = new Set(["app_users", "neon_auth_identity_map"]);
  for (const migration of migrations) {
    for (const match of migration.sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z][a-z0-9_]*)/gi)) {
      tableNames.add(match[1]);
    }
  }
  if (tableNames.size < 3) throw new Error("Não consegui identificar as tabelas de aplicação; não confirmei que o banco está vazio.");
  for (const tableName of tableNames) {
    const relation = await client.query("select to_regclass($1) as relation", [`public.${tableName}`]);
    if (!relation.rows[0].relation) throw new Error(`Tabela esperada ausente: public.${tableName}.`);
    const rows = await client.query(`select exists (select 1 from public.${tableName} limit 1) as has_rows`);
    if (rows.rows[0].has_rows) {
      throw new Error(`public.${tableName} contém registros; --confirm-empty-database não pode ser usado.`);
    }
  }
  console.log(`Banco vazio confirmado: ${tableNames.size} tabelas de aplicação/identidade sem registros.`);
}

async function verifyNeonCompat(client, includePgcrypto = false) {
  const result = await client.query(`
    select
      to_regprocedure('auth.user_id()') is not null as jwt_user_id_exists,
      exists (
        select 1
          from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
          join pg_catalog.pg_roles member_role on member_role.oid = membership.member
         where granted_role.rolname = 'anon' and member_role.rolname = 'anonymous'
      ) as anonymous_inherits_anon,
      exists (
        select 1
          from pg_catalog.pg_extension extension_row
          join pg_catalog.pg_namespace extension_schema on extension_schema.oid = extension_row.extnamespace
         where extension_row.extname = 'pgcrypto' and extension_schema.nspname = 'extensions'
      ) as pgcrypto_in_extensions
  `);
  const state = result.rows[0];
  if (!state.jwt_user_id_exists) throw new Error("Compatibility Neon incompleta: auth.user_id() não foi instalada.");
  if (!state.anonymous_inherits_anon) throw new Error("Compatibility Neon incompleta: o papel anonymous não herda anon.");
  if (includePgcrypto && !state.pgcrypto_in_extensions) {
    throw new Error("Compatibility Neon incompleta: pgcrypto não está instalado em extensions.");
  }
}

function sanitizeError(error) {
  const details = [
    error?.name,
    error?.message,
    error?.error?.name,
    error?.error?.message,
    error?.cause?.name,
    error?.cause?.message,
    typeof error?.code === "string" ? `code=${error.code}` : "",
    typeof error?.errno === "string" ? `errno=${error.errno}` : "",
    typeof error?.syscall === "string" ? `syscall=${error.syscall}` : "",
    typeof error?.stack === "string" ? error.stack.split("\n").slice(0, 4).join(" ") : "",
  ].filter((detail) => typeof detail === "string" && detail.trim());
  return String(details.join(": ") || error || "erro sem mensagem")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[URL PostgreSQL ocultada]")
    .replace(/password\s*=\s*[^\s;]+/gi, "password=[oculto]");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const migrations = await loadMigrations();

  if (args.through && args.mode !== "apply") {
    throw new Error("--through só pode ser usado com --apply.");
  }
  if (args.confirmDataImport && args.mode !== "apply") {
    throw new Error("--confirm-data-import só pode ser usado com --apply.");
  }
  if (args.confirmEmptyDatabase && args.mode !== "apply") {
    throw new Error("--confirm-empty-database só pode ser usado com --apply.");
  }
  if (args.confirmDataImport && args.confirmEmptyDatabase) {
    throw new Error("Use apenas uma confirmação: --confirm-data-import ou --confirm-empty-database.");
  }
  const throughIndex = args.through ? migrations.findIndex((migration) => migration.name === args.through) : migrations.length - 1;
  if (throughIndex === -1) {
    throw new Error("--through deve ser o nome exato de uma migration listada por db:check-neon.");
  }
  const dataCutoverIndex = migrations.findIndex((migration) => migration.name === "202610250023_legacy_staff_access_cutover.sql");
  if (args.mode === "apply" && throughIndex >= dataCutoverIndex && !args.confirmDataImport && !args.confirmEmptyDatabase) {
    throw new Error("As migrations 023/024 exigem --confirm-data-import após uma carga revisada ou --confirm-empty-database para uma instalação intencionalmente vazia.");
  }

  if (args.mode === "check") {
    for (const migration of migrations) console.log(`${migration.name}  sha256:${migration.checksum}`);
    console.log(`Verificação local concluída: ${migrations.length} arquivos; nenhuma conexão aberta.`);
    return;
  }

  const { connectionString } = connectionConfig(args.mode, args);
  const pool = new Pool({ connectionString, max: 1 });
  let client;
  let locked = false;
  try {
    client = await pool.connect();
    await client.query("select pg_advisory_lock($1)", [lockKey]);
    locked = true;

    if (args.mode === "verify") {
      await verifyPrerequisites(client);
      console.log("Pré-requisitos Neon conferidos: Neon Auth e extensões necessárias disponíveis.");
      const rows = await readJournal(client);
      compareJournal(migrations, rows);
      await verifyEmptyAppSchema(client, rows);
      const applied = new Set(rows.map((row) => row.migration_name));
      if (applied.has("000_neon_identity_compat.sql")) {
        await verifyNeonCompat(client, applied.has("202610220012_individual_rbac.sql"));
      }
      for (const migration of migrations) {
        console.log(`${applied.has(migration.name) ? "APLICADA" : "PENDENTE"} ${migration.name}`);
      }
      console.log(`Histórico conferido: ${rows.length}/${migrations.length} migrations registradas.`);
      return;
    }

    await verifyPrerequisites(client);
    await ensureJournal(client);
    const rows = await readJournal(client);
    compareJournal(migrations, rows);
    await verifyEmptyAppSchema(client, rows);
    if (args.confirmEmptyDatabase) await verifyEmptyApplicationData(client, migrations);
    const applied = new Set(rows.map((row) => row.migration_name));

    for (const [index, migration] of migrations.entries()) {
      if (index > throughIndex) break;
      if (applied.has(migration.name)) {
        console.log(`Já aplicada; ignorando ${migration.name}`);
        continue;
      }

      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          `insert into ${journalTable} (migration_name, checksum_sha256) values ($1, $2)`,
          [migration.name, migration.checksum],
        );
        await client.query("commit");
        applied.add(migration.name);
        console.log(`Aplicada ${migration.name}`);
      } catch (error) {
        try { await client.query("rollback"); } catch { /* preserve the original migration error */ }
        throw new Error(`Falha em ${migration.name}; a transação desta migration foi desfeita. ${sanitizeError(error)}`);
      }
    }
    await verifyNeonCompat(client, applied.has("202610220012_individual_rbac.sql"));
    if (throughIndex < migrations.length - 1) {
      console.log(`Checkpoint concluído em ${migrations[throughIndex].name}; ${applied.size}/${migrations.length} migrations registradas.`);
    } else {
      console.log(`Concluído: ${migrations.length} migrations verificadas; novas alterações registradas no journal.`);
    }
  } finally {
    if (locked) {
      try { await client.query("select pg_advisory_unlock($1)", [lockKey]); } catch { /* connection close releases the lock */ }
    }
    client?.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Erro no aplicador Neon: ${sanitizeError(error)}`);
  process.exitCode = 1;
});
