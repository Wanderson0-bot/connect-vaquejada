import { PostgrestClient } from "@supabase/postgrest-js";
import { createAuthClient } from "better-auth/client";
import { jwtClient } from "better-auth/client/plugins";

const backendUrl = import.meta.env.VITE_BACKEND_API_URL?.trim().replace(/\/+$/, "") || null;
const dataApiEnv = import.meta.env.VITE_NEON_DATA_API_URL?.trim().replace(/\/+$/, "") || null;
const dataApiUrl = dataApiEnv
  ? (dataApiEnv.endsWith("/rest/v1") ? dataApiEnv : `${dataApiEnv}/rest/v1`)
  : null;
const eventAccessApiUrl = backendUrl;
export const authProjectRef = "Connect Vaquejada";
export const backendConfigured = Boolean(backendUrl && dataApiUrl);
const authClient = backendUrl ? createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  fetchOptions: { credentials: "include" },
  plugins: [jwtClient()],
}) : null;
async function fetchWithConnectToken(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (authClient) {
    const { data } = await authClient.token();
    if (data?.token) headers.set("Authorization", `Bearer ${data.token}`);
  }
  return fetch(input, { ...init, headers });
}
export const neonClient = dataApiUrl
  ? new PostgrestClient<any>(dataApiUrl, { fetch: fetchWithConnectToken })
  : null;

export type AuthSession = {
  access_token: string;
  user: { id: string; email?: string };
};
const syncedNeonUsers = new Set<string>();
export type ParkProfile = {
  id: string; owner_user_id: string | null; name: string; manager_name: string;
  phone: string; city: string; state: string; address: string;
  access_role: "park_manager" | "office" | "announcer" | "judge" | "track_operator" | "event_supervisor";
  access_user_id: string;
  event_access?: Array<{ event_id: string; park_id: string; role: "office" | "announcer" | "judge" | "track_operator" | "event_supervisor"; expires_at: string }>;
};
export type PlatformContext = { role: "platform_admin" | "deployment" | "support" };
export type ConnectPark = Pick<ParkProfile, "id" | "name" | "manager_name" | "phone" | "city" | "state" | "address"> & { connect_code?: string; access_status: "active" | "suspended" | "closed" };
export type ConnectParkLifecycleStatus = "provisioned" | "pending_configuration" | "suspended" | "archived";
export type ConnectParkListItem = ConnectPark & {
  lifecycle_status: ConnectParkLifecycleStatus;
  created_at: string;
  updated_at: string;
  total_count: number;
};
export type ConnectParkProfile = {
  park: ConnectPark & {
    owner_user_id: string | null;
    owner_email: string | null;
    lifecycle_status: ConnectParkLifecycleStatus;
    created_at: string;
    updated_at: string;
  };
  created_by_user_id: string | null;
  created_by_email: string | null;
  created_by_at: string | null;
  members: Array<{ user_id: string; email: string | null; role: string; created_at: string; disabled_at: string | null; source: "park_membership" }>;
  event_staff: Array<{ event_id: string; event_name: string; user_id: string; email: string | null; role: string; created_at: string; expires_at: string; revoked_at: string | null }>;
  events: Array<{ id: string; name: string; starts_at: string; ends_at: string; operational_status: "active" | "closed" }>;
  event_count: number;
  completed_event_count: number;
};
export type ConnectEvent = { id: string; name: string; starts_at: string; ends_at: string; operational_status: "active" | "closed" };
export type ConnectPublication = {
  event_id: string; park_id: string; event_name: string; location: string; starts_at: string; ends_at: string;
  categories: string[]; prizes: unknown[]; park_name: string; city: string; state: string;
  status: "draft" | "park_confirmed" | "changes_requested" | "approved" | "published" | "withdrawn"; public_description: string; published_at: string | null;
};
export type PublicEvent = {
  event_id: string; event_name: string; location: string; starts_at: string; ends_at: string;
  categories: string[]; prizes: unknown[]; public_description: string; park_name: string; city: string; state: string; published_at: string;
};
export type ParkEventPublicationStatus = { event_id: string; status: "draft" | "park_confirmed" | "changes_requested" | "approved" | "published" | "withdrawn"; public_description: string; public_prizes: string[] };
export type EventStaff = { user_id: string; role: "office" | "announcer" | "judge" | "track_operator"; expires_at: string; revoked_at: string | null };
export type EventRoleAccess = { role: "office" | "announcer" | "event_supervisor"; created_at: string; expires_at: string; revoked_at: string | null };
export type LegacyStaffReconciliationItem = {
  item_id: string; park_id: string; source_kind: "park_membership" | "park_invitation";
  source_user_id: string | null; source_invitation_id: string | null;
  source_role: "office" | "announcer" | "judge" | "track_operator";
  source_created_by: string | null; source_created_at: string; source_was_active: boolean;
  source_membership_disabled_at: string | null; candidate_event_id: string | null;
  candidate_event_status: "active" | "closed" | null; candidate_event_ends_at: string | null;
  classification: "proven" | "ambiguous" | "no_destination"; evidence_reference: string | null;
  decision: "pending" | "approved" | "rejected" | "activated"; decision_reason: string | null;
  reviewed_by: string | null; reviewed_at: string | null; activated_at: string | null;
};
export type LegacyStaffReconciliationAudit = {
  item_id: string | null; park_id: string; event_id: string | null; actor_user_id: string | null;
  action: "prepared" | "reviewed" | "activated"; reason: string | null;
  before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; occurred_at: string;
};
export type ConnectPlatformAudit = { id: number; actor_user_id: string | null; actor_email?: string | null; event_id: string | null; action: string; reason: string | null; details: Record<string, unknown>; occurred_at: string };
export type ConnectAdminDashboard = {
  park_count: number;
  event_count: number;
  publication_count: number | null;
  checked_at: string;
  recent_parks: Array<Pick<ConnectPark, "id" | "name" | "city" | "state" | "access_status"> & { created_at: string }>;
};

