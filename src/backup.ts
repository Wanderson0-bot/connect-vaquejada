import { AVAILABLE_CATEGORIES, AuditRecord, Category, Entry, EventConfig, getEventCategories, getPaymentStatus, RunResult, TicketReservation } from "./domain";

export type BackupPayload = {
  format: "connect-pdm-backup";
  version: 1;
  exportedAt: string;
  events: EventConfig[];
  entries: Entry[];
  results: RunResult[];
  reservations?: TicketReservation[];
  audit?: AuditRecord[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const requireArray = (value: unknown, name: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`O backup está inválido: ${name} precisa ser uma lista.`);
  return value;
};

export function parseBackup(serialized: string): BackupPayload {
  let source: unknown;
  try { source = JSON.parse(serialized); }
  catch { throw new Error("O arquivo não contém um JSON válido."); }
  if (!isRecord(source) || source.format !== "connect-pdm-backup" || source.version !== 1) {
    throw new Error("Formato ou versão de backup não reconhecido.");
  }
  const events = requireArray(source.events, "vaquejadas").map((value, index) => {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.name !== "string" || !value.name.trim()) {
      throw new Error(`Vaquejada ${index + 1} sem identificador ou nome válido.`);
    }
    const categories = Array.isArray(value.categories) && value.categories.length
      ? value.categories as Category[]
      : typeof value.category === "string" && value.category.trim()
        ? [value.category as Category]
        : [];
    if (!categories.length || categories.some((category) => !AVAILABLE_CATEGORIES.includes(category))) {
      throw new Error(`Vaquejada ${value.name} possui categoria inválida.`);
    }
    if (typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error(`Data inválida na vaquejada ${value.name}.`);
    if (value.endsAt != null && (typeof value.endsAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.endsAt) || value.endsAt < value.date)) throw new Error(`Período inválido na vaquejada ${value.name}.`);
    if (new Set(categories).size !== categories.length) throw new Error(`Vaquejada ${value.name} possui categorias repetidas.`);
    if (value.scoringMode !== "instant" && value.scoringMode !== "confirm") throw new Error(`Configuração de pontuação inválida na vaquejada ${value.name}.`);
    return { ...value, categories } as unknown as EventConfig;
  });
  const eventById = new Map(events.map((event) => [event.id, event]));
  if (eventById.size !== events.length) throw new Error("O backup contém identificadores de vaquejada repetidos.");

  const entries = requireArray(source.entries, "inscrições").map((value, index) => {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.eventId !== "string" ||
        !Number.isInteger(value.number) || Number(value.number) < 1 || typeof value.vaqueiro !== "string" || !value.vaqueiro.trim() ||
        typeof value.paid !== "boolean" || (value.paidAmount != null && (typeof value.paidAmount !== "number" || !Number.isFinite(value.paidAmount) || value.paidAmount < 0))) {
      throw new Error(`Inscrição ${index + 1} possui campos inválidos.`);
    }
    const event = eventById.get(value.eventId);
    if (!event) throw new Error(`A inscrição ${value.id} referencia uma vaquejada ausente no backup.`);
    if (typeof value.category !== "string" || !getEventCategories(event).includes(value.category as Category)) {
      throw new Error(`A inscrição ${value.id} possui categoria não habilitada na vaquejada.`);
    }
    if (value.paymentStatus != null && !["pending", "paid", "exempt"].includes(String(value.paymentStatus))) throw new Error(`Status de pagamento inválido na inscrição ${value.id}.`);
    if (value.paymentMethod != null && !["cash", "pix", "transfer", "card", "other"].includes(String(value.paymentMethod))) throw new Error(`Forma de pagamento inválida na inscrição ${value.id}.`);
    if (value.status != null && !["active", "cancelled"].includes(String(value.status))) throw new Error("Status da inscrição inválido.");
    if (value.status === "cancelled" && (typeof value.statusReason !== "string" || value.statusReason.trim().length < 10 ||
        typeof value.cancelledAt !== "string" || !Number.isFinite(Date.parse(value.cancelledAt)) ||
        (value.cancelledBy != null && typeof value.cancelledBy !== "string"))) {
      throw new Error("A inscrição cancelada precisa de motivo e horário válidos.");
    }
    if (value.status !== "cancelled" && (value.statusReason != null || value.cancelledAt != null || value.cancelledBy != null)) {
      throw new Error("Dados de cancelamento encontrados em inscrição ativa.");
    }
    if (value.transferReason != null && (typeof value.transferReason !== "string" || value.transferReason.trim().length < 10 ||
        typeof value.transferredAt !== "string" || !Number.isFinite(Date.parse(value.transferredAt)) ||
        (value.transferredBy != null && typeof value.transferredBy !== "string"))) {
      throw new Error("A transferência da inscrição precisa de motivo e horário válidos.");
    }
    if (value.transferReason == null && (value.transferredAt != null || value.transferredBy != null)) {
      throw new Error("Dados de transferência sem motivo na inscrição.");
    }
    const entry = { ...value, paymentStatus: getPaymentStatus({ paid: value.paid === true, paymentStatus: value.paymentStatus as Entry["paymentStatus"] }) } as unknown as Entry;
    if ((entry.paymentStatus === "paid") !== value.paid) throw new Error(`Status e indicador de pagamento incompatíveis na inscrição ${entry.id}.`);
    if (entry.paymentStatus === "paid" && (!Number.isFinite(Number(value.paidAmount || 0)) || Number(value.paidAmount || 0) < 0)) {
      throw new Error(`Valor de pagamento inválido na inscrição ${entry.id}.`);
    }
    return entry;
  });
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  if (entryById.size !== entries.length) throw new Error("O backup contém identificadores de inscrição repetidos.");
  const ticketKeys = entries.map((entry) => `${entry.eventId}:${entry.number}`);
  if (new Set(ticketKeys).size !== ticketKeys.length) throw new Error("O backup contém números de senha repetidos na mesma vaquejada.");

  const reservations = requireArray(source.reservations ?? [], "reservas de senha").map((value, index) => {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.eventId !== "string" ||
        !Number.isInteger(value.number) || Number(value.number) < 1 || typeof value.reservedFor !== "string" || !value.reservedFor.trim() ||
        typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) ||
        !["active", "expired", "released", "converted"].includes(String(value.status)) ||
        typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw new Error(`Reserva ${index + 1} possui campos inválidos.`);
    if (!eventById.has(value.eventId)) throw new Error(`A reserva ${value.id} referencia uma vaquejada ausente no backup.`);
    if (value.status === "released" && (typeof value.releaseReason !== "string" || value.releaseReason.trim().length < 10 || typeof value.releasedAt !== "string" || !Number.isFinite(Date.parse(value.releasedAt)))) throw new Error(`A reserva ${value.id} não possui motivo e horário de liberação válidos.`);
    return value as unknown as TicketReservation;
  });
  if (new Set(reservations.map((item) => item.id)).size !== reservations.length) throw new Error("O backup contém identificadores de reserva repetidos.");
  const activeTicketKeys = reservations.filter((item) => item.status === "active" && Date.parse(item.expiresAt) > Date.now()).map((item) => `${item.eventId}:${item.number}`);
  if (activeTicketKeys.some((key) => ticketKeys.includes(key)) || new Set(activeTicketKeys).size !== activeTicketKeys.length) throw new Error("O backup contém senha ativa duplicada entre inscrição e reserva.");


  const results = requireArray(source.results, "resultados").map((value, index) => {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.eventId !== "string" ||
        typeof value.entryId !== "string" || typeof value.rodizio !== "string" || !Number.isInteger(value.bullNumber) || Number(value.bullNumber) < 1 ||
        !["points", "zero", "return"].includes(String(value.resultType)) || !["official", "pending", "superseded"].includes(String(value.status)) ||
        typeof value.points !== "number" || !Number.isFinite(value.points) || value.points < 0) {
      throw new Error(`Resultado ${index + 1} possui campos inválidos.`);
    }
    const entry = entryById.get(value.entryId);
    if (entry?.status === "cancelled") throw new Error("O backup possui resultado associado a inscrição cancelada.");
    if (!entry || entry.eventId !== value.eventId) throw new Error(`O resultado ${value.id} referencia uma inscrição ou vaquejada incompatível.`);
    if (value.status === "superseded" && (typeof value.correctionReason !== "string" || value.correctionReason.trim().length < 10 || typeof value.supersededBy !== "string" || !value.supersededBy)) {
      throw new Error(`O resultado substituído ${value.id} não possui justificativa e vínculo de correção.`);
    }
    return value as unknown as RunResult;
  });
  if (new Set(results.map((result) => result.id)).size !== results.length) throw new Error("O backup contém identificadores de resultado repetidos.");
  for (const result of results.filter((item) => item.status === "superseded")) {
    const replacement = results.find((item) => item.id === result.supersededBy);
    if (!replacement || replacement.eventId !== result.eventId || replacement.entryId !== result.entryId) {
      throw new Error(`O resultado substituído ${result.id} não referencia uma correção compatível.`);
    }
  }
  const audit = requireArray(source.audit ?? [], "auditoria").map((value, index) => {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.recordTable !== "string" ||
        typeof value.recordId !== "string" || !["INSERT", "UPDATE", "DELETE"].includes(String(value.action)) ||
        typeof value.occurredAt !== "string" || !Number.isFinite(Date.parse(value.occurredAt)) ||
        !(value.eventId == null || typeof value.eventId === "string") || !(value.actorUserId == null || typeof value.actorUserId === "string") ||
        !(value.beforeData == null || isRecord(value.beforeData)) || !(value.afterData == null || isRecord(value.afterData))) {
      throw new Error(`Registro de auditoria ${index + 1} inválido.`);
    }
    return value as unknown as AuditRecord;
  });
  if (new Set(audit.map((item) => item.id)).size !== audit.length) throw new Error("O backup contém identificadores de auditoria repetidos.");
  return { format: "connect-pdm-backup", version: 1, exportedAt: String(source.exportedAt || ""), events, entries, results, reservations, audit };
}

export function serializeBackup(events: EventConfig[], entries: Entry[], results: RunResult[], audit: AuditRecord[] = [], reservations: TicketReservation[] = []): string {
  const payload: BackupPayload = { format: "connect-pdm-backup", version: 1, exportedAt: new Date().toISOString(), events, entries, results, reservations, audit };
  return JSON.stringify(payload, null, 2);
}

export function downloadBackup(events: EventConfig[], entries: Entry[], results: RunResult[], audit: AuditRecord[] = [], reservations: TicketReservation[] = []): void {
  const blob = new Blob([serializeBackup(events, entries, results, audit, reservations)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `connect-pdm-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
