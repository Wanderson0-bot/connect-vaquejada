import assert from "node:assert/strict";
import test from "node:test";
import * as rules from "../src/domain.ts";

const entry = (number, vaqueiro = "Vaqueiro", eventId = "event-1") => ({ id: `entry-${number}`, eventId, number, vaqueiro, status: "active", paid: true });
const rotation = (overrides = {}) => ({ id: "rotation-1", name: "Etapa configurada", dayId: "day-1", order: 1, callOrder: "ticket-asc", ...overrides });

test("accepts arbitrary one, two, or three competition days and organizer-defined rotation order", () => {
  for (const count of [1, 2, 3]) {
    const days = Array.from({ length: count }, (_, i) => ({ id: `d${i + 1}`, date: `2026-10-${21 + i}`, startsAt: "08:00" }));
    const rotations = days.map((day, i) => rotation({ id: `r${i}`, dayId: day.id, name: `Sessão ${i}`, order: count - i }));
    assert.equal(rules.validateCompetitionConfig({ days, rotations, callWindowSeconds: 60 }), null);
    assert.deepEqual([...rotations].sort((a, b) => a.order - b.order).map((item) => item.name), rotations.slice().reverse().map((item) => item.name));
  }
});

test("permits more than three entries and calls consecutive tickets together when configured", () => {
  const entries = [8, 9, 14, 18].map((number) => entry(number, "Dupla repetida"));
  const result = rules.buildRotationQueue(entries, rotation({ ticketRange: { from: 8, to: 9 }, capacity: 2 }));
  assert.deepEqual(result.eligible.map((item) => item.number), [8, 9]);
  assert.deepEqual(result.deferred.map((item) => item.number), [14, 18]);
  assert.equal(entries.length, 4);
});

test("keeps tickets 10 and 25 tied to distinct entries and can defer ticket 25 to a later interval", () => {
  const entries = [entry(10, "Dupla X"), entry(25, "Dupla X")];
  const first = rules.buildRotationQueue(entries, rotation({ ticketRange: { from: 1, to: 20 }, capacity: 1 }));
  assert.deepEqual(first.eligible.map((item) => item.id), ["entry-10"]);
  assert.deepEqual(first.deferred.map((item) => item.id), ["entry-25"]);
  const next = rules.buildRotationQueue(entries, rotation({ id: "r2", dayId: "day-2", ticketRange: { from: 21 }, capacity: 10 }), ["entry-10"]);
  assert.deepEqual(next.eligible.map((item) => item.id), ["entry-25"]);
  assert.throws(() => rules.buildRotationQueue([...entries, entry(30, "Other", "event-2")], rotation()), /único evento/);
});

test("uses configurable capacity and call ordering, with additional calls only when configured", () => {
  const entries = [entry(1), entry(2), entry(3), entry(4)];
  const capped = rules.buildRotationQueue(entries, rotation({ capacity: 2, additionalCalls: 1, callOrder: "ticket-desc" }));
  assert.deepEqual(capped.eligible.map((item) => item.number), [4, 3, 2]);
  assert.deepEqual(capped.deferred.map((item) => item.number), [1]);
});

test("only paid entries are eligible and repeated calls follow the configured races per entry", () => {
  const paid = entry(1);
  const unpaid = { ...entry(2), paid: false };
  const rotationConfig = rotation({ racesPerEntry: 2 });
  assert.deepEqual(rules.buildRotationQueue([paid, unpaid], rotationConfig).eligible.map((item) => item.id), [paid.id]);
  assert.deepEqual(rules.buildRotationQueue([paid], rotationConfig, [paid.id]).eligible.map((item) => item.id), [paid.id]);
  assert.deepEqual(rules.buildRotationQueue([paid], rotationConfig, [paid.id, paid.id]).eligible, []);
  assert.match(rules.validateCompetitionConfig({ days:[{id:"day-1",date:"2026-10-22"}], rotations:[rotation({dayId:"day-1",racesPerEntry:0})], callWindowSeconds:60 }), /corridas por inscrição/);
});

