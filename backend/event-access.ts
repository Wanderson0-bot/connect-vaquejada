import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

type Request = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type Response = {
  status: (code: number) => Response;
  setHeader: (name: string, value: string) => Response;
  json: (body: unknown) => void;
};

type EventAccessBody = {
  action?: string;
  eventId?: string;
  role?: string;
  expiresAt?: string;
  accessCode?: string;
  pin?: string;
};

class RequestError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "RequestError";
  }
}

const accessCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const operationalRoles = new Set(["office", "announcer", "event_supervisor"]);

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured on the server.`);
  return value;
}

function getSql() {
  return neon(getRequiredEnv("DATABASE_URL"));
}

function readHeader(request: Request, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function readClientIpAddress(request: Request): string {
  // Render forwards the client IP in X-Forwarded-For; retain Vercel's trusted
  // header too so local fallback deployments continue to use the same throttle.
  return readHeader(request, "x-vercel-forwarded-for").split(",")[0].trim() ||
    readHeader(request, "x-forwarded-for").split(",")[0].trim() ||
    readHeader(request, "x-real-ip").trim() ||
    "unknown";
}

function randomAccessCode(): string {
  return Array.from({ length: 16 }, () => accessCodeAlphabet[randomInt(accessCodeAlphabet.length)]).join("");
}

function randomPin(): string {
  return String(randomInt(100_000_000)).padStart(8, "0");
}

function deriveAuthPassword(accessCode: string, pin: string): string {
  const secret = getRequiredEnv("EVENT_ACCESS_PASSWORD_SECRET");
  if (secret.length < 32) throw new Error("EVENT_ACCESS_PASSWORD_SECRET must contain at least 32 characters.");
  return createHmac("sha256", secret).update(`${accessCode}:${pin}`).digest("base64");
}

function readBody(request: Request): EventAccessBody | null {
  if (request.body && typeof request.body === "object") return request.body as EventAccessBody;
  if (typeof request.body !== "string") return null;
  try {
    return JSON.parse(request.body) as EventAccessBody;
  } catch {
    return null;
  }
}

async function callDataApiRpc<T>(token: string, functionName: string): Promise<T> {
  const baseUrl = getRequiredEnv("NEON_DATA_API_URL").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rpc/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new RequestError("A sessão não foi autorizada a administrar acessos Connect.", 403);
  return data as T;
}

async function requireConnectOperator(request: Request): Promise<string> {
  const authorization = readHeader(request, "authorization");
  if (!authorization.startsWith("Bearer ")) throw new RequestError("Entre com uma conta administrativa Connect.", 401);
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new RequestError("Entre com uma conta administrativa Connect.", 401);

  const applicationUserId = await callDataApiRpc<unknown>(token, "sync_current_app_user");
  const context = await callDataApiRpc<unknown>(token, "get_my_platform_context");
  const row = Array.isArray(context) ? context[0] : context;
  if (!applicationUserId || typeof applicationUserId !== "string" ||
      !row || typeof row !== "object" ||
      !["platform_admin", "deployment"].includes(String((row as { role?: unknown }).role || ""))) {
    throw new RequestError("Acesso negado: somente a equipe Connect pode administrar acessos de evento.", 403);
  }
  return applicationUserId;
}

async function provision(body: EventAccessBody, request: Request): Promise<Record<string, unknown>> {
  const actorUserId = await requireConnectOperator(request);
  const eventId = body.eventId?.trim() || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId) ||
      !operationalRoles.has(body.role || "")) {
    throw new RequestError("Evento e função operacional válida são obrigatórios.", 400);
  }
  const expiry = Date.parse(body.expiresAt || "");
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new RequestError("A validade do acesso precisa ser uma data futura.", 400);
  }

  const accessCode = randomAccessCode();
  const pin = randomPin();
  const email = `event-role-${randomUUID()}@accounts.connectpdm.invalid`;
  const password = deriveAuthPassword(accessCode, pin);
  const sql = getSql();
  // Check database connectivity before creating an Auth identity so a missing
  // or unreachable DATABASE_URL cannot leave an orphaned synthetic account.
  await sql`select 1`;
  const eventRows = await sql`
    select e.ends_at::text as ends_at
      from public.events e
      join public.parks p on p.id = e.park_id
     where e.id = ${eventId}::uuid
       and e.operational_status = 'active'
       and p.access_status = 'active'
     limit 1
  `;
  const eventEnd = Date.parse(String((eventRows[0] as { ends_at?: unknown } | undefined)?.ends_at || ""));
  if (!Number.isFinite(eventEnd)) {
    throw new RequestError("O evento ou parque não está ativo para novos acessos.", 400);
  }
  if (expiry > eventEnd) {
    throw new RequestError("A validade do acesso não pode ultrapassar o encerramento do evento.", 400);
  }
  const authBaseUrl = getRequiredEnv("NEON_AUTH_BASE_URL").replace(/\/$/, "");
  const authResponse = await fetch(`${authBaseUrl}/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: `Connect evento ${body.role}` }),
  });
  const authPayload = await authResponse.json().catch(() => null) as unknown;
  if (!authResponse.ok) {
    console.error("Neon Auth rejected creation of an internal event identity.", authResponse.status);
    throw new RequestError("O Neon Auth não criou a identidade interna para o acesso operacional.", 502);
  }

  let authUserId: string | undefined;
  let applicationUserId: string | undefined;
  try {
    const authRows = await sql`
      select id::text as id
        from neon_auth."user"
       where lower(email) = lower(${email})
       limit 1
    `;
    authUserId = (authRows[0] as { id?: string } | undefined)?.id;
    if (!authUserId) {
      const payload = authPayload && typeof authPayload === "object" ? authPayload as Record<string, unknown> : {};
      console.error("Neon Auth did not persist the internal identity.", typeof payload.code === "string" ? payload.code : "unknown");
      throw new RequestError("O Neon Auth não criou a identidade interna para o acesso operacional.", 502);
    }

    await sql`
      update neon_auth."user"
         set "emailVerified" = true
       where id::text = ${authUserId}
    `;
    const identityRows = await sql`
      select public.link_neon_auth_identity(${authUserId})::text as app_user_id
    `;
    applicationUserId = (identityRows[0] as { app_user_id?: string } | undefined)?.app_user_id;
    if (!applicationUserId) throw new Error("Não foi possível associar a identidade Neon ao usuário da aplicação.");

    const provisionRows = await sql`
      select public.provision_event_role_access(
        ${actorUserId}::uuid,
        ${eventId}::uuid,
        ${body.role},
        ${applicationUserId}::uuid,
        ${accessCode},
        ${pin},
        ${new Date(expiry).toISOString()}::timestamptz
      )::text as credential_id
    `;
    const credentialId = (provisionRows[0] as { credential_id?: string } | undefined)?.credential_id;
    if (!credentialId) throw new Error("O banco não confirmou a criação do acesso operacional.");

    return {
      accessCode,
      pin,
      expiresAt: new Date(expiry).toISOString(),
      role: body.role,
      credentialId,
    };
  } catch (error) {
    if (authUserId) {
      try {
        await sql`delete from neon_auth."user" where id::text = ${authUserId}`;
      } catch (cleanupError) {
        const cleanupCode = cleanupError && typeof cleanupError === "object" && "code" in cleanupError && typeof cleanupError.code === "string"
          ? cleanupError.code : "unknown";
        console.error("Falha ao remover uma identidade Neon Auth não atribuída.", cleanupCode);
      }
    }
    throw error;
  }
}

