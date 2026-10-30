import { backendConfigured, currentSession, neonClient } from "./backend";
import { currentParkOwnerId } from "./backend";
import { AVAILABLE_CATEGORIES, AuditRecord, CallRecord, Category, CompetitionConfig, Entry, EntryTransferChanges, EventConfig, OfflineOperationKind, RunResult, TicketReservation, TrackAction, TrackState, applyTrackAction, cancelEntryRecord, compareOfflineOperations, createTrackState, getEntryStatus, getEventCategories, getPaymentStatus, getReservationStatus, hasTicketCapacity, isCategoryEnabled, isReservationActive, overlayQueuedRecord, transferEntryRecord, validateEventRevision } from "./domain";
import { BackupPayload, parseBackup } from "./backup";
import { adoptCoordinatorOperation, CoordinatorOperation, CoordinatorRecord, getCoordinatorDeviceId, getCoordinatorSettings, getCoordinatorSnapshot, sendCoordinatorOperation } from "./coordinator";
export { AVAILABLE_CATEGORIES } from "./domain";
export type { AuditRecord, Category, Entry, EntryStatus, EventConfig, RunResult, TicketReservation } from "./domain";

const DB_NAME = "pdm-local";
const DB_VERSION = 7;
let cached: Promise<IDBDatabase> | undefined;
type CacheKind = "events" | "entries" | "results" | "audit" | "reservations";
type SyncKind = OfflineOperationKind;
type SyncOperation = { id: string; ownerUserId: string; kind: SyncKind; payload: Record<string, unknown>; createdAt: string; state: "pending" | "blocked"; lastError?: string };
type CacheRecord = { key: string; ownerUserId: string; kind: CacheKind; data: unknown[]; updatedAt: string };
let syncInFlight: Promise<SyncStatus> | undefined;
export type SyncStatus = { pending: number; blocked: number; lastError?: string };
type CoordinatorSyncStatus = { pending: number; blocked: number; lastError?: string; checked: boolean; connected: boolean };
type TrackOutboxRecord = { operationId: string; eventId: string; baseVersion: number; action: TrackAction; state: TrackState; actor: string; actorUserId: string | null; createdAt: string; status: "pending" | "blocked"; lastError?: string };

function openDb(): Promise<IDBDatabase> {
  if (cached) return cached;
  cached = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: "id" });
      if (!db.objectStoreNames.contains("entries")) {
        const store = db.createObjectStore("entries", { keyPath: "id" });
        store.createIndex("eventId", "eventId", { unique: false });
      }
      if (!db.objectStoreNames.contains("results")) {
        const store = db.createObjectStore("results", { keyPath: "id" });
        store.createIndex("eventId", "eventId", { unique: false });
        store.createIndex("entryId", "entryId", { unique: false });
      }
      if (!db.objectStoreNames.contains("audit")) db.createObjectStore("audit", { keyPath: "id" });
      if (!db.objectStoreNames.contains("remote_cache")) db.createObjectStore("remote_cache", { keyPath: "key" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
      if (!db.objectStoreNames.contains("reservations")) {
        const store = db.createObjectStore("reservations", { keyPath: "id" });
        store.createIndex("eventId", "eventId", { unique: false });
      }
      if (!db.objectStoreNames.contains("coordinator_outbox")) {
        const store = db.createObjectStore("coordinator_outbox", { keyPath: "operationId" });
        store.createIndex("entityKey", "entityKey", { unique: false });
      }
      if (!db.objectStoreNames.contains("coordinator_versions")) db.createObjectStore("coordinator_versions", { keyPath: "key" });
      if (!db.objectStoreNames.contains("track_states")) db.createObjectStore("track_states", { keyPath: "id" });
      if (!db.objectStoreNames.contains("track_outbox")) {
        const store = db.createObjectStore("track_outbox", { keyPath: "operationId" });
        store.createIndex("eventId", "eventId", { unique: false });
      }
      if (event.oldVersion < 7 && db.objectStoreNames.contains("coordinator_outbox")) {
        const cursorRequest = request.transaction!.objectStore("coordinator_outbox").openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const operation = cursor.value as CoordinatorQueuedOperation;
          cursor.update({ ...operation, state: "blocked", lastError: "Autoria original não verificável; item preservado para revisão e não enviado automaticamente." });
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return cached;
}

async function all<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}
type CoordinatorQueuedOperation = CoordinatorOperation & { entityKey: string; createdAt: string; state: "pending" | "blocked"; lastError?: string; authorProof?: never };
export type CoordinatorReviewOperation = Pick<CoordinatorQueuedOperation, "operationId" | "entityType" | "entityId" | "action" | "baseVersion" | "payload" | "createdAt" | "lastError">;
type CoordinatorVersion = { key: string; version: number };
let coordinatorSyncInFlight: Promise<CoordinatorSyncStatus> | undefined;

async function queueCoordinatorRecord(entityType: CoordinatorRecord["entityType"], payload: Record<string, unknown>, forcedAction?: CoordinatorOperation["action"]): Promise<void> {
  if (backendConfigured || !getCoordinatorSettings()) return;
  const entityId = String(payload.id || "");
  if (!entityId) return;
  const key = `${entityType}:${entityId}`;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["coordinator_versions", "coordinator_outbox"], "readwrite");
    const versionStore = tx.objectStore("coordinator_versions");
    const versionRequest = versionStore.get(key);
    const queueStore = tx.objectStore("coordinator_outbox");
    const queueRequest = queueStore.getAll();
    let ready = 0;
    let failure: Error | undefined;
    const add = () => {
      if (++ready !== 2) return;
      const version = (versionRequest.result as CoordinatorVersion | undefined)?.version || 0;
      const queued = (queueRequest.result as CoordinatorQueuedOperation[]).filter((item) => item.entityKey === key).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const baseVersion = version + queued.length;
      const action = forcedAction || (entityType === "run_results" ? "create" : baseVersion === 0 ? "create" : "update");
      const operation: CoordinatorQueuedOperation = {
        operationId: `coord:${crypto.randomUUID()}`, deviceId: getCoordinatorDeviceId(), entityType, entityId,
        action, baseVersion, payload, entityKey: key, createdAt: new Date().toISOString(), state: "blocked",
        lastError: "Autoria original não verificável pelo coordenador; operação preservada para revisão e sem envio automático.",
      };
      try { queueStore.add(operation); } catch (error) { failure = error instanceof Error ? error : new Error("Não foi possível enfileirar a alteração local."); tx.abort(); }
    };
    versionRequest.onsuccess = add;
    queueRequest.onsuccess = add;
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error("Não foi possível guardar a operação para o coordenador."));
    tx.onabort = () => reject(failure || tx.error || new Error("A operação não entrou na fila local do coordenador."));
  });
}

async function setCoordinatorOperationState(operation: CoordinatorQueuedOperation, state: CoordinatorQueuedOperation["state"], lastError?: string, version?: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["coordinator_outbox", "coordinator_versions"], "readwrite");
    const queue = tx.objectStore("coordinator_outbox");
    if (state === "pending") queue.delete(operation.operationId);
    else queue.put({ ...operation, state, lastError });
    if (version != null) tx.objectStore("coordinator_versions").put({ key: operation.entityKey, version } satisfies CoordinatorVersion);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Não foi possível atualizar o estado do coordenador."));
  });
  if (state === "blocked" && operation.entityType === "track_states" && /^Conflito de vers.o:/i.test(lastError || "")) {
    const trackState = (await all<TrackState>("track_states")).find((item) => item.eventId === operation.entityId);
    if (trackState) await put("track_states", { ...trackState, syncState: "conflict" });
  }
}

export async function getCoordinatorReviewQueue(): Promise<CoordinatorReviewOperation[]> {
  return (await all<CoordinatorQueuedOperation>("coordinator_outbox"))
    .filter((item) => item.state === "blocked")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(({ operationId, entityType, entityId, action, baseVersion, payload, createdAt, lastError }) => ({
      operationId, entityType, entityId, action, baseVersion, payload, createdAt, lastError,
    }));
}

export async function adoptCoordinatorReviewOperation(operationId: string): Promise<{ outcome: "accepted" | "duplicate" | "conflict" | "rejected"; error?: string; currentVersion?: number }> {
  const operation = (await all<CoordinatorQueuedOperation>("coordinator_outbox")).find((item) => item.operationId === operationId);
  if (!operation || operation.state !== "blocked") throw new Error("A operação não está mais aguardando revisão neste aparelho.");
  const { operationId: id, deviceId, entityType, entityId, action, baseVersion, payload } = operation;
  const { result } = await adoptCoordinatorOperation({ operationId: id, deviceId, entityType, entityId, action, baseVersion, payload });
  if (result.outcome === "accepted" || result.outcome === "duplicate") {
    await setCoordinatorOperationState(operation, "pending", undefined, result.version);
  } else if (result.outcome === "conflict") {
    // The server has durably preserved both versions; adopt the current version locally.
    await setCoordinatorOperationState(operation, "pending", undefined, result.currentVersion);
  } else {
    await setCoordinatorOperationState(operation, "blocked", result.error || "O coordenador não aceitou a operação.");
  }
  return result;
}

async function mergeCoordinatorSnapshot(snapshot: Awaited<ReturnType<typeof getCoordinatorSnapshot>>): Promise<void> {
  const db = await openDb();
  const queued = await all<CoordinatorQueuedOperation>("coordinator_outbox");
  const pendingKeys = new Set(queued.map((item) => item.entityKey));
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["events", "entries", "results", "reservations", "track_states", "coordinator_versions"], "readwrite");
    for (const row of snapshot.records) {
      const key = `${row.entityType}:${row.entityId}`;
      if (pendingKeys.has(key)) continue;
      const storeName = row.entityType === "run_results" ? "results" : row.entityType;
      const payload = row.entityType === "track_states"
        ? { ...row.payload, remoteVersion: row.version, syncState: "synced" }
        : row.payload;
      tx.objectStore(storeName).put(payload);
      tx.objectStore("coordinator_versions").put({ key, version: row.version } satisfies CoordinatorVersion);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Não foi possível aplicar as alterações compartilhadas pelo coordenador."));
  });
}

