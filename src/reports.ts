import { calculateProvisionalPoints, getEntryStatus, getEventCategories, getPaymentStatus, Entry, EventConfig, RunResult } from "./domain";

function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+@\t\r]/.test(text) || /^-\D/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildEventReportCsv(event: EventConfig, entries: Entry[], results: RunResult[]): string {
  const eventEntries = entries.filter((entry) => entry.eventId === event.id);
  const eventResults = results.filter((result) => result.eventId === event.id);
  const provisionalPoints = calculateProvisionalPoints(eventEntries, eventResults);
  const pointsById = new Map(provisionalPoints.map(({ entry, points }) => [entry.id, points]));
  const rows: unknown[][] = [
    ["Evento", event.name],
    ["Local", event.location],
    ["Período", `${event.date} a ${event.endsAt || event.date}`],
    ["Situação da apuração", "PROVISÓRIA — classificação oficial bloqueada; pontos não validados por regulamento aprovado"],
    ["Regulamento aprovado no servidor", "Não registrado"],
    ["Aviso de distribuição", "USO INTERNO: este relatório contém dados de inscrição e pagamento; não publicar como classificação"],
    [],
    ["Senha", "Categoria", "Vaqueiro", "Cavalo", "Representação", "Pagamento", "Valor recebido (R$)", "Forma", "Posição oficial (não calculada)", "Soma de pontos registrados (provisória)", "Resultados pendentes"],
  ];
  rows[7].splice(2, 0, "Situação");
  rows[7].push("Motivo do cancelamento");
  rows[7].push("Última transferência", "Motivo da transferência");
  for (const category of getEventCategories(event)) {
    for (const entry of eventEntries.filter((item) => item.category === category).sort((a, b) => a.number - b.number)) {
      const points = pointsById.get(entry.id) || 0;
      const payment = getPaymentStatus(entry);
      rows.push([
        entry.number, category, getEntryStatus(entry) === "cancelled" ? "Cancelada" : "Ativa", entry.vaqueiro, entry.horse, entry.representation,
        entry.paymentRestricted ? "Restrito" : payment === "paid" ? "Pago" : payment === "exempt" ? "Isento" : "Pendente",
        entry.paymentRestricted ? "" : payment === "paid" ? (entry.paidAmount || 0).toFixed(2) : "0.00", entry.paymentRestricted ? "" : entry.paymentMethod || "",
        "",
        points.toFixed(2),
        eventResults.filter((result) => result.entryId === entry.id && result.status === "pending").length,
        entry.statusReason || "",
        entry.transferredAt ? new Date(entry.transferredAt).toLocaleString("pt-BR") : "",
        entry.transferReason || "",
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

export function downloadEventReport(event: EventConfig, entries: Entry[], results: RunResult[]): void {
  const safeName = event.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "vaquejada";
  const blob = new Blob([buildEventReportCsv(event, entries, results)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `connect-pdm-${safeName}-${event.date}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
