import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createAuthClient } from "better-auth/client";
import { jwtClient } from "better-auth/client/plugins";
import packageJson from "../package.json" with { type: "json" };

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|mjs)$/.test(entry.name) ? [path] : [];
  }));
  return files.flat();
}

const applicationFiles = [
  ...(await sourceFiles("src")),
  ...(await sourceFiles("backend")),
];
const applicationSource = (await Promise.all(applicationFiles.map((path) => readFile(path, "utf8")))).join("\n");
const migrationFiles = (await readdir("neon/migrations")).filter((name) => name.endsWith(".sql"));
const migrations = new Map(await Promise.all(migrationFiles.map(async (name) => [name, await readFile(join("neon/migrations", name), "utf8")])));
const migrationSource = [...migrations.values()].join("\n");
const migrationSql = migrationSource.replace(/--.*$/gm, "");
const migration015Preflight = await readFile("neon/diagnostics/legacy_staff_cutover_preflight.sql", "utf8");
const migrationRunner = await readFile("scripts/apply-neon-migrations.mjs", "utf8");

test("Neon migrations define the application tables and generated identities", () => {
  const tableNames = (sql) => [...new Set([...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi)].map((match) => match[1].toLowerCase()))].sort();
  const applicationMigrationsSql = [...migrationFiles]
    .filter((name) => !name.startsWith("000_") && !name.startsWith("202610250023_"))
    .map((name) => migrations.get(name))
    .join("\n");
  const applicationTables = tableNames(applicationMigrationsSql);
  assert.equal(applicationTables.length, 28);
  assert.ok(applicationTables.includes("parks"));
  assert.ok(applicationTables.includes("events"));
  assert.ok(applicationTables.includes("entries"));
  const identityColumns = [];
  for (const match of applicationMigrationsSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\);/gim)) {
    for (const column of match[2].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+[^,\n]*generated\s+always\s+as\s+identity/gim)) {
      identityColumns.push({ table: match[1].toLowerCase(), column: column[1].toLowerCase(), generation: "always" });
    }
  }
  identityColumns.sort((left, right) => left.table.localeCompare(right.table, "en"));
  assert.equal(identityColumns.length, 7);
});

test("installed Better Auth client exposes the flows used by Connect", () => {
  const client = createAuthClient({ baseURL: "https://backend.example.invalid", plugins: [jwtClient()] });
  for (const method of ["getSession", "signIn", "signUp", "signOut", "requestPasswordReset", "resetPassword", "sendVerificationEmail", "token"]) {
    assert.equal(typeof client[method], "function", `expected Better Auth client method ${method}`);
  }
  assert.equal(packageJson.dependencies["better-auth"], "1.7.14");
  assert.equal(packageJson.dependencies["@neondatabase/neon-js"], undefined);
  assert.equal(packageJson.dependencies["@neondatabase/auth"], undefined);
  assert.equal(packageJson.dependencies["@neondatabase/auth-ui"], undefined);
});

test("event access provisions identities through the server-side Better Auth API", async () => {
  const handler = await readFile("backend/event-access.ts", "utf8");
  assert.match(handler, /auth\.api\.signUpEmail/);
  assert.match(handler, /connect_auth\."user"/);
  assert.doesNotMatch(handler, /NEON_AUTH_BASE_URL/);
});

