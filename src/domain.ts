export const AVAILABLE_CATEGORIES = [
  "Profissional", "Amador", "Aspirante", "Mirim", "Feminina", "Tropa de Elite",
] as const;
export type Category = (typeof AVAILABLE_CATEGORIES)[number];
export type EventConfig = {
  id: string; name: string; location: string; date: string; endsAt?: string;
  ticketQuantity?: number; ticketPrice?: number; prizes?: unknown[]; rules?: Record<string, unknown>;
  /** Legacy category is read only to preserve existing IndexedDB events. */
  categories?: Category[]; category?: Category;
  categorySettings?: Partial<Record<Category, Record<string, unknown>>>;
  scoringMode: "instant" | "confirm"; createdAt: string;
  competition?: CompetitionConfig;
};
export type Entry = {
  id: string; eventId: string; number: number; vaqueiro: string; partner?: string; horse: string;
  representation: string; category: Category; paid: boolean; paymentStatus?: PaymentStatus;
  paymentRestricted?: boolean;
  paidAmount?: number; paymentMethod?: PaymentMethod; paidAt?: string; paidBy?: string; createdAt: string;
  status?: EntryStatus; statusReason?: string; cancelledAt?: string; cancelledBy?: string; updatedAt?: string;
  transferReason?: string; transferredAt?: string; transferredBy?: string;
};
export type EntryStatus = "active" | "cancelled";
export type TicketReservation = {
  id: string; eventId: string; number: number; reservedFor: string; expiresAt: string;
  status: "active" | "expired" | "released" | "converted"; reason?: string;
  createdAt: string; createdBy?: string; releaseReason?: string; releasedAt?: string; releasedBy?: string;
};
export type PaymentStatus = "pending" | "paid" | "exempt";
export type PaymentMethod = "cash" | "pix" | "transfer" | "card" | "other";
export type RunResult = {
  id: string; eventId: string; entryId: string; rodizio: string; bullNumber: number;
  resultType: "points" | "zero" | "return"; points: number; status: "official" | "pending" | "superseded";
  correctionReason?: string; supersededBy?: string;
  createdAt: string; createdBy: string;
};

/** Event-owned schedule. No weekday, rotation name, race count, or point table is implied. */
export type CompetitionConfig = {
  days: Array<{ id: string; date: string; startsAt?: string; endsAt?: string }>;
  rotations: RotationConfig[];
  callWindowSeconds: number;
  scoring?: { approved: boolean; pointsByDistance?: Record<string, number>; tieBreakers?: { approved: boolean; rules: string }; bonus?: { enabled: boolean; points: number; conditions: string; approved: boolean } };
  regulationDecisionId?: string;
  resultMode?: "instant" | "confirm";
};
export type RotationConfig = {
  id: string; name: string; dayId: string; order: number; startsAt?: string;
  capacity?: number; racesPerEntry?: number; ticketRange?: { from?: number; to?: number };
  callOrder: "ticket-asc" | "ticket-desc"; additionalCalls?: number;
};
export type RaceStatus = "pending" | "running" | "raced" | "zero" | "return_requested" | "return_authorized" | "return_denied" | "official";
export type RaceRecord = {
  id: string; eventId: string; entryId: string; rotationId: string; raceNumber: number;
  status: RaceStatus; resultId?: string; createdAt: string; updatedAt: string;
};
export type CallRecord = {
  id: string; operationId: string; eventId: string; entryId: string; rotationId: string; raceId?: string;
  position: number; calledAt: string; deadlineAt?: string; operator: string; respondedAt?: string; respondedBy?: string;
  status: "called" | "present" | "absent" | "deferred" | "completed";
  reason?: string; absenceAt?: string; absenceBy?: string; movedFrom?: number; movedTo?: number; movedAt?: string; movedBy?: string;
};
export const DEFAULT_CALL_WINDOW_SECONDS = 60;
export type CompetitionEntry = Pick<Entry, "id" | "eventId" | "number" | "vaqueiro" | "status" | "paid" | "paymentStatus">;

