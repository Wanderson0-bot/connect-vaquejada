import assert from "node:assert/strict";
import test from "node:test";
import { roleAllows } from "../src/permissions.ts";

test("staff roles receive only their scoped application permissions", () => {
  assert.equal(roleAllows("announcer", "result.correct"), false);
  assert.equal(roleAllows("announcer", "entry.update"), false);
  assert.equal(roleAllows("track_operator", "users.manage"), false);
  assert.equal(roleAllows("office", "result.confirm"), false);
  assert.equal(roleAllows("office", "entry.create"), true);
  assert.equal(roleAllows("judge", "result.judge"), true);
  assert.equal(roleAllows("judge", "result.correct"), false);
  assert.equal(roleAllows("platform_admin", "platform.admin"), true);
  assert.equal(roleAllows("platform_admin", "event.manage"), false);
  assert.equal(roleAllows("support", "audit.read"), true);
  assert.equal(roleAllows("support", "entry.update"), false);
  assert.equal(roleAllows("deployment", "users.manage"), true);
  assert.equal(roleAllows("office", "platform.admin"), false);
  assert.equal(roleAllows(null, "event.read"), false);
});