export async function syncLocalCoordinator(): Promise<CoordinatorSyncStatus> {
  if (backendConfigured || !getCoordinatorSettings()) return { pending: 0, blocked: 0, checked: false, connected: false };
  if (coordinatorSyncInFlight) return coordinatorSyncInFlight;
  coordinatorSyncInFlight = (async () => {
    let lastError: string | undefined;
    let checked = false;
    let connected = false;
    try {
      const firstSnapshot = await getCoordinatorSnapshot();
      checked = true;
      connected = true;
      await mergeCoordinatorSnapshot(firstSnapshot);
    } catch (error) {
      checked = true;
      lastError = error instanceof Error ? error.message : String(error);
    }

    const [localEvents, localEntries, localResults, localReservations, localTrackStates, knownVersions, queuedBeforeBootstrap] = await Promise.all([
      all<EventConfig>("events"), all<Entry>("entries"), all<RunResult>("results"), all<TicketReservation>("reservations"),
      all<TrackState>("track_states"),
      all<CoordinatorVersion>("coordinator_versions"), all<CoordinatorQueuedOperation>("coordinator_outbox"),
    ]);
    const known = new Set(knownVersions.map((item) => item.key));
    const alreadyQueued = new Set(queuedBeforeBootstrap.map((item) => item.entityKey));
    const bootstrap = [
      ...localEvents.map((payload) => ({ entityType: "events" as const, payload })),
      ...localEntries.map((payload) => ({ entityType: "entries" as const, payload })),
      ...localReservations.map((payload) => ({ entityType: "reservations" as const, payload })),
      ...localResults.map((payload) => ({ entityType: "run_results" as const, payload })),
      ...localTrackStates.map((payload) => ({ entityType: "track_states" as const, payload })),
    ].filter(({ entityType, payload }) => !known.has(`${entityType}:${payload.id}`) && !alreadyQueued.has(`${entityType}:${payload.id}`));
    for (const item of bootstrap) await queueCoordinatorRecord(item.entityType, item.payload as unknown as Record<string, unknown>);

    const queue = (await all<CoordinatorQueuedOperation>("coordinator_outbox")).sort((a, b) => {
      const rank = (kind: CoordinatorQueuedOperation["entityType"]) => kind === "events" ? 0 : kind === "entries" || kind === "reservations" ? 1 : 2;
      return rank(a.entityType) - rank(b.entityType) || a.createdAt.localeCompare(b.createdAt);
    });
    const blockedKeys = new Set<string>();
    for (const operation of queue) {
      if (operation.state === "blocked" || blockedKeys.has(operation.entityKey)) { blockedKeys.add(operation.entityKey); continue; }
      try {
        const response = await sendCoordinatorOperation(operation);
        const result = response.results[0];
        if (!result || result.outcome === "rejected" || result.outcome === "conflict") {
          const message = result?.error || "O coordenador não aceitou a operação.";
          await setCoordinatorOperationState(operation, "blocked", message);
          blockedKeys.add(operation.entityKey); lastError ||= message; continue;
        }
        const nextVersion = result.version ?? operation.baseVersion + 1;
        await setCoordinatorOperationState(operation, "pending", undefined, nextVersion);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        connected = false;
        break;
      }
    }
    try {
      await mergeCoordinatorSnapshot(await getCoordinatorSnapshot());
      checked = true;
      connected = true;
    } catch (error) {
      checked = true;
      const message = error instanceof Error ? error.message : String(error);
      lastError ||= message;
      connected = false;
    }
    const remaining = await all<CoordinatorQueuedOperation>("coordinator_outbox");
    return {
      pending: remaining.filter((item) => item.state === "pending").length,
      blocked: remaining.filter((item) => item.state === "blocked").length,
      lastError, checked, connected,
    };
  })().finally(() => { coordinatorSyncInFlight = undefined; });
  return coordinatorSyncInFlight;
}