export function validateCompetitionConfig(config: CompetitionConfig): string | null {
  if (!Array.isArray(config.days) || config.days.length < 1) return "Configure ao menos um dia de competição.";
  if (new Set(config.days.map((day) => day.id)).size !== config.days.length || config.days.some((day) => !day.id.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(day.date))) return "Os dias precisam ter identificadores únicos e datas válidas.";
  if (!Number.isInteger(config.callWindowSeconds) || config.callWindowSeconds < 1) return "O prazo de chamada precisa ser maior que zero.";
  const dayIds = new Set(config.days.map((day) => day.id));
  if (!Array.isArray(config.rotations) || !config.rotations.length) return "Configure ao menos um rodízio.";
  if (new Set(config.rotations.map((rotation) => rotation.id)).size !== config.rotations.length) return "Os rodízios precisam ter identificadores únicos.";
  for (const rotation of config.rotations) {
    if (!rotation.name.trim() || !dayIds.has(rotation.dayId)) return "Cada rodízio precisa de nome e dia configurado.";
    if (!Number.isInteger(rotation.order) || rotation.order < 1) return "A ordem dos rodízios precisa ser um número positivo.";
    if (rotation.capacity != null && (!Number.isInteger(rotation.capacity) || rotation.capacity < 1)) return "A capacidade do rodízio precisa ser positiva.";
    if (rotation.racesPerEntry != null && (!Number.isInteger(rotation.racesPerEntry) || rotation.racesPerEntry < 1)) return "A quantidade de corridas por inscrição precisa ser positiva.";
    if (rotation.additionalCalls != null && (!Number.isInteger(rotation.additionalCalls) || rotation.additionalCalls < 0)) return "Chamadas adicionais precisam ser zero ou mais.";
    const range = rotation.ticketRange;
    if (range?.from != null && (!Number.isInteger(range.from) || range.from < 1)) return "O início do intervalo de senhas precisa ser positivo.";
    if (range?.to != null && (!Number.isInteger(range.to) || range.to < 1)) return "O fim do intervalo de senhas precisa ser positivo.";
    if (range?.from != null && range.to != null && range.from > range.to) return "O intervalo de senhas está invertido.";
  }
  const orderKeys = config.rotations.map((rotation) => `${rotation.dayId}:${rotation.order}`);
  if (new Set(orderKeys).size !== orderKeys.length) return "A ordem dos rodízios precisa ser única em cada dia.";
  if (config.scoring?.pointsByDistance && Object.values(config.scoring.pointsByDistance).some((points) => !Number.isFinite(points) || points < 0)) return "A tabela de pontuação precisa conter valores finitos e não negativos.";
  if (config.scoring?.bonus?.enabled && config.scoring.bonus.points !== 5) return "A bonificação opcional prevista nesta etapa é de cinco pontos; confirme a ativação e as condições com a comissão.";
  if (config.scoring?.bonus?.enabled && (typeof config.scoring.bonus.conditions !== "string" || !config.scoring.bonus.conditions.trim())) return "Descreva as condições da bonificação para este evento.";
  return null;
}

/** Returns eligible entries in configured order and leaves outside-range entries for later rotations. */
export function buildRotationQueue(entries: CompetitionEntry[], rotation: RotationConfig, alreadyCalledEntryIds: string[] = [], movedToTailEntryIds: string[] = []) {
  const callCounts = new Map<string, number>();
  for (const entryId of alreadyCalledEntryIds) callCounts.set(entryId, (callCounts.get(entryId) || 0) + 1);
  const eventIds = new Set(entries.map((entry) => entry.eventId));
  if (eventIds.size > 1) throw new Error("A fila precisa receber inscrições de um único evento.");
  const targetEventId = [...eventIds][0];
  const available = entries.filter((entry) => entry.eventId === targetEventId && getEntryStatus(entry) === "active" &&
    getPaymentStatus(entry) === "paid" && (callCounts.get(entry.id) || 0) < (rotation.racesPerEntry || 1));
  const inRange = available.filter((entry) =>
    (rotation.ticketRange?.from == null || entry.number >= rotation.ticketRange.from) &&
    (rotation.ticketRange?.to == null || entry.number <= rotation.ticketRange.to));
  const tail = new Set(movedToTailEntryIds);
  const order = (a: CompetitionEntry, b: CompetitionEntry) => Number(tail.has(a.id)) - Number(tail.has(b.id)) || (rotation.callOrder === "ticket-desc" ? b.number - a.number : a.number - b.number);
  const sorted = [...inRange].sort(order);
  const limit = rotation.capacity == null ? sorted.length : Math.max(0, rotation.capacity + (rotation.additionalCalls || 0) - alreadyCalledEntryIds.length);
  const eligible = sorted.slice(0, limit);
  const eligibleIds = new Set(eligible.map((entry) => entry.id));
  return { eligible, deferred: available.filter((entry) => !eligibleIds.has(entry.id)).sort(order) };
}

export function createRace(input: Omit<RaceRecord, "status" | "createdAt" | "updatedAt">, now = new Date().toISOString()): RaceRecord {
  if (!input.id || !input.eventId || !input.entryId || !input.rotationId || !Number.isInteger(input.raceNumber) || input.raceNumber < 1) throw new Error("Dados da corrida inválidos.");
  return { ...input, status: "pending", createdAt: now, updatedAt: now };
}
export function appendRace(races: RaceRecord[], input: Omit<RaceRecord, "status" | "createdAt" | "updatedAt">, now = new Date().toISOString()): RaceRecord[] {
  const existing = races.find((race) => race.id === input.id);
  if (existing) {
    if (existing.eventId !== input.eventId || existing.entryId !== input.entryId || existing.rotationId !== input.rotationId || existing.raceNumber !== input.raceNumber) throw new Error("O identificador da corrida já pertence a outra operação.");
    return races;
  }
  return [...races, createRace(input, now)];
}

