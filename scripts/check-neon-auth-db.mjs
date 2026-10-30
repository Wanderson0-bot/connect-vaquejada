import { Pool } from "pg";

const expectedBranch = "TESTE";
const confirmedHost = process.argv[2]?.trim().toLowerCase();
if (process.env.NEON_BRANCH !== expectedBranch) {
  throw new Error("Esta verificação só aceita NEON_BRANCH=TESTE.");
}
const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim();
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED não está configurada.");
let url;
try { url = new URL(connectionString); }
catch { throw new Error("DATABASE_URL_UNPOOLED não contém uma URL PostgreSQL válida."); }
if (!/[?&]sslmode=require\b/i.test(url.search)) throw new Error("A URL direta precisa exigir TLS com sslmode=require.");
if (!url.hostname.endsWith(".neon.tech") || url.hostname.includes("-pooler")) {
  throw new Error("Use o endpoint Neon direto, sem -pooler.");
}
if (!confirmedHost || confirmedHost !== url.hostname.toLowerCase()) {
  throw new Error("Informe como argumento o hostname direto exato exibido no Neon Console.");
}

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 12_000 });
function safeError(error) {
  const value = error && typeof error === "object" ? error : {};
  const message = String(value.message || "Erro sem mensagem")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[URL PostgreSQL ocultada]")
    .replace(/password\s*[=:]\s*[^\s;,]+/gi, "password=[oculto]");
  return { name: String(value.name || "Error"), message, code: typeof value.code === "string" ? value.code : undefined };
}

try {
  const identity = await pool.query("select current_database() as database_name, version() as server_version");
  const columns = await pool.query(`
    select table_schema, table_name, column_name, data_type, is_nullable
      from information_schema.columns
     where table_schema in ('neon_auth', 'connect_auth')
       and table_name in ('user', 'account', 'session', 'verification', 'jwks')
     order by table_schema, table_name, ordinal_position
  `);
  console.log("Conexão read-only PostgreSQL direta ao branch TESTE estabelecida.");
  console.log(`Banco: ${identity.rows[0].database_name}`);
  console.log(`Servidor: ${identity.rows[0].server_version}`);
  console.log(`Colunas de autenticação encontradas: ${columns.rowCount}`);
  for (const row of columns.rows) {
    console.log(`${row.table_schema}.${row.table_name}.${row.column_name} ${row.data_type} nullable=${row.is_nullable}`);
  }
} catch (error) {
  console.error("A verificação read-only falhou:", safeError(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