test("a paid entry can run the configured number of races in its rotation, but no more", () => {
  const config={days:[{id:"day-1",date:"2026-10-22"}],rotations:[rotation({dayId:"day-1",capacity:5,racesPerEntry:2})],callWindowSeconds:60};
  const participant=entry(1);
  let state=rules.createTrackState("event-1",config);
  const run=(action,id)=>{state=rules.applyTrackAction(state,config,action,id,"Operador");};
  const completeRace=(suffix)=>{
    run({kind:"call.create",rotationId:"rotation-1",entry:participant,callId:`call-${suffix}`,raceId:`race-${suffix}`},`create-${suffix}`);
    run({kind:"call.present",callId:`call-${suffix}`},`present-${suffix}`);
    run({kind:"race.start",raceId:`race-${suffix}`},`start-${suffix}`);
    run({kind:"race.judge",raceId:`race-${suffix}`,outcome:"points",points:30},`judge-${suffix}`);
    run({kind:"result.confirm",raceId:`race-${suffix}`},`confirm-${suffix}`);
  };
  completeRace("one");
  assert.deepEqual(rules.buildRotationQueue([participant],config.rotations[0],state.calls.map((call)=>call.entryId)).eligible.map((row)=>row.id),[participant.id]);
  completeRace("two");
  assert.equal(state.races.filter((race)=>race.entryId===participant.id).length,2);
  assert.throws(()=>rules.applyTrackAction(state,config,{kind:"call.create",rotationId:"rotation-1",entry:participant,callId:"call-three",raceId:"race-three"},"create-three","Operador"),/não é elegível/);
});

test("unpaid entries cannot be called even if a caller submits them directly", () => {
  const config={days:[{id:"day-1",date:"2026-10-22"}],rotations:[rotation({dayId:"day-1"})],callWindowSeconds:60};
  const unpaid={...entry(1),paid:false};
  const state=rules.createTrackState("event-1",config);
  assert.throws(()=>rules.applyTrackAction(state,config,{kind:"call.create",rotationId:"rotation-1",entry:unpaid,callId:"call",raceId:"race"},"op","Operador"),/Somente inscrições pagas/);
});

test("records no-show after configured minute and moves to tail once without changing ticket identity", () => {
  const callInput = { id: "call-1", operationId: "call-op", eventId: "event-1", entryId: "entry-8", rotationId: "rotation-1", position: 1, calledAt: "2026-10-22T12:00:00.000Z", operator: "Mesa" };
  const calls = rules.appendCall([], callInput);
  assert.deepEqual(rules.appendCall(calls, callInput), calls);
  assert.equal(rules.DEFAULT_CALL_WINDOW_SECONDS, 60);
  assert.throws(() => rules.recordNoShow(calls[0], "2026-10-22T12:00:59.999Z", 60, "Operador"), /prazo/);
  const absent = rules.recordNoShow(calls[0], "2026-10-22T12:01:00.000Z", 60, "Operador");
  const queued = rules.moveNoShowToTail(absent, [absent, { ...calls[0], id: "call-2", entryId: "entry-9", position: 2 }], "move-op", "Organizador", "Ausente no prazo", "2026-10-22T12:01:01.000Z");
  assert.equal(queued[0].entryId, "entry-8");
  assert.equal(queued[0].movedFrom, 1);
  assert.equal(queued[0].movedTo, 3);
  assert.equal(queued[0].absenceBy, "Operador");
  assert.deepEqual(rules.moveNoShowToTail(absent, queued, "move-op", "Organizador", "Ausente no prazo", "2026-10-22T12:01:02.000Z"), queued);
  assert.throws(() => rules.moveNoShowToTail(absent, queued, "move-again", "Organizador", "Ausente no prazo", "2026-10-22T12:01:03.000Z"), /já foi movida/);
});

test("starts races pending, validates zero/return transitions, and appends idempotent history", () => {
  const input = { id: "race-1", eventId: "event-1", entryId: "entry-8", rotationId: "rotation-1", raceNumber: 1 };
  const races = rules.appendRace([], input, "2026-10-22T12:00:00Z");
  const race = races[0];
  assert.equal(race.status, "pending");
  assert.deepEqual(rules.appendRace(races, input), races);
  const running = rules.transitionRace(race, "running", "Julgador");
  const raced = rules.transitionRace(running, "raced", "Julgador");
  const zero = rules.transitionRace(raced, "zero", "Julgador", "Zero confirmado");
  assert.equal(zero.status, "zero");
  assert.throws(() => rules.transitionRace(zero, "pending", "Julgador"), /inválida/);
  const returned = rules.transitionRace(running, "return_requested", "Julgador", "Solicitada nova apresentação");
  assert.throws(() => rules.transitionRace(returned, "return_authorized", "Comissão"), /justificativa/);
  const applied = rules.applyRaceTransition(running, "raced", [], "transition-op", "Julgador", undefined, "2026-10-22T12:05:00Z");
  assert.equal(applied.history[0].from, "running");
  assert.equal(applied.history[0].to, "raced");
  assert.deepEqual(rules.applyRaceTransition(applied.race, "raced", applied.history, "transition-op", "Julgador"), applied);
});

