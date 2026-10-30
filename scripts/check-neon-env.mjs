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

report("Frontend: VITE_BACKEND_API_URL HTTPS", Boolean(readUrl("VITE_BACKEND_API_URL", ["https:"])), "Configure VITE_BACKEND_API_URL com o domínio Render.");
report("Frontend: VITE_NEON_DATA_API_URL HTTPS", Boolean(readUrl("VITE_NEON_DATA_API_URL", ["https:"])), "Configure VITE_NEON_DATA_API_URL com a Data API do mesmo ambiente.");

const backendDatabase = readUrl("DATABASE_URL", ["postgres:", "postgresql:"], { directNeon: true });
report("Backend: DATABASE_URL aponta para Neon direto (sem -pooler)", Boolean(backendDatabase), "Configure DATABASE_URL com a conexão direta Neon, sem -pooler.");
report("Backend: BETTER_AUTH_URL HTTPS", Boolean(readUrl("BETTER_AUTH_URL", ["https:"])), "Configure BETTER_AUTH_URL com o domínio público do backend.");
report("Backend: BETTER_AUTH_SECRET com pelo menos 32 caracteres", (process.env.BETTER_AUTH_SECRET?.trim().length || 0) >= 32, "Configure um BETTER_AUTH_SECRET aleatório com pelo menos 32 caracteres.");
report("Backend: RESEND_API_KEY presente", Boolean(process.env.RESEND_API_KEY?.trim()), "Configure RESEND_API_KEY no Render.");
report("Backend: AUTH_EMAIL_FROM presente", Boolean(process.env.AUTH_EMAIL_FROM?.trim()), "Configure AUTH_EMAIL_FROM com remetente verificado.");
report("Backend: NEON_DATA_API_URL HTTPS", Boolean(readUrl("NEON_DATA_API_URL", ["https:"])), "Configure NEON_DATA_API_URL para o mesmo branch Neon.");
report("Backend: BACKEND_ALLOWED_ORIGINS HTTPS", Boolean((process.env.BACKEND_ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter((origin) => readUrlValue(origin))), "Configure BACKEND_ALLOWED_ORIGINS com as origens HTTPS exatas do frontend.");
report("Neon Data API: BETTER_AUTH_JWKS_URL HTTPS", Boolean(readUrl("BETTER_AUTH_JWKS_URL", ["https:"])), "Configure BETTER_AUTH_JWKS_URL no planejamento externo da Data API.");
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

function readUrlValue(raw) {
  if (!raw || /(?:SUBSTITUA|USUARIO|SENHA|SEU-PROJETO|YOUR[_-]?PROJECT|CHANGE_ME)/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname.toLowerCase() !== "" && !url.hostname.toLowerCase().endsWith(".example") ? url : null;
  } catch { return null; }
}