async function queueStoredCoordinatorRecord(entityType: CoordinatorRecord["entityType"], entityId: string, action?: CoordinatorOperation["action"]): Promise<void> {
  const storeName = entityType === "run_results" ? "results" : entityType;
  const records = await all<Record<string, unknown>>(storeName);
  const record = records.find((item) => item.id === entityId);
  if (record) await queueCoordinatorRecord(entityType, record, action);
}
async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
const cacheKey = (ownerUserId: string, kind: CacheKind) => `${ownerUserId}:${kind}`;
function getOperationCacheKind(kind: SyncKind): CacheKind {
  return kind.startsWith("event.") ? "events" : kind.startsWith("entry.") ? "entries" : "results";
}
function overlayOperation(kind: SyncKind, rows: unknown[], payload: Record<string, unknown>): unknown[] {
  return overlayQueuedRecord(kind, rows as Array<{ id: string; status?: string }>, payload as { id: string }) as unknown[];
}
async function cachedRows<T>(ownerUserId: string, kind: CacheKind): Promise<T[] | null> {
  const records = await all<CacheRecord>("remote_cache");
  const record = records.find((item) => item.key === cacheKey(ownerUserId, kind));
  if (!record) return null;
  const cacheAge = Date.now() - Date.parse(record.updatedAt);
  if (!Number.isFinite(cacheAge) || cacheAge > 7 * 24 * 60 * 60 * 1000) return null;
  return record.data as T[];
}
async function cacheRemoteSnapshot(ownerUserId: string, kind: CacheKind, rows: unknown[]): Promise<unknown[]> {
  const operations = (await all<SyncOperation>("outbox"))
    .filter((operation) => operation.ownerUserId === ownerUserId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const merged = operations.filter((operation) => getOperationCacheKind(operation.kind) === kind)
    .reduce((data, operation) => overlayOperation(operation.kind, data, operation.payload), [...rows]);
  await put("remote_cache", { key: cacheKey(ownerUserId, kind), ownerUserId, kind, data: merged, updatedAt: new Date().toISOString() } satisfies CacheRecord);
  return merged;
}
function networkFailure(error: unknown): boolean {
  if (!navigator.onLine) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|network error|networkerror|load failed|fetch failed|connection|offline/i.test(message);
}
async function fallbackRows<T>(ownerUserId: string, kind: CacheKind, error: unknown): Promise<T[]> {
  if (!networkFailure(error)) throw error;
  const cached = await cachedRows<T>(ownerUserId, kind);
  if (cached) return cached;
  throw new Error("Sem conexão e sem dados deste parque previamente armazenados neste aparelho.");
}
async function enqueueOperation(ownerUserId: string, id: string, kind: SyncKind, payload: Record<string, unknown>): Promise<void> {
  const cacheKind = getOperationCacheKind(kind);
  const operation: SyncOperation = { id, ownerUserId, kind, payload, createdAt: new Date().toISOString(), state: "pending" };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["remote_cache", "outbox"], "readwrite");
    const cacheStore = tx.objectStore("remote_cache");
    const cacheRequest = cacheStore.get(cacheKey(ownerUserId, cacheKind));
    const operationStore = tx.objectStore("outbox");
    const operationRequest = operationStore.get(id);
    const queueRequest = operationStore.getAll();
    let cacheReady = false;
    let operationReady = false;
    let queueReady = false;
    let failure: Error | undefined;
    const commit = () => {
      if (!cacheReady || !operationReady || !queueReady) return;
      if (operationRequest.result) return;
      const current = cacheRequest.result as CacheRecord | undefined;
      const cacheAge = current ? Date.now() - Date.parse(current.updatedAt) : Number.POSITIVE_INFINITY;
      if (!current || !Number.isFinite(cacheAge) || cacheAge > 7 * 24 * 60 * 60 * 1000) {
        failure = new Error("Carregue os dados atualizados do parque com internet antes de iniciar operações offline neste aparelho.");
        tx.abort();
        return;
      }
      if (kind === "entry.cancel" || kind === "entry.payment" || kind === "entry.transfer") {
        const priorTimestamp = (queueRequest.result as SyncOperation[])
          .filter((prior) => prior.ownerUserId === ownerUserId && (prior.kind === "entry.cancel" || prior.kind === "entry.payment" || prior.kind === "entry.transfer") && prior.payload.id === payload.id)
          .reduce((latest, prior) => Math.max(latest, Date.parse(prior.createdAt) || 0), 0);
        operation.createdAt = new Date(Math.max(Date.now(), priorTimestamp + 1)).toISOString();
      }
      const data = overlayOperation(kind, current?.data || [], payload);
      cacheStore.put({ key: cacheKey(ownerUserId, cacheKind), ownerUserId, kind: cacheKind, data, updatedAt: current.updatedAt } satisfies CacheRecord);
      operationStore.add(operation);
    };
    cacheRequest.onsuccess = () => { cacheReady = true; commit(); };
    operationRequest.onsuccess = () => { operationReady = true; commit(); };
    queueRequest.onsuccess = () => { queueReady = true; commit(); };
    cacheRequest.onerror = () => { failure = cacheRequest.error || new Error("Falha ao preparar a fila offline."); tx.abort(); };
    operationRequest.onerror = () => { failure = operationRequest.error || new Error("Falha ao consultar a fila offline."); tx.abort(); };
    queueRequest.onerror = () => { failure = queueRequest.error || new Error("Falha ao ordenar a fila offline."); tx.abort(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error("Não foi possível guardar a operação offline."));
    tx.onabort = () => reject(failure || tx.error || new Error("A operação offline foi cancelada."));
  });
}
export async function getSyncStatus(): Promise<SyncStatus> {
  if (!backendConfigured) return { pending: 0, blocked: 0 };
  let ownerUserId: string;
  try { ownerUserId = await currentParkOwnerId(); } catch { return { pending: 0, blocked: 0 }; }
  const operations = (await all<SyncOperation>("outbox")).filter((item) => item.ownerUserId === ownerUserId);
  const blocked = operations.filter((item) => item.state === "blocked");
  const pending = operations.filter((item) => item.state === "pending");
  return { pending: pending.length, blocked: blocked.length, lastError: blocked[0]?.lastError || pending.find((item) => item.lastError)?.lastError };
}
async function applySyncOperation(operation: SyncOperation): Promise<void> {
  const payload = operation.payload;
  if (!neonClient) throw new Error("Backend ainda não configurado.");
  if (operation.kind === "event.create") {
    const event = payload as unknown as EventConfig;
    const endDate = event.endsAt || event.date;
    const { error } = await neonClient.rpc("create_park_event", {
      p_id: event.id, p_name: event.name, p_location: event.location,
      p_starts_at: `${event.date}T00:00:00.000Z`, p_ends_at: `${endDate}T23:59:59.999Z`,
      p_categories: event.categories || [], p_rules: event.rules || {}, p_category_rules: event.categorySettings || {},
      p_ticket_quantity: event.ticketQuantity ?? null, p_ticket_price: event.ticketPrice ?? null,
      p_prizes: event.prizes || [], p_scoring_mode: event.scoringMode,
    });
    if (!error) return;
    if (error.code === "23505") {
      const { data, error: readError } = await neonClient.from("events").select("id,name,starts_at,categories").eq("id", event.id).maybeSingle();
      if (readError) throw readError;
      if (data && data.name === event.name && String(data.starts_at).slice(0, 10) === event.date && stableJson(data.categories) === stableJson(event.categories || [])) return;
    }
    throw error;
  }
  if (operation.kind === "entry.create") {
    const entry = payload as unknown as Entry;
    const { error } = await neonClient.from("entries").insert({
      id: entry.id, event_id: entry.eventId, number: entry.number, vaqueiro: entry.vaqueiro, partner_name: entry.partner || "",
      horse: entry.horse, representation: entry.representation, category: entry.category,
      paid: getPaymentStatus(entry) === "paid", payment_status: getPaymentStatus(entry),
      paid_amount: entry.paidAmount || 0, payment_method: entry.paymentMethod || null, created_at: entry.createdAt,
    });
    if (!error) return;
    if (error.message.includes("Ticket capacity reached")) throw new Error("A quantidade de senhas desta vaquejada foi atingida antes da sincronização.");
    if (error.code === "23505") {
      const { data, error: readError } = await neonClient.from("entries").select("id,event_id,number,vaqueiro,partner_name,horse,representation,category")
        .eq("id", entry.id).maybeSingle();
      if (readError) throw readError;
      if (data && data.event_id === entry.eventId && data.number === entry.number && data.vaqueiro === entry.vaqueiro && data.partner_name === (entry.partner || "") && data.category === entry.category) return;
      throw new Error("Este número de senha já está ocupado nesta vaquejada.");
    }
    throw error;
  }
  if (operation.kind === "entry.payment") {
    const entry = payload as unknown as Entry;
    const fields = { paid: getPaymentStatus(entry) === "paid", payment_status: getPaymentStatus(entry), paid_amount: entry.paidAmount || 0, payment_method: entry.paymentMethod || null };
    const { data, error } = await neonClient.from("entries").update(fields).eq("id", entry.id).select("id").maybeSingle();
    if (error) throw error;
    if (data) return;
    const { data: current, error: readError } = await neonClient.rpc("get_entry_payment_state", { p_entry_id: entry.id });
    if (readError) throw readError;
    const payment = Array.isArray(current) ? current[0] : current;
    if (payment && payment.payment_status === fields.payment_status && Number(payment.paid_amount) === fields.paid_amount && payment.payment_method === fields.payment_method) return;
    throw new Error("A inscrição não existe mais ou o pagamento foi alterado em outro dispositivo.");
  }
  if (operation.kind === "entry.cancel") {
    const entry = payload as unknown as Entry;
    const { data, error } = await neonClient.from("entries").update({ status: "cancelled", status_reason: entry.statusReason, cancelled_at: entry.cancelledAt || null })
      .eq("id", entry.id).eq("event_id", entry.eventId).eq("status", "active").select("id").maybeSingle();
    if (error) {
      if (error.message.includes("recorded results cannot be cancelled")) throw new Error("Esta senha já tem resultados registrados e não pode ser cancelada.");
      throw error;
    }
    if (data) return;
    const { data: current, error: readError } = await neonClient.from("entries").select("status,status_reason").eq("id", entry.id).eq("event_id", entry.eventId).maybeSingle();
    if (readError) throw readError;
    if (current?.status === "cancelled" && current.status_reason === entry.statusReason) return;
    throw new Error("A inscrição mudou em outro dispositivo; atualize os dados antes de cancelar.");
  }
  if (operation.kind === "entry.transfer") {
    const entry = payload as unknown as Entry & { previous: EntryTransferChanges };
    const { data, error } = await neonClient.from("entries").update({
      vaqueiro: entry.vaqueiro, partner_name: entry.partner || "", horse: entry.horse, representation: entry.representation, category: entry.category,
      transfer_reason: entry.transferReason, transferred_at: entry.transferredAt || null,
    }).eq("id", entry.id).eq("event_id", entry.eventId).eq("status", "active")
      .eq("vaqueiro", entry.previous.vaqueiro).eq("partner_name", entry.previous.partner || "").eq("horse", entry.previous.horse)
      .eq("representation", entry.previous.representation).eq("category", entry.previous.category)
      .select("id").maybeSingle();
    if (error) {
      if (error.message.includes("recorded results")) throw new Error("Esta senha já tem resultado registrado e não pode ser transferida.");
      throw error;
    }
    if (data) return;
    const { data: current, error: readError } = await neonClient.from("entries")
      .select("status,vaqueiro,partner_name,horse,representation,category,transfer_reason")
      .eq("id", entry.id).eq("event_id", entry.eventId).maybeSingle();
    if (readError) throw readError;
    if (current?.status === "active" && current.vaqueiro === entry.vaqueiro && current.partner_name === (entry.partner || "") && current.horse === entry.horse &&
        current.representation === entry.representation && current.category === entry.category && current.transfer_reason === entry.transferReason) return;
    throw new Error("A inscrição foi alterada em outro aparelho. Atualize os dados antes de transferir.");
  }
  if (operation.kind === "result.create") {
    const result = payload as unknown as RunResult;
    const { error } = await neonClient.from("run_results").insert({
      id: result.id, event_id: result.eventId, entry_id: result.entryId, rodizio: result.rodizio,
      bull_number: result.bullNumber, result_type: result.resultType, points: result.points,
      status: result.status, created_at: result.createdAt,
    });
    if (!error) return;
    if (error.code === "23505") {
      const { data, error: readError } = await neonClient.from("run_results").select("event_id,entry_id,rodizio,bull_number,result_type,points,status").eq("id", result.id).maybeSingle();
      if (readError) throw readError;
      if (data && data.event_id === result.eventId && data.entry_id === result.entryId && data.rodizio === result.rodizio && data.bull_number === result.bullNumber && data.result_type === result.resultType && Number(data.points) === result.points && data.status === result.status) return;
    }
    throw error;
  }
  if (operation.kind === "result.confirm") {
    const result = payload as unknown as RunResult;
    const { data, error } = await neonClient.from("run_results").update({ status: "official" })
      .eq("id", result.id).eq("event_id", result.eventId).eq("status", "pending").select("id").maybeSingle();
    if (error) throw error;
    if (data) return;
    const { data: current, error: readError } = await neonClient.from("run_results").select("status").eq("id", result.id).eq("event_id", result.eventId).maybeSingle();
    if (readError) throw readError;
    if (current?.status === "official") return;
    throw new Error("O resultado mudou antes da sincronização; revise o histórico.");
  }
}
async function deleteOutboxOperation(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("outbox", "readwrite");
    tx.objectStore("outbox").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Falha ao atualizar a fila de sincronização."));
  });
}
export function syncPendingOperations(): Promise<SyncStatus> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    if (!backendConfigured || !navigator.onLine || !neonClient) return getSyncStatus();
    const session = await currentSession().catch(() => null);
    if (!session) return getSyncStatus();
    const operations = (await all<SyncOperation>("outbox"))
      .filter((operation) => operation.ownerUserId === session.user.id)
      .sort(compareOfflineOperations);
    for (const operation of operations) {
      if (operation.state === "blocked") break;
      try {
        await applySyncOperation(operation);
        await deleteOutboxOperation(operation.id);
      } catch (error) {
        const network = networkFailure(error);
        await put("outbox", { ...operation, state: network ? "pending" : "blocked", lastError: error instanceof Error ? error.message : String(error) } satisfies SyncOperation);
        break;
      }
    }
    return getSyncStatus();
  })().finally(() => { syncInFlight = undefined; });
  return syncInFlight;
}
export async function retryBlockedSync(): Promise<SyncStatus> {
  if (!backendConfigured || !navigator.onLine) return getSyncStatus();
  let owner: string;
  try { owner = await currentParkOwnerId(); } catch { return getSyncStatus(); }
  const operations = (await all<SyncOperation>("outbox")).filter((operation) => operation.ownerUserId === owner && operation.state === "blocked");
  for (const operation of operations) await put("outbox", { ...operation, state: "pending" as const });
  return syncPendingOperations();
}
export async function getEvents(): Promise<EventConfig[]> {
  if (backendConfigured) {
    const owner = await currentParkOwnerId();
    if (!navigator.onLine) return fallbackRows<EventConfig>(owner, "events", new Error("offline"));
    try {
      const { data: rows, error } = await neonClient!.from("events").select("id,name,location,starts_at,ends_at,categories,rules,category_rules,ticket_quantity,ticket_price,prizes,scoring_mode,created_at").order("starts_at", { ascending: true });
      if (error) throw error;
      const events = ((rows || []) as unknown as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id), name: String(row.name), location: String(row.location || ""),
        date: String(row.starts_at).slice(0, 10), endsAt: String(row.ends_at).slice(0, 10),
        categories: row.categories as Category[], rules: row.rules as Record<string, unknown>,
        competition: (row.rules as Record<string, unknown> | null)?.competition as EventConfig["competition"],
        categorySettings: row.category_rules as EventConfig["categorySettings"],
        ticketQuantity: row.ticket_quantity == null ? undefined : Number(row.ticket_quantity),
        ticketPrice: row.ticket_price == null ? undefined : Number(row.ticket_price),
        prizes: row.prizes as unknown[], scoringMode: row.scoring_mode as EventConfig["scoringMode"],
        createdAt: String(row.created_at),
      }));
      return await cacheRemoteSnapshot(owner, "events", events) as EventConfig[];
    } catch (error) { return fallbackRows<EventConfig>(owner, "events", error); }
  }
  const events = await all<EventConfig & { category?: Category; categories?: Category[] }>("events");
  return events.map((event) => ({ ...event, categories: event.categories?.length ? event.categories : [event.category || "Profissional"] }));
}
export async function getEntries(): Promise<Entry[]> {
  if (backendConfigured) {
    const owner = await currentParkOwnerId();
    if (!navigator.onLine) return fallbackRows<Entry>(owner, "entries", new Error("offline"));
    try {
      const { data: rows, error } = await neonClient!.rpc("get_event_entries");
      if (error) throw error;
      const entries = ((rows || []) as unknown as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id), eventId: String(row.event_id), number: Number(row.number),
        vaqueiro: String(row.vaqueiro), partner: String(row.partner_name || ""), horse: String(row.horse), representation: String(row.representation),
        category: String(row.category) as Category, paid: row.paid == null ? false : Boolean(row.paid),
        paymentRestricted: row.payment_status == null,
        paymentStatus: row.payment_status == null ? undefined : getPaymentStatus({ paid: Boolean(row.paid), paymentStatus: row.payment_status as Entry["paymentStatus"] }),
        paidAmount: row.paid_amount == null ? 0 : Number(row.paid_amount), paymentMethod: row.payment_method as Entry["paymentMethod"],
        paidAt: row.paid_at ? String(row.paid_at) : undefined, paidBy: row.paid_by ? String(row.paid_by) : undefined,
        status: row.status as Entry["status"] || "active", statusReason: row.status_reason ? String(row.status_reason) : undefined,
        cancelledAt: row.cancelled_at ? String(row.cancelled_at) : undefined, cancelledBy: row.cancelled_by ? String(row.cancelled_by) : undefined,
        transferReason: row.transfer_reason ? String(row.transfer_reason) : undefined, transferredAt: row.transferred_at ? String(row.transferred_at) : undefined,
        transferredBy: row.transferred_by ? String(row.transferred_by) : undefined,
        updatedAt: row.updated_at ? String(row.updated_at) : undefined,
        createdAt: String(row.created_at),
      }));
      return await cacheRemoteSnapshot(owner, "entries", entries) as Entry[];
    } catch (error) { return fallbackRows<Entry>(owner, "entries", error); }
  }
  return (await all<Entry>("entries")).map((entry) => ({ ...entry, paymentStatus: getPaymentStatus(entry) }));
}
export async function getTicketReservations(eventId?: string): Promise<TicketReservation[]> {
  if (backendConfigured) {
    const owner = await currentParkOwnerId();
    if (!navigator.onLine) {
      const cached = await fallbackRows<TicketReservation>(owner, "reservations", new Error("offline"));
      return cached.filter((reservation) => !eventId || reservation.eventId === eventId)
        .map((reservation) => ({ ...reservation, status: getReservationStatus(reservation) }));
    }
    try {
      if (eventId) {
        const { error: sweepError } = await neonClient!.rpc("sweep_event_ticket_reservations", { p_event_id: eventId });
        if (sweepError) throw sweepError;
      }
      let query = neonClient!.from("ticket_reservations")
        .select("id,event_id,number,reserved_for,expires_at,status,reason,created_by,created_at,released_at,released_by,release_reason")
        .order("created_at", { ascending: false });
      if (eventId) query = query.eq("event_id", eventId);
      const { data: rows, error } = await query;
      if (error) throw error;
      const reservations = (rows || []).map((row) => ({
        id: String(row.id), eventId: String(row.event_id), number: Number(row.number), reservedFor: String(row.reserved_for),
        expiresAt: String(row.expires_at), status: row.status as TicketReservation["status"], reason: row.reason ? String(row.reason) : undefined,
        createdBy: row.created_by ? String(row.created_by) : undefined, createdAt: String(row.created_at),
        releasedAt: row.released_at ? String(row.released_at) : undefined, releasedBy: row.released_by ? String(row.released_by) : undefined,
        releaseReason: row.release_reason ? String(row.release_reason) : undefined,
      }));
      const cached = await cacheRemoteSnapshot(owner, "reservations", reservations) as TicketReservation[];
      return cached.filter((reservation) => !eventId || reservation.eventId === eventId)
        .map((reservation) => ({ ...reservation, status: getReservationStatus(reservation) }));
    } catch (error) { return fallbackRows<TicketReservation>(owner, "reservations", error); }
  }
  return (await all<TicketReservation>("reservations"))
    .filter((reservation) => !eventId || reservation.eventId === eventId)
    .map((reservation) => ({ ...reservation, status: getReservationStatus(reservation) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function reserveTicketNumber(input: {
  id: string; eventId: string; number: number; reservedFor: string; expiresAt: string; reason?: string;
}): Promise<void> {
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isInteger(input.number) || input.number < 1 || !input.reservedFor.trim() || !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() || expiresAt > Date.now() + 30 * 24 * 60 * 60 * 1000) {
    throw new Error("Informe uma senha, pessoa e prazo de reserva futuro de até 30 dias.");
  }
  if (backendConfigured) {
    if (!navigator.onLine) throw new Error("Criar uma reserva compartilhada exige conexão com o servidor do parque.");
    const { error } = await neonClient!.rpc("reserve_event_ticket_number", {
      p_id: input.id, p_event_id: input.eventId, p_number: input.number, p_reserved_for: input.reservedFor.trim(),
      p_expires_at: input.expiresAt, p_reason: input.reason?.trim() || null,
    });
    if (error) {
      if (error.message.includes("already assigned or reserved")) throw new Error("Esse número já foi usado ou está reservado.");
      if (error.message.includes("Ticket capacity reached")) throw new Error("A capacidade de senhas desta vaquejada foi atingida.");
      throw error;
    }
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["events", "entries", "reservations", "audit"], "readwrite");
    const eventRequest = tx.objectStore("events").get(input.eventId);
    const entriesRequest = tx.objectStore("entries").index("eventId").getAll(input.eventId);
    const reservationsRequest = tx.objectStore("reservations").index("eventId").getAll(input.eventId);
    let event: EventConfig | undefined;
    let entries: Entry[] = [];
    let reservations: TicketReservation[] = [];
    let ready = 0;
    let failure: Error | undefined;
    const apply = () => {
      if (++ready !== 3) return;
      const active = reservations.filter((item) => isReservationActive(item));
      if (!event) failure = new Error("A vaquejada não foi encontrada neste aparelho.");
      else if (entries.some((item) => item.number === input.number) || active.some((item) => item.number === input.number)) failure = new Error("Esse número já foi usado ou está reservado.");
      else if (!hasTicketCapacity(event.ticketQuantity, entries.length + active.length)) failure = new Error("A capacidade de senhas desta vaquejada foi atingida.");
      if (failure) { tx.abort(); return; }
      const reservation: TicketReservation = { ...input, reservedFor: input.reservedFor.trim(), reason: input.reason?.trim() || undefined, status: "active", createdAt: new Date().toISOString(), createdBy: "Operador local" };
      tx.objectStore("reservations").add(reservation);
      tx.objectStore("audit").add(createLocalAudit(input.eventId, "ticket_reservations", input.id, "INSERT", null, reservation as unknown as Record<string, unknown>));
    };
    eventRequest.onsuccess = () => { event = eventRequest.result as EventConfig | undefined; apply(); };
    entriesRequest.onsuccess = () => { entries = entriesRequest.result as Entry[]; apply(); };
    reservationsRequest.onsuccess = () => { reservations = reservationsRequest.result as TicketReservation[]; apply(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error("Não foi possível reservar a senha."));
    tx.onabort = () => reject(failure || tx.error || new Error("A reserva foi interrompida."));
  });
  await queueStoredCoordinatorRecord("reservations", input.id);
}
export async function releaseTicketReservation(reservation: TicketReservation, reason: string): Promise<void> {
  if (reason.trim().length < 10) throw new Error("Informe um motivo com pelo menos 10 caracteres.");
  if (backendConfigured) {
    if (!navigator.onLine) throw new Error("Liberar uma reserva compartilhada exige conexão com o servidor do parque.");
    const { error } = await neonClient!.rpc("release_event_ticket_reservation", { p_id: reservation.id, p_reason: reason.trim() });
    if (error) throw error.message.includes("Only active reservations") ? new Error("A reserva já expirou ou foi finalizada.") : error;
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["reservations", "audit"], "readwrite");
    const store = tx.objectStore("reservations");
    const request = store.get(reservation.id);
    let failure: Error | undefined;
    request.onsuccess = () => {
      const before = request.result as TicketReservation | undefined;
      if (!before || before.eventId !== reservation.eventId || !isReservationActive(before)) {
        failure = new Error("A reserva já expirou ou foi finalizada."); tx.abort(); return;
      }
      const after: TicketReservation = { ...before, status: "released", releaseReason: reason.trim(), releasedAt: new Date().toISOString(), releasedBy: "Operador local" };
      store.put(after);
      tx.objectStore("audit").add(createLocalAudit(after.eventId, "ticket_reservations", after.id, "UPDATE", before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error("Não foi possível liberar a reserva."));
    tx.onabort = () => reject(failure || tx.error || new Error("A liberação foi interrompida."));
  });
  await queueStoredCoordinatorRecord("reservations", reservation.id);
}
export async function getResults(): Promise<RunResult[]> {
  if (backendConfigured) {
    const owner = await currentParkOwnerId();
    if (!navigator.onLine) return fallbackRows<RunResult>(owner, "results", new Error("offline"));
    try {
      const [resultsResponse, correctionsResponse] = await Promise.all([
        neonClient!.from("run_results").select("id,event_id,entry_id,rodizio,bull_number,result_type,points,status,created_at,created_by"),
        neonClient!.from("run_result_corrections").select("original_result_id,replacement_result_id,reason"),
      ]);
      if (resultsResponse.error) throw resultsResponse.error;
      if (correctionsResponse.error) throw correctionsResponse.error;
      const corrections = new Map((correctionsResponse.data || []).map((row) => [String(row.original_result_id), { reason: String(row.reason), replacement: String(row.replacement_result_id) }]));
      const results = ((resultsResponse.data || []) as unknown as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id), eventId: String(row.event_id), entryId: String(row.entry_id),
        rodizio: String(row.rodizio), bullNumber: Number(row.bull_number), resultType: row.result_type as RunResult["resultType"],
        points: Number(row.points), status: row.status as RunResult["status"],
        correctionReason: corrections.get(String(row.id))?.reason, supersededBy: corrections.get(String(row.id))?.replacement,
        createdAt: String(row.created_at), createdBy: String(row.created_by || "Operador"),
      }));
      return await cacheRemoteSnapshot(owner, "results", results) as RunResult[];
    } catch (error) { return fallbackRows<RunResult>(owner, "results", error); }
  }
  const [results, records] = await Promise.all([all<RunResult>("results"), all<AuditRecord>("audit")]);
  const corrections = new Map(records.filter((record) => record.recordTable === "result_corrections" && record.afterData)
    .map((record) => [String(record.afterData!.originalResultId), { reason: String(record.afterData!.reason), replacement: String(record.afterData!.replacementResultId) }]));
  return results.map((result) => ({
    ...result, correctionReason: corrections.get(result.id)?.reason, supersededBy: corrections.get(result.id)?.replacement,
  }));
}

