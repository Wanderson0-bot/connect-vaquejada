const problems = [];

function report(label, ok, problem) {
  console.log(`${ok ? "OK" : "FALTA/INVÁLIDO"} ${label}`);
  if (!ok) problems.push(problem || label);
}

function readUrl(name, protocols, { directNeon = false } = {}) {
  const raw = process.env[name]?.trim();
  if (!raw || /(?:SUBSTITUA|USUARIO|SENHA|SEU-PROJETO|YOUR[_-]?PROJECT|CHANGE_ME)/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (!protocols.includes(url.protocol)) return null;
    if (url.hostname.toLowerCase().endsWith(".example")) return null;
    if (directNeon && (!url.hostname.toLowerCase().endsWith(".neon.tech") || url.hostname.toLowerCase().includes("-pooler"))) return null;
    return url;
  } catch {
    return null;
  }
}

const hasFrontendEndpoints = Boolean(
  readUrl("VITE_NEON_AUTH_BASE_URL", ["https:"]) &&
  readUrl("VITE_NEON_DATA_API_URL", ["https:"]),
);
const hasFrontendBaseUrl = Boolean(readUrl("VITE_NEON_URL", ["https:"]));
report(
  "Frontend: VITE_NEON_AUTH_BASE_URL + VITE_NEON_DATA_API_URL ou VITE_NEON_URL",
  hasFrontendEndpoints || hasFrontendBaseUrl,
  "Configure os endpoints Neon públicos usados pelo frontend.",
);

report("API: DATABASE_URL PostgreSQL", Boolean(readUrl("DATABASE_URL", ["postgres:", "postgresql:"])), "Configure DATABASE_URL no servidor.");
report("API: NEON_AUTH_BASE_URL HTTPS", Boolean(readUrl("NEON_AUTH_BASE_URL", ["https:"])), "Configure NEON_AUTH_BASE_URL no servidor.");
report("API: NEON_DATA_API_URL HTTPS", Boolean(readUrl("NEON_DATA_API_URL", ["https:"])), "Configure NEON_DATA_API_URL no servidor.");
report(
  "API: EVENT_ACCESS_PASSWORD_SECRET com pelo menos 32 caracteres",
  (process.env.EVENT_ACCESS_PASSWORD_SECRET?.length || 0) >= 32,
  "Configure EVENT_ACCESS_PASSWORD_SECRET com pelo menos 32 caracteres e mantenha-o estável para os acessos emitidos.",
);

const branch = process.env.NEON_BRANCH;
report(
  "Migrations: NEON_BRANCH TESTE ou staging",
  branch === "TESTE" || branch === "staging",
  "Defina NEON_BRANCH exatamente como TESTE ou staging.",
);
const directUrl = readUrl("DATABASE_URL_UNPOOLED", ["postgres:", "postgresql:"], { directNeon: true });
report(
  "Migrations: DATABASE_URL_UNPOOLED aponta para endpoint Neon direto (sem -pooler)",
  Boolean(directUrl),
  "Configure DATABASE_URL_UNPOOLED com a URL direta da branch Neon confirmada, sem -pooler.",
);

if (problems.length) {
  console.error(`Preflight local incompleto: ${problems.length} configuração(ões) precisa(m) de atenção. Nenhum valor foi exibido e nenhuma conexão foi aberta.`);
  process.exitCode = 1;
} else {
  console.log("Preflight local concluído: variáveis presentes e com formato esperado; nenhuma conexão foi aberta.");
}