const raceTransitions: Record<RaceStatus, RaceStatus[]> = {
  pending: ["running"],
  running: ["raced", "zero", "return_requested"],
  raced: ["zero", "return_requested", "official"],
  zero: ["official"],
  return_requested: ["return_authorized", "return_denied"],
  return_authorized: ["raced", "zero"],
  return_denied: [],
  official: [],
};
export function transitionRace(race: RaceRecord, next: RaceStatus, actor: string, reason?: string, now = new Date().toISOString()): RaceRecord {
  if (!raceTransitions[race.status].includes(next)) throw new Error(`Transição de corrida inválida: ${race.status} → ${next}.`);
  if (!actor.trim()) throw new Error("Informe o operador responsável.");
  if ((next === "return_requested" || next === "return_authorized") && !reason?.trim()) throw new Error("A decisão de retorno precisa de justificativa.");
  return { ...race, status: next, updatedAt: now };
}
export type RaceTransitionRecord = { id: string; operationId: string; raceId: string; eventId: string; entryId: string; rotationId: string; from: RaceStatus; to: RaceStatus; operator: string; occurredAt: string; reason?: string };
export function applyRaceTransition(race: RaceRecord, next: RaceStatus, history: RaceTransitionRecord[], operationId: string, actor: string, reason?: string, now = new Date().toISOString()) {
  const duplicate = history.find((item) => item.operationId === operationId);
  if (duplicate) {
    if (duplicate.raceId !== race.id || duplicate.to !== next) throw new Error("A chave idempotente já foi usada para outra transição.");
    return { race, history };
  }
  const updated = transitionRace(race, next, actor, reason, now);
  const record: RaceTransitionRecord = { id: operationId, operationId, raceId: race.id, eventId: race.eventId, entryId: race.entryId, rotationId: race.rotationId, from: race.status, to: next, operator: actor.trim(), occurredAt: now, reason };
  return { race: updated, history: [...history, record] };
}

export function recordCall(input: Omit<CallRecord, "status">): CallRecord {
  if (!input.operationId || !input.id || !input.eventId || !input.entryId || !input.rotationId || !Number.isFinite(Date.parse(input.calledAt)) || !input.operator.trim() || !Number.isInteger(input.position) || input.position < 1) throw new Error("Dados da chamada inválidos.");
  return { ...input, status: "called" };
}
export function appendCall(calls: CallRecord[], input: Omit<CallRecord, "status">): CallRecord[] {
  const existingOperation = calls.find((call) => call.operationId === input.operationId);
  if (existingOperation) {
    if (existingOperation.id !== input.id || existingOperation.entryId !== input.entryId || existingOperation.rotationId !== input.rotationId) throw new Error("A chave idempotente da chamada já foi usada em outra operação.");
    return calls;
  }
  if (calls.some((call) => call.id === input.id)) throw new Error("A chamada já existe com outra chave idempotente.");
  return [...calls, recordCall(input)];
}
export function recordNoShow(call: CallRecord, now: string, windowSeconds: number, operator: string): CallRecord {
  if (call.status !== "called") throw new Error("Somente chamadas aguardando comparecimento podem ser marcadas como ausência.");
  if (!operator.trim()) throw new Error("Informe o operador responsável pela ausência.");
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || !Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(call.calledAt)) || Date.parse(now) < Date.parse(call.calledAt) + windowSeconds * 1000) throw new Error("O prazo configurado para a chamada ainda não terminou.");
  return { ...call, status: "absent", absenceAt: now, absenceBy: operator.trim() };
}
export function moveNoShowToTail(call: CallRecord, calls: CallRecord[], operationId: string, actor: string, reason: string, now: string): CallRecord[] {
  const duplicate = calls.find((item) => item.operationId === operationId);
  if (duplicate) {
    if (duplicate.id !== call.id) throw new Error("A chave idempotente já foi usada por outra chamada.");
    return calls;
  }
  const current = calls.find((item) => item.id === call.id);
  if (!current || current.status !== "absent" || current.movedAt) throw new Error("A chamada não está elegível para deslocamento ou já foi movida.");
  if (!actor.trim() || reason.trim().length < 5) throw new Error("Informe operador e justificativa do deslocamento.");
  const lastPosition = Math.max(0, ...calls.filter((item) => item.rotationId === call.rotationId).map((item) => item.position));
  return calls.map((item) => item.id !== call.id ? item : { ...item, operationId, reason: reason.trim(), movedFrom: item.position, movedTo: lastPosition + 1, position: lastPosition + 1, movedAt: now, movedBy: actor.trim(), status: "deferred" });
}

export function officialClassificationReadiness(_config?: CompetitionConfig): { ready: false; reason: string } {
  return {
    ready: false,
    reason: "Classificação oficial bloqueada: não há versão de regulamento aprovada e registrada pelo servidor para este evento.",
  };
}