export async function getTrackState(eventId: string, config: CompetitionConfig): Promise<TrackState> {
  const localRows = await all<TrackState>("track_states");
  const local = localRows.find((item) => item.eventId === eventId);
  if (backendConfigured && navigator.onLine) {
    await syncTrackOperations();
    const { data, error } = await neonClient!.from("event_track_states").select("event_id,version,state,updated_at").eq("event_id", eventId).maybeSingle();
    if (error) {
      if (!local) throw error;
      return { ...local, syncState: local.syncState === "blocked" || local.syncState === "conflict" ? local.syncState : "pending" };
    }
    const queued = (await all<TrackOutboxRecord>("track_outbox")).some((item) => item.eventId === eventId);
    if (data && !queued) {
      const remote = { ...(data.state as TrackState), id: eventId, eventId, version: Number(data.version), remoteVersion: Number(data.version), syncState: "synced" as const, updatedAt: String(data.updated_at) } as TrackState;
      await put("track_states", remote);
      return remote;
    }
  }
  if (local) return local;
  const state = createTrackState(eventId, config);
  await put("track_states", state);
  return state;
}

export async function applyTrackOperation(eventId: string, config: CompetitionConfig, action: TrackAction, operationId: string, actor: string): Promise<TrackState> {
  const session = backendConfigured ? await currentSession() : null;
  if (backendConfigured && !session) throw new Error("A sessão expirou. Entre com a identidade individual antes de registrar operações de pista.");
  const actorUserId = session?.user.id || null;
  const db = await openDb();
  const nextState = await new Promise<TrackState>((resolve, reject) => {
    const tx = db.transaction(["track_states", "track_outbox", "coordinator_outbox", "audit"], "readwrite");
    const stateStore = tx.objectStore("track_states");
    const currentRequest = stateStore.get(eventId);
    const queueStore = tx.objectStore("track_outbox");
    const queueRequest = queueStore.getAll();
    const coordinatorQueueRequest = tx.objectStore("coordinator_outbox").getAll();
    let state: TrackState | undefined;
    let queue: TrackOutboxRecord[] = [];
    let coordinatorQueue: CoordinatorQueuedOperation[] = [];
    let ready = 0;
    let failure: Error | undefined;
    const apply = () => {
      if (++ready !== 3) return;
      try {
        const current = state || createTrackState(eventId, config);
        if (current.syncState === "conflict") throw new Error("A pista está em conflito de versão. Resolva a sincronização antes de registrar novas ações.");
        const pendingTrackOperations = queue.some((item) => item.eventId === eventId && (item.status === "pending" || item.status === "blocked"));
        const trackKey = `track_states:${eventId}`;
        const pendingCoordinatorOperations = coordinatorQueue.some((item) => item.entityKey === trackKey && (item.state === "pending" || item.state === "blocked"));
        if (action.kind === "rotation.close" && (pendingTrackOperations || pendingCoordinatorOperations)) throw new Error("Há operações de pista pendentes ou em conflito. Sincronize e confira a fila antes de encerrar o rodízio.");
        const changed = applyTrackAction(current, config, action, operationId, actor);
        if (changed === current) { state = current; return; }
        const pending = queue.filter((item) => item.eventId === eventId && item.status === "pending").length;
        const remoteVersion = Number((current as TrackState & { remoteVersion?: number }).remoteVersion || 0);
        const persisted = { ...changed, remoteVersion, syncState: backendConfigured ? "pending" as const : getCoordinatorSettings() ? "blocked" as const : "local" as const } as TrackState;
        state = persisted;
        stateStore.put(persisted);
        const history = persisted.history[persisted.history.length - 1];
        tx.objectStore("audit").add({ id: `track:${history.operationId}`, eventId, recordTable: "track_state", recordId: history.recordId, action: "UPDATE", actorUserId: null, actorLabel: actor, beforeData: history.before as Record<string, unknown> || null, afterData: history.after as Record<string, unknown> || null, occurredAt: history.occurredAt } satisfies AuditRecord);
        if (backendConfigured) queueStore.add({ operationId, eventId, baseVersion: remoteVersion + pending, action, state: persisted, actor, actorUserId, createdAt: history.occurredAt, status: "pending" } satisfies TrackOutboxRecord);
      } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); try { tx.abort(); } catch { reject(failure); } }
    };
    currentRequest.onsuccess = () => { state = currentRequest.result as TrackState | undefined; apply(); };
    queueRequest.onsuccess = () => { queue = queueRequest.result as TrackOutboxRecord[]; apply(); };
    coordinatorQueueRequest.onsuccess = () => { coordinatorQueue = coordinatorQueueRequest.result as CoordinatorQueuedOperation[]; apply(); };
    tx.oncomplete = () => resolve(state!);
    tx.onerror = () => reject(failure || tx.error || new Error("Não foi possível persistir a operação da pista."));
    tx.onabort = () => reject(failure || tx.error || new Error("A operação da pista foi interrompida."));
  });
  if (!backendConfigured && getCoordinatorSettings()) {
    await queueCoordinatorRecord("track_states", nextState as unknown as Record<string, unknown>);
    await syncLocalCoordinator();
  }
  if (backendConfigured && navigator.onLine) await syncTrackOperations();
  return (await all<TrackState>("track_states")).find((item) => item.eventId === eventId) || nextState;
}

