import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool, PoolClient } from "pg";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const inviteLifetimeSeconds = 24 * 60 * 60;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.end(JSON.stringify(body));
}

function equalSecret(candidate: string, expected: string): boolean {
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash) && candidate.length === expected.length;
}

export function bootstrapTokenHash(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export async function handleBootstrapAdmin(request: IncomingMessage, response: ServerResponse, pool: Pool): Promise<void> {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Método não permitido." });
  const secret = process.env.ADMIN_BOOTSTRAP_SECRET?.trim() || "";
  if (!secret || secret.length < 32) return sendJson(response, 404, { error: "Rota não encontrada." });
  const header = request.headers["x-admin-bootstrap-secret"];
  const candidate = Array.isArray(header) ? header[0] || "" : header || "";
  if (!equalSecret(candidate, secret)) return sendJson(response, 404, { error: "Rota não encontrada." });

  let body: { email?: unknown };
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 4096) return sendJson(response, 413, { error: "A solicitação excede o tamanho permitido." });
      chunks.push(buffer);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return sendJson(response, 400, { error: "Envie os dados em JSON válido." });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!emailPattern.test(email) || email.length > 254) return sendJson(response, 400, { error: "Informe um email válido." });

  const token = randomBytes(32).toString("hex");
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('connect:first-admin-bootstrap'))");
    await client.query("update public.admin_bootstrap_invitations set consumed_at=now() where consumed_at is null and expires_at<=now()");
    const state = await client.query<{ admin_exists: boolean; account_exists: boolean; invitation_exists: boolean }>(
      `select exists(select 1 from public.platform_admins) as admin_exists,
              exists(select 1 from public.app_users where lower(email)=lower($1)) as account_exists,
              exists(select 1 from public.admin_bootstrap_invitations where consumed_at is null and expires_at>now()) as invitation_exists`, [email],
    );
    if (state.rows[0]?.admin_exists) {
      await client.query("rollback");
      return sendJson(response, 409, { error: "O administrador inicial já foi configurado." });
    }
    if (state.rows[0]?.account_exists) {
      await client.query("rollback");
      return sendJson(response, 409, { error: "Já existe uma conta com este email." });
    }
    if (state.rows[0]?.invitation_exists) {
      await client.query("rollback");
      return sendJson(response, 409, { error: "Já existe um convite inicial ativo." });
    }
    const inserted = await client.query<{ expires_at: Date }>(
      `insert into public.admin_bootstrap_invitations(email,token_hash,expires_at)
       values($1,$2,now()+($3 * interval '1 second')) returning expires_at`,
      [email, bootstrapTokenHash(token), inviteLifetimeSeconds],
    );
    await client.query("commit");
    sendJson(response, 201, { email, expiresAt: inserted.rows[0].expires_at });
  } catch (error) {
    await client?.query("rollback").catch(() => undefined);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    console.error("Connect admin bootstrap failed.", { code });
    if (!response.headersSent) sendJson(response, 500, { error: "Não foi possível criar o convite inicial." });
  } finally {
    client?.release();
  }
}

export async function grantBootstrapAdminAfterVerification(user: { id: string; email: string; emailVerified: boolean }, pool: Pool): Promise<void> {
  if (!user.emailVerified) return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('connect:first-admin-bootstrap'))");
    const invitation = await client.query<{ id: string }>(
      `select id from public.admin_bootstrap_invitations
        where lower(email)=lower($1) and registration_started_at is not null and consumed_at is null for update`, [user.email],
    );
    if (invitation.rows[0]) {
      const admins = await client.query("select 1 from public.platform_admins limit 1");
      if (admins.rowCount === 0) {
        await client.query("insert into public.platform_admins(user_id,created_by) values($1::uuid,null) on conflict(user_id) do nothing", [user.id]);
        await client.query("update public.admin_bootstrap_invitations set consumed_at=now(),consumed_by=$1::uuid where id=$2", [user.id, invitation.rows[0].id]);
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
