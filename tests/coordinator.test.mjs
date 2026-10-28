import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createCoordinator } from "../coordinator/server.mjs";

test("offline adoption requires an authenticated operator and records validated work under that operator", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "connect-pdm-adoption-"));
  const managerToken = "coordinator-adoption-manager-token-long-enough";
  const officeToken = "coordinator-adoption-office-token-long-enough";
  const managerId = "9f05e57e-0c89-47a8-8456-9ae3a09ba77d";
  const officeId = "36cab849-210a-4d24-95b0-4df4294cb573";
  const coordinator = createCoordinator({
    dbPath: join(directory, "adoption.sqlite"), parkId: "park-adoption", host: "127.0.0.1", port: 0, webRoot: directory,
    operators: [
      { userId: managerId, token: managerToken, role: "park_manager", expiresAt: new Date(Date.now() + 60000).toISOString(), disabled: false },
      { userId: officeId, token: officeToken, role: "office", expiresAt: new Date(Date.now() + 60000).toISOString(), disabled: false },
    ],
  });
  const address = await coordinator.listen();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await coordinator.close(); await rm(directory, { recursive: true, force: true }); });
  const operation = { operationId: "adopt-event-op", deviceId: "offline-device", entityType: "events", entityId: "event-1", action: "create", baseVersion: 0, payload: { id: "event-1", eventId: "event-1", name: "Evento assumido", parkId: "park-adoption" } };
  const request = (token, path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });

  assert.deepEqual(await (await request(officeToken, "/api/operator")).json(), { userId: officeId, role: "office" });
  assert.equal((await request(officeToken, "/api/operations/adopt", { method: "POST", body: JSON.stringify({ operation }) })).status, 403);
  const response = await request(managerToken, "/api/operations/adopt", { method: "POST", body: JSON.stringify({ operation }) });
  assert.equal((await response.json()).result.outcome, "accepted");
  const changes = await (await request(managerToken, "/api/changes?since=0")).json();
  assert.equal(changes.changes[0].actorUserId, managerId);
});

test("coordinator stream notifies authenticated devices about shared record changes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "connect-pdm-stream-"));
  const token = "coordinator-stream-token-with-at-least-32-characters";
  const coordinator = createCoordinator({
    dbPath: join(directory, "stream.sqlite"), parkId: "park-stream", host: "127.0.0.1", port: 0, webRoot: directory,
    operators: [{ userId: "9f05e57e-0c89-47a8-8456-9ae3a09ba77d", token, role: "park_manager", expiresAt: new Date(Date.now() + 60000).toISOString(), disabled: false }],
  });
  const address = await coordinator.listen();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await coordinator.close(); await rm(directory, { recursive: true, force: true }); });
  const stream = await fetch(`${base}/api/stream?since=0`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /event: ready/);

  const operation = { operationId: "stream-event", deviceId: "office", entityType: "events", entityId: "event-1", action: "create", baseVersion: 0, payload: { id: "event-1", eventId: "event-1", name: "Evento compartilhado", parkId: "park-stream" } };
  const response = await fetch(`${base}/api/operations`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(operation) });
  assert.equal((await response.json()).results[0].outcome, "accepted");
  assert.match(decoder.decode((await reader.read()).value), /event: change/);
  await reader.cancel();
});