export type RotationRuntime = { rotationId: string; status: "active" | "paused" | "closed"; changedAt: string; changedBy: string; reason?: string };
export type TrackRace = RaceRecord & {
  ticketNumber: number; position: number; operator: string; version: number; syncState: "local" | "pending" | "synced" | "conflict";
  distance?: number; distanceUnit?: string; announcedPoints?: number; bonusPoints?: number; bonusReason?: string;
  occurrence?: string; observation?: string; resultStatus?: "unrecorded" | "pending" | "official" | "superseded";
  judge?: string; resultReason?: string; originalRaceId?: string; returnDecision?: "approved" | "denied"; returnDecisionBy?: string; returnDecisionAt?: string;
  outcome?: "points" | "zero" | "return";
};
export type TrackHistory = { id: string; operationId: string; eventId: string; recordType: "rotation" | "call" | "race"; recordId: string; entryId?: string; rotationId: string; action: string; actionPayload: unknown; before?: unknown; after?: unknown; operator: string; occurredAt: string; reason?: string };
export type TrackState = { id: string; eventId: string; version: number; remoteVersion?: number; syncState: "local" | "pending" | "synced" | "conflict" | "blocked"; rotations: RotationRuntime[]; calls: CallRecord[]; races: TrackRace[]; history: TrackHistory[]; updatedAt: string };
export function trackOperationMessage(syncState: TrackState["syncState"], name: string): string {
  if (syncState === "pending") return `Operação “${name}” registrada localmente; sincronização pendente.`;
  if (syncState === "synced") return `Operação “${name}” registrada e sincronizada.`;
  if (syncState === "conflict") return `Operação “${name}” registrada, mas há conflito que exige revisão.`;
  if (syncState === "blocked") return `Operação “${name}” registrada neste aparelho; sincronização bloqueada para revisão.`;
  return `Operação “${name}” registrada no aparelho.`;
}
export type TrackAction =
  | { kind: "rotation.pause" | "rotation.resume" | "rotation.close" | "rotation.reopen"; rotationId: string; reason: string }
  | { kind: "call.create"; rotationId: string; entry: CompetitionEntry; callId: string; raceId: string }
  | { kind: "call.present" | "call.absent" | "call.move_tail"; callId: string; reason?: string }
  | { kind: "race.start"; raceId: string }
  | { kind: "race.judge"; raceId: string; outcome: "points" | "zero" | "return"; distance?: number; distanceUnit?: string; occurrence?: string; observation?: string; points?: number; applyBonus?: boolean; bonusReason?: string }
  | { kind: "return.decide"; raceId: string; decision: "approved" | "denied"; reason: string }
  | { kind: "return.create_race"; raceId: string; newRaceId: string }
  | { kind: "result.confirm"; raceId: string }
  | { kind: "result.correct"; raceId: string; outcome: "points" | "zero" | "return"; distance?: number; distanceUnit?: string; occurrence?: string; observation?: string; reason: string; points?: number; applyBonus?: boolean; bonusReason?: string };

export function createTrackState(eventId: string, config: CompetitionConfig, now = new Date().toISOString()): TrackState {
  const issue = validateCompetitionConfig(config);
  if (issue) throw new Error(issue);
  return { id: eventId, eventId, version: 0, syncState: "local", rotations: config.rotations.map(({ id }) => ({ rotationId: id, status: "active", changedAt: now, changedBy: "Sistema" })), calls: [], races: [], history: [], updatedAt: now };
}

