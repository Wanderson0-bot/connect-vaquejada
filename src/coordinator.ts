export type CoordinatorSettings = { url: string; token: string };
export type CoordinatorHealth = { status: "ok" };
export type CoordinatorOperator = { userId: string; role: "park_manager" | "office" | "announcer" | "judge" | "track_operator" };
export type CoordinatorConflict = {
  id: string; operationId: string; entityType: CoordinatorRecord["entityType"]; entityId: string; deviceId: string;
  expectedVersion: number; currentVersion: number; attempted: Record<string, unknown>; current: Record<string, unknown> | null; createdAt: string;
};
export type CoordinatorRecord = { entityType: "events" | "entries" | "run_results" | "reservations" | "track_states"; entityId: string; version: number; updatedAt: string; payload: Record<string, unknown> };
export type CoordinatorSnapshot = { parkId: string; sequence: number; records: CoordinatorRecord[] };
export type CoordinatorOperation = {
  operationId: string; deviceId: string; entityType: CoordinatorRecord["entityType"]; entityId: string;
  action: "create" | "update" | "confirm" | "convert" | "correct"; baseVersion: number; payload: Record<string, unknown>;
};
const SETTINGS_KEY = "connect-pdm-coordinator";
const DEVICE_KEY = "connect-pdm-device-id";

export function getCoordinatorSettings(): CoordinatorSettings | null {
  try {
    const value = localStorage.getItem(SETTINGS_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<CoordinatorSettings>;
    if (typeof parsed.url !== "string" || typeof parsed.token !== "string") return null;
    return { url: parsed.url.replace(/\/$/, ""), token: parsed.token };
  } catch { return null; }
}
export function saveCoordinatorSettings(settings: CoordinatorSettings): void {
  const url = settings.url.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error("Informe o endereço completo do coordenador, incluindo http:// ou https://.");
  if (settings.token.trim().length < 32) throw new Error("O token individual precisa ter ao menos 32 caracteres.");
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ url, token: settings.token.trim() }));
}
export function clearCoordinatorSettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}
export function getCoordinatorDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
  return id;
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const settings = getCoordinatorSettings();
  if (!settings) throw new Error("Configure o endereço e o token do coordenador local.");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${settings.url}${path}`, {
      ...init, signal: controller.signal,
      headers: { authorization: `Bearer ${settings.token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body.error || `O coordenador respondeu com erro HTTP ${response.status}.`);
    return body;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("O coordenador local não respondeu em 8 segundos.");
    throw error;
  } finally { window.clearTimeout(timer); }
}
export async function checkCoordinator(): Promise<CoordinatorHealth> {
  const settings = getCoordinatorSettings();
  if (!settings) throw new Error("Configure o coordenador local antes de testar a conexão.");
  const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${settings.url}/api/health`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`O coordenador respondeu com erro HTTP ${response.status}.`);
    return await response.json() as CoordinatorHealth;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("O coordenador local não respondeu em 8 segundos.");
    throw error;
  } finally { window.clearTimeout(timer); }
}
export function getCoordinatorSnapshot(): Promise<CoordinatorSnapshot> { return request("/api/snapshot"); }
export function getCoordinatorOperator(): Promise<CoordinatorOperator> { return request("/api/operator"); }
export async function getCoordinatorConflicts(): Promise<CoordinatorConflict[]> {
  const result = await request<{ conflicts: CoordinatorConflict[] }>("/api/conflicts");
  return result.conflicts;
}
export function subscribeCoordinatorChanges(onChange: () => void): () => void {
  const settings = getCoordinatorSettings();
  if (!settings) return () => undefined;
  let closed = false;
  let controller: AbortController | undefined;
  let retryTimer = 0;
  let retryDelay = 1000;

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    try {
      const response = await fetch(`${settings.url}/api/stream`, {
        headers: { authorization: `Bearer ${settings.token}`, accept: "text/event-stream" },
        cache: "no-store", signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `O fluxo do coordenador respondeu com HTTP ${response.status}.`);
      }
      retryDelay = 1000;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (/^event: (?:ready|change)$/m.test(frame)) onChange();
          boundary = buffer.indexOf("\n\n");
        }
      }
      await reader.cancel().catch(() => undefined);
    } catch {
      // The periodic snapshot refresh remains the fallback while the stream reconnects.
    } finally {
      if (!closed) {
        retryTimer = window.setTimeout(() => void connect(), retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
      }
    }
  };
  void connect();
  return () => {
    closed = true;
    controller?.abort();
    window.clearTimeout(retryTimer);
  };
}
export function sendCoordinatorOperation(operation: CoordinatorOperation): Promise<{ results: Array<{ operationId: string; outcome: "accepted" | "duplicate" | "conflict" | "rejected"; sequence?: number; version?: number; error?: string }> }> {
  return request("/api/operations", { method: "POST", body: JSON.stringify(operation) });
}
export function adoptCoordinatorOperation(operation: CoordinatorOperation): Promise<{ result: { operationId: string; outcome: "accepted" | "duplicate" | "conflict" | "rejected"; sequence?: number; version?: number; currentVersion?: number; error?: string } }> {
  return request("/api/operations/adopt", { method: "POST", body: JSON.stringify({ operation }) });
}
