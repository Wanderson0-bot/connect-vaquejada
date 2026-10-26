import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/domain.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const domain = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const reportsSource = await readFile(new URL("../src/reports.ts", import.meta.url), "utf8");
const reportsJavascript = ts.transpileModule(reportsSource.replace('from "./domain"', `from "data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}"`), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const reports = await import(`data:text/javascript;base64,${Buffer.from(reportsJavascript).toString("base64")}`);
const backupSource = await readFile(new URL("../src/backup.ts", import.meta.url), "utf8");
const backupJavascript = ts.transpileModule(backupSource.replace('from "./domain"', `from "data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}"`), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const backup = await import(`data:text/javascript;base64,${Buffer.from(backupJavascript).toString("base64")}`);
const permissionsSource = await readFile(new URL("../src/permissions.ts", import.meta.url), "utf8");
const permissionsJavascript = ts.transpileModule(permissionsSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const permissions = await import(`data:text/javascript;base64,${Buffer.from(permissionsJavascript).toString("base64")}`);

const entry = (id, eventId, category, number) => ({ id, eventId, category, number, vaqueiro: id, horse: "", representation: "", paid: false, createdAt: "2026-01-01" });
const result = (id, eventId, entryId, points, status = "official") => ({ id, eventId, entryId, points, status, rodizio: "A", bullNumber: 1, resultType: "points", createdAt: "2026-01-01", createdBy: "operator" });

test("categories only expose the configured list and read legacy single-category events", () => {
  assert.deepEqual(domain.getEventCategories({ categories: ["Amador", "Mirim"] }), ["Amador", "Mirim"]);
  assert.deepEqual(domain.getEventCategories({ category: "Feminina" }), ["Feminina"]);
  assert.equal(domain.isCategoryEnabled({ categories: ["Profissional"] }, "Mirim"), false);
});

test("payment status preserves legacy paid flags and explicit exemption", () => {
  assert.equal(domain.getPaymentStatus({ paid: true }), "paid");
  assert.equal(domain.getPaymentStatus({ paid: false }), "pending");
  assert.equal(domain.getPaymentStatus({ paid: false, paymentStatus: "exempt" }), "exempt");
});

test("announcer and office roles have the access needed for track and result flow without exposing full management", () => {
  assert.equal(permissions.roleAllows("announcer", "track.read"), true);
  assert.equal(permissions.roleAllows("announcer", "result.read"), true);
  assert.equal(permissions.roleAllows("announcer", "result.judge"), true);
  assert.equal(permissions.roleAllows("announcer", "entry.create"), false);
  assert.equal(permissions.roleAllows("office", "entry.create"), true);
  assert.equal(permissions.roleAllows("office", "track.read"), false);
});

test("office filters search ticket and participant fields and combine category payment and status", () => {
  const rows = [entry("a", "event-a", "Profissional", 12), { ...entry("b", "event-a", "Amador", 25), horse: "Lua", representation: "Rancho Verde", paymentStatus: "paid", paid: true }, { ...entry("c", "event-a", "Amador", 30), status: "cancelled", statusReason: "Cancelamento solicitado", cancelledAt: "2026-01-01T00:00:00Z" }];
  assert.deepEqual(domain.filterEntries(rows, { query: "lua", category: "Amador", paymentStatus: "paid", status: "active" }).map((row) => row.id), ["b"]);
  assert.deepEqual(domain.filterEntries(rows, { query: "12" }).map((row) => row.id), ["a"]);
  assert.deepEqual(domain.filterEntries(rows, { status: "cancelled" }).map((row) => row.id), ["c"]);
});

test("provisional totals count confirmed results for the entry's own event only", () => {
  const entries = [entry("a", "event-a", "Profissional", 1), entry("b", "event-a", "Amador", 2)];
  const results = [result("own-1", "event-a", "a", 4), result("own-2", "event-a", "a", 3), result("other-event", "event-b", "a", 100), result("pending", "event-a", "b", 99, "pending"), result("superseded", "event-a", "b", 500, "superseded")];
  assert.deepEqual(domain.calculateProvisionalPoints(entries, results).map(({ entry: e, points }) => [e.id, e.category, points]), [["a", "Profissional", 7], ["b", "Amador", 0]]);
});

test("equal provisional point totals do not use ticket number as a tie-breaker", () => {
  const entries = [entry("ticket-25", "event-a", "Profissional", 25), entry("ticket-10", "event-a", "Profissional", 10)];
  const results = [result("result-25", "event-a", "ticket-25", 8), result("result-10", "event-a", "ticket-10", 8)];
  assert.deepEqual(domain.calculateProvisionalPoints(entries, results).map(({ entry: row }) => row.id), ["ticket-25", "ticket-10"]);
});

test("event status boundaries classify future, active and past dates", () => {
  assert.equal(domain.getEventStatus("2026-10-22", "2026-10-24", "2026-10-21"), "future");
  assert.equal(domain.getEventStatus("2026-10-21", "2026-10-24", "2026-10-21"), "current");
  assert.equal(domain.getEventStatus("2026-10-18", "2026-10-20", "2026-10-21"), "finished");
});

test("ticket capacity handles unlimited and zero-capacity events explicitly", () => {
  assert.equal(domain.hasTicketCapacity(undefined, 500), true);
  assert.equal(domain.hasTicketCapacity(2, 1), true);
  assert.equal(domain.hasTicketCapacity(2, 2), false);
  assert.equal(domain.hasTicketCapacity(0, 0), false);
});

test("ticket reservations expire dynamically and count against event capacity", () => {
  const active = { id: "r1", eventId: "event-a", number: 12, reservedFor: "Puxador", expiresAt: "2026-10-22T12:00:00.000Z", status: "active", createdAt: "2026-10-21T12:00:00.000Z" };
  assert.equal(domain.isReservationActive(active, Date.parse("2026-10-21T12:00:00.000Z")), true);
  assert.equal(domain.getReservationStatus(active, Date.parse("2026-10-23T12:00:00.000Z")), "expired");
  assert.equal(domain.validateEventRevision({ id: "event-a", name: "Vaquejada", location: "", date: "2026-10-21", categories: ["Profissional"], ticketQuantity: 2, scoringMode: "instant", createdAt: "2026-10-21" }, [{ category: "Profissional" }], 1), null);
  assert.match(domain.validateEventRevision({ id: "event-a", name: "Vaquejada", location: "", date: "2026-10-21", categories: ["Profissional"], ticketQuantity: 1, scoringMode: "instant", createdAt: "2026-10-21" }, [{ category: "Profissional" }], 1), /inscrições e reservas/);
});

test("event edits preserve categories used by entries and issued ticket capacity", () => {
  const event = { id: "event-a", name: "Vaquejada", location: "Parque", date: "2026-10-21", endsAt: "2026-10-22", categories: ["Profissional", "Amador"], ticketQuantity: 3, scoringMode: "instant", createdAt: "2026-10-01" };
  assert.equal(domain.validateEventRevision(event, [{ category: "Profissional" }, { category: "Amador" }]), null);
  assert.match(domain.validateEventRevision({ ...event, categories: ["Profissional"] }, [{ category: "Amador" }]), /categoria que já possui inscrições/);
  assert.match(domain.validateEventRevision({ ...event, ticketQuantity: 1 }, [{ category: "Profissional" }, { category: "Amador" }]), /abaixo das inscrições/);
  assert.match(domain.validateEventRevision({ ...event, endsAt: "2026-10-20" }, []), /data final/);
});

test("entry cancellation keeps its history and removes it from standings", () => {
  const active = entry("entry-a", "event-a", "Profissional", 4);
  const cancelled = domain.cancelEntryRecord(active, "Solicitação do participante", "2026-10-21T12:00:00.000Z", "Operador");
  assert.equal(domain.getEntryStatus(cancelled), "cancelled");
  assert.equal(cancelled.number, active.number);
  assert.equal(cancelled.statusReason, "Solicitação do participante");
  assert.deepEqual(domain.calculateProvisionalPoints([active, cancelled], [result("r1", "event-a", "entry-a", 7)]).map(({ entry: row }) => row.id), ["entry-a"]);
  assert.throws(() => domain.cancelEntryRecord(cancelled, "Outro motivo valido", "2026-10-21T13:00:00.000Z", "Operador"), /Somente inscrições ativas/);
  assert.throws(() => domain.cancelEntryRecord(active, "Curto", "2026-10-21T12:00:00.000Z", "Operador"), /10 caracteres/);
});

test("ticket transfers change participant data without changing the ticket identity", () => {
  const active = entry("entry-a", "event-a", "Profissional", 4);
  const moved = domain.transferEntryRecord(active, { vaqueiro: "Novo puxador", horse: "Novo cavalo", representation: "Novo rancho", category: "Amador" }, "Transferência solicitada", "2026-10-21T12:00:00.000Z", "Operador");
  assert.equal(moved.id, active.id);
  assert.equal(moved.number, active.number);
  assert.equal(moved.eventId, active.eventId);
  assert.equal(moved.category, "Amador");
  assert.equal(moved.transferReason, "Transferência solicitada");
  assert.throws(() => domain.transferEntryRecord(active, { vaqueiro: "Outro", horse: "", representation: "", category: "Profissional" }, "Curto", "2026-10-21T12:00:00.000Z", "Operador"), /10 caracteres/);
});

test("entry drafts require vaqueiro but keep horse, representation and partner optional", () => {
  assert.equal(domain.validateEntryDraft({ vaqueiro: "", partner: "", horse: "", representation: "" }), "Informe o vaqueiro da inscrição.");
  assert.equal(domain.validateEntryDraft({ vaqueiro: "João", partner: "", horse: "", representation: "" }), null);
  assert.equal(domain.validateEntryDraft({ vaqueiro: "João", partner: "Maria", horse: "Rubi", representation: "Rancho Vale" }), null);
});

test("offline queue overlays snapshots idempotently and orders parent records first", () => {
  const created = domain.overlayQueuedRecord("event.create", [], { id: "event-a", name: "Evento" });
  assert.deepEqual(domain.overlayQueuedRecord("event.create", created, { id: "event-a", name: "Evento" }), created);
  const paid = domain.overlayQueuedRecord("entry.payment", [{ id: "entry-a", paid: false }], { id: "entry-a", paid: true, paymentStatus: "paid" });
  assert.deepEqual(paid, [{ id: "entry-a", paid: true, paymentStatus: "paid" }]);
  const confirmed = domain.overlayQueuedRecord("result.confirm", [{ id: "result-a", status: "pending" }], { id: "result-a" });
  assert.equal(confirmed[0].status, "official");
  const queue = [
    { id: "confirm", kind: "result.confirm", createdAt: "2026-10-21T00:00:00.000Z" },
    { id: "cancel", kind: "entry.cancel", createdAt: "2026-10-21T00:00:00.003Z", entryId: "entry-a" },
    { id: "payment", kind: "entry.payment", createdAt: "2026-10-21T00:00:00.001Z", entryId: "entry-a" },
    { id: "transfer", kind: "entry.transfer", createdAt: "2026-10-21T00:00:00.002Z", entryId: "entry-a" },
    { id: "entry", kind: "entry.create", createdAt: "2026-10-21T00:00:00.000Z" },
    { id: "event", kind: "event.create", createdAt: "2026-10-21T00:00:00.000Z" },
  ].sort(domain.compareOfflineOperations);
  assert.deepEqual(queue.map(({ id }) => id), ["event", "entry", "payment", "transfer", "cancel", "confirm"]);
});

test("result confirmation only changes pending results and preserves the sporting record", () => {
  const pending = result("result-1", "event-a", "entry-a", 6, "pending");
  assert.deepEqual(domain.confirmPendingResult(pending), { ...pending, status: "official" });
  assert.throws(() => domain.confirmPendingResult({ ...pending, status: "official" }), /pendentes/);
});

test("CSV labels provisional totals, excludes pending points, and escapes spreadsheet input", () => {
  const event = { id: "event-a", name: '=CMD("x")', location: "Parque", date: "2026-10-21", categories: ["Profissional", "Amador"], scoringMode: "instant", createdAt: "2026-10-01" };
  const entries = [entry("p1", "event-a", "Profissional", 1), entry("p2", "event-a", "Profissional", 2), entry("a1", "event-a", "Amador", 3)];
  const results = [result("p1-official", "event-a", "p1", 8), result("p1-pending", "event-a", "p1", 100, "pending"), result("a1-official", "event-a", "a1", 8)];
  const csv = reports.buildEventReportCsv(event, entries, results);
  assert.match(csv, /"'=CMD\(""x""\)"/);
  assert.match(csv, /"PROVISÓRIA — classificação oficial bloqueada/);
  assert.match(csv, /"USO INTERNO: este relatório contém dados de inscrição e pagamento/);
  assert.match(csv, /"Posição oficial \(não calculada\)"/);
  assert.match(csv, /"Soma de pontos registrados \(provisória\)"/);
  assert.doesNotMatch(csv, /Classificação na categoria/);
  assert.match(csv, /"1";"Profissional";"Ativa";"p1"/);
  assert.match(csv, /"3";"Amador";"Ativa";"a1"/);
  assert.match(csv, /"1";"Profissional";"Ativa";"p1".*;"1";"";"";""\r\n/s);
  assert.doesNotMatch(csv, /"100\.00"/);
  const restrictedCsv = reports.buildEventReportCsv(event, [{ ...entries[0], paymentRestricted: true, paid: false, paidAmount: 0 }], []);
  assert.match(restrictedCsv, /"Restrito";"";""/);
  const cancelled = { ...entry("cancelled-1", "event-a", "Profissional", 8), status: "cancelled", statusReason: "Desistência solicitada", cancelledAt: "2026-10-21T12:00:00.000Z" };
  const reportWithCancellation = reports.buildEventReportCsv(event, [...entries, cancelled], results);
  assert.match(reportWithCancellation, /"8";"Profissional";"Cancelada"/);
  assert.match(reportWithCancellation, /"Desistência solicitada"/);
  const moved = { ...entry("moved-1", "event-a", "Profissional", 9), transferReason: "Transferência autorizada", transferredAt: "2026-10-21T13:00:00.000Z", transferredBy: "Operador" };
  assert.match(reports.buildEventReportCsv(event, [...entries, moved], results), /"Transferência autorizada"/);
});

test("backup parser accepts valid linked data and rejects broken references and ticket collisions", () => {
  const event = { id: "event-a", name: "Vaquejada", location: "Parque", date: "2026-10-21", categories: ["Profissional"], scoringMode: "instant", createdAt: "2026-10-01" };
  const entryA = entry("entry-a", "event-a", "Profissional", 1);
  const cancelledEntry = { ...entry("cancelled", "event-a", "Profissional", 2), status: "cancelled", statusReason: "Solicitação do participante", cancelledAt: "2026-10-21T12:00:00.000Z", cancelledBy: "Operador local" };
  const transferredEntry = { ...entry("transferred", "event-a", "Profissional", 3), transferReason: "Transferência autorizada", transferredAt: "2026-10-21T12:00:00.000Z", transferredBy: "Operador local" };
  const entryB = entry("entry-b", "event-a", "Profissional", 1);
  const audit = [{ id: "audit-1", eventId: "event-a", recordTable: "entries", recordId: "entry-a", action: "INSERT", actorUserId: null, actorLabel: "Operador local", beforeData: null, afterData: { vaqueiro: "entry-a" }, occurredAt: "2026-10-21T12:00:00.000Z" }];
  const valid = backup.serializeBackup([event], [entryA], [result("result-a", "event-a", "entry-a", 5)], audit);
  assert.equal(backup.parseBackup(valid).results[0].entryId, "entry-a");
  assert.equal(backup.parseBackup(valid).audit[0].actorLabel, "Operador local");
  const activeReservation = { id: "reservation-a", eventId: "event-a", number: 8, reservedFor: "Participante", expiresAt: "2027-01-01T12:00:00.000Z", status: "active", createdAt: "2026-10-21T12:00:00.000Z" };
  assert.equal(backup.parseBackup(backup.serializeBackup([event], [entryA], [], [], [activeReservation])).reservations[0].number, 8);
  assert.throws(() => backup.parseBackup(backup.serializeBackup([event], [entryA], [], [], [{ ...activeReservation, number: 1 }])), /senha ativa duplicada/);
  assert.equal(backup.parseBackup(backup.serializeBackup([event], [cancelledEntry], [])).entries[0].status, "cancelled");
  assert.equal(backup.parseBackup(backup.serializeBackup([event], [transferredEntry], [])).entries[0].transferReason, "Transferência autorizada");
  assert.throws(() => backup.parseBackup(backup.serializeBackup([event], [{ ...transferredEntry, transferReason: "Curto" }], [])), /transferência da inscrição precisa/);
  assert.throws(() => backup.parseBackup(backup.serializeBackup([event], [{ ...cancelledEntry, statusReason: "curto" }], [])), /motivo e horário válidos/);
  assert.throws(() => backup.parseBackup(backup.serializeBackup([event], [cancelledEntry], [result("cancelled-result", "event-a", "cancelled", 3)])), /inscrição cancelada/);
  const corrected = backup.parseBackup(backup.serializeBackup([event], [entryA], [
    { ...result("old-result", "event-a", "entry-a", 2, "superseded"), correctionReason: "Pontuação digitada incorretamente", supersededBy: "new-result" },
    result("new-result", "event-a", "entry-a", 5),
  ]));
  assert.equal(corrected.results[0].supersededBy, "new-result");
  assert.throws(() => backup.parseBackup(backup.serializeBackup([event], [entryA], [result("result-b", "event-a", "missing-entry", 5)])), /referencia uma inscrição/);
  assert.throws(() => backup.parseBackup(backup.serializeBackup([event], [entryA, entryB], [])), /números de senha repetidos/);
  assert.throws(() => backup.parseBackup(backup.serializeBackup([event], [entryA], [result("old-result", "event-a", "entry-a", 5, "superseded")])), /não possui justificativa/);
  assert.throws(() => backup.parseBackup(backup.serializeBackup([{ ...event, categories: [] }], [], [])), /categoria inválida/);
  assert.throws(() => backup.parseBackup(backup.serializeBackup([event], [{ ...entryA, paid: true, paymentStatus: "pending" }], [])), /incompatíveis/);
  assert.throws(() => backup.parseBackup("{}"), /Formato ou versão/);
});

test("Brazilian Portuguese text survives JSON backup and CSV UTF-8 round trips", () => {
  const event = { id: "utf8-event", name: "Vaquejada São João d'Água", location: "Açude do Coração", date: "2026-10-21", categories: ["Profissional"], scoringMode: "instant", createdAt: "2026-10-01" };
  const participant = { ...entry("utf8-entry", "utf8-event", "Profissional", 42), vaqueiro: "João Gonçalves", horse: "Maçã de São José", representation: "Rancho Coração" };
  const serialized = backup.serializeBackup([event], [participant], []);
  const utf8RoundTrip = Buffer.from(serialized, "utf8").toString("utf8");
  const restored = backup.parseBackup(utf8RoundTrip);
  assert.equal(restored.events[0].name, "Vaquejada São João d'Água");
  assert.equal(restored.entries[0].vaqueiro, "João Gonçalves");
  const csv = reports.buildEventReportCsv(event, [participant], []);
  assert.match(csv, /Vaquejada São João d'Água/);
  assert.match(csv, /João Gonçalves/);
  assert.match(csv, /Maçã de São José/);
  assert.equal(Buffer.from(csv, "utf8").toString("utf8"), csv);
});

test("competition schedule is configurable for one, two, or three days and custom rotation order", () => {
  for (const count of [1, 2, 3]) {
    const days = Array.from({ length: count }, (_, index) => ({ id: `day-${index + 1}`, date: `2026-10-${21 + index}` }));
    const rotations = [...days].reverse().map((day, index) => ({ id: `rot-${index + 1}`, name: `Etapa ${index + 1}`, dayId: day.id, order: index + 1, callOrder: "ticket-asc" }));
    assert.equal(domain.validateCompetitionConfig({ days, rotations, callWindowSeconds: 60 }), null);
    assert.deepEqual(rotations.map((rotation) => rotation.dayId), days.map((_, index) => `day-${count - index}`));
  }
});

test("more than three entries per vaqueiro remain independent and consecutive tickets can run together", () => {
  const entries = [8, 9, 14, 18].map((number) => ({ id: `e${number}`, eventId: "event-a", number, vaqueiro: "Mesmo vaqueiro", status: "active", paid: true }));
  const queue = domain.buildRotationQueue(entries, { id: "one", name: "Etapa manhã", dayId: "d1", order: 1, callOrder: "ticket-asc", ticketRange: { from: 8, to: 9 }, capacity: 2 });
  assert.deepEqual(queue.eligible.map(({ number }) => number), [8, 9]);
  assert.deepEqual(queue.deferred.map(({ number }) => number), [14, 18]);
  assert.equal(entries.length, 4);
});

test("a later ticket stays queued when the configured interval or capacity excludes it", () => {
  const entries = [
    { id: "e10", eventId: "event-a", number: 10, vaqueiro: "Dupla A", status: "active", paid: true },
    { id: "e25", eventId: "event-a", number: 25, vaqueiro: "Dupla A", status: "active", paid: true },
  ];
  const first = domain.buildRotationQueue(entries, { id: "r1", name: "Primeira", dayId: "d1", order: 1, callOrder: "ticket-asc", ticketRange: { from: 1, to: 20 }, capacity: 1 });
  assert.deepEqual(first.eligible.map(({ number }) => number), [10]);
  assert.deepEqual(first.deferred.map(({ number }) => number), [25]);
  const second = domain.buildRotationQueue(entries, { id: "r2", name: "Segunda", dayId: "d2", order: 2, callOrder: "ticket-asc", ticketRange: { from: 21 }, capacity: 4 }, ["e10"]);
  assert.deepEqual(second.eligible.map(({ number }) => number), [25]);
});

test("queue preserves each entry identity and excludes previously called tickets", () => {
  const entries = [8, 9].map((number) => ({ id: `e${number}`, eventId: "event-a", number, vaqueiro: "Mesmo vaqueiro", status: "active", paid: true }));
  const queue = domain.buildRotationQueue(entries, { id: "r", name: "X", dayId: "d", order: 1, callOrder: "ticket-asc" }, ["e8"]);
  assert.deepEqual(queue.eligible.map(({ id, number }) => [id, number]), [["e9", 9]]);
});

test("one-minute no-show waits for configured window, moves to tail, and is idempotent", () => {
  const call = domain.recordCall({ id: "call1", operationId: "call-op", eventId: "event-a", entryId: "e1", rotationId: "r1", position: 1, calledAt: "2026-10-22T12:00:00.000Z", operator: "Mesa", reason: "" });
  assert.deepEqual(domain.appendCall([call], { ...call, status: undefined }), [call]);
  assert.throws(() => domain.recordNoShow(call, "2026-10-22T12:00:59.999Z", 60, "Operador"), /prazo/);
  const absent = domain.recordNoShow(call, "2026-10-22T12:01:00.000Z", 60, "Operador");
  assert.equal(absent.status, "absent");
  assert.equal(absent.absenceBy, "Operador");
  assert.equal(domain.DEFAULT_CALL_WINDOW_SECONDS, 60);
  const other = { ...call, id: "call2", entryId: "e2", position: 2 };
  const moved = domain.moveNoShowToTail(absent, [absent, other], "move-op", "Operador", "Não compareceu no prazo", "2026-10-22T12:01:01.000Z");
  assert.equal(moved[0].status, "deferred");
  assert.equal(moved[0].movedFrom, 1);
  assert.equal(moved[0].movedTo, 3);
  assert.equal(moved[0].entryId, "e1");
  assert.equal(moved[0].id, "call1");
  assert.deepEqual(domain.moveNoShowToTail(absent, moved, "move-op", "Operador", "Não compareceu no prazo", "2026-10-22T12:01:02.000Z"), moved);
  assert.throws(() => domain.moveNoShowToTail(absent, moved, "different-op", "Operador", "Outra vez", "2026-10-22T12:01:03.000Z"), /já foi movida/);
});

test("new races start pending and validate transitions including zero and explicit return decision", () => {
  const race = domain.createRace({ id: "race1", eventId: "event-a", entryId: "e1", rotationId: "r1", raceNumber: 1 }, "2026-10-22T12:00:00Z");
  assert.equal(race.status, "pending");
  const running = domain.transitionRace(race, "running", "Julgador", undefined, "2026-10-22T12:00:30Z");
  const raced = domain.transitionRace(running, "raced", "Julgador", undefined, "2026-10-22T12:01:00Z");
  const zero = domain.transitionRace(raced, "zero", "Julgador", "Ocorrência registrada", "2026-10-22T12:02:00Z");
  assert.equal(zero.status, "zero");
  assert.throws(() => domain.transitionRace(zero, "pending", "Julgador"), /inválida/);
  const requested = domain.transitionRace(running, "return_requested", "Julgador", "Nova apresentação solicitada");
  assert.throws(() => domain.transitionRace(requested, "return_authorized", "Julgador"), /justificativa/);
  const authorized = domain.transitionRace(requested, "return_authorized", "Comissão", "Autorizado pela comissão");
  assert.equal(authorized.status, "return_authorized");
  assert.equal(authorized.id, race.id);
});

test("race transitions append actor, old/new states, and remain idempotent", () => {
  const race = domain.createRace({ id: "race-h", eventId: "event-a", entryId: "e1", rotationId: "r1", raceNumber: 1 });
  assert.deepEqual(domain.appendRace([race], { id: race.id, eventId: race.eventId, entryId: race.entryId, rotationId: race.rotationId, raceNumber: race.raceNumber }), [race]);
  const running = domain.transitionRace(race, "running", "Julgador");
  const applied = domain.applyRaceTransition(running, "raced", [], "op-1", "Julgador", undefined, "2026-10-22T12:00:00Z");
  assert.equal(applied.history[0].from, "running");
  assert.equal(applied.history[0].to, "raced");
  assert.equal(applied.history[0].operator, "Julgador");
  assert.deepEqual(domain.applyRaceTransition(applied.race, "raced", applied.history, "op-1", "Julgador"), applied);
  assert.throws(() => domain.applyRaceTransition(applied.race, "zero", applied.history, "op-1", "Julgador"), /outra transição/);
});

test("client-side scoring flags cannot approve official classification", () => {
  assert.equal(domain.officialClassificationReadiness(undefined).ready, false);
  assert.match(domain.officialClassificationReadiness(undefined).reason, /servidor/);
  assert.equal(domain.officialClassificationReadiness({ scoring: { approved: true, pointsByDistance: { "50": 10 } } }).ready, false);
  assert.equal(domain.officialClassificationReadiness({ scoring: { approved: true, pointsByDistance: { "50": 10 }, tieBreakers: { approved: true, rules: "Critérios da comissão" }, regulationDecisionId: "client-supplied" } }).ready, false);
  assert.equal(domain.officialClassificationReadiness({ scoring: { approved: true, pointsByDistance: { "50": 10 }, tieBreakers: { approved: true, rules: "Critérios da comissão" }, bonus: { enabled: true, points: 5, conditions: "", approved: false } } }).ready, false);
});