export function applyTrackAction(state: TrackState, config: CompetitionConfig, action: TrackAction, operationId: string, actor: string, now = new Date().toISOString()): TrackState {
  const prior = state.history.find((item) => item.operationId === operationId);
  if (prior) {
    if (prior.action !== action.kind || JSON.stringify(prior.actionPayload) !== JSON.stringify(action)) throw new Error("A chave idempotente já foi usada para outra ação da pista.");
    return state;
  }
  if (!actor.trim() || !operationId) throw new Error("A ação precisa de identificador e operador.");
  const configIssue = validateCompetitionConfig(config);
  if (configIssue) throw new Error(configIssue);
  const rotationConfig = "rotationId" in action ? config.rotations.find((item) => item.id === action.rotationId) : undefined;
  if ("rotationId" in action && !rotationConfig) throw new Error("Rodízio não pertence à configuração do evento.");
  const rotation = "rotationId" in action ? state.rotations.find((item) => item.rotationId === action.rotationId) : undefined;
  let next = state;
  let recordType: TrackHistory["recordType"] = "race";
  let recordId = "";
  let entryId: string | undefined;
  let rotationId = "";
  let reason: string | undefined;
  if (action.kind === "rotation.pause" || action.kind === "rotation.resume" || action.kind === "rotation.close" || action.kind === "rotation.reopen") {
    if (!rotation) throw new Error("Estado do rodízio não encontrado.");
    const transitions: Record<"rotation.pause" | "rotation.resume" | "rotation.close" | "rotation.reopen", [RotationRuntime["status"], RotationRuntime["status"]]> = { "rotation.pause": ["active", "paused"], "rotation.resume": ["paused", "active"], "rotation.close": ["active", "closed"], "rotation.reopen": ["closed", "active"] };
    const transition = transitions[action.kind];
    if (rotation.status !== transition[0]) throw new Error("Transição de estado do rodízio inválida.");
    if (!action.reason.trim()) throw new Error("Informe o motivo da alteração do rodízio.");
    next = { ...state, rotations: state.rotations.map((item) => item.rotationId !== action.rotationId ? item : { ...item, status: transition[1] as RotationRuntime["status"], changedAt: now, changedBy: actor.trim(), reason: action.reason.trim() }) };
    recordType = "rotation"; recordId = action.rotationId; rotationId = action.rotationId; reason = action.reason.trim();
  } else if (action.kind === "call.create") {
    if (!rotation || rotation.status !== "active") throw new Error("Não é possível chamar senhas com o rodízio pausado ou encerrado.");
    if (action.entry.eventId !== state.eventId || getEntryStatus(action.entry) !== "active") throw new Error("A inscrição não pertence ao evento ou não está ativa.");
    if (getPaymentStatus(action.entry) !== "paid") throw new Error("Somente inscrições pagas podem ser encaminhadas para a chamada.");
    const priorDeferred = state.calls.find((item) => item.entryId === action.entry.id && item.rotationId === action.rotationId && item.status === "deferred" && item.movedAt);
    const alreadyCalled = state.calls.filter((item) => item.rotationId === action.rotationId && !(item.status === "deferred" && item.movedAt)).map((item) => item.entryId);
    const movedToTail = state.calls.filter((item) => item.rotationId === action.rotationId && item.status === "deferred" && item.movedAt).map((item) => item.entryId);
    const planned = buildRotationQueue([action.entry], rotationConfig!, alreadyCalled, movedToTail);
    const withinQueue = planned.eligible.some((item) => item.id === action.entry.id);
    const raceCount = state.races.filter((item) => item.rotationId === action.rotationId).length;
    if (!withinQueue || (!priorDeferred && rotationConfig!.capacity != null && raceCount >= rotationConfig!.capacity + (rotationConfig!.additionalCalls || 0))) throw new Error("A inscrição não é elegível para chamada nesta etapa ou a capacidade foi atingida.");
    const linkedRaceId = priorDeferred?.raceId || action.raceId;
    const call = recordCall({ id: action.callId, operationId, eventId: state.eventId, entryId: action.entry.id, rotationId: action.rotationId, raceId: linkedRaceId, position: priorDeferred?.position || state.calls.filter((item) => item.rotationId === action.rotationId).length + 1, calledAt: now, deadlineAt: new Date(Date.parse(now) + config.callWindowSeconds * 1000).toISOString(), operator: actor.trim() });
    const existingRace = state.races.find((item) => item.id === linkedRaceId);
    if (state.calls.some((item) => item.id === call.id || item.operationId === operationId) || (existingRace && !priorDeferred) || (!existingRace && state.races.some((item) => item.id === linkedRaceId))) throw new Error("Identificador de chamada ou corrida já utilizado.");
    const race = existingRace || createRace({ id: linkedRaceId, eventId: state.eventId, entryId: action.entry.id, rotationId: action.rotationId, raceNumber: state.races.filter((item) => item.entryId === action.entry.id).length + 1 });
    next = { ...state, calls: [...state.calls, call], races: existingRace ? state.races : [...state.races, { ...race, ticketNumber: action.entry.number, position: call.position, operator: actor.trim(), version: 1, syncState: "local", resultStatus: "unrecorded" }] };
    recordType = "call"; recordId = call.id; entryId = action.entry.id; rotationId = action.rotationId;
  } else {
    const race = "raceId" in action ? state.races.find((item) => item.id === action.raceId) : undefined;
    const callsForRace = race ? state.calls.filter((item) => item.raceId === race.id) : [];
    const call = "callId" in action ? state.calls.find((item) => item.id === action.callId) :
      race ? callsForRace.slice().reverse().find((item) => ["called", "present", "absent"].includes(item.status)) || callsForRace[callsForRace.length - 1] : undefined;
    if (action.kind === "call.present" || action.kind === "call.absent" || action.kind === "call.move_tail") {
      if (!call) throw new Error("Chamada não encontrada.");
      const callRotation = state.rotations.find((item) => item.rotationId === call.rotationId);
      if (action.kind === "call.present" || action.kind === "call.absent") {
        if (call.status !== "called") throw new Error("A chamada já recebeu uma resposta.");
        if (action.kind === "call.absent" && Date.parse(now) < Date.parse(call.deadlineAt || call.calledAt)) throw new Error("O prazo da chamada ainda não terminou.");
        const updated = action.kind === "call.present" ? { ...call, status: "present" as const, respondedAt: now, respondedBy: actor.trim() } : { ...call, status: "absent" as const, absenceAt: now, absenceBy: actor.trim(), reason: action.reason?.trim() };
        next = { ...state, calls: state.calls.map((item) => item.id === call.id ? updated : item) };
        recordType = "call"; recordId = call.id; entryId = call.entryId; rotationId = call.rotationId; reason = action.reason;
      } else {
        if (call.status !== "absent" || call.movedAt || !callRotation || (action.reason || "").trim().length < 5) throw new Error("A chamada ausente não pode ser deslocada novamente sem justificativa.");
        const maxPosition = Math.max(0, ...state.calls.filter((item) => item.rotationId === call.rotationId).map((item) => item.position));
        const updated = { ...call, movedFrom: call.position, movedTo: maxPosition + 1, position: maxPosition + 1, movedAt: now, movedBy: actor.trim(), status: "deferred" as const, reason: action.reason?.trim() };
        next = { ...state, calls: state.calls.map((item) => item.id === call.id ? updated : item) };
        recordType = "call"; recordId = call.id; entryId = call.entryId; rotationId = call.rotationId; reason = action.reason;
      }
    } else {
      if (!race) throw new Error("Corrida não encontrada.");
      const raceRotation = state.rotations.find((item) => item.rotationId === race.rotationId);
      const updateRace = (updated: TrackRace) => ({ ...state, races: state.races.map((item) => item.id === race.id ? updated : item) });
      recordId = race.id; entryId = race.entryId; rotationId = race.rotationId;
      if (action.kind === "race.start") {
        if (!raceRotation || raceRotation.status !== "active" || call?.status !== "present") throw new Error("A corrida exige rodízio ativo e comparecimento registrado.");
        next = updateRace({ ...race, status: "running", updatedAt: now, version: race.version + 1 });
      } else if (action.kind === "race.judge" || action.kind === "result.correct") {
        if (action.kind === "race.judge" && race.status !== "running") throw new Error("Somente uma corrida iniciada pode receber julgamento.");
        if (action.kind === "result.correct" && (race.status !== "official" || action.reason.trim().length < 10)) throw new Error("Correção exige resultado oficial e justificativa com pelo menos 10 caracteres.");
        if (action.distance != null && (!Number.isFinite(action.distance) || action.distance < 0)) throw new Error("Informe uma distância válida.");
        if (action.outcome === "points" && (action.points == null || !Number.isFinite(action.points) || action.points < 0)) throw new Error("Informe a pontuação anunciada pelo juiz.");
        if (action.outcome !== "points" && action.points != null) throw new Error("A pontuação só pode ser informada para uma corrida pontuada.");
        const status: RaceStatus = action.outcome === "zero" ? "zero" : action.outcome === "return" ? "return_requested" : "raced";
        if (status === "return_requested" && !action.occurrence?.trim()) throw new Error("Informe o motivo do retorno solicitado.");
        if (action.kind === "race.judge" && !raceTransitions[race.status].includes(status)) throw new Error("Transição de julgamento inválida.");
        if (action.kind === "result.correct" && action.outcome === "return" && !action.occurrence?.trim()) throw new Error("Correção para retorno exige motivo da ocorrência.");
        if (action.applyBonus && (action.outcome !== "points" || !config.scoring?.bonus?.enabled || !config.scoring.bonus.conditions.trim())) throw new Error("A bonificação não está configurada para este evento ou não se aplica a este resultado.");
        if (action.applyBonus && !action.bonusReason?.trim()) throw new Error("Informe por que as condições da bonificação foram atendidas.");
        const preserveBonus = action.kind === "result.correct" && action.applyBonus === undefined && action.outcome === "points";
        const bonusPoints = action.applyBonus ? config.scoring!.bonus!.points : preserveBonus ? race.bonusPoints || 0 : 0;
        const bonusReason = action.applyBonus ? action.bonusReason!.trim() : preserveBonus ? race.bonusReason : undefined;
        const updated: TrackRace = { ...race, status: action.kind === "result.correct" ? "official" : status, outcome: action.outcome, distance: action.distance, distanceUnit: action.distanceUnit, announcedPoints: action.outcome === "points" ? action.points : action.outcome === "zero" ? 0 : undefined, bonusPoints, bonusReason, occurrence: action.occurrence, observation: action.observation, judge: actor.trim(), resultReason: action.kind === "result.correct" ? action.reason.trim() : undefined, resultStatus: action.kind === "result.correct" ? "official" : "pending", resultId: race.resultId || (action.kind === "result.correct" ? race.id : undefined), updatedAt: now, version: race.version + 1 };
        next = updateRace(updated);
        if (action.kind === "race.judge" && updated.resultStatus === "official" && call) next = { ...next, calls: next.calls.map((item) => item.id === call.id ? { ...item, status: "completed" as const } : item) };
        reason = action.kind === "result.correct" ? action.reason : action.occurrence;
      } else if (action.kind === "return.decide") {
        if (race.status !== "return_requested" || !action.reason.trim()) throw new Error("Apenas retorno solicitado pode receber decisão justificada.");
        next = updateRace({ ...race, status: action.decision === "approved" ? "return_authorized" : "return_denied", returnDecision: action.decision, returnDecisionBy: actor.trim(), returnDecisionAt: now, resultReason: action.reason.trim(), updatedAt: now, version: race.version + 1 });
        if (action.decision === "denied" && call) next = { ...next, calls: next.calls.map((item) => item.id === call.id ? { ...item, status: "completed" as const } : item) };
        reason = action.reason.trim();
      } else if (action.kind === "return.create_race") {
        if (race.status !== "return_authorized") throw new Error("A corrida de retorno exige autorização registrada.");
        if (state.races.some((item) => item.originalRaceId === race.id)) throw new Error("Já existe uma corrida de retorno vinculada a esta corrida original.");
        if (state.races.some((item) => item.id === action.newRaceId)) throw new Error("Identificador da corrida de retorno já utilizado.");
        const created = createRace({ id: action.newRaceId, eventId: race.eventId, entryId: race.entryId, rotationId: race.rotationId, raceNumber: state.races.filter((item) => item.entryId === race.entryId).length + 1 }, now);
        const returnRace: TrackRace = { ...created, ticketNumber: race.ticketNumber, position: race.position, operator: actor.trim(), version: 1, syncState: "local", originalRaceId: race.id, resultStatus: "unrecorded" };
        const returnCall: CallRecord = { id: `return-call:${action.newRaceId}`, operationId: `return-call:${operationId}`, eventId: race.eventId, entryId: race.entryId, rotationId: race.rotationId, raceId: returnRace.id, position: Math.max(0,...state.calls.filter((item)=>item.rotationId===race.rotationId).map((item)=>item.position))+1, calledAt: now, deadlineAt: new Date(Date.parse(now)+config.callWindowSeconds*1000).toISOString(), operator: actor.trim(), status: "called" };
        next = { ...state, races: [...state.races, returnRace], calls: [...state.calls.map((item)=>item.id===call?.id?{...item,status:"completed" as const}:item), returnCall] };
        recordId = returnRace.id;
      } else if (action.kind === "result.confirm") {
        if (race.resultStatus !== "pending" || !["raced", "zero"].includes(race.status)) throw new Error("Somente julgamento pendente pode ser confirmado.");
        next = updateRace({ ...race, resultId: race.resultId || race.id, resultStatus: "official", status: "official", updatedAt: now, version: race.version + 1 });
        if (call) next = { ...next, calls: next.calls.map((item) => item.id === call.id ? { ...item, status: "completed" as const } : item) };
      }
    }
  }
  const readRecord = (source: TrackState) => recordType === "rotation" ? source.rotations.find((item) => item.rotationId === recordId) : recordType === "call" ? source.calls.find((item) => item.id === recordId) : source.races.find((item) => item.id === recordId);
  const history: TrackHistory = { id: operationId, operationId, eventId: state.eventId, recordType, recordId, entryId, rotationId, action: action.kind, actionPayload: action, before: readRecord(state), after: readRecord(next), operator: actor.trim(), occurredAt: now, reason };
  return { ...next, version: state.version + 1, syncState: "pending", updatedAt: now, history: [...state.history, history] };
}
export type AuditRecord = {
  id: string; eventId: string | null; recordTable: string; recordId: string;
  action: "INSERT" | "UPDATE" | "DELETE"; actorUserId: string | null; actorLabel?: string;
  beforeData: Record<string, unknown> | null; afterData: Record<string, unknown> | null; occurredAt: string;
};
export type EventStatus = "future" | "current" | "finished";
export type OfflineOperationKind = "event.create" | "entry.create" | "entry.cancel" | "entry.payment" | "entry.transfer" | "result.create" | "result.confirm";