export async function syncTrackOperations(): Promise<{ pending: number; blocked: number; lastError?: string }> {
  const rows = await all<TrackOutboxRecord>("track_outbox");
  if (!backendConfigured) return { pending: rows.filter((item) => item.status === "pending").length, blocked: rows.filter((item) => item.status === "blocked").length };
  const reason = "Sincronização remota da pista suspensa: a RPC baseada em estado completo aguarda substituição e validação em staging. Operação preservada para revisão.";
  const blockedEvents = new Set(rows.map((item) => item.eventId));
  for (const item of rows) {
    if (item.status === "pending") await put("track_outbox", { ...item, status: "blocked", lastError: reason });
  }
  for (const state of await all<TrackState>("track_states")) {
    if (blockedEvents.has(state.eventId) && state.syncState !== "blocked") await put("track_states", { ...state, syncState: "blocked" });
  }
  const blocked = rows.length;
  return { pending: 0, blocked, ...(blocked ? { lastError: reason } : {}) };
}
export async function getAuditRecords(): Promise<AuditRecord[]> {
  if (!backendConfigured) {
    return (await all<AuditRecord>("audit")).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  const owner = await currentParkOwnerId();
  if (!navigator.onLine) return fallbackRows<AuditRecord>(owner, "audit", new Error("offline"));
  try {
    const { data: rows, error } = await neonClient!.from("audit_log")
      .select("id,event_id,record_table,record_id,action,actor_user_id,before_data,after_data,occurred_at")
      .order("occurred_at", { ascending: false }).limit(250);
    if (error) throw error;
    const records = (rows || []).map((row) => ({
      id: String(row.id), eventId: row.event_id ? String(row.event_id) : null,
      recordTable: String(row.record_table), recordId: String(row.record_id),
      action: row.action as AuditRecord["action"], actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
      beforeData: row.before_data as Record<string, unknown> | null, afterData: row.after_data as Record<string, unknown> | null,
      occurredAt: String(row.occurred_at),
    }));
    return await cacheRemoteSnapshot(owner, "audit", records) as AuditRecord[];
  } catch (error) { return fallbackRows<AuditRecord>(owner, "audit", error); }
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function normalizedStored(store: "events" | "entries" | "results", value: unknown): unknown {
  if (store === "events") {
    const event = value as EventConfig & { category?: Category };
    return { ...event, categories: getEventCategories(event) };
  }
  if (store === "entries") {
    const entry = value as Entry;
    return { ...entry, paymentStatus: getPaymentStatus(entry) };
  }
  return value;
}
export async function restoreLocalBackup(serialized: string): Promise<{ events: number; entries: number; results: number; reservations: number; audit: number }> {
  if (backendConfigured) throw new Error("Restauração direta está desabilitada na conta conectada. Use um processo remoto autorizado e auditado.");
  const backup: BackupPayload = parseBackup(serialized);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["events", "entries", "results", "reservations", "audit"], "readwrite");
    const stores = { events: tx.objectStore("events"), entries: tx.objectStore("entries"), results: tx.objectStore("results"), reservations: tx.objectStore("reservations"), audit: tx.objectStore("audit") };
    const existing: { events: EventConfig[]; entries: Entry[]; results: RunResult[]; reservations: TicketReservation[]; audit: AuditRecord[] } = { events: [], entries: [], results: [], reservations: [], audit: [] };
    let readsRemaining = 5;
    let failure: Error | undefined;
    const fail = (error: Error) => { failure = error; try { tx.abort(); } catch { reject(error); } };
    const read = <K extends keyof typeof stores>(name: K) => {
      const request = stores[name].getAll();
      request.onsuccess = () => {
        existing[name] = request.result as typeof existing[K];
        readsRemaining -= 1;
        if (readsRemaining !== 0) return;
        try {
          const addEvents = backup.events.filter((item) => {
            const old = existing.events.find((row) => row.id === item.id);
            if (old && stableJson(normalizedStored("events", old)) !== stableJson(normalizedStored("events", item))) throw new Error(`A vaquejada ${item.name} já existe com dados diferentes. Nenhum dado foi restaurado.`);
            return !old;
          });
          const eventById = new Map([...existing.events, ...backup.events].map((event) => [event.id, event]));
          const entryById = new Map(existing.entries.map((entry) => [entry.id, entry]));
          const usedNumbers = new Map(existing.entries.map((entry) => [`${entry.eventId}:${entry.number}`, entry.id]));
          const addEntries = backup.entries.filter((item) => {
            const old = entryById.get(item.id);
            if (old) {
              if (stableJson(normalizedStored("entries", old)) !== stableJson(normalizedStored("entries", item))) throw new Error(`A inscrição ${item.number} já existe com dados diferentes. Nenhum dado foi restaurado.`);
              return false;
            }
            const event = eventById.get(item.eventId);
            if (!event || !getEventCategories(event).includes(item.category)) throw new Error(`A categoria da senha ${item.number} não está habilitada na vaquejada.`);
            const numberKey = `${item.eventId}:${item.number}`;
            if (usedNumbers.has(numberKey)) throw new Error(`A senha ${item.number} já está ocupada nesta vaquejada. Nenhum dado foi restaurado.`);
            usedNumbers.set(numberKey, item.id);
            entryById.set(item.id, item);
            return true;
          });
          const reservationById = new Map(existing.reservations.map((item) => [item.id, item]));
          const usedTicketNumbers = new Set([...existing.entries, ...addEntries].map((item) => `${item.eventId}:${item.number}`));
          for (const item of existing.reservations.filter((item) => item.status === "active" && isReservationActive(item))) usedTicketNumbers.add(`${item.eventId}:${item.number}`);
          const addReservations = (backup.reservations || []).filter((item) => {
            const old = reservationById.get(item.id);
            if (old) {
              if (stableJson(old) !== stableJson(item)) throw new Error(`A reserva ${item.number} já existe com dados diferentes.`);
              return false;
            }
            const key = `${item.eventId}:${item.number}`;
            if (item.status === "active" && isReservationActive(item) && usedTicketNumbers.has(key)) throw new Error(`A senha ${item.number} já está ocupada nesta vaquejada.`);
            if (item.status === "active" && isReservationActive(item)) usedTicketNumbers.add(key);
            return true;
          });
          const resultById = new Map(existing.results.map((result) => [result.id, result]));
          const addResults = backup.results.filter((item) => {
            const old = resultById.get(item.id);
            if (old) {
              if (stableJson(old) !== stableJson(item)) throw new Error(`O resultado ${item.id} já existe com dados diferentes. Nenhum dado foi restaurado.`);
              return false;
            }
            const entry = entryById.get(item.entryId);
            if (!entry || entry.eventId !== item.eventId) throw new Error(`O resultado ${item.id} não corresponde a uma inscrição restaurada.`);
            return true;
          });
          const auditById = new Map(existing.audit.map((item) => [item.id, item]));
          const addAudit = (backup.audit || []).filter((item) => {
            const old = auditById.get(item.id);
            if (old) {
              if (stableJson(old) !== stableJson(item)) throw new Error(`O registro de auditoria ${item.id} já existe com dados diferentes.`);
              return false;
            }
            return true;
          });
          const restoreRecord = createLocalAudit(null, "backups", "restore", "INSERT", null, {
            events: addEvents.length, entries: addEntries.length, results: addResults.length, audit: addAudit.length,
          });
          addEvents.forEach((item) => stores.events.add(item));
          addEntries.forEach((item) => stores.entries.add(item));
          addResults.forEach((item) => stores.results.add(item));
          addReservations.forEach((item) => stores.reservations.add(item));
          addAudit.forEach((item) => stores.audit.add(item));
          stores.audit.add(restoreRecord);
          tx.oncomplete = () => resolve({ events: addEvents.length, entries: addEntries.length, results: addResults.length, reservations: addReservations.length, audit: addAudit.length + 1 });
        } catch (error) { fail(error instanceof Error ? error : new Error("O backup não pôde ser restaurado.")); }
      };
    };
    read("events"); read("entries"); read("results"); read("reservations"); read("audit");
    tx.onerror = () => reject(failure || tx.error || new Error("Falha ao restaurar o backup."));
    tx.onabort = () => reject(failure || tx.error || new Error("A restauração foi cancelada; os dados locais não foram alterados."));
  });
}

