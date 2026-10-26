import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function randomAccessCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function randomPin(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const value = new DataView(bytes.buffer).getUint32(0) % 100_000_000;
  return String(value).padStart(8, "0");
}

async function hashToHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveAuthPassword(accessCode: string, pin: string): Promise<string> {
  const secret = Deno.env.get("EVENT_ACCESS_PASSWORD_SECRET");
  if (!secret || secret.length < 32) throw new Error("EVENT_ACCESS_PASSWORD_SECRET must contain at least 32 characters.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${accessCode}:${pin}`));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function getOperator(request: Request, anonKey: string, supabaseUrl: string) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Authenticated Connect PDM operator required.");
  const operator = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await operator.auth.getUser();
  if (userError || !userData.user) throw new Error("Authenticated Connect PDM operator required.");
  const { data: context, error: contextError } = await operator.rpc("get_my_platform_context");
  if (contextError) throw contextError;
  const role = Array.isArray(context) ? context[0]?.role : null;
  if (role !== "platform_admin" && role !== "deployment") throw new Error("Event access management denied.");
  return userData.user.id;
}

async function provision(
  request: Request,
  body: { eventId?: string; role?: string; expiresAt?: string },
  admin: SupabaseClient,
  anonKey: string,
  supabaseUrl: string,
) {
  const actorUserId = await getOperator(request, anonKey, supabaseUrl);
  if (!body.eventId || !["office", "announcer", "event_supervisor"].includes(body.role || "")) {
    return response(400, { error: "Event and supported operational role are required." });
  }
  const expiresAt = Date.parse(body.expiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return response(400, { error: "Access expiry must be a future date." });
  }

  const accessCode = randomAccessCode();
  const pin = randomPin();
  const identitySeed = crypto.randomUUID();
  const email = `event-role-${identitySeed}@accounts.connectpdm.invalid`;
  const password = await deriveAuthPassword(accessCode, pin);
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { account_kind: "shared_event_role" },
  });
  if (authError || !authData.user) {
    throw authError || new Error("Could not create the internal event role identity.");
  }

  const { data: credentialId, error: provisionError } = await admin.rpc("provision_event_role_access", {
    p_actor_user_id: actorUserId,
    p_event_id: body.eventId,
    p_role: body.role,
    p_user_id: authData.user.id,
    p_access_code: accessCode,
    p_pin: pin,
    p_expires_at: new Date(expiresAt).toISOString(),
  });
  if (provisionError) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id);
    if (deleteError) console.error("Failed to remove unassigned event auth identity:", deleteError.message);
    throw provisionError;
  }
  return response(200, { accessCode, pin, expiresAt: new Date(expiresAt).toISOString(), role: body.role, credentialId });
}

async function signInWithEventRole(
  request: Request,
  body: { accessCode?: string; pin?: string },
  admin: SupabaseClient,
  anonKey: string,
  supabaseUrl: string,
) {
  const accessCode = body.accessCode?.trim().toUpperCase() || "";
  const pin = body.pin?.trim() || "";
  if (!/^[A-HJ-NP-Z2-9]{16}$/.test(accessCode) || !/^\d{8}$/.test(pin)) {
    return response(401, { error: "Código ou PIN inválido, expirado ou desativado." });
  }
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const fingerprint = await hashToHex(ip);
  const { data: userId, error: verifyError } = await admin.rpc("verify_event_role_access", {
    p_access_code: accessCode,
    p_pin: pin,
    p_fingerprint: fingerprint,
  });
  if (verifyError) throw verifyError;
  if (typeof userId !== "string") return response(401, { error: "Código ou PIN inválido, expirado ou desativado." });

  const { data: userData, error: getUserError } = await admin.auth.admin.getUserById(userId);
  if (getUserError || !userData.user?.email) throw getUserError || new Error("Internal event role identity is unavailable.");
  const password = await deriveAuthPassword(accessCode, pin);
  const auth = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await auth.auth.signInWithPassword({ email: userData.user.email, password });
  if (error || !data.session) {
    console.error("Event role session creation failed:", error?.message || "session unavailable");
    return response(401, { error: "Código ou PIN inválido, expirado ou desativado." });
  }
  return response(200, {
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Method not allowed." });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Supabase function secrets are missing.");
    return response(500, { error: "Event access service is not configured." });
  }

  let body: { action?: string; eventId?: string; role?: string; expiresAt?: string; accessCode?: string; pin?: string };
  try {
    body = await request.json();
  } catch {
    return response(400, { error: "A JSON request body is required." });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    if (body.action === "login") return await signInWithEventRole(request, body, admin, anonKey, supabaseUrl);
    if (body.action === "provision") return await provision(request, body, admin, anonKey, supabaseUrl);
    return response(400, { error: "Unsupported event access action." });
  } catch (error) {
    console.error("Event access request failed:", error);
    return response(400, { error: error instanceof Error ? error.message : "Event access request failed." });
  }
});
