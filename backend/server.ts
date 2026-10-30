import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { auth, pool } from "./auth.js";
import eventAccessHandler from "./event-access.js";
import { handleBootstrapAdmin } from "./bootstrap-admin.js";

const port = Number.parseInt(process.env.PORT || "10000", 10);
const maxBodyBytes = 16 * 1024;

function loadAllowedOrigins(): Set<string> {
  const configured = (process.env.BACKEND_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV !== "production") {
    configured.push("http://localhost:5173", "http://127.0.0.1:5173");
  }
  if (configured.length === 0) throw new Error("BACKEND_ALLOWED_ORIGINS precisa listar ao menos uma origem exata do frontend.");

  return new Set(configured.map((value) => {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error("BACKEND_ALLOWED_ORIGINS contém uma origem inválida."); }
    const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((!isLocalHttp && url.protocol !== "https:") || url.origin !== value) {
      throw new Error("BACKEND_ALLOWED_ORIGINS deve conter origens HTTPS exatas, sem caminho ou barra final.");
    }
    return url.origin;
  }));
}

const allowedOrigins = loadAllowedOrigins();
const authHandler = toNodeHandler(auth.handler);
const registrationAttempts = new Map<string, { count: number; resetAt: number }>();

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.end(JSON.stringify(body));
}

