import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createCoordinator } from "../coordinator/server.mjs";
import { createCoordinatorBackup, restoreCoordinatorBackup, verifyCoordinatorBackup } from "../coordinator/backup.mjs";

test("online SQLite backup verifies integrity and restores operations, versions, conflicts and audit data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "connect-pdm-backup-"));
  const databasePath = join(directory, "coordinator.sqlite");
  const backupPath = join(directory, "backups", "event.sqlite");
  const restoredPath = join(directory, "restored", "coordinator.sqlite");
  const token = "backup-test-token-with-at-least-32-characters";
  const secondToken = "backup-second-token-with-at-least-32-characters";
  const operators = [
    { userId: "9f05e57e-0c89-47a8-8456-9ae3a09ba77d", token, role: "park_manager", expiresAt: new Date(Date.now() + 3600000).toISOString(), disabled: false },
    { userId: "36cab849-210a-4d24-95b0-4df4294cb573", token: secondToken, role: "park_manager", expiresAt: new Date(Date.now() + 3600000).toISOString(), disabled: false },
  ];
  await mkdir(join(directory, "backups"));
  await mkdir(join(directory, "restored"));
  let coordinator = createCoordinator({ dbPath: databasePath, operators, parkId: "backup-park", host: "127.0.0.1", port: 0, webRoot: directory });
  const address = await coordinator.listen();
  let base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await coordinator.close(); await rm(directory, { recursive: true, force: true }); });
  const send = (operation, authToken = token, serverUrl = base) => fetch(`${serverUrl}/api/operations`, {
    method: "POST",
    body: JSON.stringify(operation),
    headers: { authorization: `Bearer ${authToken}`, "content-type": "application/json" },
  });

  const event = { id: "backup-event", eventId: "backup-event", name: "Evento fictício", categories: ["Profissional"], parkId: "backup-park" };
  const createEvent = { operationId: "backup-event-create", deviceId: "laptop", entityType: "events", entityId: event.id, action: "create", baseVersion: 0, payload: event };
  const accepted = (await (await send(createEvent)).json()).results[0];
  assert.equal(accepted.outcome, "accepted");
  const entry = { id: "backup-entry", eventId: event.id, number: 7, vaqueiro: "Pessoa fictícia", category: "Profissional" };
  const createEntry = { operationId: "backup-entry-create", deviceId: "tablet", entityType: "entries", entityId: entry.id, action: "create", baseVersion: 0, payload: entry };
  assert.equal((await (await send(createEntry)).json()).results[0].outcome, "accepted");
  const staleEvent = { ...createEvent, operationId: "backup-event-conflict", action: "update", baseVersion: 0, payload: { ...event, name: "Conflito preservado" } };
  assert.equal((await (await send(staleEvent, secondToken)).json()).results[0].outcome, "conflict");
  const alteredReplay = { ...createEvent, payload: { ...event, name: "Reuso indevido" } };
  assert.equal((await (await send(alteredReplay)).json()).results[0].outcome, "rejected");

  const manifest = await createCoordinatorBackup(databasePath, backupPath, "0.1.0-test");
  assert.equal(manifest.integrity, "ok");
  assert.equal(manifest.foreignKeyViolations, 0);
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.counts, { records: 2, operations: 3, conflicts: 1, operation_attempts: 1, schema_migrations: 2 });
  assert.deepEqual(await verifyCoordinatorBackup(backupPath), manifest);
  await assert.rejects(createCoordinatorBackup(databasePath, backupPath, "0.1.0-test"), /destino.*existe/i);

  const restored = await restoreCoordinatorBackup(backupPath, restoredPath);
  assert.equal(restored.counts.operations, 3);
  assert.equal(restored.schemaVersion, 2);
  await assert.rejects(restoreCoordinatorBackup(backupPath, restoredPath), /already exists|EEXIST/i);

  await coordinator.close();
  coordinator = createCoordinator({ dbPath: restoredPath, operators, parkId: "backup-park", host: "127.0.0.1", port: 0, webRoot: directory });
  const restoredAddress = await coordinator.listen();
  base = `http://127.0.0.1:${restoredAddress.port}`;
  const headers = { authorization: `Bearer ${token}` };
  const snapshot = await (await fetch(`${base}/api/snapshot`, { headers })).json();
  assert.equal(snapshot.records.find((record) => record.entityId === event.id).version, 1);
  assert.equal(snapshot.records.find((record) => record.entityId === entry.id).payload.vaqueiro, "Pessoa fictícia");
  assert.equal((await (await fetch(`${base}/api/conflicts`, { headers })).json()).conflicts.length, 1);
  assert.equal((await (await fetch(`${base}/api/operation-attempts`, { headers })).json()).attempts.length, 1);
  assert.deepEqual((await (await send(createEvent)).json()).results[0], accepted);

  const newEntry = { ...entry, id: "entry-after-restore", number: 8 };
  const postRestoreWrite = { ...createEntry, operationId: "entry-after-restore-op", entityId: newEntry.id, payload: newEntry };
  assert.equal((await (await send(postRestoreWrite)).json()).results[0].version, 1);
  await coordinator.close();
  coordinator = createCoordinator({ dbPath: restoredPath, operators, parkId: "backup-park", host: "127.0.0.1", port: 0, webRoot: directory });
  const restarted = await coordinator.listen();
  const restartedBase = `http://127.0.0.1:${restarted.port}`;
  assert.equal((await (await fetch(`${restartedBase}/api/snapshot`, { headers })).json()).records.some((record) => record.entityId === newEntry.id), true);

  const corruptedPath = join(directory, "corrupted.sqlite");
  await copyFile(backupPath, corruptedPath);
  const corruptedManifest = JSON.parse(await readFile(`${backupPath}.manifest.json`, "utf8"));
  corruptedManifest.databaseFile = "corrupted.sqlite";
  await writeFile(`${corruptedPath}.manifest.json`, JSON.stringify(corruptedManifest));
  const corrupted = await readFile(corruptedPath);
  corrupted[corrupted.length - 1] ^= 1;
  await writeFile(corruptedPath, corrupted);
  await assert.rejects(verifyCoordinatorBackup(corruptedPath), /SHA-256/);

  const protectedDestination = join(directory, "restored", "must-not-be-overwritten.sqlite");
  const sentinel = Buffer.from("existing temporary destination");
  await writeFile(protectedDestination, sentinel);
  await assert.rejects(restoreCoordinatorBackup(corruptedPath, protectedDestination), /SHA-256/);
  assert.deepEqual(await readFile(protectedDestination), sentinel);
});

test("coordinator refuses to open a database schema newer than the application", async () => {
  const directory = await mkdtemp(join(tmpdir(), "connect-pdm-schema-version-"));
  const databasePath = join(directory, "future.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA user_version=3");
  database.close();
  try {
    assert.throws(() => createCoordinator({
      dbPath: databasePath,
      operators: [{ userId: "9f05e57e-0c89-47a8-8456-9ae3a09ba77d", token: "schema-test-token-with-at-least-32-characters", role: "park_manager", expiresAt: new Date(Date.now() + 3600000).toISOString(), disabled: false }],
      parkId: "schema-test", host: "127.0.0.1", port: 0, webRoot: directory,
    }), /versão de esquema mais nova/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