test("client-configured rules cannot release the official classification block", () => {
  assert.equal(rules.officialClassificationReadiness(undefined).ready, false);
  const approved = { approved: true, pointsByDistance: { "50": 10 }, tieBreakers: { approved: true, rules: "Critérios confirmados pela comissão" } };
  assert.equal(rules.officialClassificationReadiness({ scoring: { approved: true, pointsByDistance: { "50": 10 } } }).ready, false);
  assert.match(rules.officialClassificationReadiness({ scoring: { approved: true, pointsByDistance: { "50": 10 } } }).reason, /servidor/);
  assert.equal(rules.officialClassificationReadiness({ scoring: approved }).ready, false);
  assert.equal(rules.officialClassificationReadiness({ scoring: { ...approved, bonus: { enabled: true, points: 5, conditions: "", approved: false } } }).ready, false);
  assert.match(rules.officialClassificationReadiness({ scoring: { ...approved, bonus: { enabled: true, points: 4, conditions: "Aprovado", approved: true } } }).reason, /servidor/);
});

test("track domain records calls, results, return authorization and rotation history", () => {
  const config = { days:[{id:"day",date:"2026-10-22"}], rotations:[rotation({dayId:"day",ticketRange:{from:8,to:9},capacity:3})], callWindowSeconds:60 };
  const first = entry(8); const second = entry(9);
  let state = rules.createTrackState("event-1",config,"2026-10-22T10:00:00Z");
  const run=(action,id,at="2026-10-22T10:00:00Z")=>{state=rules.applyTrackAction(state,config,action,id,"Operador",at);};
  run({kind:"call.create",rotationId:"rotation-1",entry:first,callId:"call-1",raceId:"race-1"},"call-1","2026-10-22T10:00:00Z");
  assert.equal(state.races[0].status,"pending");
  run({kind:"call.present",callId:"call-1"},"present");
  run({kind:"race.start",raceId:"race-1"},"start");
  run({kind:"race.judge",raceId:"race-1",outcome:"return",occurrence:"Nova apresentação solicitada",distance:12,distanceUnit:"unidade pendente"},"judge");
  assert.equal(state.races[0].distance,12); assert.equal(state.races[0].resultStatus,"pending");
  run({kind:"return.decide",raceId:"race-1",decision:"approved",reason:"Aprovado pela comissão"},"approve");
  run({kind:"return.create_race",raceId:"race-1",newRaceId:"race-2"},"return-race");
  assert.equal(state.races[1].status,"pending");
  assert.throws(()=>rules.applyTrackAction(state,config,{kind:"return.create_race",raceId:"race-1",newRaceId:"race-return-duplicate"},"return-race-again","Operador"),/Já existe uma corrida de retorno/);
  run({kind:"rotation.pause",rotationId:"rotation-1",reason:"Pausa operacional"},"pause");
  assert.throws(()=>rules.applyTrackAction(state,config,{kind:"call.create",rotationId:"rotation-1",entry:second,callId:"call-2",raceId:"race-3"},"blocked-call","Operador"),/pausado/);
  run({kind:"rotation.resume",rotationId:"rotation-1",reason:"Retomada autorizada"},"resume");
  run({kind:"call.create",rotationId:"rotation-1",entry:second,callId:"call-2",raceId:"race-3"},"call-two","2026-10-22T10:01:00Z");
  run({kind:"call.absent",callId:"call-2",reason:"Não compareceu"},"absent","2026-10-22T10:02:00Z");
  const absent=state.calls.find((call)=>call.id==="call-2");
  run({kind:"call.move_tail",callId:"call-2",reason:"Prazo de um minuto encerrado"},"move-tail","2026-10-22T10:02:01Z");
  const moved=state.calls.find((call)=>call.id==="call-2");
  assert.equal(moved.entryId,second.id); assert.equal(moved.movedFrom,absent.position); assert.equal(moved.movedTo,4);
  assert.equal(state.history.find((item)=>item.action==="call.absent"&&item.recordId==="call-2").after.status,"absent","O histórico mantém a chamada original registrada como ausência.");
  assert.equal(state.history.find((item)=>item.action==="call.move_tail"&&item.recordId==="call-2").before.status,"absent","O deslocamento parte do estado de ausência auditado.");
  assert.throws(()=>rules.applyTrackAction(state,config,{kind:"call.move_tail",callId:"call-2",reason:"Tentar duplicar movimento"},"move-again","Operador"),/deslocada novamente/);
  run({kind:"call.create",rotationId:"rotation-1",entry:second,callId:"call-3",raceId:"race-duplicate-attempt"},"recall","2026-10-22T10:03:00Z");
  assert.notEqual(state.calls.find((call)=>call.id==="call-3").id,state.history.find((item)=>item.action==="call.absent"&&item.recordId==="call-2").recordId,"A reconvocação possui identificador de chamada distinto.");
  assert.equal(state.races.filter((race)=>race.entryId===second.id).length,1);
  assert.equal(state.calls.find((call)=>call.id==="call-3").raceId,"race-3");
  run({kind:"call.present",callId:"call-3"},"recall-present","2026-10-22T10:03:01Z");
  run({kind:"race.start",raceId:"race-3"},"recall-start","2026-10-22T10:03:02Z");
  assert.equal(state.races.find((race)=>race.id==="race-3").status,"running");
  run({kind:"race.judge",raceId:"race-3",outcome:"zero"},"recall-zero","2026-10-22T10:03:03Z");
  run({kind:"result.confirm",raceId:"race-3"},"recall-confirm","2026-10-22T10:03:04Z");
  assert.equal(state.races.filter((race)=>race.entryId===second.id).length,1);
  assert.equal(state.races.find((race)=>race.id==="race-3").status,"official");
  assert.equal(state.calls.find((call)=>call.id==="call-3").status,"completed");
  assert.equal(state.history.length,16);
});