function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
  response.setHeader("Vary", "Origin");
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) {
    sendJson(response, 403, { error: "Origem não autorizada." });
    return false;
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With");
  response.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function readClientIp(request: IncomingMessage): string {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function registrationRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = registrationAttempts.get(ip);
  if (!record || record.resetAt <= now) {
    registrationAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  record.count += 1;
  return record.count > 5;
}

async function handleRegistration(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Método não permitido." });
  const ip = readClientIp(request);
  if (registrationRateLimited(ip)) return sendJson(response, 429, { error: "Aguarde antes de tentar outro cadastro." });
  let body: { registrationType?: unknown; name?: unknown; email?: unknown; password?: unknown; confirmationPassword?: unknown; invitationToken?: unknown; callbackURL?: unknown };
  try { body = JSON.parse(await readRequestBody(request)); }
  catch (error) {
    if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 413) {
      return sendJson(response, 413, { error: "A solicitação excede o tamanho permitido." });
    }
    return sendJson(response, 400, { error: "Envie os dados em JSON válido." });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const confirmationPassword = typeof body.confirmationPassword === "string" ? body.confirmationPassword : "";
  const invitationToken = typeof body.invitationToken === "string" ? body.invitationToken.trim() : "";
  const callbackURL = typeof body.callbackURL === "string" ? body.callbackURL : "";
  const connectAdminRegistration = body.registrationType === "connect_admin";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 128 || invitationToken.length < 16 || invitationToken.length > 256 || ((connectAdminRegistration || body.name !== undefined) && (name.length < 3 || name.length > 100)) || (connectAdminRegistration && password !== confirmationPassword)) {
    return sendJson(response, 400, { error: "Email, senha de pelo menos 10 caracteres e convite válido são obrigatórios." });
  }
  let callbackOrigin: string;
  try { callbackOrigin = new URL(callbackURL).origin; }
  catch { return sendJson(response, 400, { error: "Destino de confirmação inválido." }); }
  if (!allowedOrigins.has(callbackOrigin)) return sendJson(response, 400, { error: "Destino de confirmação não autorizado." });
  try {
    const invited = await pool.query<{ allowed: boolean }>(
      `select case when $3::boolean then
        exists(select 1 from public.admin_bootstrap_invitations i where i.token_hash=extensions.digest(convert_to($1,'UTF8'),'sha256') and lower(i.email)=lower($2) and i.consumed_at is null and i.expires_at>now())
        else
        (exists(select 1 from public.park_invitations i where i.token_hash=extensions.digest(convert_to($1,'UTF8'),'sha256') and lower(i.email)=lower($2) and i.accepted_at is null and i.revoked_at is null and i.expires_at>now())
        or exists(select 1 from public.event_staff_invitations i where i.token_hash=extensions.digest(convert_to($1,'UTF8'),'sha256') and lower(i.email)=lower($2) and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()))
      end as allowed`, [invitationToken, email, connectAdminRegistration],
    );
    if (!invited.rows[0]?.allowed) return sendJson(response, 403, { error: "O convite é inválido, expirou ou pertence a outro email." });
    await pool.query(
      `update public.admin_bootstrap_invitations
          set registration_started_at=coalesce(registration_started_at,now())
        where token_hash=extensions.digest(convert_to($1,'UTF8'),'sha256')
          and lower(email)=lower($2) and consumed_at is null and expires_at>now()`,
      [invitationToken, email],
    );
    const authHeaders = new Headers({
      "content-type": "application/json",
      origin: String(request.headers.origin || callbackOrigin),
    });
    const authRequest = new Request(`${process.env.BETTER_AUTH_URL!.replace(/\/$/, "")}/api/auth/sign-up/email`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ email, password, name: name || email.split("@")[0], callbackURL }),
    });
    const authResponse = await auth.handler(authRequest);
    response.statusCode = authResponse.status;
    authResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") response.setHeader(key, value);
    });
    const cookies = authResponse.headers.getSetCookie?.() || [];
    if (cookies.length) response.setHeader("Set-Cookie", cookies);
    response.end(Buffer.from(await authResponse.arrayBuffer()));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    console.error("Connect registration failed.", { code });
    if (!response.headersSent) sendJson(response, 500, { error: "Não foi possível concluir o cadastro." });
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const declaredSize = Number(request.headers["content-length"] || 0);
  if (declaredSize > maxBodyBytes) throw Object.assign(new Error("Corpo da requisição muito grande."), { statusCode: 413 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw Object.assign(new Error("Corpo da requisição muito grande."), { statusCode: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function adaptResponse(response: ServerResponse) {
  return {
    status(code: number) { response.statusCode = code; return this; },
    setHeader(name: string, value: string) { response.setHeader(name, value); return this; },
    json(body: unknown) {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(body));
    },
  };
}

const server = createServer(async (request, response) => {
  if (!applyCors(request, response)) return;
  const pathname = new URL(request.url || "/", "http://localhost").pathname;

  if (pathname === "/health" && request.method === "GET") {
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (pathname.startsWith("/api/auth/")) {
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    authHandler(request, response);
    return;
  }
  if (pathname === "/api/register") {
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    await handleRegistration(request, response);
    return;
  }
  if (pathname === "/api/bootstrap-admin") {
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    await handleBootstrapAdmin(request, response, pool);
    return;
  }
  if (pathname !== "/api/event-access") {
    sendJson(response, 404, { error: "Rota não encontrada." });
    return;
  }
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Método não permitido." });
    return;
  }

  try {
    const body = await readRequestBody(request);
    await eventAccessHandler(
      { method: request.method, headers: request.headers, body },
      adaptResponse(response),
    );
  } catch (error) {
    const statusCode = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode : 500;
    if (statusCode >= 500) console.error("Falha HTTP no serviço de acesso Connect.", { statusCode });
    if (!response.headersSent) sendJson(response, statusCode, {
      error: statusCode === 413 ? "A solicitação excede o tamanho permitido." : "Não foi possível processar a solicitação.",
    });
    else response.end();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Connect backend listening on port ${port}.`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down Connect backend.`);
  server.close((error) => {
    if (error) {
      console.error("Backend shutdown failed.", { name: error.name, code: Reflect.get(error, "code") });
      process.exitCode = 1;
    }
    void pool.end().catch((poolError: unknown) => {
      const value = poolError && typeof poolError === "object" ? poolError : {};
      console.error("Backend database pool shutdown failed.", {
        name: "name" in value ? String(value.name) : "Error",
        code: "code" in value ? String(value.code) : "unknown",
      });
      process.exitCode = 1;
    });
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
