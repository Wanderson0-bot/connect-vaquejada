import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required by the authentication service.`);
  return value;
}

const appUrl = required("BETTER_AUTH_URL").replace(/\/$/, "");
const databaseUrl = required("DATABASE_URL");
const secret = required("BETTER_AUTH_SECRET");
if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
const databaseHost = new URL(databaseUrl).hostname;
if (databaseHost.includes("-pooler.")) throw new Error("Better Auth requires the direct Neon DATABASE_URL without -pooler.");
const allowedOrigins = (process.env.BACKEND_ALLOWED_ORIGINS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
  options: "-c search_path=connect_auth,public",
  max: 5,
});

async function sendAuthEmail(to: string, subject: string, text: string, html: string) {
  const key = required("RESEND_API_KEY");
  const from = required("AUTH_EMAIL_FROM");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!response.ok) throw new Error(`Email provider rejected a transactional message (${response.status}).`);
}

export const auth = betterAuth({
  appName: "Connect Vaquejada",
  baseURL: appUrl,
  basePath: "/api/auth",
  trustedOrigins: [...new Set([...allowedOrigins, appUrl])],
  database: pool,
  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: appUrl.startsWith("https://"),
    defaultCookieAttributes: {
      httpOnly: true,
      secure: appUrl.startsWith("https://"),
      sameSite: appUrl.startsWith("https://") ? "none" : "lax",
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail(user.email, "Redefinição de senha — Connect Vaquejada",
        `Use este link para redefinir sua senha: ${url}`,
        `<p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${url}">Redefinir senha</a></p><p>Se você não fez essa solicitação, ignore esta mensagem.</p>`);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Event access identities use synthetic, non-deliverable addresses and
      // are marked verified by the trusted provisioning route.
      if (user.email.endsWith("@accounts.connectpdm.invalid")) return;
      await sendAuthEmail(user.email, "Confirme seu email — Connect Vaquejada",
        `Confirme seu email usando este link: ${url}`,
        `<p>Confirme seu email para ativar seu acesso ao Connect Vaquejada.</p><p><a href="${url}">Confirmar email</a></p>`);
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 300, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const existing = await pool.query<{ id: string }>(
            "select id::text as id from public.app_users where lower(email)=lower($1) limit 1",
            [user.email.trim()],
          );
          return existing.rows[0] ? { data: { ...user, id: existing.rows[0].id } } : undefined;
        },
        after: async (user) => {
          const client = await pool.connect();
          try {
            await client.query("begin");
            await client.query(
              `insert into public.app_users(id,email,email_confirmed_at)
               values($1::uuid,lower($2),case when $3 then now() else null end)
               on conflict(id) do update set email=excluded.email,
                 email_confirmed_at=coalesce(excluded.email_confirmed_at,public.app_users.email_confirmed_at)`,
              [user.id, user.email, user.emailVerified],
            );
            await client.query(
              `insert into public.neon_auth_identity_map(neon_subject,app_user_id,email)
               values($1,$1::uuid,lower($2))
               on conflict(neon_subject) do update set email=excluded.email,synced_at=now()`,
              [user.id, user.email],
            );
            await client.query("commit");
          } catch (error) {
            await client.query("rollback");
            throw error;
          } finally {
            client.release();
          }
        },
      },
      update: {
        after: async (user) => {
          await pool.query(
            `update public.app_users set email=lower($2),
               email_confirmed_at=case when $3 then coalesce(email_confirmed_at,now()) else null end
             where id=$1::uuid`,
            [user.id, user.email, user.emailVerified],
          );
          await pool.query(
            "update public.neon_auth_identity_map set email=lower($2),synced_at=now() where neon_subject=$1",
            [user.id, user.email],
          );
        },
      },
    },
  },
  plugins: [jwt({
    jwt: {
      issuer: appUrl,
      audience: appUrl,
      expirationTime: "15m",
      definePayload: ({ user }) => ({
        email: user.email,
        email_verified: user.emailVerified,
        role: "authenticated",
      }),
    },
  })],
});

export { pool };