test("coordinator persists UTF-8 records, enforces operation idempotence and preserves version conflicts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "connect-pdm-coordinator-"));
  const token = "coordinator-test-token-with-at-least-32-characters";
  const otherToken = "other-coordinator-test-token-with-at-least-32-characters";
  const userId = "9f05e57e-0c89-47a8-8456-9ae3a09ba77d";
  const operators = [
    { userId, token, role: "park_manager", expiresAt: new Date(Date.now() + 3600000).toISOString(), disabled: false },
    { userId: "36cab849-210a-4d24-95b0-4df4294cb573", token: otherToken, role: "park_manager", expiresAt: new Date(Date.now() + 3600000).toISOString(), disabled: false },
  ];
  const parkId = "park-test";
  const dbPath = join(directory, "data.sqlite");
  let coordinator = createCoordinator({ dbPath, operators, parkId, host: "127.0.0.1", port: 0, webRoot: directory });
  const address = await coordinator.listen();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await coordinator.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal((await fetch(`${base}/api/snapshot`)).status, 401);
  const createEvent = { operationId: "event-create-op", deviceId: "office-tablet", entityType: "events", entityId: "event-1", action: "create", baseVersion: 0, payload: { id: "event-1", eventId: "event-1", name: "Vaquejada São João d'Água", categories: ["Profissional"], ticketQuantity: 3, scoringMode: "confirm" } };
  let response = await request("/api/operations", { method: "POST", body: JSON.stringify(createEvent) });
  assert.equal(response.status, 200);
  const originalCreateResult = (await response.json()).results[0];
  assert.equal(originalCreateResult.version, 1);
  const invalidEventConfirm = { ...createEvent, operationId: "event-confirm-op", action: "confirm", baseVersion: 1, payload: { ...createEvent.payload, name: "Não deve alterar por confirmação" } };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(invalidEventConfirm) });
  assert.equal((await response.json()).results[0].outcome, "rejected");
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(createEvent) });
  assert.deepEqual((await response.json()).results[0], originalCreateResult);
  const reorderedReplay = { ...createEvent, payload: Object.fromEntries(Object.entries(createEvent.payload).reverse()) };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(reorderedReplay) });
  assert.deepEqual((await response.json()).results[0], originalCreateResult, "JSON object key order must not change operation identity.");
  const alteredReplays = [
    { ...createEvent, deviceId: "another-device" },
    { ...createEvent, baseVersion: 1 },
    { ...createEvent, action: "update" },
    { ...createEvent, entityId: "event-2", payload: { ...createEvent.payload, id: "event-2", eventId: "event-2" } },
    { ...createEvent, payload: { ...createEvent.payload, name: "Payload adulterado" } },
  ];
  for (const alteredReplay of alteredReplays) {
    response = await request("/api/operations", { method: "POST", body: JSON.stringify(alteredReplay) });
    assert.equal((await response.json()).results[0].outcome, "rejected");
  }
  response = await fetch(`${base}/api/operations`, {
    method: "POST", body: JSON.stringify(createEvent),
    headers: { authorization: `Bearer ${otherToken}`, "content-type": "application/json" },
  });
  assert.equal((await response.json()).results[0].outcome, "rejected", "Operation IDs cannot be replayed across users.");
  assert.equal((await (await request("/api/operation-attempts")).json()).attempts.length, 6);
  const unexpectedField = { ...createEvent, role: "park_manager" };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(unexpectedField) });
  assert.equal((await response.json()).results[0].outcome, "rejected");
  assert.equal((await (await request("/api/operation-attempts")).json()).attempts.length, 7);

  const createEntry = { operationId: "entry-create-op", deviceId: "office-tablet", entityType: "entries", entityId: "entry-1", action: "create", baseVersion: 0, payload: { id: "entry-1", eventId: "event-1", number: 17, vaqueiro: "João Gonçalves", category: "Profissional" } };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(createEntry) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].outcome, "accepted");

  const pendingResult = { id: "result-1", eventId: "event-1", entryId: "entry-1", rodizio: "Primeiro", bullNumber: 4, resultType: "clean", points: 10, status: "pending" };
  const createResult = { operationId: "result-create-op", deviceId: "judge-tablet", entityType: "run_results", entityId: pendingResult.id, action: "create", baseVersion: 0, payload: pendingResult };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(createResult) });
  assert.equal((await response.json()).results[0].outcome, "accepted");
  const officialResult = { ...pendingResult, status: "official" };
  const confirmResult = { ...createResult, operationId: "result-confirm-op", action: "confirm", baseVersion: 1, payload: officialResult };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(confirmResult) });
  assert.equal((await response.json()).results[0].outcome, "accepted");
  const illicitEdit = { ...confirmResult, operationId: "result-edit-op", action: "update", baseVersion: 2, payload: { ...officialResult, points: 999 } };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(illicitEdit) });
  assert.equal((await response.json()).results[0].outcome, "rejected");
  const replacement = { ...pendingResult, id: "result-2", points: 8 };
  const correction = { ...confirmResult, operationId: "result-correction-op", baseVersion: 2, action: "correct", payload: { ...officialResult, reason: "Corre\u00e7\u00e3o autorizada pelo julgador", replacement } };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(correction) });
  assert.equal((await response.json()).results[0].outcome, "accepted");

  const reservation = { id: "reservation-1", eventId: "event-1", number: 18, reservedFor: "Jo?o", status: "active", expiresAt: new Date(Date.now() + 60000).toISOString() };
  const reserveOp = { operationId: "reserve-op", deviceId: "office-tablet", entityType: "reservations", entityId: reservation.id, action: "create", baseVersion: 0, payload: reservation };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(reserveOp) });
  assert.equal((await response.json()).results[0].outcome, "accepted");
  const reservedEntry = { id: "entry-2", eventId: "event-1", number: 18, vaqueiro: "Jo?o da Silva", category: "Profissional" };
  const invalidConversion = { ...reserveOp, operationId: "invalid-convert-op", action: "convert", baseVersion: 1, payload: { ...reservation, entry: { ...reservedEntry, number: 19 } } };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(invalidConversion) });
  assert.equal((await response.json()).results[0].outcome, "rejected");
  let currentSnapshot = await (await request("/api/snapshot")).json();
  assert.equal(currentSnapshot.records.find((record) => record.entityId === reservation.id).payload.status, "active");
  assert.equal(currentSnapshot.records.some((record) => record.entityId === "entry-2"), false, "A failed conversion must not leave a partial entry.");
  const convertOp = { ...reserveOp, operationId: "convert-op", action: "convert", baseVersion: 1, payload: { ...reservation, entry: reservedEntry } };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(convertOp) });
  assert.equal((await response.json()).results[0].outcome, "accepted");

  const update = { ...createEvent, operationId: "event-update-op", action: "update", baseVersion: 1, payload: { ...createEvent.payload, name: "Vaquejada São João atualizada" } };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(update) });
  assert.equal((await response.json()).results[0].version, 2);
  const stale = { ...update, operationId: "stale-update-op", payload: { ...update.payload, name: "Outro nome em conflito" } };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(stale) });
  assert.equal(response.status, 207);
  const staleResult = (await response.json()).results[0];
  assert.equal(staleResult.outcome, "conflict");
  assert.equal(staleResult.currentVersion, 2);
  assert.equal(staleResult.current.name, "Vaquejada São João atualizada");
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(stale) });
  assert.deepEqual((await response.json()).results[0], staleResult, "A lost conflict response must be recoverable by retry.");

  const concurrentEvent = { ...createEvent, operationId: "concurrent-event-op", entityId: "event-concurrent", payload: { id: "event-concurrent", eventId: "event-concurrent", name: "Evento concorrente" } };
  response = await request("/api/operations", { method: "POST", body: JSON.stringify(concurrentEvent) });
  assert.equal((await response.json()).results[0].outcome, "accepted");
  const concurrentUpdates = ["Tablet A", "Tablet B"].map((name) => ({
    ...concurrentEvent, operationId: `concurrent-update-${name.at(-1)}`, deviceId: name,
    action: "update", baseVersion: 1, payload: { ...concurrentEvent.payload, name },
  }));
  const concurrentResponses = await Promise.all(concurrentUpdates.map((operation, index) => fetch(`${base}/api/operations`, {
    method: "POST", body: JSON.stringify(operation),
    headers: { authorization: `Bearer ${index === 0 ? token : otherToken}`, "content-type": "application/json" },
  })));
  const concurrentResults = await Promise.all(concurrentResponses.map(async (item) => (await item.json()).results[0]));
  assert.deepEqual(concurrentResults.map((item) => item.outcome).sort(), ["accepted", "conflict"]);
  assert.equal(concurrentResults.find((item) => item.outcome === "conflict").currentVersion, 2);
  currentSnapshot = await (await request("/api/snapshot")).json();
  assert.equal(currentSnapshot.records.find((record) => record.entityId === "event-concurrent").version, 2);

  const trackState = { id:"event-1",eventId:"event-1",version:1,syncState:"pending",rotations:[],calls:[{id:"call-1",operationId:"track-op",eventId:"event-1",entryId:"entry-1",rotationId:"r1",raceId:"race-1",position:1,calledAt:"2026-10-22T12:00:00Z",status:"called"}],races:[{id:"race-1",eventId:"event-1",entryId:"entry-1",rotationId:"r1",ticketNumber:17,status:"official",resultStatus:"official",outcome:"points",resultId:"race-1"}],history:[{id:"track-op",operationId:"track-op",eventId:"event-1",recordType:"call",recordId:"call-1",entryId:"entry-1",rotationId:"r1",action:"call.create",actionPayload:{kind:"call.create"},operator:"Mesa",occurredAt:"2026-10-22T12:00:00Z"}],updatedAt:"2026-10-22T12:00:00Z" };
  const trackOperation = { operationId:"track-state-op",deviceId:"track-tablet",entityType:"track_states",entityId:"event-1",action:"create",baseVersion:0,payload:trackState };
  response = await request("/api/operations", { method:"POST",body:JSON.stringify(trackOperation) });
  assert.equal((await response.json()).results[0].outcome,"rejected", "The coordinator must fail closed instead of storing caller-authored track snapshots.");
  response = await request("/api/operations", { method:"POST",body:JSON.stringify(trackOperation) });
  assert.equal((await response.json()).results[0].outcome,"rejected");
  const snapshot = await (await request("/api/snapshot")).json();
  assert.equal(snapshot.parkId, parkId);
  assert.equal(snapshot.records.find((record) => record.entityId === "event-1").payload.name, "Vaquejada São João atualizada");
  assert.equal(snapshot.records.find((record) => record.entityId === "entry-1").payload.vaqueiro, "João Gonçalves");
  const conflictList = (await (await request("/api/conflicts")).json()).conflicts;
  assert.equal(conflictList.length, 2);
  const preservedStale = conflictList.find((conflict) => conflict.operationId === stale.operationId);
  assert.equal(preservedStale.attempted.name, "Outro nome em conflito");
  assert.equal(preservedStale.current.name, staleResult.current.name);

  assert.equal(snapshot.records.some((record) => record.entityType === "track_states"),false, "No unvalidated track snapshot is persisted.");
  await coordinator.close();
  coordinator = createCoordinator({ dbPath, operators, parkId, host: "127.0.0.1", port: 0, webRoot: directory });
  const restarted = await coordinator.listen();
  const restartedBase = `http://127.0.0.1:${restarted.port}`;
  const afterRestart = await (await fetch(`${restartedBase}/api/snapshot`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(afterRestart.records.some((record) => record.entityType === "track_states"),false);
  assert.equal(afterRestart.records.find((record) => record.entityId === "entry-1").payload.vaqueiro, "João Gonçalves");
  const replayAfterRestart = await fetch(`${restartedBase}/api/operations`, {
    method: "POST", body: JSON.stringify(createEvent),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  assert.deepEqual((await replayAfterRestart.json()).results[0], originalCreateResult);
  assert.equal((await (await fetch(`${restartedBase}/api/operation-attempts`, { headers: { authorization: `Bearer ${token}` } })).json()).attempts.length, 7);
  await coordinator.close();
  const restoredDbPath = join(directory, "restored.sqlite");
  await copyFile(dbPath, restoredDbPath);
  coordinator = createCoordinator({ dbPath: restoredDbPath, operators, parkId, host: "127.0.0.1", port: 0, webRoot: directory });
  const restoredAddress = await coordinator.listen();
  const restoredBase = `http://127.0.0.1:${restoredAddress.port}`;
  const restoredSnapshot = await (await fetch(`${restoredBase}/api/snapshot`, {
    headers: { authorization: `Bearer ${token}` },
  })).json();
  assert.equal(restoredSnapshot.records.find((record) => record.entityId === "event-1").version, 2);
  assert.equal((await (await fetch(`${restoredBase}/api/conflicts`, {
    headers: { authorization: `Bearer ${token}` },
  })).json()).conflicts.length, 2);
  assert.equal((await (await fetch(`${restoredBase}/api/operation-attempts`, {
    headers: { authorization: `Bearer ${token}` },
  })).json()).attempts.length, 7);
  const replayAfterRestore = await fetch(`${restoredBase}/api/operations`, {
    method: "POST", body: JSON.stringify(createEvent),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  assert.deepEqual((await replayAfterRestore.json()).results[0], originalCreateResult);
});

test("coordinator refuses to expose bearer-token traffic over insecure LAN by default", () => {
  assert.throws(() => createCoordinator({
    dbPath: join(tmpdir(), `connect-pdm-insecure-${Date.now()}.sqlite`),
    operators: [{ userId: "9f05e57e-0c89-47a8-8456-9ae3a09ba77d", token: "coordinator-test-token-with-at-least-32-characters", role: "park_manager", expiresAt: new Date(Date.now() + 3600000).toISOString(), disabled: false }],
    parkId: "park-test", host: "0.0.0.0", port: 0, webRoot: tmpdir(),
  }), /HTTPS é obrigatório/);
});

test("Render PORT takes precedence over the local coordinator port fallback", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "connect-pdm-render-port-"));
  const previousPort = process.env.PORT;
  const previousCoordinatorPort = process.env.CONNECT_PDM_PORT;
  process.env.PORT = "0";
  process.env.CONNECT_PDM_PORT = "8787";
  const coordinator = createCoordinator({
    dbPath: join(directory, "render-port.sqlite"), parkId: "park-render-port", host: "127.0.0.1", webRoot: directory,
    operators: [{ userId: "9f05e57e-0c89-47a8-8456-9ae3a09ba77d", token: "render-port-test-token-with-at-least-32-characters", role: "park_manager", expiresAt: new Date(Date.now() + 60000).toISOString(), disabled: false }],
  });
  t.after(async () => {
    await coordinator.close();
    await rm(directory, { recursive: true, force: true });
    if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
    if (previousCoordinatorPort === undefined) delete process.env.CONNECT_PDM_PORT; else process.env.CONNECT_PDM_PORT = previousCoordinatorPort;
  });
  const address = await coordinator.listen();
  assert.notEqual(address.port, 8787);
  assert.ok(address.port > 0);
});

test("Render TLS termination is explicit and does not bypass operator authentication or CORS allowlists", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "connect-pdm-render-proxy-"));
  const previous = { proxyTls: process.env.CONNECT_PDM_TRUST_PROXY_TLS, origins: process.env.CONNECT_PDM_ALLOWED_ORIGINS, port: process.env.PORT };
  process.env.CONNECT_PDM_TRUST_PROXY_TLS = "true";
  process.env.CONNECT_PDM_ALLOWED_ORIGINS = "https://app.example.test";
  process.env.PORT = "0";
  const coordinator = createCoordinator({
    dbPath: join(directory, "render-proxy.sqlite"), parkId: "park-render-proxy", host: "0.0.0.0", webRoot: directory,
    operators: [{ userId: "9f05e57e-0c89-47a8-8456-9ae3a09ba77d", token: "render-proxy-test-token-with-at-least-32-characters", role: "park_manager", expiresAt: new Date(Date.now() + 60000).toISOString(), disabled: false }],
  });
  t.after(async () => {
    await coordinator.close();
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of [["CONNECT_PDM_TRUST_PROXY_TLS", previous.proxyTls], ["CONNECT_PDM_ALLOWED_ORIGINS", previous.origins], ["PORT", previous.port]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const address = await coordinator.listen();
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal(coordinator.protocol, "http", "TLS terminates outside Node; forwarded headers do not change auth behavior");
  const allowed = await fetch(`${base}/api/operator`, { method: "OPTIONS", headers: { origin: "https://app.example.test" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.test");
  const denied = await fetch(`${base}/api/operator`, { method: "OPTIONS", headers: { origin: "https://other.example.test" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  const unauthenticated = await fetch(`${base}/api/operator`, { headers: { "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1" } });
  assert.equal(unauthenticated.status, 401);
});

test("Render proxy TLS setting does not replace required park or operator configuration", () => {
  const previous = process.env.CONNECT_PDM_TRUST_PROXY_TLS;
  process.env.CONNECT_PDM_TRUST_PROXY_TLS = "true";
  try {
    assert.throws(() => createCoordinator({ parkId: "park-render", operators: [], host: "0.0.0.0", port: 0 }), /credenciais individuais/);
    assert.throws(() => createCoordinator({ parkId: "", operators: [{ userId: "9f05e57e-0c89-47a8-8456-9ae3a09ba77d", token: "render-validation-test-token-with-at-least-32-characters", role: "park_manager", expiresAt: new Date(Date.now() + 60000).toISOString(), disabled: false }], host: "0.0.0.0", port: 0 }), /CONNECT_PDM_PARK_ID/);
  } finally {
    if (previous === undefined) delete process.env.CONNECT_PDM_TRUST_PROXY_TLS; else process.env.CONNECT_PDM_TRUST_PROXY_TLS = previous;
  }
});

test("coordinator backfills replay results for existing SQLite operations", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "connect-pdm-idempotency-migration-"));
  const dbPath = join(directory, "legacy.sqlite");
  const token = "legacy-operation-test-token-with-at-least-32-characters";
  const userId = "9f05e57e-0c89-47a8-8456-9ae3a09ba77d";
  const operators = [{ userId, token, role: "park_manager", expiresAt: new Date(Date.now() + 3600000).toISOString(), disabled: false }];
  const payload = { id: "event-legacy", eventId: "event-legacy", name: "Evento legado", parkId: "park-test" };
  const database = new DatabaseSync(dbPath);
  database.exec(`
    CREATE TABLE records (
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL,
      payload_json TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(entity_type, entity_id)
    );
    CREATE TABLE operations (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL UNIQUE,
      device_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      action TEXT NOT NULL, base_version INTEGER NOT NULL, outcome TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL, actor_user_id TEXT
    );
    CREATE TABLE conflicts (
      id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, device_id TEXT NOT NULL, expected_version INTEGER NOT NULL,
      current_version INTEGER NOT NULL, attempted_json TEXT NOT NULL, current_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  database.prepare("INSERT INTO records VALUES(?,?,?,?,?)").run("events", payload.id, 1, JSON.stringify(payload), new Date().toISOString());
  database.prepare("INSERT INTO operations(operation_id,device_id,entity_type,entity_id,action,base_version,outcome,payload_json,created_at,actor_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("legacy-create-op", "legacy-device", "events", payload.id, "create", 0, "accepted", JSON.stringify(payload), new Date().toISOString(), userId);
  database.close();

  const coordinator = createCoordinator({ dbPath, operators, parkId: "park-test", host: "127.0.0.1", port: 0, webRoot: directory });
  const address = await coordinator.listen();
  t.after(async () => { await coordinator.close(); await rm(directory, { recursive: true, force: true }); });
  const replay = await fetch(`http://127.0.0.1:${address.port}/api/operations`, {
    method: "POST",
    body: JSON.stringify({ operationId: "legacy-create-op", deviceId: "legacy-device", entityType: "events", entityId: payload.id, action: "create", baseVersion: 0, payload }),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  assert.deepEqual((await replay.json()).results[0], { operationId: "legacy-create-op", outcome: "accepted", sequence: 1, version: 1 });
});

test("coordinator binds actions to an individual active role and rejects expired credentials", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "connect-pdm-rbac-"));
  const valid = "office-token-with-more-than-thirty-two-characters";
  const expired = "expired-token-with-more-than-thirty-two-chars";
  const managerToken = "manager-token-with-more-than-thirty-two-chars";
  const announcerToken = "announcer-token-with-more-than-thirty-two-characters";
  const operators = [
    { userId: "6cfecc78-9351-4146-82c0-66dab49c967e", token: valid, role: "office", expiresAt: new Date(Date.now() + 60000).toISOString(), disabled: false },
    { userId: "34f95fe8-a74e-4cd4-99a4-424a9433f49c", token: expired, role: "park_manager", expiresAt: new Date(Date.now() - 1000).toISOString(), disabled: false },
    { userId: "f1826b2d-b878-47e2-adc2-0b7b7824c724", token: managerToken, role: "park_manager", expiresAt: new Date(Date.now() + 60000).toISOString(), disabled: false },
    { userId: "41850d64-89d0-4f55-82d0-868699a70340", token: announcerToken, role: "announcer", expiresAt: new Date(Date.now() + 60000).toISOString(), disabled: false },
  ];
  const coordinator = createCoordinator({ dbPath: join(directory, "auth.sqlite"), operators, parkId: "park-A", host: "127.0.0.1", port: 0, webRoot: directory });
  const address = await coordinator.listen();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await coordinator.close(); await rm(directory, { recursive: true, force: true }); });
  const send = (token, path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });
  assert.equal((await fetch(`${base}/api/snapshot`)).status, 401);
  assert.equal((await send("invalid-token-with-at-least-32-characters", "/api/snapshot")).status, 401);
  assert.equal((await send(expired, "/api/snapshot")).status, 401);
  const eventOp = { operationId: "manager-seed-event", deviceId: "manager-device", entityType: "events", entityId: "event-1", action: "create", baseVersion: 0, payload: { id: "event-1", eventId: "event-1", name: "Evento de teste", parkId: "park-A" } };
  assert.equal((await (await send(managerToken, "/api/operations", { method: "POST", body: JSON.stringify(eventOp) })).json()).results[0].outcome, "accepted");
  const entryOp = { operationId: "manager-seed-entry", deviceId: "manager-device", entityType: "entries", entityId: "entry-1", action: "create", baseVersion: 0, payload: { id: "entry-1", eventId: "event-1", number: 3, vaqueiro: "Teste", paid: true, paidAmount: 200, paymentMethod: "cash" } };
  assert.equal((await (await send(managerToken, "/api/operations", { method: "POST", body: JSON.stringify(entryOp) })).json()).results[0].outcome, "accepted");
  const officeSnapshot = await (await send(valid, "/api/snapshot")).json();
  assert.equal(officeSnapshot.records.find((record) => record.entityId === "entry-1").payload.paidAmount, 200);
  const announcerSnapshot = await (await send(announcerToken, "/api/snapshot")).json();
  assert.equal(announcerSnapshot.records.find((record) => record.entityId === "entry-1").payload.paidAmount, undefined);
  const event = { operationId: "office-event-create", deviceId: "office-device", entityType: "events", entityId: "event-1", action: "create", baseVersion: 0, payload: { id: "event-1", eventId: "event-1", name: "Evento", parkId: "park-A" } };
  const rejected = await (await send(valid, "/api/operations", { method: "POST", body: JSON.stringify(event) })).json();
  assert.equal(rejected.results[0].outcome, "rejected");
  const crossPark = { ...event, operationId: "office-cross-park", payload: { ...event.payload, parkId: "park-B" } };
  assert.equal((await (await send(valid, "/api/operations", { method: "POST", body: JSON.stringify(crossPark) })).json()).results[0].outcome, "rejected");
  const conflicts = await send(valid, "/api/conflicts");
  assert.equal(conflicts.status, 403);
  const operationAttempts = await send(valid, "/api/operation-attempts");
  assert.equal(operationAttempts.status, 403);
  operators[0].disabled = true;
  assert.equal((await send(valid, "/api/snapshot")).status, 401);
});

test("credential file changes revoke coordinator access on the next protected request", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "connect-pdm-revocation-"));
  const credentialFile = join(directory, "operators.json");
  const token = "revocation-test-token-with-at-least-32-characters";
  const roster = [{ userId: "9f05e57e-0c89-47a8-8456-9ae3a09ba77d", token, role: "track_operator", expiresAt: new Date(Date.now() + 60000).toISOString(), disabled: false }];
  await writeFile(credentialFile, JSON.stringify(roster), { mode: 0o600 });
  const coordinator = createCoordinator({ dbPath: join(directory, "data.sqlite"), operatorCredentialsFile: credentialFile, parkId: "park-A", host: "127.0.0.1", port: 0, webRoot: directory });
  const address = await coordinator.listen();
  t.after(async () => { await coordinator.close(); await rm(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${address.port}/api/snapshot`;
  const request = () => fetch(url, { headers: { authorization: `Bearer ${token}` } });

  assert.equal((await request()).status, 200);
  await writeFile(credentialFile, JSON.stringify([{ ...roster[0], disabled: true }]), { mode: 0o600 });
  assert.equal((await request()).status, 401);
  await writeFile(credentialFile, "invalid json", { mode: 0o600 });
  assert.equal((await request()).status, 401);
});