function isMissingRpc(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}
function throwMissingMigration(error: { code?: string } | null, functionName: string, migrationFile: string): void {
  if (isMissingRpc(error)) {
    throw new Error(`A função ${functionName} ainda não existe no Neon. Aplique a migration ${migrationFile} e tente novamente.`);
  }
}
export function clearOfflineParkCache(): void {
  // Remove stale cache entries written by previous app versions. Cached membership
  // is never sufficient to authorize a protected view.
  try { localStorage.removeItem("connect-pdm-offline-park"); } catch { /* Ignore unavailable storage. */ }
}

export async function currentSession(): Promise<AuthSession | null> {
  if (!authClient) return null;
  const { data, error } = await authClient.getSession();
  if (error) throw error;
  const active = data?.user;
  if (!active) return null;
  const { data: tokenData, error: tokenError } = await authClient.token();
  if (tokenError) throw tokenError;
  if (!tokenData?.token) return null;
  if (!neonClient) throw new Error("Neon Data API is not configured.");
  if (!syncedNeonUsers.has(active.id)) {
    const { error: syncError } = await neonClient.rpc("sync_current_app_user");
    if (syncError) throw syncError;
    syncedNeonUsers.add(active.id);
  }
  return { access_token: tokenData.token, user: { id: active.id, email: active.email } };
}
export async function requirePlatformRole(required: PlatformContext["role"][]): Promise<PlatformContext> {
  const session = await currentSession();
  if (!session) throw new Error("Authentication session is missing.");
  const context = await getPlatformContext();
  if (!context || !required.includes(context.role)) throw new Error("This profile is not authorized.");
  return context;
}
export async function signIn(email: string, password: string): Promise<AuthSession> {
  if (!authClient) throw new Error("Authentication is not configured.");
  const { error } = await authClient.signIn.email({ email, password });
  if (error) throw error;
  const session = await currentSession();
  if (!session) throw new Error("Authentication did not return an active session.");
  window.dispatchEvent(new Event("connect-auth-statechange"));
  return session;
}
export async function signInEventRole(accessCode: string, pin: string): Promise<AuthSession> {
  if (!authClient) throw new Error("Authentication is not configured.");
  const credentials = await requestEventAccess("login", {
    accessCode: accessCode.trim().toUpperCase(),
    pin: pin.trim(),
  }) as { email?: string; password?: string };
  if (!credentials.email || !credentials.password) throw new Error("Operational access service returned invalid credentials.");
  return signIn(credentials.email, credentials.password);
}
async function requestEventAccess(action: "login" | "provision", payload: Record<string, unknown>) {
  const session = await currentSession();
  if (!eventAccessApiUrl) throw new Error("Set VITE_BACKEND_API_URL to the public Render backend URL.");
  const response = await fetch(`${eventAccessApiUrl}/api/event-access`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Could not validate operational access.");
  return data as Record<string, unknown>;
}
export async function signUp(email: string, password: string) {
  if (!authClient || !backendUrl) throw new Error("Authentication is not configured.");
  const invitationToken = localStorage.getItem("connect-pdm-pending-invitation") ||
    localStorage.getItem("connect-pdm-pending-event-invitation") || "";
  const response = await fetch(`${window.location.origin}/api/register`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, invitationToken, callbackURL: `${window.location.origin}${window.location.pathname}` }),
  });
  const body = await response.json().catch(() => null) as { error?: string; needsEmailConfirmation?: boolean } | null;
  if (!response.ok) throw new Error(body?.error || "Could not complete registration.");
  const { data, error } = await authClient.getSession();
  if (error) throw error;
  return { session: await currentSession(), needsEmailConfirmation: body?.needsEmailConfirmation ?? !data?.user, existingAccount: false };
}
export async function resendSignupConfirmation(email: string) {
  if (!authClient) throw new Error("Authentication is not configured.");
  const { error } = await authClient.sendVerificationEmail({ email, callbackURL: `${window.location.origin}${window.location.pathname}` });
  if (error) throw error;
}
export async function signOut() {
  if (!authClient) return;
  const { error } = await authClient.signOut();
  if (error) throw error;
  syncedNeonUsers.clear();
  window.dispatchEvent(new Event("connect-auth-statechange"));
}
export async function requestPasswordReset(email: string) {
  if (!authClient) throw new Error("Authentication is not configured.");
  const { error } = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}${window.location.pathname}` });
  if (error) throw new Error(error.message || "Could not send password reset instructions.");
}
export async function updatePassword(password: string, token: string) {
  if (!authClient) throw new Error("Authentication is not configured.");
  if (!token) throw new Error("The reset link has no valid token. Request another email.");
  const { error } = await authClient.resetPassword({ newPassword: password, token });
  if (error) throw new Error(error.message || "Could not reset the password.");
}
export async function getParkProfile(): Promise<ParkProfile | null> {
  if (!neonClient) return null;
  const session = await currentSession();
  if (!session) return null;
  if (!navigator.onLine) throw new Error("As permissões reais não podem ser revalidadas offline. Reconecte-se antes de abrir a área protegida.");
  const [{ data: parkRows, error: parkError }, { data: accessRows, error: accessError }] = await Promise.all([
    neonClient.rpc("get_my_park_context"), neonClient.rpc("get_my_event_contexts"),
  ]);
  if (parkError) throw parkError;
  if (accessError && !isMissingRpc(accessError)) throw accessError;
  const row = Array.isArray(parkRows) ? parkRows[0] : null;
  const eventAccess = Array.isArray(accessRows) ? accessRows as ParkProfile["event_access"] : [];
  const eventContext = eventAccess?.[0];
  if (!row && !eventContext) { clearOfflineParkCache(); return null; }
  const profile = row
    ? { ...row, access_user_id: session.user.id, event_access: eventAccess } as ParkProfile
    : { id: eventContext!.park_id, owner_user_id: "", name: "", manager_name: "", phone: "", city: "", state: "", address: "", access_role: eventContext!.role, access_user_id: session.user.id, event_access: eventAccess } as ParkProfile;
  if (!row && eventContext) {
    profile.name = (accessRows as Array<{ park_name?: string }>)[0]?.park_name || "Parque do evento";
    profile.city = (accessRows as Array<{ city?: string }>)[0]?.city || "";
    profile.state = (accessRows as Array<{ state?: string }>)[0]?.state || "";
  }
  return profile;
}
export async function getPlatformContext(): Promise<PlatformContext | null> {
  if (!neonClient) return null;
  const session = await currentSession();
  if (!session) return null;
  const { data, error } = await neonClient.rpc("get_my_platform_context");
  if (error && isMissingRpc(error)) return null;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row?.role ? { role: row.role as PlatformContext["role"] } : null;
}

export async function listConnectParks(filters: {
  search: string;
  state: string;
  city: string;
  lifecycleStatus: ConnectParkLifecycleStatus | "";
  limit: number;
  offset: number;
}): Promise<ConnectParkListItem[]> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment", "support"]);
  const { data, error } = await neonClient.rpc("list_connect_parks", {
    p_search: filters.search.trim() || null,
    p_state: filters.state || null,
    p_city: filters.city.trim() || null,
    p_lifecycle_status: filters.lifecycleStatus || null,
    p_limit: filters.limit,
    p_offset: filters.offset,
  });
  if (error) {
    throwMissingMigration(error, "list_connect_parks", "202610240020_park_name_identity.sql");
    throw error;
  }
  return (data || []) as ConnectParkListItem[];
}
export async function getConnectParkProfile(parkId: string): Promise<ConnectParkProfile> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment", "support"]);
  const { data, error } = await neonClient.rpc("get_connect_park_profile", { p_park_id: parkId });
  if (error) {
    throwMissingMigration(error, "get_connect_park_profile", "202610240020_park_name_identity.sql");
    throw error;
  }
  if (!data || typeof data !== "object" || !("park" in data) || !Array.isArray(data.members) || !Array.isArray(data.event_staff) || !Array.isArray(data.events)) {
    throw new Error("O servidor não retornou um perfil de parque válido.");
  }
  const { data: code, error: codeError } = await neonClient.rpc("get_connect_park_code", { p_park_id: parkId });
  if (codeError) {
    throwMissingMigration(codeError, "get_connect_park_code", "202610250022_connect_park_code.sql");
    throw codeError;
  }
  const profile = data as ConnectParkProfile;
  profile.park.connect_code = String(code);
  return profile;
}

export async function getConnectPublicationQueue(): Promise<ConnectPublication[]> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin"]);
  const { data, error } = await neonClient.rpc("get_connect_publication_queue");
  if (error) throw error;
  return (data || []) as ConnectPublication[];
}

export async function setConnectEventPublication(eventId: string, status: "approved" | "published" | "withdrawn" | "changes_requested", publicDescription: string, reason?: string): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin"]);
  const { error } = await neonClient.rpc("set_connect_event_publication", {
    p_event_id: eventId, p_status: status, p_public_description: publicDescription, p_reason: reason || null,
  });
  if (error) throw error;
}

export async function confirmParkEventPublication(eventId: string, publicDescription: string, publicPrizes: string[]): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { error } = await neonClient.rpc("confirm_park_event_publication", {
    p_event_id: eventId, p_public_description: publicDescription.trim(), p_public_prizes: publicPrizes,
  });
  if (error) throw error;
}

export async function getMyEventPublicationStatuses(): Promise<ParkEventPublicationStatus[]> {
  if (!neonClient) return [];
  const { data, error } = await neonClient.rpc("get_my_event_publication_statuses");
  if (error) throw error;
  return (data || []) as ParkEventPublicationStatus[];
}

export async function getPublicEvents(): Promise<PublicEvent[]> {
  if (!neonClient) throw new Error("A consulta pública ainda não está disponível.");
  const { data, error } = await neonClient.rpc("list_public_events");
  if (error) throw error;
  return (data || []) as PublicEvent[];
}
export async function listConnectPlatformAudit(parkId: string): Promise<ConnectPlatformAudit[]> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment", "support"]);
  const { data, error } = await neonClient.rpc("list_connect_platform_audit", { p_park_id: parkId, p_limit: 100 });
  if (error) throw error;
  return (data || []) as ConnectPlatformAudit[];
}
export async function getConnectAdminDashboard(): Promise<ConnectAdminDashboard> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment", "support"]);
  const { data, error } = await neonClient.rpc("get_connect_admin_dashboard");
  if (error) {
    throwMissingMigration(error, "get_connect_admin_dashboard", "202610240020_park_name_identity.sql");
    throw error;
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.recent_parks)) {
    throw new Error("O painel não recebeu um resumo válido do servidor.");
  }
  return data as ConnectAdminDashboard;
}
export async function provisionConnectPark(input: Omit<ConnectPark, "id" | "access_status"> & { existingParkId?: string | null }) {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment"]);
  const { data, error } = await neonClient.rpc("provision_connect_park_by_name", {
    p_name: input.name, p_manager_name: input.manager_name,
    p_phone: input.phone, p_city: input.city, p_state: input.state, p_address: input.address,
    p_existing_park_id: input.existingParkId || null,
  });
  if (error) {
    throwMissingMigration(error, "provision_connect_park_by_name", "202610240020_park_name_identity.sql");
    throw error;
  }
  return (Array.isArray(data) ? data[0] : data) as { park_id: string; park_name: string; created: boolean };
}
export async function updateConnectPark(park: ConnectPark): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment"]);
  const { error } = await neonClient.rpc("update_connect_park", {
    p_park_id: park.id, p_name: park.name, p_manager_name: park.manager_name, p_phone: park.phone,
    p_city: park.city, p_state: park.state, p_address: park.address,
  });
  if (error) throw error;
}
export async function setConnectParkStatus(parkId: string, status: ConnectPark["access_status"], reason: string): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment"]);
  const { error } = await neonClient.rpc("set_connect_park_status", { p_park_id: parkId, p_status: status, p_reason: reason });
  if (error) throw error;
}
export async function createConnectParkManagerInvitation(parkId: string, email: string) {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment"]);
  const { data, error } = await neonClient.rpc("create_connect_park_manager_invitation", { p_park_id: parkId, p_email: email.trim().toLowerCase() });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { invitation_id: string; invitation_token: string; expires_at: string };
}
export async function createConnectParkEvent(input: { parkId: string; idempotencyId: string; name: string; location: string; startsAt: string; endsAt: string; categories: string[]; ticketQuantity: number | null; ticketPrice: number | null }): Promise<string> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment"]);
  const { data, error } = await neonClient.rpc("create_connect_park_event", {
    p_park_id: input.parkId, p_id: input.idempotencyId, p_name: input.name, p_location: input.location,
    p_starts_at: input.startsAt, p_ends_at: input.endsAt, p_categories: input.categories,
    p_ticket_quantity: input.ticketQuantity, p_ticket_price: input.ticketPrice,
  });
  if (error) throw error;
  return data as string;
}
export async function listConnectParkEvents(parkId: string): Promise<ConnectEvent[]> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { data, error } = await neonClient.rpc("list_connect_park_events", { p_park_id: parkId });
  if (error) throw error;
  return (data || []) as ConnectEvent[];
}
export async function setConnectEventStatus(eventId: string, status: ConnectEvent["operational_status"], reason: string): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment"]);
  const { error } = await neonClient.rpc("set_connect_event_status", { p_event_id: eventId, p_status: status, p_reason: reason });
  if (error) throw error;
}
export async function createEventStaffInvitation(eventId: string, email: string, role: "office" | "announcer" | "judge" | "track_operator", expiresAt: string) {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { data, error } = await neonClient.rpc("create_event_staff_invitation", { p_event_id: eventId, p_email: email.trim().toLowerCase(), p_role: role, p_expires_at: expiresAt });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { invitation_id: string; invitation_token: string; expires_at: string };
}
export async function createEventRoleAccess(eventId: string, role: EventRoleAccess["role"], expiresAt: string) {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment"]);
  const data = await requestEventAccess("provision", { eventId, role, expiresAt });
  if (!data?.accessCode || !data?.pin || !data?.expiresAt) {
    throw new Error("O serviço não retornou as credenciais operacionais.");
  }
  return data as { accessCode: string; pin: string; expiresAt: string; role: EventRoleAccess["role"]; credentialId: string };
}
export async function listEventRoleAccess(eventId: string): Promise<EventRoleAccess[]> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment"]);
  const { data, error } = await neonClient.rpc("list_event_role_access", { p_event_id: eventId });
  if (error) throw error;
  return (data || []) as EventRoleAccess[];
}
export async function revokeEventRoleAccess(eventId: string, role: EventRoleAccess["role"]): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin", "deployment"]);
  const { error } = await neonClient.rpc("revoke_event_role_access", { p_event_id: eventId, p_role: role });
  if (error) throw error;
}
export async function acceptEventStaffInvitation(token: string): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { error } = await neonClient.rpc("accept_event_staff_invitation", { p_invitation_token: token });
  if (error) throw error;
}
export async function listEventStaff(eventId: string): Promise<EventStaff[]> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { data, error } = await neonClient.rpc("list_event_staff", { p_event_id: eventId });
  if (error) throw error;
  return (data || []) as EventStaff[];
}
export async function prepareLegacyStaffReconciliation(batchId: string, parkId: string): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { error } = await neonClient.rpc("prepare_legacy_staff_reconciliation", { p_batch_id: batchId, p_park_id: parkId });
  if (error) throw error;
}
export async function getLegacyStaffReconciliation(batchId: string): Promise<LegacyStaffReconciliationItem[]> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { data, error } = await neonClient.rpc("get_legacy_staff_reconciliation", { p_batch_id: batchId });
  if (error) throw error;
  return (data || []) as LegacyStaffReconciliationItem[];
}
export async function getLegacyStaffReconciliationAudit(batchId: string): Promise<LegacyStaffReconciliationAudit[]> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { data, error } = await neonClient.rpc("get_legacy_staff_reconciliation_audit", { p_batch_id: batchId });
  if (error) throw error;
  return (data || []) as LegacyStaffReconciliationAudit[];
}
export async function reviewLegacyStaffMapping(itemId: string, classification: "proven" | "ambiguous" | "no_destination", evidenceReference: string | null, reason: string): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { error } = await neonClient.rpc("review_legacy_staff_mapping", {
    p_item_id: itemId, p_classification: classification, p_evidence_reference: evidenceReference, p_reason: reason,
  });
  if (error) throw error;
}
export async function activateLegacyStaffMapping(itemId: string): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { error } = await neonClient.rpc("activate_legacy_staff_mapping", { p_item_id: itemId });
  if (error) throw error;
}
export async function revokeEventStaff(eventId: string, userId: string): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { error } = await neonClient.rpc("revoke_event_staff", { p_event_id: eventId, p_user_id: userId });
  if (error) throw error;
}
export async function manageConnectPlatformStaff(email: string, role: "deployment" | "support"): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin"]);
  const { error } = await neonClient.rpc("manage_connect_platform_staff", { p_email: email.trim().toLowerCase(), p_role: role });
  if (error) throw error;
}
export async function revokeConnectPlatformStaff(email: string): Promise<void> {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  await requirePlatformRole(["platform_admin"]);
  const { error } = await neonClient.rpc("revoke_connect_platform_staff", { p_email: email.trim().toLowerCase() });
  if (error) throw error;
}
export async function currentParkOwnerId(): Promise<string> {
  const session = await currentSession();
  if (session?.user.id) return session.user.id;
  throw new Error("Entre novamente com a conta do parque para sincronizar os dados.");
}
export async function updateParkProfile(park: ParkProfile) {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { error } = await neonClient.from("parks").update({
    name: park.name, manager_name: park.manager_name, phone: park.phone,
    city: park.city, state: park.state, address: park.address,
    updated_at: new Date().toISOString(),
  }).eq("id", park.id);
  if (error) throw error;
}

export async function createParkInvitation(email: string, role: ParkProfile["access_role"]) {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { data, error } = await neonClient.rpc("create_park_invitation", { p_email: email.trim().toLowerCase(), p_role: role });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { invitation_id: string; invitation_token: string; expires_at: string };
}
export async function acceptParkInvitation(token: string) {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { error } = await neonClient.rpc("accept_park_invitation", { p_invitation_token: token });
  if (error) throw error;
}
export async function listParkMembers() {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { data, error } = await neonClient.from("park_memberships").select("park_id,user_id,role,created_at,disabled_at").order("created_at");
  if (error) throw error;
  return data || [];
}
export async function deactivateParkMember(userId: string) {
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  const { error } = await neonClient.rpc("deactivate_park_member", { p_user_id: userId });
  if (error) throw error;
}