export function offlineOperationPriority(kind: OfflineOperationKind): number {
  return kind === "event.create" ? 0 : kind === "entry.create" ? 1 : kind === "entry.cancel" || kind === "entry.payment" || kind === "entry.transfer" ? 2 : kind === "result.create" ? 3 : 4;
}
export function compareOfflineOperations(a: { kind: OfflineOperationKind; createdAt: string; id: string }, b: { kind: OfflineOperationKind; createdAt: string; id: string }): number {
  return offlineOperationPriority(a.kind) - offlineOperationPriority(b.kind) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
export function overlayQueuedRecord<T extends { id: string; status?: string }>(kind: OfflineOperationKind, rows: T[], payload: Partial<T> & { id: string }): T[] {
  if (kind === "event.create" || kind === "entry.create" || kind === "result.create") {
    return rows.some((row) => row.id === payload.id) ? rows : [...rows, payload as T];
  }
  const { previous: _previous, ...changes } = payload as Partial<T> & { id: string; previous?: unknown };
  return rows.map((row) => row.id !== payload.id ? row : {
    ...row, ...changes, ...(kind === "result.confirm" ? { status: "official" } : {}),
  });
}

export function getPaymentStatus(entry: Pick<Entry, "paymentStatus" | "paid">): PaymentStatus {
  return entry.paymentStatus || (entry.paid ? "paid" : "pending");
}
export function getEntryStatus(entry: Pick<Entry, "status">): EntryStatus {
  return entry.status || "active";
}
export function filterEntries(entries: Entry[], filters: { query?: string; category?: string; paymentStatus?: PaymentStatus | ""; status?: EntryStatus | "" } = {}): Entry[] {
  const query = filters.query?.trim().toLocaleLowerCase("pt-BR") || "";
  return entries.filter((entry) => {
    const searchable = `${entry.number} ${entry.vaqueiro} ${entry.horse} ${entry.representation}`.toLocaleLowerCase("pt-BR");
    return (!query || searchable.includes(query)) && (!filters.category || entry.category === filters.category) &&
      (!filters.paymentStatus || getPaymentStatus(entry) === filters.paymentStatus) && (!filters.status || getEntryStatus(entry) === filters.status);
  });
}
export function isReservationActive(reservation: Pick<TicketReservation, "status" | "expiresAt">, now = Date.now()): boolean {
  return reservation.status === "active" && Date.parse(reservation.expiresAt) > now;
}
export function getReservationStatus(reservation: TicketReservation, now = Date.now()): TicketReservation["status"] {
  return reservation.status === "active" && !isReservationActive(reservation, now) ? "expired" : reservation.status;
}
export function cancelEntryRecord(entry: Entry, reason: string, cancelledAt: string, cancelledBy: string): Entry {
  const normalizedReason = reason.trim();
  if (getEntryStatus(entry) !== "active") throw new Error("Somente inscrições ativas podem ser canceladas.");
  if (normalizedReason.length < 10) throw new Error("Informe um motivo com pelo menos 10 caracteres.");
  return { ...entry, status: "cancelled", statusReason: normalizedReason, cancelledAt, cancelledBy, updatedAt: cancelledAt };
}
export type EntryTransferChanges = Pick<Entry, "vaqueiro" | "horse" | "representation" | "category"> & Partial<Pick<Entry, "partner">>;
export function transferEntryRecord(entry: Entry, changes: EntryTransferChanges, reason: string, transferredAt: string, transferredBy: string): Entry {
  const normalizedReason = reason.trim();
  if (getEntryStatus(entry) !== "active") throw new Error("Somente inscrições ativas podem ser transferidas.");
  if (normalizedReason.length < 10) throw new Error("Informe um motivo com pelo menos 10 caracteres.");
  if (!changes.vaqueiro.trim()) throw new Error("Informe o nome do novo vaqueiro.");
  if (changes.vaqueiro.trim() === entry.vaqueiro && (changes.partner || "").trim() === (entry.partner || "") && changes.horse.trim() === entry.horse && changes.representation.trim() === entry.representation && changes.category === entry.category) {
    throw new Error("Informe pelo menos uma alteração nos dados da inscrição.");
  }
  return { ...entry, ...changes, vaqueiro: changes.vaqueiro.trim(), horse: changes.horse.trim(), representation: changes.representation.trim(), transferReason: normalizedReason, transferredAt, transferredBy, updatedAt: transferredAt };
}

export function getEventCategories(event: Pick<EventConfig, "categories" | "category">): Category[] {
  return event.categories?.length ? event.categories : [event.category || "Profissional"];
}
export function isCategoryEnabled(event: Pick<EventConfig, "categories" | "category">, category: string): boolean {
  return getEventCategories(event).includes(category as Category);
}
export function hasTicketCapacity(limit: number | undefined, issued: number): boolean {
  return limit == null || issued < limit;
}
export function validateEntryDraft(draft: Partial<Pick<Entry, "vaqueiro" | "partner" | "horse" | "representation">>): string | null {
  if (!String(draft.vaqueiro ?? "").trim()) return "Informe o vaqueiro da inscrição.";
  return null;
}
export function validateEventRevision(event: EventConfig, entries: Pick<Entry, "category">[], activeReservations = 0): string | null {
  const categories = getEventCategories(event);
  if (!categories.length) return "O evento precisa manter ao menos uma categoria habilitada.";
  if (event.endsAt && event.endsAt < event.date) return "A data final não pode ser anterior à data inicial.";
  if (event.ticketQuantity != null && entries.length + activeReservations > event.ticketQuantity) return "A quantidade de senhas não pode ficar abaixo das inscrições e reservas ativas.";
  if (entries.some((entry) => !categories.includes(entry.category))) return "Não é possível desativar uma categoria que já possui inscrições.";
  return null;
}
export function getEventStatus(start: string, end: string, today: string): EventStatus {
  if (today < start) return "future";
  if (today > end) return "finished";
  return "current";
}

export function confirmPendingResult(result: RunResult): RunResult {
  if (result.status !== "pending") {
    throw new Error("Somente resultados pendentes podem ser confirmados.");
  }
  return { ...result, status: "official" };
}
export function calculateProvisionalPoints(entries: Entry[], results: RunResult[]) {
  return entries.filter((entry) => getEntryStatus(entry) === "active").map((entry) => ({
    entry,
    points: results.filter((result) => result.eventId === entry.eventId && result.entryId === entry.id && result.status === "official")
      .reduce((total, result) => total + result.points, 0),
  })).sort((a, b) => b.points - a.points);
}

export function calculateProvisionalTrackTotals(entries: Entry[], state?: TrackState) {
  return entries.filter((entry) => getEntryStatus(entry) === "active").map((entry) => {
    const results = (state?.eventId === entry.eventId ? state.races : []).filter((race) =>
      race.eventId === entry.eventId && race.entryId === entry.id && race.resultStatus === "official");
    return {
      entry,
      points: results.reduce((total, race) => total + (race.outcome === "points"
        ? (race.announcedPoints || 0) + (race.bonusPoints || 0) : 0), 0),
      confirmedRaces: results.length,
    };
  });
}
