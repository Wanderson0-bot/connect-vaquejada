import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { randomUUID, timingSafeEqual } from "node:crypto";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon" };
const entityTypes = new Set(["events", "entries", "run_results", "reservations", "track_states"]);
const maxBodyBytes = 256 * 1024;

function safeEqual(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
async function bodyJson(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error("A operação excede 256 KiB."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("O corpo precisa ser um JSON UTF-8 válido."), { status: 400 }); }
}

export function createCoordinator({
  dbPath = process.env.CONNECT_PDM_DB || resolve("data/connect-pdm.sqlite"),
  operators = (() => { try { return JSON.parse(process.env.CONNECT_PDM_OPERATOR_CREDENTIALS || "[]"); } catch { return []; } })(),
  operatorCredentialsFile = process.env.CONNECT_PDM_OPERATOR_CREDENTIALS_FILE,
  parkId = process.env.CONNECT_PDM_PARK_ID,
  host = process.env.CONNECT_PDM_HOST || "0.0.0.0",
  port = Number(process.env.PORT || process.env.CONNECT_PDM_PORT || 8787),
  webRoot = process.env.CONNECT_PDM_WEB_ROOT || resolve("dist"),
  tlsCert = process.env.CONNECT_PDM_TLS_CERT,
  tlsKey = process.env.CONNECT_PDM_TLS_KEY,
  allowedOrigins = (process.env.CONNECT_PDM_ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173").split(",").map((value) => value.trim()).filter(Boolean),
  allowInsecureLan = process.env.CONNECT_PDM_ALLOW_INSECURE_LAN === "true",
  trustProxyTls = process.env.CONNECT_PDM_TRUST_PROXY_TLS === "true",
} = {}) {
  const loadOperators = () => {
    if (!operatorCredentialsFile) return operators;
    try { return JSON.parse(readFileSync(operatorCredentialsFile, "utf8")); }
    catch { return null; }
  };
  const validOperators = (roster) => Array.isArray(roster) && roster.length > 0 && !roster.some((operator) =>
    !operator || typeof operator.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(operator.userId) ||
    typeof operator.token !== "string" || operator.token.length < 32 ||
    !["park_manager", "office", "announcer", "judge", "track_operator"].includes(operator.role) ||
    typeof operator.expiresAt !== "string" || !Number.isFinite(Date.parse(operator.expiresAt)) || typeof operator.disabled !== "boolean");
  if (!validOperators(loadOperators())) {
    throw new Error("Configure CONNECT_PDM_OPERATOR_CREDENTIALS com credenciais individuais por usuário, perfil e expiração.");
  }
  if (!parkId) throw new Error("Defina CONNECT_PDM_PARK_ID para vincular este coordenador a um único parque.");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT/CONNECT_PDM_PORT precisa ser uma porta TCP válida.");
  if (trustProxyTls && tlsCert) throw new Error("Use TLS terminado no proxy ou certificado local, não ambos.");
  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!tlsCert && !loopbackHosts.has(host) && !allowInsecureLan && !trustProxyTls) {
    throw new Error("HTTPS é obrigatório para expor o coordenador na rede. Configure CONNECT_PDM_TLS_CERT e CONNECT_PDM_TLS_KEY ou, somente atrás de um proxy com TLS externo, CONNECT_PDM_TRUST_PROXY_TLS=true.");
  }
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
  const schemaVersion = Number(db.prepare("PRAGMA user_version").get().user_version);
  if (schemaVersion > 2) {
    db.close();
    throw new Error(`O banco SQLite usa uma versão de esquema mais nova (${schemaVersion}) que esta aplicação suporta (2).`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL,
      payload_json TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(entity_type, entity_id)
    );
    CREATE TABLE IF NOT EXISTS operations (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL UNIQUE,
      device_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      action TEXT NOT NULL, base_version INTEGER NOT NULL, outcome TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL, actor_user_id TEXT,
      response_json TEXT
    );
    CREATE TABLE IF NOT EXISTS conflicts (
      id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, device_id TEXT NOT NULL, expected_version INTEGER NOT NULL,
      current_version INTEGER NOT NULL, attempted_json TEXT NOT NULL, current_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operation_attempts (
      id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, actor_user_id TEXT NOT NULL,
      device_id TEXT NOT NULL, reason TEXT NOT NULL, attempted_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS operations_sequence_idx ON operations(sequence);
    CREATE INDEX IF NOT EXISTS operation_attempts_created_at_idx ON operation_attempts(created_at);
  `);
  if (!db.prepare("PRAGMA table_info(operations)").all().some((column) => column.name === "actor_user_id")) {
    db.exec("ALTER TABLE operations ADD COLUMN actor_user_id TEXT");
  }
  if (!db.prepare("PRAGMA table_info(operations)").all().some((column) => column.name === "response_json")) {
    db.exec("ALTER TABLE operations ADD COLUMN response_json TEXT");
  }
  const migrationTime = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(1,?,?)").run("coordinator-core", migrationTime);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(2,?,?)").run("durable-idempotency-and-attempts", migrationTime);
  db.exec("PRAGMA user_version=2");
  const events = new EventEmitter(); events.setMaxListeners(0);
  const stmts = {
    operation: db.prepare("SELECT sequence,device_id,entity_type,entity_id,action,base_version,outcome,payload_json,actor_user_id,response_json FROM operations WHERE operation_id=?"),
    record: db.prepare("SELECT version,payload_json FROM records WHERE entity_type=? AND entity_id=?"),
    saveRecord: db.prepare("INSERT INTO records(entity_type,entity_id,version,payload_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET version=excluded.version,payload_json=excluded.payload_json,updated_at=excluded.updated_at"),
    appendOperation: db.prepare("INSERT INTO operations(operation_id,device_id,entity_type,entity_id,action,base_version,outcome,payload_json,created_at,actor_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)"),
    saveOperationResponse: db.prepare("UPDATE operations SET response_json=? WHERE operation_id=?"),
    operationAttempt: db.prepare("INSERT INTO operation_attempts(id,operation_id,actor_user_id,device_id,reason,attempted_json,created_at) VALUES(?,?,?,?,?,?,?)"),
    conflict: db.prepare("INSERT INTO conflicts(id,operation_id,entity_type,entity_id,device_id,expected_version,current_version,attempted_json,current_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)"),
    changes: db.prepare("SELECT sequence,operation_id,device_id,entity_type,entity_id,action,base_version,outcome,payload_json,created_at,actor_user_id FROM operations WHERE sequence>? ORDER BY sequence LIMIT 500"),
    conflicts: db.prepare("SELECT id,operation_id,entity_type,entity_id,device_id,expected_version,current_version,attempted_json,current_json,created_at FROM conflicts ORDER BY created_at DESC LIMIT 200"),
    conflictByOperation: db.prepare("SELECT id,current_version,current_json FROM conflicts WHERE operation_id=?"),
    operationAttempts: db.prepare("SELECT id,operation_id,actor_user_id,device_id,reason,attempted_json,created_at FROM operation_attempts ORDER BY created_at DESC LIMIT 200"),
    snapshot: db.prepare("SELECT entity_type,entity_id,version,payload_json,updated_at FROM records ORDER BY entity_type,entity_id"),
    maxSequence: db.prepare("SELECT COALESCE(MAX(sequence),0) AS sequence FROM operations"),
  };
  const missingResponses = db.prepare("SELECT sequence,operation_id,entity_type,action,base_version,outcome,payload_json FROM operations WHERE response_json IS NULL AND outcome IN ('accepted','conflict')").all();
  for (const row of missingResponses) {
    const payload = JSON.parse(row.payload_json);
    let response;
    if (row.outcome === "conflict") {
      const storedConflict = stmts.conflictByOperation.get(row.operation_id);
      response = {
        operationId: row.operation_id, outcome: "conflict", sequence: row.sequence,
        ...(storedConflict ? {
          conflictId: storedConflict.id, currentVersion: storedConflict.current_version,
          current: JSON.parse(storedConflict.current_json),
        } : {}),
        error: "Conflito de versão: os dois conteúdos foram preservados para revisão.",
      };
    } else {
      response = { operationId: row.operation_id, outcome: "accepted", sequence: row.sequence, version: row.base_version + 1 };
      if (row.entity_type === "reservations" && row.action === "convert" && payload.entry?.id) response.createdEntryId = payload.entry.id;
      if (row.entity_type === "run_results" && row.action === "correct" && payload.replacement?.id) response.replacementId = payload.replacement.id;
    }
    stmts.saveOperationResponse.run(JSON.stringify(response), row.operation_id);
  }
  const rolePermissions = {
    park_manager: new Set(["event.manage", "entry.create", "entry.update", "entry.cancel", "entry.transfer", "entry.reserve", "payment.record", "result.judge", "result.confirm", "result.correct", "result.return_decide", "track.queue", "track.rotation_control", "track.rotation_close", "track.rotation_reopen", "track.read", "result.read", "event.read", "entry.read", "standings.read", "report.read", "audit.read", "users.manage"]),
    office: new Set(["event.read", "entry.read", "entry.create", "entry.update", "payment.record", "report.read"]),
    announcer: new Set(["event.read", "entry.read", "track.read", "result.read", "standings.read"]),
    judge: new Set(["event.read", "entry.read", "track.read", "result.read", "result.judge", "result.return_decide"]),
    track_operator: new Set(["event.read", "entry.read", "track.read", "track.queue", "track.rotation_control"]),
  };
  const allowedReadTypes = {
    park_manager: new Set(entityTypes),
    office: new Set(["events", "entries", "reservations"]),
    announcer: new Set(["events", "entries", "run_results", "track_states"]),
    judge: new Set(["events", "entries", "run_results", "track_states"]),
    track_operator: new Set(["events", "entries", "track_states"]),
  };
  function filterRecord(record, role) {
    const linkedEventId = record.entityType === "events" ? record.entityId : record.payload.eventId;
    const linkedEvent = record.entityType === "events" ? record.payload : JSON.parse(stmts.record.get("events", linkedEventId || "")?.payload_json || "null");
    if (!linkedEvent || linkedEvent.parkId !== parkId) return null;
    if (!allowedReadTypes[role]?.has(record.entityType)) return null;
    if (["announcer", "judge", "track_operator"].includes(role) && record.entityType === "entries") {
      const { paid: _paid, paidAmount: _amount, paidAt: _at, paidBy: _by, paymentStatus: _status, paymentMethod: _method, ...safe } = record.payload;
      return { ...record, payload: safe };
    }
    return record;
  }
  function assertOperationPermission(op, principal, currentRecord) {
    if (op.entityType !== "events") {
      const event = stmts.record.get("events", op.payload.eventId);
      if (!event || JSON.parse(event.payload_json).parkId !== parkId) throw Object.assign(new Error("O evento não pertence ao parque autenticado."), { status: 403 });
    } else if (op.payload.parkId && op.payload.parkId !== parkId) {
      throw Object.assign(new Error("O evento pertence a outro parque."), { status: 403 });
    }
    const required = new Set();
    if (op.entityType === "events") required.add("event.manage");
    if (op.entityType === "entries") {
      if (op.action === "create") required.add("entry.create");
      else {
        const before = currentRecord ? JSON.parse(currentRecord.payload_json) : {};
        const after = op.payload;
        if (before.status !== after.status && after.status === "cancelled") required.add("entry.cancel");
        if (["vaqueiro", "partner", "horse", "representation", "category"].some((key) => before[key] !== after[key])) {
          required.add(after.transferReason && after.transferReason !== before.transferReason ? "entry.transfer" : "entry.update");
        }
        if (["paid", "paymentStatus", "paidAmount", "paymentMethod", "paidAt"].some((key) => before[key] !== after[key])) required.add("payment.record");
        if (!required.size) required.add("entry.update");
      }
    }
    if (op.entityType === "reservations") required.add("entry.reserve");
    if (op.entityType === "run_results") required.add(op.action === "create" ? "result.judge" : op.action === "confirm" ? "result.confirm" : "result.correct");
    if (op.entityType === "track_states") {
      const action = op.payload.history?.at(-1)?.action;
      const permissions = {
        "rotation.pause": "track.rotation_control", "rotation.resume": "track.rotation_control",
        "rotation.close": "track.rotation_close", "rotation.reopen": "track.rotation_reopen",
        "call.create": "track.queue", "call.present": "track.queue", "call.absent": "track.queue", "call.move_tail": "track.queue", "race.start": "track.queue",
        "race.judge": "result.judge", "return.decide": "result.return_decide", "return.create_race": "result.return_decide",
        "result.confirm": "result.confirm", "result.correct": "result.correct",
      };
      required.add(permissions[action]);
    }
    if ([...required].some((permission) => !rolePermissions[principal.role]?.has(permission))) {
      throw Object.assign(new Error(`O perfil ${principal.role} não tem permissão para esta operação.`), { status: 403 });
    }
  }
  function validateOperation(op) {
    if (!op || typeof op !== "object" || Array.isArray(op)) throw new Error("Operação inválida.");
    const operationFields = new Set(["operationId", "deviceId", "entityType", "entityId", "action", "baseVersion", "payload"]);
    if (Object.keys(op).some((key) => !operationFields.has(key))) throw new Error("A operação contém campos não permitidos.");
    if (typeof op.operationId !== "string" || op.operationId.length < 8 || op.operationId.length > 120) throw new Error("Identificador de operação inválido.");
    if (typeof op.deviceId !== "string" || op.deviceId.length < 1 || op.deviceId.length > 100) throw new Error("Identificador do aparelho inválido.");
    if (!entityTypes.has(op.entityType)) throw new Error("Tipo de registro não permitido.");
    if (op.entityType === "track_states") throw Object.assign(new Error("Escrita do estado da pista suspensa: o servidor ainda não aplica transições canônicas por ação."), { status: 403 });
    if (typeof op.entityId !== "string" || op.entityId.length < 1 || op.entityId.length > 120) throw new Error("Identificador de registro inválido.");
    if (!new Set(["create", "update", "confirm", "convert", "correct"]).has(op.action)) throw new Error("Ação inválida; registros não podem ser apagados pelo coordenador.");
    if (!Number.isSafeInteger(op.baseVersion) || op.baseVersion < 0) throw new Error("Versão-base inválida.");
    if (!op.payload || typeof op.payload !== "object" || Array.isArray(op.payload)) throw new Error("Conteúdo do registro inválido.");
    if (String(op.payload.id || op.payload.eventId || "") !== op.entityId) throw new Error("O identificador do conteúdo não corresponde ao registro.");
    if (op.entityType === "events" && op.payload.parkId && op.payload.parkId !== parkId) throw new Error("O evento pertence a outro parque.");
    if (op.payload.parkId && op.payload.parkId !== parkId) throw new Error("O registro pertence a outro parque.");
    const allowedActions = {
      events: new Set(["create", "update"]),
      entries: new Set(["create", "update"]),
      reservations: new Set(["create", "update", "convert"]),
      run_results: new Set(["create", "confirm", "correct"]),
      track_states: new Set(["create", "update"]),
    };
    if (!allowedActions[op.entityType].has(op.action)) {
      throw new Error(`A ação "${op.action}" não é permitida para registros do tipo "${op.entityType}".`);
    }
        if (op.entityType === "run_results" && op.action === "confirm" && op.baseVersion < 1) throw new Error("Só resultados existentes podem ser confirmados.");
  }
  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  function rejectOperationReplay(op, principal, reason) {
    stmts.operationAttempt.run(randomUUID(), op.operationId, principal.userId, op.deviceId, reason, stableJson(op), new Date().toISOString());
    return { operationId: op.operationId, outcome: "rejected", error: reason };
  }
  function replayResult(prior, op, principal, payloadJson) {
    const operationFields = new Set(["operationId", "deviceId", "entityType", "entityId", "action", "baseVersion", "payload"]);
    const hasOnlyOperationFields = Object.keys(op).every((key) => operationFields.has(key));
    const matches = hasOnlyOperationFields &&
      prior.actor_user_id === principal.userId &&
      prior.device_id === op.deviceId &&
      prior.entity_type === op.entityType &&
      prior.entity_id === op.entityId &&
      prior.action === op.action &&
      prior.base_version === op.baseVersion &&
      stableJson(JSON.parse(prior.payload_json)) === payloadJson;
    if (!matches) {
      return rejectOperationReplay(op, principal, "O identificador da operação já foi usado por outro usuário ou com outro conteúdo.");
    }
    if (prior.response_json) return JSON.parse(prior.response_json);
    return { operationId: op.operationId, outcome: prior.outcome === "conflict" ? "conflict" : "accepted", sequence: prior.sequence };
  }
  function processOperation(op, principal) {
    if (op && typeof op === "object" && !Array.isArray(op) && typeof op.operationId === "string") {
      const priorOperation = stmts.operation.get(op.operationId);
      if (priorOperation) {
        const replayPayload = op.payload && typeof op.payload === "object" && !Array.isArray(op.payload) ? { ...op.payload } : op.payload;
        if (op.entityType === "events" && replayPayload && typeof replayPayload === "object" && !Array.isArray(replayPayload)) replayPayload.parkId = parkId;
        return replayResult(priorOperation, op, principal, stableJson(replayPayload));
      }
    }
    validateOperation(op);
    const payload = { ...op.payload };
    if (op.entityType === "events") payload.parkId = parkId;
    const payloadJson = stableJson(payload);
    const priorOperation = stmts.operation.get(op.operationId);
    if (priorOperation) return replayResult(priorOperation, op, principal, payloadJson);
    db.exec("BEGIN IMMEDIATE");
    try {
      const prior = stmts.operation.get(op.operationId);
      if (prior) {
        const result = replayResult(prior, op, principal, payloadJson);
        db.exec("COMMIT");
        return result;
      }
      const current = stmts.record.get(op.entityType, op.entityId);
      assertOperationPermission(op, principal, current);
      const version = current?.version || 0;
      const now = new Date().toISOString();
      if (op.baseVersion !== version || (op.action === "create" && current) || (op.action === "update" && !current)) {
        const conflictId = randomUUID();
        stmts.conflict.run(conflictId, op.operationId, op.entityType, op.entityId, op.deviceId, op.baseVersion, version, payloadJson, current?.payload_json || "null", now);
        const inserted = stmts.appendOperation.run(op.operationId, op.deviceId, op.entityType, op.entityId, op.action, op.baseVersion, "conflict", payloadJson, now, principal.userId);
        const result = {
          operationId: op.operationId, outcome: "conflict", sequence: Number(inserted.lastInsertRowid),
          conflictId, currentVersion: version, current: current ? JSON.parse(current.payload_json) : null,
          error: "Conflito de versão: os dois conteúdos foram preservados para revisão.",
        };
        stmts.saveOperationResponse.run(JSON.stringify(result), op.operationId);
        db.exec("COMMIT"); events.emit("change", Number(inserted.lastInsertRowid));
        return result;
      }
      if (op.entityType !== "events") {
        const parentId = payload.eventId;
        if (typeof parentId !== "string" || !stmts.record.get("events", parentId)) throw new Error("O evento associado ainda não foi compartilhado no coordenador.");
      }
      if (op.action === "convert") {
        const reservation = current ? JSON.parse(current.payload_json) : null;
        const entry = payload.entry;
        if (!reservation || reservation.status !== "active" || Date.parse(reservation.expiresAt) <= Date.now()) throw new Error("A reserva expirou ou já foi finalizada.");
        if (payload.eventId !== reservation.eventId || payload.number !== reservation.number) throw new Error("A conversão não pode alterar o evento nem o número da reserva.");
        if (!entry || typeof entry.id !== "string" || entry.eventId !== reservation.eventId || Number(entry.number) !== Number(reservation.number) || entry.category == null || !entry.vaqueiro?.trim()) throw new Error("A inscrição não corresponde à reserva.");
        const event = JSON.parse(stmts.record.get("events", reservation.eventId).payload_json);
        if (Array.isArray(event.categories) && !event.categories.includes(entry.category)) throw new Error("A categoria não está habilitada neste evento.");
        if (stmts.record.get("entries", entry.id)) throw new Error("O identificador da inscrição já existe.");
        const duplicateTicket = db.prepare("SELECT entity_id FROM records WHERE entity_type='entries' AND json_extract(payload_json,'$.eventId')=? AND json_extract(payload_json,'$.number')=?").get(entry.eventId, Number(entry.number));
        if (duplicateTicket) throw new Error("Este número de senha já está atribuído neste evento.");
        const converted = { ...payload, status: "converted" }; delete converted.entry;
        const nextVersion = version + 1;
        stmts.saveRecord.run("reservations", op.entityId, nextVersion, JSON.stringify(converted), now);
        stmts.saveRecord.run("entries", entry.id, 1, JSON.stringify(entry), now);
        const parentOperation = stmts.appendOperation.run(op.operationId, op.deviceId, op.entityType, op.entityId, op.action, op.baseVersion, "accepted", payloadJson, now, principal.userId);
        stmts.appendOperation.run(`${op.operationId}:entry`, op.deviceId, "entries", entry.id, "create", 0, "accepted", JSON.stringify(entry), now, principal.userId);
        const sequence = Number(parentOperation.lastInsertRowid);
        const result = { operationId: op.operationId, outcome: "accepted", sequence, version: nextVersion, createdEntryId: entry.id };
        stmts.saveOperationResponse.run(JSON.stringify(result), op.operationId);
        db.exec("COMMIT"); events.emit("change", sequence);
        return result;
      }
      if (op.action === "correct") {
        const original = current ? JSON.parse(current.payload_json) : null;
        const replacement = payload.replacement;
        const reason = String(payload.reason || "").trim();
        if (!original || original.status !== "official" || reason.length < 10 || !replacement || typeof replacement.id !== "string") throw new Error("A correção precisa partir de resultado oficial e conter justificativa.");
        if (stmts.record.get("run_results", replacement.id)) throw new Error("O identificador do novo resultado já existe.");
        if (replacement.eventId !== original.eventId || replacement.entryId !== original.entryId || !["official", "pending"].includes(replacement.status)) throw new Error("O resultado substituto não corresponde à tentativa original.");
        const event = JSON.parse(stmts.record.get("events", original.eventId).payload_json);
        if (event.scoringMode === "confirm" && replacement.status !== "pending") throw new Error("Este evento exige confirmação do resultado corrigido.");
        const originalAfter = { ...original, status: "superseded", correctionReason: reason, supersededBy: replacement.id };
        const originalVersion = version + 1;
        stmts.saveRecord.run("run_results", op.entityId, originalVersion, JSON.stringify(originalAfter), now);
        stmts.saveRecord.run("run_results", replacement.id, 1, JSON.stringify(replacement), now);
        const parentOperation = stmts.appendOperation.run(op.operationId, op.deviceId, op.entityType, op.entityId, op.action, op.baseVersion, "accepted", payloadJson, now, principal.userId);
        stmts.appendOperation.run(`${op.operationId}:replacement`, op.deviceId, "run_results", replacement.id, "create", 0, "accepted", JSON.stringify(replacement), now, principal.userId);
        const sequence = Number(parentOperation.lastInsertRowid);
        const result = { operationId: op.operationId, outcome: "accepted", sequence, version: originalVersion, replacementId: replacement.id };
        stmts.saveOperationResponse.run(JSON.stringify(result), op.operationId);
        db.exec("COMMIT"); events.emit("change", sequence);
        return result;
      }
      if (op.entityType === "run_results") {
        const existingResult = current ? JSON.parse(current.payload_json) : null;
        const event = JSON.parse(stmts.record.get("events", payload.eventId).payload_json);
        if (!stmts.record.get("entries", payload.entryId)) throw new Error("A senha do resultado não está compartilhada neste coordenador.");
        if (op.action === "create") {
          if (current) throw new Error("Resultados são registros insert-only.");
          if (event.scoringMode === "confirm" && payload.status !== "pending") throw new Error("Este evento exige confirmação antes de oficializar o resultado.");
          if (!["official", "pending"].includes(payload.status)) throw new Error("Estado inicial de resultado inválido.");
        } else {
          if (!existingResult || existingResult.status !== "pending" || payload.status !== "official") throw new Error("Somente um resultado pendente pode ser confirmado.");
          const expected = { ...existingResult, status: "official" };
          if (stableJson(expected) !== payloadJson) throw new Error("A confirmação não pode alterar os dados esportivos do resultado.");
        }
      }
      if (op.entityType === "entries") {
        const event = JSON.parse(stmts.record.get("events", payload.eventId).payload_json);
        if (Array.isArray(event.categories) && !event.categories.includes(payload.category)) throw new Error("A categoria não está habilitada neste evento.");
        const duplicateTicket = db.prepare("SELECT entity_id FROM records WHERE entity_type='entries' AND entity_id<>? AND json_extract(payload_json,'$.eventId')=? AND json_extract(payload_json,'$.number')=?").get(op.entityId, payload.eventId, Number(payload.number));
        if (duplicateTicket) throw new Error("Este número de senha já está atribuído neste evento.");
        if (!current) {
          const issued = Number(db.prepare("SELECT COUNT(*) AS count FROM records WHERE entity_type='entries' AND json_extract(payload_json,'$.eventId')=?").get(payload.eventId).count);
          const reserved = Number(db.prepare("SELECT COUNT(*) AS count FROM records WHERE entity_type='reservations' AND json_extract(payload_json,'$.eventId')=? AND json_extract(payload_json,'$.status')='active'").get(payload.eventId).count);
          if (event.ticketQuantity != null && issued + reserved >= event.ticketQuantity) throw new Error("A capacidade de senhas do evento foi atingida.");
        }
      }
      if (op.entityType === "reservations" && payload.status === "active") {
        const duplicate = db.prepare("SELECT entity_id FROM records WHERE entity_type IN ('entries','reservations') AND entity_id<>? AND json_extract(payload_json,'$.eventId')=? AND json_extract(payload_json,'$.number')=? AND (entity_type='entries' OR json_extract(payload_json,'$.status')='active')").get(op.entityId, payload.eventId, Number(payload.number));
        if (duplicate) throw new Error("Este número de senha já está atribuído ou reservado neste evento.");
        const event = JSON.parse(stmts.record.get("events", payload.eventId).payload_json);
        const issued = Number(db.prepare("SELECT COUNT(*) AS count FROM records WHERE entity_type='entries' AND json_extract(payload_json,'$.eventId')=?").get(payload.eventId).count);
        const reserved = Number(db.prepare("SELECT COUNT(*) AS count FROM records WHERE entity_type='reservations' AND json_extract(payload_json,'$.eventId')=? AND json_extract(payload_json,'$.status')='active'").get(payload.eventId).count);
        if (event.ticketQuantity != null && issued + reserved >= event.ticketQuantity) throw new Error("A capacidade de senhas do evento foi atingida.");
      }
      if (op.entityType === "events" && payload.ticketQuantity != null) {
        const issued = Number(db.prepare("SELECT COUNT(*) AS count FROM records WHERE entity_type='entries' AND json_extract(payload_json,'$.eventId')=?").get(op.entityId).count);
        const reserved = Number(db.prepare("SELECT COUNT(*) AS count FROM records WHERE entity_type='reservations' AND json_extract(payload_json,'$.eventId')=? AND json_extract(payload_json,'$.status')='active'").get(op.entityId).count);
        if (Number(payload.ticketQuantity) < issued + reserved) throw new Error("A capacidade não pode ficar abaixo das senhas emitidas e reservas ativas.");
      }
      const nextVersion = version + 1;
      stmts.saveRecord.run(op.entityType, op.entityId, nextVersion, payloadJson, now);
      const inserted = stmts.appendOperation.run(op.operationId, op.deviceId, op.entityType, op.entityId, op.action, op.baseVersion, "accepted", payloadJson, now, principal.userId);
      const sequence = Number(inserted.lastInsertRowid);
      const result = { operationId: op.operationId, outcome: "accepted", sequence, version: nextVersion };
      stmts.saveOperationResponse.run(JSON.stringify(result), op.operationId);
      db.exec("COMMIT"); events.emit("change", sequence);
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* already committed before reporting a conflict */ }
      throw error;
    }
  }
  function auth(request) {
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!supplied) return null;
    const currentOperators = loadOperators();
    if (!validOperators(currentOperators)) return null;
    const operator = currentOperators.find((candidate) => safeEqual(supplied, candidate.token));
    if (!operator || operator.disabled || Date.parse(operator.expiresAt) <= Date.now()) return null;
    return { userId: operator.userId, role: operator.role };
  }
  async function serveStatic(request, response) {
    const root = resolve(webRoot);
    const pathname = decodeURIComponent(new URL(request.url, "http://coordinator").pathname);
    const requested = pathname === "/" ? "index.html" : normalize(pathname).replace(/^([/\\]|\.\.(?:[/\\]|$))+/, "");
    let file = resolve(join(root, requested));
    if (!file.startsWith(root + "\\") && !file.startsWith(root + "/") && file !== root) return json(response, 403, { error: "Caminho inválido." });
    try { if (!(await stat(file)).isFile()) throw new Error("not file"); }
    catch {
      file = join(root, "index.html");
      if (!existsSync(file)) return json(response, 404, { error: "Aplicação não compilada. Execute npm run build antes de iniciar o coordenador." });
    }
    response.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": extname(file) === ".html" ? "no-cache" : "public, max-age=31536000, immutable" });
    createReadStream(file).pipe(response);
  }
  if (Boolean(tlsCert) !== Boolean(tlsKey)) throw new Error("Configure juntos CONNECT_PDM_TLS_CERT e CONNECT_PDM_TLS_KEY.");
  const handler = async (request, response) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
      response.setHeader("access-control-allow-headers", "authorization, content-type");
      response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    }
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    const url = new URL(request.url, "http://coordinator");
    if (url.pathname === "/api/health" && request.method === "GET") { json(response, 200, { status: "ok" }); return; }
    if (!url.pathname.startsWith("/api/")) { await serveStatic(request, response); return; }
    const principal = auth(request);
    if (!principal) { json(response, 401, { error: "Identidade inválida, expirada ou desativada." }); return; }
    try {
      if (url.pathname === "/api/operator" && request.method === "GET") {
        json(response, 200, { userId: principal.userId, role: principal.role }); return;
      }
      if (url.pathname === "/api/snapshot" && request.method === "GET") {
        const records = stmts.snapshot.all().map((row) => filterRecord({ entityType: row.entity_type, entityId: row.entity_id, version: row.version, updatedAt: row.updated_at, payload: JSON.parse(row.payload_json) }, principal.role)).filter(Boolean);
        json(response, 200, { parkId, sequence: Number(stmts.maxSequence.get().sequence), records }); return;
      }
      if (url.pathname === "/api/operations" && request.method === "POST") {
        const body = await bodyJson(request);
        const operations = Array.isArray(body.operations) ? body.operations : [body];
        if (!operations.length || operations.length > 100) { json(response, 400, { error: "Envie de 1 a 100 operações por lote." }); return; }
        const results = [];
      for (const op of operations) {
          try { results.push(processOperation(op, principal)); }
          catch (error) { results.push({ operationId: op?.operationId, outcome: error.status === 409 ? "conflict" : "rejected", error: error.message, ...(error.conflictId ? { conflictId: error.conflictId } : {}) }); }
        }
        json(response, results.some((item) => item.outcome === "conflict" || item.outcome === "rejected") ? 207 : 200, { results }); return;
      }
      if (url.pathname === "/api/operations/adopt" && request.method === "POST") {
        const body = await bodyJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body) || !body.operation) {
          json(response, 400, { error: "Informe a operacao offline que sera assumida pelo operador autenticado." }); return;
        }
        const result = processOperation(body.operation, principal);
        json(response, 200, { result }); return;
      }
      if (url.pathname === "/api/changes" && request.method === "GET") {
        const since = Math.max(0, Number(url.searchParams.get("since") || 0));
        if (!Number.isSafeInteger(since)) { json(response, 400, { error: "Cursor inválido." }); return; }
        const changes = stmts.changes.all(since).map((row) => filterRecord({ sequence: row.sequence, operationId: row.operation_id, deviceId: row.device_id, entityType: row.entity_type, entityId: row.entity_id, action: row.action, baseVersion: row.base_version, outcome: row.outcome, payload: JSON.parse(row.payload_json), createdAt: row.created_at, actorUserId: row.actor_user_id }, principal.role)).filter(Boolean);
        json(response, 200, { parkId, changes, sequence: Number(stmts.maxSequence.get().sequence) }); return;
      }
      if (url.pathname === "/api/conflicts" && request.method === "GET") {
        if (principal.role !== "park_manager") { json(response, 403, { error: "Somente o responsável pelo parque pode consultar conflitos." }); return; }
        const conflicts = stmts.conflicts.all().map((row) => ({ id: row.id, operationId: row.operation_id, entityType: row.entity_type, entityId: row.entity_id, deviceId: row.device_id, expectedVersion: row.expected_version, currentVersion: row.current_version, attempted: JSON.parse(row.attempted_json), current: JSON.parse(row.current_json), createdAt: row.created_at }));
        json(response, 200, { conflicts }); return;
      }
      if (url.pathname === "/api/operation-attempts" && request.method === "GET") {
        if (principal.role !== "park_manager") { json(response, 403, { error: "Somente o responsável pelo parque pode consultar tentativas rejeitadas." }); return; }
        const attempts = stmts.operationAttempts.all().map((row) => ({
          id: row.id, operationId: row.operation_id, actorUserId: row.actor_user_id,
          deviceId: row.device_id, reason: row.reason, attempted: JSON.parse(row.attempted_json), createdAt: row.created_at,
        }));
        json(response, 200, { attempts }); return;
      }
      if (url.pathname === "/api/stream" && request.method === "GET") {
        const since = Math.max(0, Number(url.searchParams.get("since") || 0));
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
        response.write(`event: ready\ndata: ${JSON.stringify({ parkId, sequence: Number(stmts.maxSequence.get().sequence) })}\n\n`);
        const listener = (sequence) => { if (!response.destroyed && sequence > since) response.write(`event: change\ndata: ${JSON.stringify({ sequence })}\n\n`); };
        events.on("change", listener);
        const heartbeat = setInterval(() => { if (!response.destroyed) response.write(": heartbeat\n\n"); }, 20000);
        response.on("close", () => { events.off("change", listener); clearInterval(heartbeat); });
        return;
      }
      json(response, 404, { error: "Rota não encontrada." });
    } catch (error) { json(response, error.status || 400, { error: error.message }); }
  };
  const server = tlsCert ? createHttpsServer({ cert: readFileSync(tlsCert), key: readFileSync(tlsKey) }, handler) : createServer(handler);
  return {
    server, db, protocol: tlsCert ? "https" : "http",
    listen() { return new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolveListen(server.address()); }); }); },
    close() { return new Promise((resolveClose, reject) => { server.close((error) => { db.close(); error ? reject(error) : resolveClose(); }); }); },
  };
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const coordinator = createCoordinator();
  const address = await coordinator.listen();
  console.log(`Connect PDM local coordinator listening on ${address.address}:${address.port} for park ${process.env.CONNECT_PDM_PARK_ID}`);
  const stop = async () => { await coordinator.close(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