async function signInWithEventRole(body: EventAccessBody, request: Request): Promise<Record<string, string>> {
  const accessCode = body.accessCode?.trim().toUpperCase() || "";
  const pin = body.pin?.trim() || "";
  if (!/^[A-HJ-NP-Z2-9]{16}$/.test(accessCode) || !/^\d{8}$/.test(pin)) {
    throw new RequestError("Código ou PIN inválido, expirado ou desativado.", 401);
  }

  const ipAddress = readClientIpAddress(request);
  const fingerprint = createHash("sha256").update(ipAddress).digest("hex");
  const sql = getSql();
  const verifiedRows = await sql`
    select public.verify_event_role_access(${accessCode}, ${pin}, ${fingerprint})::text as user_id
  `;
  const applicationUserId = (verifiedRows[0] as { user_id?: string | null } | undefined)?.user_id;
  if (!applicationUserId) throw new RequestError("Código ou PIN inválido, expirado ou desativado.", 401);

  const identityRows = await sql`
    select auth_user.email
      from public.neon_auth_identity_map as identity
      join neon_auth."user" as auth_user on auth_user.id::text = identity.neon_subject
     where identity.app_user_id = ${applicationUserId}::uuid
     limit 1
  `;
  const email = (identityRows[0] as { email?: string } | undefined)?.email;
  if (!email) throw new RequestError("A identidade Neon deste acesso não está disponível.", 503);
  return { email, password: deriveAuthPassword(accessCode, pin) };
}

export default async function handler(request: Request, response: Response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  if (request.method !== "POST") return response.status(405).json({ error: "Método não permitido." });
  const body = readBody(request);
  if (!body) return response.status(400).json({ error: "Envie os dados do acesso em formato JSON." });

  try {
    if (body.action === "provision") {
      return response.status(200).json(await provision(body, request));
    }
    if (body.action === "login") {
      return response.status(200).json(await signInWithEventRole(body, request));
    }
    return response.status(400).json({ error: "Ação de acesso operacional desconhecida." });
  } catch (error) {
    const statusCode = error instanceof RequestError ? error.statusCode : 500;
    const errorCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code : "unknown";
    console.error("Falha na solicitação Neon de acesso a evento.", { statusCode, errorCode });
    const message = error instanceof RequestError ? error.message : "Não foi possível concluir a solicitação de acesso operacional.";
    return response.status(statusCode).json({ error: message });
  }
}