test("track operation notices distinguish local, pending, blocked, conflict and synchronized states", () => {
  assert.equal(rules.trackOperationMessage("local", "Pausa"), "Operação “Pausa” registrada no aparelho.");
  assert.equal(rules.trackOperationMessage("pending", "Pausa"), "Operação “Pausa” registrada localmente; sincronização pendente.");
  assert.equal(rules.trackOperationMessage("blocked", "Pausa"), "Operação “Pausa” registrada neste aparelho; sincronização bloqueada para revisão.");
  assert.equal(rules.trackOperationMessage("synced", "Pausa"), "Operação “Pausa” registrada e sincronizada.");
  assert.equal(rules.trackOperationMessage("conflict", "Pausa"), "Operação “Pausa” registrada, mas há conflito que exige revisão.");
});

test("official result confirmation and correction preserve stable identity and the previous result", () => {
  const config={days:[{id:"day",date:"2026-10-22"}],rotations:[rotation({dayId:"day",capacity:5})],callWindowSeconds:60};
  const participant=entry(1);
  let state=rules.createTrackState("event-1",config);
  const run=(action,id)=>{state=rules.applyTrackAction(state,config,action,id,"Julgador");};
  run({kind:"call.create",rotationId:"rotation-1",entry:participant,callId:"call",raceId:"race"},"call");
  run({kind:"call.present",callId:"call"},"present");
  run({kind:"race.start",raceId:"race"},"start");
  run({kind:"race.judge",raceId:"race",outcome:"points",points:35,distance:12,distanceUnit:"metros"},"judge");
  assert.equal(state.races[0].resultStatus,"pending");
  assert.equal(state.races[0].announcedPoints,35,"The score announced by the judge is stored unchanged.");
  run({kind:"result.confirm",raceId:"race"},"confirm");
  const official={...state.races[0]};
  assert.equal(official.resultId,official.id);
  run({kind:"result.correct",raceId:"race",outcome:"points",points:40,distance:13,distanceUnit:"metros",reason:"Correção aprovada pela comissão"},"correct");
  assert.equal(state.races[0].resultStatus,"official");
  assert.equal(state.races[0].announcedPoints,40);
  assert.equal(state.races[0].resultId,official.resultId);
  assert.equal(state.history.at(-1).before.distance,12);
  assert.equal(state.history.at(-1).before.announcedPoints,35);
  assert.equal(state.history.at(-1).before.resultStatus,"official");
  assert.equal(state.history.at(-1).reason,"Correção aprovada pela comissão");
});

test("event bonus is explicit, reasoned, and added separately from the judge-announced score", () => {
  const config={days:[{id:"day",date:"2026-10-22"}],rotations:[rotation({dayId:"day",capacity:5})],callWindowSeconds:60,scoring:{approved:false,bonus:{enabled:true,points:5,conditions:"Condição específica deste evento",approved:false}}};
  const participant=entry(1);
  let state=rules.createTrackState("event-1",config);
  const run=(action,id)=>{state=rules.applyTrackAction(state,config,action,id,"Julgador");};
  run({kind:"call.create",rotationId:"rotation-1",entry:participant,callId:"call",raceId:"race"},"call");
  run({kind:"call.present",callId:"call"},"present");
  run({kind:"race.start",raceId:"race"},"start");
  assert.throws(()=>rules.applyTrackAction(state,config,{kind:"race.judge",raceId:"race",outcome:"points",points:35,applyBonus:true},"missing-reason","Julgador"),/condições da bonificação/);
  run({kind:"race.judge",raceId:"race",outcome:"points",points:35,applyBonus:true,bonusReason:"Condição do evento confirmada"},"judge");
  run({kind:"result.confirm",raceId:"race"},"confirm");
  const totals=rules.calculateProvisionalTrackTotals([{...participant,category:"Profissional",horse:"",representation:"",createdAt:"2026-10-22"}],state);
  assert.equal(state.races[0].announcedPoints,35);
  assert.equal(state.races[0].bonusPoints,5);
  assert.equal(totals[0].points,40);
  assert.equal(totals[0].confirmedRaces,1);
});