function createLocalAudit(eventId: string | null, recordTable: string, recordId: string, action: AuditRecord["action"], beforeData: Record<string, unknown> | null, afterData: Record<string, unknown> | null, actorLabel = "Operador local"): AuditRecord {
  return { id: crypto.randomUUID(), eventId, recordTable, recordId, action, actorUserId: null, actorLabel, beforeData, afterData, occurredAt: new Date().toISOString() };
}

export async function saveEvent(event: EventConfig): Promise<void> {
  if (backendConfigured) {
    const owner = await currentParkOwnerId();
    await enqueueOperation(owner, `event.create:${event.id}`, "event.create", event as unknown as Record<string, unknown>);
    if (navigator.onLine) await syncPendingOperations();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["events", "audit"], "readwrite");
    const events = tx.objectStore("events");
    const request = events.get(event.id);
    request.onsuccess = () => {
      const before = request.result as EventConfig | undefined;
      events.put(event);
      tx.objectStore("audit").add(createLocalAudit(event.id, "events", event.id, before ? "UPDATE" : "INSERT", before ? before as unknown as Record<string, unknown> : null, event as unknown as Record<string, unknown>));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Não foi possível salvar a vaquejada neste aparelho."));
    tx.onabort = () => reject(tx.error || new Error("O cadastro da vaquejada foi cancelado."));
  });
  await queueCoordinatorRecord("events", event as unknown as Record<string, unknown>);
}
export async function updateEvent(event: EventConfig): Promise<void> {
  const categories = event.categories || [];
  if (backendConfigured) {
    if (!navigator.onLine) throw new Error("A edição das configurações da vaquejada exige conexão.");
    const { data, error } = await neonClient!.from("events").update({
      name: event.name, location: event.location,
      starts_at: `${event.date}T00:00:00.000Z`, ends_at: `${event.endsAt || event.date}T23:59:59.999Z`,
      categories, rules: event.rules || {}, category_rules: event.categorySettings || {},
      ticket_quantity: event.ticketQuantity ?? null, ticket_price: event.ticketPrice ?? null,
      prizes: event.prizes || [], scoring_mode: event.scoringMode,
    }).eq("id", event.id).select("id").maybeSingle();
    if (error) {
      if (error.message.includes("Remove or transfer affected entries")) throw new Error("Não é possível desativar uma categoria que já possui inscrições.");
      if (error.message.includes("Event capacity cannot be lower")) throw new Error("A quantidade de senhas não pode ficar abaixo das inscrições já cadastradas.");
      throw error;
    }
    if (!data) throw new Error("A vaquejada não foi encontrada ou não pertence a este parque.");
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["events", "entries", "audit"], "readwrite");
    const events = tx.objectStore("events");
    const eventRequest = events.get(event.id);
    const entriesRequest = tx.objectStore("entries").index("eventId").getAll(event.id);
    let current: EventConfig | undefined;
    let linked: Entry[] = [];
    let ready = 0;
    let failure: Error | undefined;
    const apply = () => {
      if (++ready !== 2) return;
      if (!current) failure = new Error("A vaquejada não foi encontrada neste aparelho.");
      else {
        const validationError = validateEventRevision(event, linked);
        if (validationError) failure = new Error(validationError);
      }
      if (failure) { tx.abort(); return; }
      events.put({ ...event, createdAt: current!.createdAt });
      tx.objectStore("audit").add(createLocalAudit(event.id, "events", event.id, "UPDATE", current as unknown as Record<string, unknown>, event as unknown as Record<string, unknown>));
    };
    eventRequest.onsuccess = () => { current = eventRequest.result as EventConfig | undefined; apply(); };
    entriesRequest.onsuccess = () => { linked = entriesRequest.result as Entry[]; apply(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error("Não foi possível atualizar a vaquejada."));
    tx.onabort = () => reject(failure || tx.error || new Error("A edição da vaquejada foi cancelada."));
  });
  await queueCoordinatorRecord("events", event as unknown as Record<string, unknown>);
}
export async function saveEntry(entry: Entry, reservationId?: string): Promise<void> {
  if (!entry.vaqueiro.trim()) throw new Error("Informe o vaqueiro da inscrição.");
  if (backendConfigured) {
    if (reservationId) {
      if (!navigator.onLine) throw new Error("Converter uma reserva compartilhada em inscrição exige conexão com o parque.");
      const { error } = await neonClient!.rpc("create_entry_from_ticket_reservation", {
        p_entry_id: entry.id, p_reservation_id: reservationId, p_vaqueiro: entry.vaqueiro, p_partner_name: entry.partner || "",
        p_horse: entry.horse, p_representation: entry.representation, p_category: entry.category,
        p_payment_status: getPaymentStatus(entry), p_paid_amount: entry.paidAmount || 0,
        p_payment_method: entry.paymentMethod || null,
      });
      if (error) throw error;
      return;
    }
    const owner = await currentParkOwnerId();
    await enqueueOperation(owner, `entry.create:${entry.id}`, "entry.create", entry as unknown as Record<string, unknown>);
    if (navigator.onLine) await syncPendingOperations();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["events", "entries", "reservations", "audit"], "readwrite");
    const eventRequest = tx.objectStore("events").get(entry.eventId);
    const entriesStore = tx.objectStore("entries");
    const entriesRequest = entriesStore.index("eventId").getAll(entry.eventId);
    const reservationRequest = reservationId ? tx.objectStore("reservations").get(reservationId) : undefined;
    const reservationsRequest = tx.objectStore("reservations").index("eventId").getAll(entry.eventId);
    let event: EventConfig | undefined;
    let eventEntries: Entry[] | undefined;
    let reservation: TicketReservation | undefined;
    let eventReady = false;
    let entriesReady = false;
    let reservationReady = !reservationId;
    let reservationsReady = false;
    let eventReservations: TicketReservation[] = [];
    let failure: Error | undefined;
    const evaluate = () => {
      if (!eventReady || !entriesReady || !reservationReady || !reservationsReady) return;
      if (!event) failure = new Error("A vaquejada selecionada não foi encontrada neste aparelho.");
      else if (!isCategoryEnabled(event, entry.category)) failure = new Error("A categoria da senha não está habilitada nesta vaquejada.");
      else if (reservationId && (!reservation || reservation.eventId !== entry.eventId || reservation.number !== entry.number || !isReservationActive(reservation))) failure = new Error("A reserva expirou, foi finalizada ou não corresponde a esta senha.");
      else if (eventEntries!.some((stored) => stored.number === entry.number)) failure = new Error("Este número de senha já foi utilizado nesta vaquejada.");
      else if (eventReservations.some((stored) => stored.number === entry.number && stored.id !== reservationId && isReservationActive(stored))) failure = new Error("Este número de senha está reservado nesta vaquejada.");
      else if (!reservationId && !hasTicketCapacity(event.ticketQuantity, eventEntries!.length + eventReservations.filter(isReservationActive).length)) failure = new Error("A quantidade de senhas desta vaquejada já foi atingida.");
      if (failure) { try { tx.abort(); } catch { reject(failure); } return; }
      if (reservationId) {
        const nextReservation = { ...reservation!, status: "converted" as const };
        tx.objectStore("reservations").put(nextReservation);
        tx.objectStore("audit").add(createLocalAudit(entry.eventId, "ticket_reservations", reservation!.id, "UPDATE", reservation as unknown as Record<string, unknown>, nextReservation as unknown as Record<string, unknown>));
      }
      entriesStore.add(entry);
      tx.objectStore("audit").add(createLocalAudit(entry.eventId, "entries", entry.id, "INSERT", null, entry as unknown as Record<string, unknown>, entry.paidBy || "Operador local"));
    };
    eventRequest.onsuccess = () => { event = eventRequest.result as EventConfig | undefined; eventReady = true; evaluate(); };
    entriesRequest.onsuccess = () => { eventEntries = entriesRequest.result as Entry[]; entriesReady = true; evaluate(); };
    if (reservationRequest) {
      reservationRequest.onsuccess = () => { reservation = reservationRequest.result as TicketReservation | undefined; reservationReady = true; evaluate(); };
      reservationRequest.onerror = () => { failure = reservationRequest.error || new Error("Não foi possível ler a reserva."); tx.abort(); };
    }
    reservationsRequest.onsuccess = () => { eventReservations = reservationsRequest.result as TicketReservation[]; reservationsReady = true; evaluate(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error("Não foi possível salvar a senha neste aparelho."));
    tx.onabort = () => reject(failure || tx.error || new Error("O cadastro da senha foi cancelado."));
  });
  if (reservationId) {
    const reservation = (await all<TicketReservation>("reservations")).find((item) => item.id === reservationId);
    if (!reservation) throw new Error("A inscrição foi salva, mas a reserva não pôde ser encaminhada ao coordenador.");
    await queueCoordinatorRecord("reservations", { ...reservation, entry: entry as unknown as Record<string, unknown> }, "convert");
  } else await queueCoordinatorRecord("entries", entry as unknown as Record<string, unknown>);
}
export async function updateEntryPayment(entry: Entry): Promise<void> {
  if (getEntryStatus(entry) !== "active") throw new Error("Não é possível alterar o pagamento de uma inscrição cancelada.");
  if (backendConfigured) {
    const owner = await currentParkOwnerId();
    await enqueueOperation(owner, `entry.payment:${entry.id}:${crypto.randomUUID()}`, "entry.payment", entry as unknown as Record<string, unknown>);
    if (navigator.onLine) await syncPendingOperations();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["entries", "audit"], "readwrite");
    const entries = tx.objectStore("entries");
    const request = entries.get(entry.id);
    request.onsuccess = () => {
      const before = request.result as Entry | undefined;
      if (!before || before.eventId !== entry.eventId) { tx.abort(); return; }
      const next: Entry = {
        ...before, paid: getPaymentStatus(entry) === "paid", paymentStatus: getPaymentStatus(entry),
        paidAmount: entry.paidAmount || 0, paymentMethod: entry.paymentMethod,
        paidAt: entry.paidAt, paidBy: entry.paidBy,
      };
      entries.put(next);
      tx.objectStore("audit").add(createLocalAudit(next.eventId, "entries", next.id, "UPDATE", before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, next.paidBy || "Operador local"));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Não foi possível atualizar o pagamento."));
    tx.onabort = () => reject(tx.error || new Error("A inscrição não foi encontrada para atualizar o pagamento."));
  });
  await queueStoredCoordinatorRecord("entries", entry.id);
}
export async function cancelEntry(entry: Entry, reason: string): Promise<void> {
  const cancellation = cancelEntryRecord(entry, reason, new Date().toISOString(), "Operador local");
  const eventResults = (await getResults()).filter((result) => result.eventId === entry.eventId && result.entryId === entry.id);
  if (eventResults.length) throw new Error("Esta senha já tem resultados registrados e não pode ser cancelada.");
  if (backendConfigured) {
    const owner = await currentParkOwnerId();
    const payload = { id: entry.id, eventId: entry.eventId, status: "cancelled", statusReason: cancellation.statusReason, cancelledAt: cancellation.cancelledAt };
    await enqueueOperation(owner, `entry.cancel:${entry.id}`, "entry.cancel", payload);
    if (navigator.onLine) await syncPendingOperations();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["entries", "results", "audit"], "readwrite");
    const entries = tx.objectStore("entries");
    const entryRequest = entries.get(entry.id);
    const resultsRequest = tx.objectStore("results").index("entryId").getAll(entry.id);
    let current: Entry | undefined;
    let resultCount: number | undefined;
    let ready = 0;
    let failure: Error | undefined;
    const apply = () => {
      if (++ready !== 2) return;
      if (!current || current.eventId !== entry.eventId) failure = new Error("A inscrição não foi encontrada neste aparelho.");
      else if (getEntryStatus(current) !== "active") failure = new Error("Somente inscrições ativas podem ser canceladas.");
      else if (resultCount) failure = new Error("Esta senha já tem resultados registrados e não pode ser cancelada.");
      if (failure) { tx.abort(); return; }
      const next = cancelEntryRecord(current!, reason, new Date().toISOString(), "Operador local");
      entries.put(next);
      tx.objectStore("audit").add(createLocalAudit(next.eventId, "entries", next.id, "UPDATE", current as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, "Operador local"));
    };
    entryRequest.onsuccess = () => { current = entryRequest.result as Entry | undefined; apply(); };
    resultsRequest.onsuccess = () => { resultCount = (resultsRequest.result as RunResult[]).length; apply(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error("Não foi possível cancelar a inscrição."));
    tx.onabort = () => reject(failure || tx.error || new Error("O cancelamento foi interrompido."));
  });
  await queueStoredCoordinatorRecord("entries", entry.id);
}
export async function transferEntry(entry: Entry, changes: EntryTransferChanges, reason: string): Promise<void> {
  const event = (await getEvents()).find((item) => item.id === entry.eventId);
  if (!event || !isCategoryEnabled(event, changes.category)) throw new Error("A categoria escolhida não está habilitada nesta vaquejada.");
  const transferredAt = new Date().toISOString();
  const updated = transferEntryRecord(entry, changes, reason, transferredAt, "Operador local");
  const eventResults = (await getResults()).filter((result) => result.eventId === entry.eventId && result.entryId === entry.id);
  if (eventResults.length) throw new Error("Esta senha já tem resultado registrado e não pode ser transferida.");
  if (backendConfigured) {
    const owner = await currentParkOwnerId();
    const payload = {
      id: entry.id, eventId: entry.eventId, vaqueiro: updated.vaqueiro, partner: updated.partner, horse: updated.horse,
      representation: updated.representation, category: updated.category,
      transferReason: updated.transferReason, transferredAt: updated.transferredAt,
      previous: { vaqueiro: entry.vaqueiro, partner: entry.partner || "", horse: entry.horse, representation: entry.representation, category: entry.category },
    };
    await enqueueOperation(owner, `entry.transfer:${entry.id}:${crypto.randomUUID()}`, "entry.transfer", payload);
    if (navigator.onLine) await syncPendingOperations();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["events", "entries", "results", "audit"], "readwrite");
    const eventRequest = tx.objectStore("events").get(entry.eventId);
    const entryStore = tx.objectStore("entries");
    const entryRequest = entryStore.get(entry.id);
    const resultsRequest = tx.objectStore("results").index("entryId").getAll(entry.id);
    let currentEvent: EventConfig | undefined;
    let current: Entry | undefined;
    let resultCount: number | undefined;
    let ready = 0;
    let failure: Error | undefined;
    const apply = () => {
      if (++ready !== 3) return;
      if (!current || current.eventId !== entry.eventId) failure = new Error("A inscrição não foi encontrada neste aparelho.");
      else if (getEntryStatus(current) !== "active") failure = new Error("Somente inscrições ativas podem ser transferidas.");
      else if (!currentEvent || !isCategoryEnabled(currentEvent, changes.category)) failure = new Error("A categoria escolhida não está habilitada nesta vaquejada.");
      else if (resultCount) failure = new Error("Esta senha já tem resultado registrado e não pode ser transferida.");
      if (failure) { tx.abort(); return; }
      const next = transferEntryRecord(current!, changes, reason, new Date().toISOString(), "Operador local");
      entryStore.put(next);
      tx.objectStore("audit").add(createLocalAudit(next.eventId, "entries", next.id, "UPDATE", current as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, "Operador local"));
    };
    eventRequest.onsuccess = () => { currentEvent = eventRequest.result as EventConfig | undefined; apply(); };
    entryRequest.onsuccess = () => { current = entryRequest.result as Entry | undefined; apply(); };
    resultsRequest.onsuccess = () => { resultCount = (resultsRequest.result as RunResult[]).length; apply(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error("Não foi possível transferir a senha."));
    tx.onabort = () => reject(failure || tx.error || new Error("A transferência foi interrompida."));
  });
  await queueStoredCoordinatorRecord("entries", entry.id);
}
export async function saveResult(result: RunResult): Promise<void> {
  if (backendConfigured) {
    const owner = await currentParkOwnerId();
    await enqueueOperation(owner, `result.create:${result.id}`, "result.create", result as unknown as Record<string, unknown>);
    if (navigator.onLine) await syncPendingOperations();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["entries", "results", "audit"], "readwrite");
    const entryRequest = tx.objectStore("entries").get(result.entryId);
    const results = tx.objectStore("results");
    const resultRequest = results.get(result.id);
    let entry: Entry | undefined;
    let duplicate = false;
    let ready = 0;
    const saveIfReady = () => {
      if (++ready !== 2) return;
      if (duplicate) { tx.abort(); return; }
      if (!entry || entry.eventId !== result.eventId || getEntryStatus(entry) !== "active") { tx.abort(); return; }
      results.add(result);
      tx.objectStore("audit").add(createLocalAudit(result.eventId, "run_results", result.id, "INSERT", null, result as unknown as Record<string, unknown>, result.createdBy));
    };
    entryRequest.onsuccess = () => { entry = entryRequest.result as Entry | undefined; saveIfReady(); };
    resultRequest.onsuccess = () => { duplicate = Boolean(resultRequest.result); saveIfReady(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Não foi possível registrar o resultado."));
    tx.onabort = () => reject(tx.error || new Error(duplicate ? "Este resultado já existe e não pode ser substituído." : "Somente inscrições ativas desta vaquejada podem receber resultados."));
  });
  await queueStoredCoordinatorRecord("run_results", result.id);
}
export async function confirmRunResult(resultId: string, eventId: string): Promise<void> {
  if (backendConfigured) {
    const owner = await currentParkOwnerId();
    const result = (await getResults()).find((item) => item.id === resultId && item.eventId === eventId);
    if (!result || result.status !== "pending") throw new Error("O resultado não está mais pendente. Atualize a tela e revise o histórico.");
    await enqueueOperation(owner, `result.confirm:${resultId}`, "result.confirm", result as unknown as Record<string, unknown>);
    if (navigator.onLine) await syncPendingOperations();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["results", "audit"], "readwrite");
    const results = tx.objectStore("results");
    const request = results.get(resultId);
    request.onsuccess = () => {
      const current = request.result as RunResult | undefined;
      if (!current || current.eventId !== eventId || current.status !== "pending") { tx.abort(); return; }
      const next: RunResult = { ...current, status: "official" };
      results.put(next);
      tx.objectStore("audit").add(createLocalAudit(eventId, "run_results", resultId, "UPDATE", current as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, current.createdBy));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Não foi possível confirmar o resultado."));
    tx.onabort = () => reject(tx.error || new Error("O resultado não está mais pendente. Atualize a tela e revise o histórico."));
  });
  await queueStoredCoordinatorRecord("run_results", resultId, "confirm");
}
export async function correctRunResult(input: {
  originalResultId: string; rodizio: string; bullNumber: number;
  resultType: RunResult["resultType"]; points: number; reason: string; correctedBy: string;
}): Promise<void> {
  if (input.reason.trim().length < 10) throw new Error("Informe um motivo com pelo menos 10 caracteres.");
  if (!input.rodizio.trim() || !Number.isInteger(input.bullNumber) || input.bullNumber < 1 || !Number.isFinite(input.points) || input.points < 0 ||
      !["points", "zero", "return"].includes(input.resultType) || (input.resultType !== "points" && input.points !== 0)) {
    throw new Error("Os dados corrigidos do resultado são inválidos.");
  }
  if (backendConfigured) {
    if (!navigator.onLine) throw new Error("A correção de um resultado oficial exige conexão. Os resultados existentes continuam disponíveis no cache local.");
    const { error } = await neonClient!.rpc("correct_official_result", {
      p_original_result_id: input.originalResultId, p_rodizio: input.rodizio,
      p_bull_number: input.bullNumber, p_result_type: input.resultType,
      p_points: input.points, p_reason: input.reason.trim(),
    });
    if (error) throw error;
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["results", "events", "audit"], "readwrite");
    const results = tx.objectStore("results");
    const originalRequest = results.get(input.originalResultId);
    let original: RunResult | undefined;
    let event: EventConfig | undefined;
    let originalReady = false;
    let eventReady = false;
    let failure: Error | undefined;
    originalRequest.onsuccess = () => {
      original = originalRequest.result as RunResult | undefined;
      originalReady = true;
      if (original) {
        const request = tx.objectStore("events").get(original.eventId);
        request.onsuccess = () => { event = request.result as EventConfig | undefined; eventReady = true; commit(); };
        request.onerror = () => { failure = request.error || new Error("Não foi possível ler a vaquejada."); tx.abort(); };
      } else {
        eventReady = true;
        commit();
      }
    };
    const commit = () => {
      if (!originalReady || !eventReady) return;
      if (!original || !event || original.status !== "official") {
        failure = new Error("Somente resultados oficiais deste aparelho podem ser corrigidos.");
        tx.abort();
        return;
      }
      const replacement: RunResult = {
        id: crypto.randomUUID(), eventId: original.eventId, entryId: original.entryId,
        rodizio: input.rodizio.trim(), bullNumber: input.bullNumber, resultType: input.resultType,
        points: input.points, status: event.scoringMode === "confirm" ? "pending" : "official",
        createdAt: new Date().toISOString(), createdBy: input.correctedBy.trim() || "Operador local",
      };
      const superseded: RunResult = { ...original, status: "superseded", correctionReason: input.reason.trim(), supersededBy: replacement.id };
      results.put(superseded);
      results.add(replacement);
      const audit = tx.objectStore("audit");
      audit.add(createLocalAudit(original.eventId, "run_results", original.id, "UPDATE", original as unknown as Record<string, unknown>, superseded as unknown as Record<string, unknown>, replacement.createdBy));
      audit.add(createLocalAudit(original.eventId, "run_results", replacement.id, "INSERT", null, replacement as unknown as Record<string, unknown>, replacement.createdBy));
      audit.add(createLocalAudit(original.eventId, "result_corrections", crypto.randomUUID(), "INSERT", null, {
        originalResultId: original.id, replacementResultId: replacement.id, reason: input.reason.trim(),
      }, replacement.createdBy));
    };
    originalRequest.onerror = () => { failure = originalRequest.error || new Error("Não foi possível ler o resultado."); tx.abort(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error("Não foi possível corrigir o resultado."));
    tx.onabort = () => reject(failure || tx.error || new Error("A correção foi cancelada."));
  });
  const correctedRows = await all<RunResult>("results");
  const correctedOriginal = correctedRows.find((item) => item.id === input.originalResultId);
  const correctedReplacement = correctedRows.find((item) => item.id === correctedOriginal?.supersededBy);
  if (correctedOriginal && correctedReplacement) await queueCoordinatorRecord("run_results", {
    ...correctedOriginal, reason: input.reason.trim(), replacement: correctedReplacement,
  } as unknown as Record<string, unknown>, "correct");

}
export const uid = () => crypto.randomUUID();