test("Better Auth uses a persistent PostgreSQL connection and exposes external JWT keys", async () => {
  const authConfig = await readFile("backend/auth.ts", "utf8");
  const neonConfig = await readFile("neon.external-auth.ts", "utf8");
  const schema = migrations.get("202610300025_self_managed_better_auth.sql");
  const identityCopy = migrations.get("202610300026_copy_neon_auth_identities.sql");
  assert.match(authConfig, /new Pool\(/);
  assert.match(authConfig, /requireEmailVerification:\s*true/);
  assert.match(authConfig, /minPasswordLength:\s*10/);
  assert.match(authConfig, /plugins:\s*\[jwt\(/);
  assert.match(neonConfig, /authProvider:\s*"external"/);
  assert.match(neonConfig, /jwksUrl/);
  for (const table of ["user", "session", "account", "verification", "jwks"]) {
    assert.match(schema, new RegExp(`create table if not exists connect_auth\\."?${table}"?`, "i"));
  }
  assert.match(schema, /sync_current_app_user/);
  assert.match(identityCopy, /insert into connect_auth\.account[\s\S]*?password[\s\S]*?from neon_auth\.account/i);
  assert.match(identityCopy, /insert into connect_auth\."user"[\s\S]*?from neon_auth\."user"/i);
  assert.doesNotMatch(identityCopy, /\b(?:delete\s+from|truncate|drop\s+table)\b/i);
});

test("every literal Data API RPC call has a function in the Neon migrations", () => {
  const calls = new Set([...applicationSource.matchAll(/\.rpc\(\s*["']([a-z0-9_]+)["']/gi)].map((match) => match[1].toLowerCase()));
  const functions = new Set([...migrationSource.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)].map((match) => match[1].toLowerCase()));
  const missing = [...calls].filter((name) => !functions.has(name)).sort();

  assert.ok(calls.size > 0, "expected to find literal RPC calls in the application");
  assert.deepEqual(missing, []);
});

test("every literal Data API table call has a table or view in the Neon migrations", () => {
  const calls = new Set([...applicationSource.matchAll(/\.from\(\s*["']([a-z0-9_]+)["']/gi)].map((match) => match[1].toLowerCase()));
  const relations = new Set([
    ...[...migrationSource.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/gi)].map((match) => match[1].toLowerCase()),
    ...[...migrationSource.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?([a-z0-9_]+)/gi)].map((match) => match[1].toLowerCase()),
  ]);
  const missing = [...calls].filter((name) => !relations.has(name)).sort();

  assert.ok(calls.size > 0, "expected to find literal table calls in the application");
  assert.deepEqual(missing, []);
});

test("Neon migration set starts with compatibility and uses Neon identity helpers", () => {
  const sorted = [...migrationFiles].sort((left, right) => left.localeCompare(right, "en"));
  assert.equal(sorted.length, 28);
  assert.equal(sorted[0], "000_neon_identity_compat.sql");
  assert.ok(sorted.includes("202610250023_legacy_staff_access_cutover.sql"));
  assert.ok(sorted.includes("202610250024_harden_auth_identity_link.sql"));
  assert.equal(sorted.at(-3), "202610300025_self_managed_better_auth.sql");
  assert.equal(sorted.at(-2), "202610300026_copy_neon_auth_identities.sql");
  assert.equal(sorted.at(-1), "202610300027_admin_bootstrap_invitations.sql");
  assert.doesNotMatch(migrationSql, /\bauth\.(?:users|uid\s*\(|jwt\s*\(|role\s*\()/i);
  assert.match(migrationSql, /auth\.user_id\s*\(\s*\)/i);
});

test("Neon migrations avoid SQL commands that cannot run inside the per-file transaction", () => {
  assert.doesNotMatch(migrationSource, /\b(?:create\s+database|drop\s+database|vacuum|alter\s+system)\b/i);
  assert.doesNotMatch(migrationSource, /\bcreate\s+(?:unique\s+)?index\s+concurrently\b/i);
});

test("pgcrypto is installed before migrated functions first call extensions.digest", () => {
  const sorted = [...migrationFiles].sort((left, right) => left.localeCompare(right, "en"));
  const installIndex = sorted.indexOf("202610220012_individual_rbac.sql");
  const digestIndexes = sorted.filter((name) => /extensions\.digest\s*\(/i.test(migrations.get(name))).map((name) => sorted.indexOf(name));
  assert.notEqual(installIndex, -1, "expected the RBAC migration that installs pgcrypto");
  assert.match(migrations.get(sorted[installIndex]), /create\s+extension\s+if\s+not\s+exists\s+pgcrypto\s+with\s+schema\s+extensions/i);
  assert.ok(digestIndexes.length > 0, "expected functions to use pgcrypto");
  assert.ok(digestIndexes.every((index) => index >= installIndex), "every digest call must follow pgcrypto installation");
});

test("migration runner rejects invalid checkpoints before opening a database connection", () => {
  const result = spawnSync(process.execPath, [
    "scripts/apply-neon-migrations.mjs", "--apply", "--through", "not-a-migration.sql",
  ], { encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--through deve ser o nome exato de uma migration/);
  assert.doesNotMatch(result.stderr, /DATABASE_URL|postgres(?:ql)?:\/\//i);
});

test("migration runner recognizes the data-import checkpoint without connecting when credentials are absent", () => {
  const result = spawnSync(process.execPath, [
    "scripts/apply-neon-migrations.mjs", "--apply", "--confirm-branch", "staging", "--through", "202610250022_connect_park_code.sql",
  ], { encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NEON_BRANCH: "staging" } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Defina DATABASE_URL_UNPOOLED/);
  assert.doesNotMatch(result.stderr, /postgres(?:ql)?:\/\//i);
});

test("migration runner accepts the explicitly allowed TESTE branch without connecting", () => {
  const result = spawnSync(process.execPath, [
    "scripts/apply-neon-migrations.mjs", "--verify", "--confirm-branch", "TESTE", "--confirm-host", "ep-test.neon.tech",
  ], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NEON_BRANCH: "TESTE" },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Defina DATABASE_URL_UNPOOLED/);
  assert.doesNotMatch(result.stderr, /staging ou TESTE|NEON_BRANCH.*limitado/i);
  assert.doesNotMatch(result.stderr, /postgres(?:ql)?:\/\//i);
});

test("read-only Neon verification checks migration prerequisites before reading the journal", () => {
  assert.match(migrationRunner, /if\s*\(args\.mode\s*===\s*"verify"\)\s*\{\s*await verifyPrerequisites\(client\);\s*console\.log\(/);
  assert.match(migrationRunner, /function verifyPrerequisites\(client\)[\s\S]*?to_regclass\('neon_auth\."user"'\)[\s\S]*?pg_session_jwt[\s\S]*?pgcrypto/);
});

test("migration runner rejects a branch name that is not explicitly allowed before reading credentials", () => {
  const result = spawnSync(process.execPath, [
    "scripts/apply-neon-migrations.mjs", "--verify", "--confirm-branch", "production", "--confirm-host", "ep-prod.neon.tech",
  ], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NEON_BRANCH: "production" },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /staging ou TESTE/);
  assert.doesNotMatch(result.stderr, /postgres(?:ql)?:\/\//i);
});

test("legacy access cutover preflight is read-only and mirrors its blocking conditions", () => {
  const preflightSql = migration015Preflight.replace(/--.*$/gm, "");
  const cutoverSql = migrations.get("202610250023_legacy_staff_access_cutover.sql").replace(/--.*$/gm, "");

  assert.doesNotMatch(preflightSql, /\b(?:insert\s+into|update\s+\w+|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate|grant|revoke)\b/i);
  for (const sql of [preflightSql, cutoverSql]) {
    assert.match(sql, /park_memberships[\s\S]*?disabled_at\s+is\s+null[\s\S]*?office[\s\S]*?announcer[\s\S]*?judge[\s\S]*?track_operator/i);
    assert.match(sql, /park_invitations[\s\S]*?accepted_at\s+is\s+null[\s\S]*?revoked_at\s+is\s+null/i);
  }
  assert.match(preflightSql, /pg_catalog\.pg_get_triggerdef/);
  assert.match(preflightSql, /not\s+trg\.tgisinternal/i);
});

test("the data-access cutover requires explicit confirmation before connecting", () => {
  const result = spawnSync(process.execPath, ["scripts/apply-neon-migrations.mjs", "--apply"], {
    encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /migrations 023\/024 exigem --confirm-data-import/);
  assert.doesNotMatch(result.stderr, /DATABASE_URL|postgres(?:ql)?:\/\//i);
});
