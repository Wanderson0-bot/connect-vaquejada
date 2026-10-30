import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("additive migration fails closed for the unvalidated full-state track RPC", async () => {
  const sql = await readFile(new URL("../neon/migrations/202610220013_suspend_unvalidated_track_rpc.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on function public\.apply_event_track_operation\(uuid,uuid,bigint,text,jsonb,text\)[\s\S]*?from public, anon, authenticated/i);
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger[\s\S]*?on public\.event_track_states, public\.event_track_operations from public, anon, authenticated/i);
  assert.match(sql, /accepts caller-supplied full state without action transition validation/i);
  assert.doesNotMatch(sql, /drop\s+(table|column|function)/i, "The stopgap must preserve existing tables, columns and function definition.");
  const serviceRoleSql = await readFile(new URL("../neon/migrations/202610220014_track_service_role_stop.sql", import.meta.url), "utf8");
  assert.match(serviceRoleSql, /revoke all on function public\.apply_event_track_operation[\s\S]*from service_role/i);
  assert.match(serviceRoleSql, /revoke insert, update, delete, truncate, references, trigger[\s\S]*from service_role/i);
});

test("the application has no code path that submits the unsafe full-state RPC", async () => {
  const source = await readFile(new URL("../src/db.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.rpc\(["']apply_event_track_operation["']/i);
  assert.match(source, /syncState: "blocked"/);
  assert.match(source, /state\.syncState !== "blocked"/);
  assert.match(source, /Sincronização remota da pista suspensa/);
});
