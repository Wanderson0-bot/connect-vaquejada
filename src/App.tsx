import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  House,
  Printer,
  Download,
  Trophy,
  WifiOff,
  Plus,
  CheckCircle2,
  CircleAlert,
  RefreshCw,
  LogOut,
  Pencil,
  Wifi,
  X,
} from "lucide-react";
import { AccountGate, ParkEditor, TeamManager } from "./Account";
import { backendConfigured, confirmParkEventPublication, getMyEventPublicationStatuses, ParkEventPublicationStatus, ParkProfile } from "./backend";
import { downloadEventReport } from "./reports";
import { downloadBackup } from "./backup";
import { CoordinatorQueueReview } from "./CoordinatorQueueReview";
import { PageHeading } from "./PageHeading";
import { RouteNotFound } from "./RouteNotFound";
import { isConnectPath, isOperationPath, isPublicParkPath, operationTabForLocation, operationUrlForTab, OperationTab } from "./navigation.mjs";
import { checkCoordinator, clearCoordinatorSettings, getCoordinatorSettings, saveCoordinatorSettings, subscribeCoordinatorChanges, CoordinatorHealth } from "./coordinator";
import { calculateProvisionalPoints, confirmPendingResult, filterEntries, getEntryStatus, getEventCategories, getEventStatus, getPaymentStatus, hasTicketCapacity, isCategoryEnabled, isReservationActive, officialClassificationReadiness, validateCompetitionConfig, validateEntryDraft, CompetitionConfig, DEFAULT_CALL_WINDOW_SECONDS, EntryTransferChanges, PaymentMethod, PaymentStatus } from "./domain";
import {
  Entry,
  EventConfig,
  RunResult,
  AuditRecord,
  SyncStatus,
  getEntries,
  getEvents,
  getResults,
  getTicketReservations,
  reserveTicketNumber,
  releaseTicketReservation,
  getAuditRecords,
  getSyncStatus,
  syncPendingOperations,
  syncLocalCoordinator,
  retryBlockedSync,
  saveEntry,
  cancelEntry as cancelEntryRecord,
  transferEntry as transferEnrollmentRecord,
  updateEntryPayment as updateEntryPaymentRecord,
  saveEvent,
  updateEvent as updateEventRecord,
  saveResult,
  confirmRunResult,
  correctRunResult,
  restoreLocalBackup,
  uid,
  AVAILABLE_CATEGORIES,
  Category,
  TicketReservation,
} from "./db";

type Tab = OperationTab;
const tabLabels: Record<Tab, string> = {
  overview: "Visão geral",
  entries: "Inscrições e senhas",
  track: "Pista e resultados",
  settings: "Vaquejadas",
  park: "Perfil do parque",
  audit: "Auditoria",
  backup: "Backup",
  network: "Coordenador do parque",
};
const tabDescriptions: Record<Tab, string> = {
  overview: "Resumo do parque e do evento selecionado.",
  entries: "Inscrições, senhas e pagamentos do evento ativo.",
  track: "Chamadas e resultados, com estados locais e de sincronização identificados.",
  settings: "Cadastro e configurações das vaquejadas.",
  park: "Informações e acessos do parque.",
  audit: "Histórico de alterações disponíveis para esta conta.",
  backup: "Exportação e restauração dos dados operacionais.",
  network: "Estado e configuração do coordenador local.",
};
function localDateString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function formatDateBR(value?: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString("pt-BR");
  return value;
}
const today = localDateString();
const TrackConsole = lazy(() => import("./TrackConsole").then((module) => ({ default: module.TrackConsole })));
const PublicSite = lazy(() => import("./PublicSite").then((module) => ({ default: module.PublicSite })));

export default function App() {
  const { pathname } = window.location;
  if (pathname === "/eventos" || pathname.startsWith("/eventos/") || isPublicParkPath(pathname)) return <Suspense fallback={<div className="public-site-empty" role="status">Carregando pagina publica...</div>}><PublicSite /></Suspense>;
  if (isConnectPath(pathname) || isOperationPath(pathname)) return <AccountGate>{(account) => <Dashboard {...account} />}</AccountGate>;
  return <RouteNotFound />;
}

function Dashboard({ park, onSignOut, onSavePark }: {
  park: ParkProfile | null;
  onSignOut: () => Promise<void>;
  onSavePark: (value: ParkProfile) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>(() => operationTabForLocation(window.location.pathname, new URLSearchParams(window.location.search).get("area")) || "overview");
  const deepLinkApplied = useRef(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [events, setEvents] = useState<EventConfig[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reservations, setReservations] = useState<TicketReservation[]>([]);
  const [results, setResults] = useState<RunResult[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ pending: 0, blocked: 0 });
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [publicationStatuses, setPublicationStatuses] = useState<Record<string, ParkEventPublicationStatus>>({});
  const [auditLoading, setAuditLoading] = useState(false);
  const [activeEvent, setActiveEvent] = useState("");
  const [editingEventId, setEditingEventId] = useState("");
  const [paymentEntryId, setPaymentEntryId] = useState("");
  const [transferEntryId, setTransferEntryId] = useState("");
  const [selectedReservationId, setSelectedReservationId] = useState("");
  const [entryFormKey, setEntryFormKey] = useState(0);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryCategoryFilter, setEntryCategoryFilter] = useState("");
  const [entryPaymentFilter, setEntryPaymentFilter] = useState("");
  const [entryStatusFilter, setEntryStatusFilter] = useState("");
  const [correctionResultId, setCorrectionResultId] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [coordinatorSettings, setCoordinatorSettings] = useState(() => getCoordinatorSettings() || { url: "", token: "" });
  const [coordinatorConfigured, setCoordinatorConfigured] = useState(() => Boolean(getCoordinatorSettings()));
  const [coordinatorHealth, setCoordinatorHealth] = useState<CoordinatorHealth | null>(null);
  const [coordinatorStatus, setCoordinatorStatus] = useState<{ pending: number; blocked: number; lastError?: string; checked: boolean; connected: boolean }>({ pending: 0, blocked: 0, checked: false, connected: false });

  async function refresh() {
    try {
      if (!backendConfigured && getCoordinatorSettings()) setCoordinatorStatus(await syncLocalCoordinator());
      const [ev, en, re, rs, sync] = await Promise.all([getEvents(), getEntries(), getResults(), getTicketReservations(), getSyncStatus()]);
      setEvents(ev); setEntries(en); setResults(re); setReservations(rs);
      setSyncStatus(sync);
      if (!activeEvent && ev[0]) {
        const requestedEvent = new URLSearchParams(window.location.search).get("event");
        const requestedEventIsAuthorized = requestedEvent && ev.some((item) => item.id === requestedEvent)
          && (park?.access_role === "park_manager" || park?.event_access?.some((access) => access.event_id === requestedEvent));
        const permittedEvent = park?.event_access?.find((access) => ev.some((item) => item.id === access.event_id))?.event_id;
        setActiveEvent(requestedEventIsAuthorized && requestedEvent ? requestedEvent : permittedEvent || ev[0].id);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível carregar os dados.");
    } finally { setLoading(false); }
  }
  async function importBackupFile(file?: File) {
    if (!file) return;
    try {
      const counts = await restoreLocalBackup(await file.text());
      await refresh();
      setNotice(`Backup restaurado: ${counts.events} vaquejadas, ${counts.entries} senhas, ${counts.reservations} reservas, ${counts.results} resultados e ${counts.audit} registros de auditoria adicionados.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível restaurar o backup.");
    }
  }
  useEffect(() => {
    if (backendConfigured && navigator.onLine) {
      void syncPendingOperations().then(() => refresh()).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Falha ao retomar sincronização.");
        void refresh();
      });
    } else void refresh();
  }, []);
  useEffect(() => {
    if (backendConfigured || !coordinatorConfigured || !getCoordinatorSettings()) return;
    const unsubscribe = subscribeCoordinatorChanges(() => {
      if (document.visibilityState === "visible") void refresh();
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { unsubscribe(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [backendConfigured, coordinatorConfigured]);
  useEffect(() => {
    const markOnline = () => {
      setNetworkOnline(true);
      if (backendConfigured) void syncPendingOperations().then(() => refresh()).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Falha ao retomar sincronização.");
      });
      else if (getCoordinatorSettings()) void refresh();
    };
    const markOffline = () => setNetworkOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);
  useEffect(() => {
    if (tab !== "audit") return;
    let active = true;
    setAuditLoading(true);
    getAuditRecords().then((records) => {
      if (active) setAuditRecords(records);
    }).catch((error: unknown) => {
      if (active) setNotice(error instanceof Error ? error.message : "Não foi possível consultar a auditoria.");
    }).finally(() => {
      if (active) setAuditLoading(false);
    });
    return () => { active = false; };
  }, [tab]);
  useEffect(() => {
    if (tab !== "settings" || !backendConfigured || park?.access_role !== "park_manager") return;
    let active = true;
    getMyEventPublicationStatuses().then((rows) => {
      if (active) setPublicationStatuses(Object.fromEntries(rows.map((row) => [row.event_id, row])));
    }).catch((error: unknown) => {
      if (active) setNotice(error instanceof Error ? error.message : "Não foi possível consultar o estado de publicação.");
    });
    return () => { active = false; };
  }, [tab, park?.access_role]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const event = events.find((e) => e.id === activeEvent);
  const coordinatorUnauthorized = coordinatorStatus.lastError?.includes("Identidade inválida, expirada ou desativada.") ?? false;
  const coordinatorStatusMessage = coordinatorStatus.blocked
    ? `${coordinatorStatus.blocked} alteração(ões) precisam de revisão no coordenador.`
    : !coordinatorStatus.checked
      ? "Verificando a conexão com o coordenador local."
      : !coordinatorStatus.connected && coordinatorUnauthorized
        ? "A credencial do coordenador é inválida, expirada ou desativada. Verifique o acesso antes de sincronizar."
        : !coordinatorStatus.connected
          ? `Coordenador indisponível; tentando reconectar. ${coordinatorStatus.lastError || "Sem resposta autenticada do servidor."}`
          : coordinatorStatus.pending
            ? `${coordinatorStatus.pending} alteração(ões) aguardam compartilhamento pela rede local.${coordinatorStatus.lastError ? ` Última falha: ${coordinatorStatus.lastError}` : ""}`
              : coordinatorStatus.lastError
                ? `Conectado ao coordenador, mas a última sincronização teve falha: ${coordinatorStatus.lastError}`
                : "Coordenador local conectado: dados compartilhados neste parque.";
  const eventRole = park?.access_role === "park_manager" ? null : park?.event_access?.find((access) => access.event_id === activeEvent)?.role || null;
  const currentRole = eventRole || (park?.access_role === "park_manager" ? null : park?.access_role);
  const isEventScoped = park?.access_role !== "park_manager" && (currentRole !== null && currentRole !== undefined || Boolean(park?.event_access?.length));
  const canReadEntries = !isEventScoped || ["office", "judge", "track_operator", "event_supervisor"].includes(currentRole || "");
  const canChangePayments = !isEventScoped || currentRole === "office";
  const canOperateTrack = !isEventScoped || ["announcer", "judge", "track_operator"].includes(currentRole || "");
  const canManagePark = !isEventScoped && (!backendConfigured || park?.access_role === "park_manager");
  const allowedTabs: Tab[] = isEventScoped
    ? currentRole === "office" ? ["overview", "entries"]
      : currentRole === "event_supervisor" ? ["overview", "entries", "track"]
      : currentRole === "announcer" ? ["overview", "track"]
      : currentRole === "judge" || currentRole === "track_operator" ? ["overview", "track"] : ["overview"]
    : ["overview", "entries", "track", "settings", "park", "audit", "backup", ...(!backendConfigured ? ["network" as const] : [])];
  useEffect(() => {
    if (deepLinkApplied.current || loading || events.length === 0) return;
    deepLinkApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const area = params.get("area");
    const requestedEventId = params.get("event");
    if (requestedEventId && events.some((item) => item.id === requestedEventId)
      && (park?.access_role === "park_manager" || park?.event_access?.some((access) => access.event_id === requestedEventId))) {
      setActiveEvent(requestedEventId);
    }
    const requestedTab = operationTabForLocation(window.location.pathname, area);
    if (!requestedTab) return;
    const requestedRole = requestedEventId
      ? park?.event_access?.find((access) => access.event_id === requestedEventId)?.role
      : park?.event_access?.find((access) => access.event_id === activeEvent)?.role;
    const areaAllowed = park?.access_role === "park_manager"
      || area === "office" && (requestedRole === "office" || requestedRole === "event_supervisor")
      || area === "announcer" && requestedRole === "announcer"
      || area === "operational" && ["judge", "track_operator", "event_supervisor"].includes(requestedRole || "");
    if (areaAllowed && requestedTab) setTab(requestedTab);
  }, [activeEvent, events, loading, park]);
  useEffect(() => {
    if (loading || (isEventScoped && !activeEvent)) return;
    if (tab && !allowedTabs.includes(tab)) {
      const fallback = allowedTabs[0] ?? "overview";
      setTab(fallback);
      const nextUrl = operationUrlForTab(fallback, window.location.href);
      window.history.replaceState(null, "", nextUrl);
    }
  }, [tab, allowedTabs]);
  useEffect(() => {
    const handlePopState = () => {
      const requested = operationTabForLocation(window.location.pathname, new URLSearchParams(window.location.search).get("area"))
        || "overview";
      setTab(requested);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  const editingEvent = events.find((item) => item.id === editingEventId);
  const eventEntries = entries.filter((e) => e.eventId === activeEvent);
  const visibleEntries = filterEntries(eventEntries, { query: entrySearch, category: entryCategoryFilter, paymentStatus: entryPaymentFilter as PaymentStatus | "", status: entryStatusFilter as Entry["status"] | "" }).sort((a, b) => a.number - b.number);
  const eventReservations = reservations.filter((r) => r.eventId === activeEvent).map((r) => ({ ...r, status: r.status === "active" && !isReservationActive(r) ? "expired" as const : r.status }));
  const activeReservationCount = eventReservations.filter((r) => isReservationActive(r)).length;
  const selectedReservation = eventReservations.find((r) => r.id === selectedReservationId && isReservationActive(r));
  const eventResults = results.filter((r) => r.eventId === activeEvent);
  const totalPoints = (entryId: string) =>
    eventResults
      .filter((r) => r.entryId === entryId && r.status === "official")
      .reduce((sum, r) => sum + r.points, 0);
  const provisionalPoints = useMemo(() => calculateProvisionalPoints(eventEntries, eventResults), [eventEntries, eventResults]);
  const classificationReadiness = officialClassificationReadiness(event?.competition);

  function navigateTab(nextTab: Tab) {
    if (!allowedTabs.includes(nextTab)) return;
    setTab(nextTab);
    const nextUrl = operationUrlForTab(nextTab, window.location.href);
    if (nextUrl.pathname !== window.location.pathname || nextUrl.search !== window.location.search) {
      window.history.pushState(null, "", nextUrl);
    }
  }

  useEffect(() => {
    if (isEventScoped && park?.event_access?.length === 1 && activeEvent !== park.event_access[0].event_id) setActiveEvent(park.event_access[0].event_id);
  }, [activeEvent, isEventScoped, park?.event_access]);

  useEffect(() => {
    if (!eventModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEventModalOpen(false);
        setEditingEventId("");
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [eventModalOpen]);

  function openEventEditor(eventId = "") {
    setEditingEventId(eventId);
    setEventModalOpen(true);
  }

  function closeEventEditor() {
    setEventModalOpen(false);
    setEditingEventId("");
  }

  async function createEvent(form: FormData): Promise<boolean> {
    const editing = events.find((item) => item.id === editingEventId);
    const name = String(form.get("name") || "").trim();
    if (!name) {
      setNotice("Informe o nome da vaquejada.");
      return false;
    }
    const eventEnd = String(form.get("endsAt") || form.get("date") || today);
    if (eventEnd < String(form.get("date") || today)) {
      setNotice("A data final não pode ser anterior à data inicial.");
      return false;
    }
    const categories = form.getAll("categories").map(String) as Category[];
    const competitionText = String(form.get("competitionConfig") || "").trim();
    let competition: CompetitionConfig | undefined;
    if (competitionText) {
      try {
        const parsed = JSON.parse(competitionText) as Partial<CompetitionConfig>;
        competition = { ...parsed, callWindowSeconds: parsed.callWindowSeconds ?? DEFAULT_CALL_WINDOW_SECONDS } as CompetitionConfig;
      }
      catch { throw new Error("A configuração dos rodízios precisa ser um JSON válido."); }
      const configError = validateCompetitionConfig(competition);
      if (configError) throw new Error(configError);
    }
    const ev: EventConfig = {
      id: editing?.id || uid(),
      name,
      location: String(form.get("location") || ""),
      date: String(form.get("date") || today),
      endsAt: eventEnd,
      ticketQuantity: Number(form.get("ticketQuantity") || 0) || undefined,
      ticketPrice: Number(form.get("ticketPrice") || 0) || undefined,
      prizes: String(form.get("prizes") || "").split("\n").map((prize) => prize.trim()).filter(Boolean),
      rules: { regulation: String(form.get("regulation") || "").trim(), ...(competition ? { competition } : {}) },
      competition,
      categories,
      categorySettings: Object.fromEntries(categories.map((category) => [category, {
        regulation: String(form.get(`categoryRule:${category}`) || "").trim(),
      }])),
      scoringMode: String(
        form.get("mode") || "instant",
      ) as EventConfig["scoringMode"],
      createdAt: new Date().toISOString(),
    };
    if (!ev.categories?.length) {
      setNotice("Selecione ao menos uma categoria para a vaquejada.");
      return false;
    }
    if (editing) {
      await updateEventRecord(ev);
      await refresh();
      setNotice("Configurações da vaquejada atualizadas; inscrições e resultados foram preservados.");
      return true;
    } else {
      await saveEvent(ev);
      await refresh();
      setActiveEvent(ev.id);
      navigateTab("entries");
      const sync = await getSyncStatus();
      setNotice(backendConfigured && (sync.pending > 0 || sync.blocked > 0)
        ? "Vaquejada salva neste aparelho; aguardando sincronização com a conta do parque."
        : backendConfigured ? "Vaquejada cadastrada na conta do parque." : "Vaquejada cadastrada neste aparelho.");
      return true;
    }
  }
  async function createEntry(form: FormData): Promise<boolean> {
    if (!event) {
      setNotice("Cadastre ou selecione uma vaquejada primeiro.");
      return false;
    }
    const reservationId = String(form.get("reservationId") || "") || undefined;
    if (!reservationId && !hasTicketCapacity(event.ticketQuantity, eventEntries.length + activeReservationCount)) {
      setNotice("A quantidade de senhas configurada para este evento foi atingida.");
      return false;
    }
    const number = Number(form.get("number"));
    if (!Number.isInteger(number) || number < 1) {
      setNotice("Informe um número de senha válido.");
      return false;
    }
    if (eventEntries.some((e) => e.number === number) || eventReservations.some((r) => r.number === number && isReservationActive(r) && r.id !== reservationId)) {
      setNotice("Esse número de senha já está ocupado nesta vaquejada.");
      return false;
    }
    const vaqueiro = String(form.get("vaqueiro") || "").trim();
    const partner = String(form.get("partner") || "").trim();
    const horse = String(form.get("horse") || "").trim();
    const representation = String(form.get("representation") || "").trim();
    const validationError = validateEntryDraft({ vaqueiro, partner, horse, representation });
    if (validationError) {
      setNotice(validationError);
      return false;
    }
    const paymentStatus = String(form.get("paymentStatus") || "pending") as PaymentStatus;
    const entry: Entry = {
      id: uid(),
      eventId: event.id,
      number,
      vaqueiro,
      partner: partner || undefined,
      horse,
      representation,
      category: String(form.get("entryCategory") || "") as Category,
      paymentStatus,
      paid: paymentStatus === "paid",
      paidAmount: paymentStatus === "paid" ? Number(form.get("paidAmount") || 0) : 0,
      paymentMethod: paymentStatus === "paid" && form.get("paymentMethod") ? String(form.get("paymentMethod")) as Entry["paymentMethod"] : undefined,
      paidAt: paymentStatus === "paid" ? new Date().toISOString() : undefined,
      paidBy: String(form.get("paymentReceivedBy") || "").trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    if (!isCategoryEnabled(event, entry.category)) {
      setNotice("Selecione uma categoria habilitada nesta vaquejada.");
      return false;
    }
    const amountReceived = entry.paidAmount ?? 0;
    if (!Number.isFinite(amountReceived) || amountReceived < 0) {
      setNotice("Informe um valor recebido válido.");
      return false;
    }
    await saveEntry(entry, reservationId);
    await refresh();
    const sync = await getSyncStatus();
    setNotice(backendConfigured && (sync.pending > 0 || sync.blocked > 0)
      ? `Senha ${number} salva neste aparelho; aguardando sincronização.` : `Senha ${number} cadastrada.`);
    return true;
  }
  async function createReservation(form: FormData) {
    if (!event) return;
    const localExpiry = String(form.get("expiresAt") || "");
    await reserveTicketNumber({
      id: uid(), eventId: event.id, number: Number(form.get("reservationNumber")),
      reservedFor: String(form.get("reservedFor") || ""),
      expiresAt: new Date(localExpiry).toISOString(), reason: String(form.get("reservationReason") || "") || undefined,
    });
    await refresh();
    setNotice("Senha reservada até o prazo informado.");
  }
  async function updateEntryPayment(entry: Entry) {
    try {
      await updateEntryPaymentRecord(entry);
      await refresh();
      setPaymentEntryId("");
      setNotice(`Pagamento da senha ${entry.number} atualizado.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível atualizar o pagamento.");
    }
  }  async function addResult(form: FormData) {
    if (!event) return;
    const entryId = String(form.get("entryId") || "");
    const entry = eventEntries.find((e) => e.id === entryId);
    if (!entry) {
      setNotice("Selecione uma senha.");
      return;
    }
    const resultType = String(
      form.get("resultType") || "points",
    ) as RunResult["resultType"];
    const points = resultType === "points" ? Number(form.get("points") || 0) : 0;
    const bullNumber = Number(form.get("bullNumber") || 1);
    if (!Number.isFinite(points) || points < 0 || !Number.isInteger(bullNumber) || bullNumber < 1) {
      setNotice("Informe uma pontuação não negativa e um número de boi válido.");
      return;
    }
    const result: RunResult = {
      id: uid(),
      eventId: event.id,
      entryId,
      rodizio: String(form.get("rodizio") || [...(event.competition?.rotations || [])].sort((a, b) => a.order - b.order)[0]?.name || ""),
      bullNumber,
      resultType,
      points,
      status: event.scoringMode === "confirm" ? "pending" : "official",
      createdAt: new Date().toISOString(),
      createdBy: String(form.get("operator") || "Operador"),
    };
    await saveResult(result);
    await refresh();
    setNotice(
      result.status === "pending"
        ? "Resultado salvo como pendente de confirmação."
        :         "Resultado registrado. A apuração continua provisória e sem posição oficial.",
    );
  }
  async function cancelEntry(entry: Entry) {
    const reason = window.prompt("Informe o motivo do cancelamento (mínimo de 10 caracteres):");
    if (reason === null) return;
    if (!window.confirm(`Cancelar a senha ${entry.number} de ${entry.vaqueiro}? O número ficará no histórico e não será reutilizado.`)) return;
    try {
      await cancelEntryRecord(entry, reason);
      await refresh();
      setNotice(backendConfigured && !navigator.onLine
        ? `Cancelamento da senha ${entry.number} salvo neste aparelho e aguardando sincronização.`
        : `Senha ${entry.number} cancelada; número preservado no histórico.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível cancelar a inscrição.");
    }
  }
  async function saveTransfer(entry: Entry, changes: EntryTransferChanges, reason: string) {
    try {
      await transferEnrollmentRecord(entry, changes, reason);
      await refresh();
      setTransferEntryId("");
      const sync = await getSyncStatus();
      setNotice(backendConfigured && (sync.pending > 0 || sync.blocked > 0)
        ? `Transferência da senha ${entry.number} salva neste aparelho e aguardando sincronização.`
        : `Senha ${entry.number} transferida; histórico da alteração preservado.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível transferir a senha.");
    }
  }
  async function confirmResult(result: RunResult) {
    try {
      confirmPendingResult(result);
      await confirmRunResult(result.id, result.eventId);
      await refresh();
      setNotice("Resultado confirmado.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível confirmar o resultado.");
    }
  }
  async function correctResult(form: FormData, original: RunResult) {
    const resultType = String(form.get("resultType") || original.resultType) as RunResult["resultType"];
    const points = resultType === "points" ? Number(form.get("points")) : 0;
    const bullNumber = Number(form.get("bullNumber"));
    const reason = String(form.get("reason") || "").trim();
    if (!Number.isInteger(bullNumber) || bullNumber < 1 || !Number.isFinite(points) || points < 0 || reason.length < 10) {
      setNotice("Confira boi, pontuação e informe um motivo com pelo menos 10 caracteres.");
      return;
    }
    try {
      await correctRunResult({
        originalResultId: original.id, rodizio: String(form.get("rodizio") || original.rodizio),
        bullNumber, resultType, points, reason, correctedBy: String(form.get("operator") || "Operador local"),
      });
      await refresh();
      setCorrectionResultId("");
      setNotice("Correção registrada. O resultado anterior foi preservado no histórico.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível corrigir o resultado.");
    }
  }
  function printEntry(entry: Entry) {
    const printWindow = window.open("", "_blank", "width=700,height=700");
    if (!printWindow) {
      setNotice(
        "O navegador bloqueou a janela de impressão. Permita pop-ups para este site.",
      );
      return;
    }
    const eventDate = event?.date ? formatDateBR(event.date) : "—";
    const paymentLabel = entry.paymentRestricted ? "Restrito" : paymentStatusLabel(getPaymentStatus(entry));
    const paymentClass = paymentLabel === "Pago" ? "paid" : paymentLabel === "Pendente" ? "pending" : "neutral";

    printWindow.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comprovante — Senha ${entry.number}</title><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}.ticket{width:80mm;max-width:80mm;margin:0 auto;padding:2mm 2.5mm 3mm;background:#fff}.brand{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:2mm}.brand-mark{width:12mm;height:12mm;border:2px solid #111;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;line-height:1}.brand-text{font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;line-height:1.1;text-align:center}.title{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;text-align:center;margin:2mm 0 1mm}.meta{border-top:1px solid #111;border-bottom:1px solid #111;padding:1.5mm 0 1mm;margin:1mm 0}.meta-row{display:flex;justify-content:space-between;align-items:center;gap:2mm;font-size:9px;line-height:1.4}.meta-row strong{font-weight:900}.section{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;margin:2mm 0 1mm}.entry-head{background:#111;color:#fff;padding:1.5mm 2mm;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px}.entry-head span{display:block}.line{display:flex;justify-content:space-between;align-items:flex-start;gap:2mm;padding:1.2mm 0;border-bottom:1px dashed #111;font-size:9px}.line-label{font-weight:700}.line-value{font-weight:900;text-align:right}.pill{display:inline-block;padding:1.2mm 2.8mm;border-radius:2px;background:#e7e1d5;color:#111;font-weight:900;font-size:8.5px;text-transform:uppercase}.pill.paid{background:#dfead9}.pill.pending{background:#f3e5b7}.pill.neutral{background:#e9e9e9}.footer{border-top:1px solid #111;padding-top:2mm;margin-top:2mm;text-align:center;font-size:8.5px;font-weight:900;letter-spacing:0.7px;text-transform:uppercase}.footer .stamp{display:flex;justify-content:center;align-items:center;gap:4px;margin-bottom:1mm}.footer .stamp-box{width:6mm;height:6mm;border:1px solid #111;display:inline-flex;align-items:center;justify-content:center;font-size:6px;font-weight:900}.dashed{border-top:1px dashed #111;margin:2mm 0 0;padding-top:2mm}@page{size:80mm auto;margin:0}@media print{body{width:80mm;margin:0;padding:0}.ticket{padding:0}}</style></head><body><div class="ticket"><div class="brand"><div class="brand-mark">C</div><div class="brand-text">CONNECT<br/>VAQUEJADA</div></div><div class="title">Comprovante de inscrições</div><div class="meta"><div class="meta-row"><span>Evento:</span><strong>${escapeHtml(event?.name || "Vaquejada")}</strong></div><div class="meta-row"><span>Data:</span><strong>${escapeHtml(eventDate)}</strong></div><div class="meta-row"><span>Vaqueiro:</span><strong>${escapeHtml(entry.vaqueiro)}</strong></div><div class="meta-row"><span>Equipe/Rep.:</span><strong>${escapeHtml(entry.representation || "Não informada")}</strong></div></div><div class="section">Inscrições</div><div class="entry-head">Senha nº <span>${entry.number}</span></div><div class="line"><span class="line-label">Categoria:</span><span class="line-value">${escapeHtml(entry.category)}</span></div><div class="line"><span class="line-label">Cavalo:</span><span class="line-value">${escapeHtml(entry.horse || "Não informado")}</span></div><div class="line"><span class="line-label">Pagamento:</span><span class="pill ${paymentClass}">${paymentLabel}</span></div><div class="dashed"></div><div class="footer"><div class="stamp"><span class="stamp-box">✓</span><span>Impressão em ${new Date().toLocaleString("pt-BR")}</span></div><div>Boa sorte na pista</div><div>Vaqueiro!</div></div></div><script>window.onload=()=>window.print()</script></body></html>`
    );
    printWindow.document.close();
  }
  function printEntrySequence(rows: Entry[]) {
    if (!rows.length) { setNotice("Não há inscrições visíveis para imprimir."); return; }
    const printWindow = window.open("", "_blank", "width=700,height=700");
    if (!printWindow) { setNotice("O navegador bloqueou a janela de impressão. Permita pop-ups para este site."); return; }
    const sheets = rows.map((entry) => {
      const paymentLabel = entry.paymentRestricted ? "Restrito" : paymentStatusLabel(getPaymentStatus(entry));
      const paymentClass = paymentLabel === "Pago" ? "paid" : paymentLabel === "Pendente" ? "pending" : "neutral";
      return `<article class="ticket"><div class="brand"><div class="brand-mark">C</div><div class="brand-text">CONNECT<br/>VAQUEJADA</div></div><div class="title">Comprovante de inscrições</div><div class="meta"><div class="meta-row"><span>Evento:</span><strong>${escapeHtml(event?.name || "Vaquejada")}</strong></div><div class="meta-row"><span>Data:</span><strong>${escapeHtml(event?.date ? formatDateBR(event.date) : "—")}</strong></div><div class="meta-row"><span>Vaqueiro:</span><strong>${escapeHtml(entry.vaqueiro)}</strong></div><div class="meta-row"><span>Equipe/Rep.:</span><strong>${escapeHtml(entry.representation || "Não informada")}</strong></div></div><div class="section">Inscrições</div><div class="entry-head">Senha nº <span>${entry.number}</span></div><div class="line"><span class="line-label">Categoria:</span><span class="line-value">${escapeHtml(entry.category)}</span></div><div class="line"><span class="line-label">Cavalo:</span><span class="line-value">${escapeHtml(entry.horse || "Não informado")}</span></div><div class="line"><span class="line-label">Pagamento:</span><span class="pill ${paymentClass}">${paymentLabel}</span></div><div class="dashed"></div><div class="footer"><div class="stamp"><span class="stamp-box">✓</span><span>Impressão em ${new Date().toLocaleString("pt-BR")}</span></div><div>Boa sorte na pista</div><div>Vaqueiro!</div></div></article>`;
    }).join("");
    printWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comprovantes · ${escapeHtml(event?.name || "Connect PDM")}</title><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}.ticket{width:80mm;max-width:80mm;margin:0 auto 3mm;padding:2mm 2.5mm 3mm;background:#fff;page-break-inside:avoid}.brand{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:2mm}.brand-mark{width:12mm;height:12mm;border:2px solid #111;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900}.brand-text{font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;line-height:1.1;text-align:center}.title{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;text-align:center;margin:2mm 0 1mm}.meta{border-top:1px solid #111;border-bottom:1px solid #111;padding:1.5mm 0 1mm;margin:1mm 0}.meta-row{display:flex;justify-content:space-between;align-items:center;gap:2mm;font-size:9px;line-height:1.4}.meta-row strong{font-weight:900}.section{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;margin:2mm 0 1mm}.entry-head{background:#111;color:#fff;padding:1.5mm 2mm;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px}.entry-head span{display:block}.line{display:flex;justify-content:space-between;align-items:flex-start;gap:2mm;padding:1.2mm 0;border-bottom:1px dashed #111;font-size:9px}.line-label{font-weight:700}.line-value{font-weight:900;text-align:right}.pill{display:inline-block;padding:1.2mm 2.8mm;border-radius:2px;background:#e7e1d5;color:#111;font-weight:900;font-size:8.5px;text-transform:uppercase}.pill.paid{background:#dfead9}.pill.pending{background:#f3e5b7}.pill.neutral{background:#e9e9e9}.footer{border-top:1px solid #111;padding-top:2mm;margin-top:2mm;text-align:center;font-size:8.5px;font-weight:900;letter-spacing:0.7px;text-transform:uppercase}.footer .stamp{display:flex;justify-content:center;align-items:center;gap:4px;margin-bottom:1mm}.footer .stamp-box{width:6mm;height:6mm;border:1px solid #111;display:inline-flex;align-items:center;justify-content:center;font-size:6px;font-weight:900}.dashed{border-top:1px dashed #111;margin:2mm 0 0;padding-top:2mm}@page{size:80mm auto;margin:0}@media print{body{width:80mm;margin:0;padding:0}.ticket{padding:0}}</style></head><body>${sheets}<script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
  }
  function escapeHtml(value: string) {
    return value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char] || char,
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="/Simbolo-Principal-Connect-Vaquejada.png" alt="Connect Vaquejada" />
          <div>
            <strong>Connect</strong>
            <span>{park?.name || "Vaquejada"}</span>
          </div>
        </div>
        <div className="offline-pill">
          <WifiOff size={15} /> {backendConfigured ? networkOnline ? `Conta do parque · ${syncStatus.pending} pendente(s)` : `Conta do parque · sem rede · ${syncStatus.pending} pendente(s)` : networkOnline ? "Dados locais neste aparelho" : "Dados locais · sem rede"}
        </div>
        <nav aria-label="Navegação da operação do parque">
          {!isEventScoped && <button
            className={tab === "overview" ? "nav active" : "nav"}
            aria-current={tab === "overview" ? "page" : undefined}
            onClick={() => navigateTab("overview")}
          >
            <House size={18} /> Visão geral
          </button>}
          {canManagePark && park && <button
            className={tab === "park" ? "park-profile-card active" : "park-profile-card"}
            aria-current={tab === "park" ? "page" : undefined}
            onClick={() => navigateTab("park")}
            aria-label={`Abrir perfil de ${park.name}: informações e equipe`}
            title={`Perfil de ${park.name}`}
          >
            <img src="/Simbolo-Principal-Connect-Vaquejada.png" alt="" />
            <span>Perfil do parque</span>
          </button>}
          {canReadEntries && <button
            className={tab === "entries" ? "nav active" : "nav"}
            aria-current={tab === "entries" ? "page" : undefined}
            onClick={() => navigateTab("entries")}
          >
            <ClipboardList size={18} /> Inscrições e senhas
          </button>}
          {canOperateTrack && <button
            className={tab === "track" ? "nav active" : "nav"}
            aria-current={tab === "track" ? "page" : undefined}
            onClick={() => navigateTab("track")}
          >
            <Trophy size={18} /> Pista e resultados
          </button>}
          {!isEventScoped && <button
            className={tab === "settings" ? "nav active" : "nav"}
            aria-current={tab === "settings" ? "page" : undefined}
            onClick={() => navigateTab("settings")}
          >
            <RefreshCw size={18} /> Vaquejadas
          </button>}
          {!isEventScoped && <button
            className={tab === "backup" ? "nav active" : "nav"}
            aria-current={tab === "backup" ? "page" : undefined}
            onClick={() => navigateTab("backup")}
          >
            <Download size={18} /> Backup
          </button>}
          {!isEventScoped && !backendConfigured && <button
            className={tab === "network" ? "nav active" : "nav"}
            aria-current={tab === "network" ? "page" : undefined}
            onClick={() => navigateTab("network")}
          >
            <Wifi size={18} /> Coordenador local
          </button>}
          {!isEventScoped && (!backendConfigured || park) && <button
            className={tab === "audit" ? "nav active" : "nav"}
            aria-current={tab === "audit" ? "page" : undefined}
            onClick={() => navigateTab("audit")}
          >
            <ClipboardList size={18} /> Auditoria
          </button>}
        </nav>
        <div className="sidebar-bottom">
          <span className="dot"></span> {park ? park.city + " / " + park.state : "Dados salvos neste aparelho"}
          {park && <button className="icon-button" onClick={() => void onSignOut()} title="Sair da conta"><LogOut size={15}/></button>}
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <PageHeading eyebrow="OPERAÇÃO DO PARQUE" title={tabLabels[tab]} description={tabDescriptions[tab]} />
          <div className="event-select">
            <label htmlFor="activeEvent">Evento ativo</label>
            <select
              id="activeEvent"
              value={activeEvent}
              onChange={(e) => setActiveEvent(e.target.value)}
            >
              <option value="">Selecione uma vaquejada</option>
              {events.filter((e) => !isEventScoped || park?.event_access?.some((access) => access.event_id === e.id)).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            {(!isEventScoped || currentRole === "event_supervisor") && <button className="secondary" type="button" disabled={!event} onClick={() => event && downloadEventReport(event, eventEntries, eventResults)}>
              Exportar relatório interno CSV
            </button>}
          </div>
        </header>
        {backendConfigured && !networkOnline && <div className="offline-warning" role="status">Sem conexão: mostrando dados previamente carregados. Eventos novos, inscrições, pagamentos e lançamentos/confirmações de resultados ficam numa fila local deste aparelho; edição de vaquejadas, correções oficiais e edição do perfil exigem conexão. A fila não compartilha dados com outros aparelhos.</div>}
        {!backendConfigured && getCoordinatorSettings() && <div className={coordinatorStatus.blocked || coordinatorStatus.lastError || (coordinatorStatus.checked && !coordinatorStatus.connected) ? "sync-warning" : "sync-status"} role="status">{coordinatorStatusMessage}<button className="text-button" onClick={() => void refresh()}>Atualizar</button></div>}
        {backendConfigured && networkOnline && (syncStatus.pending > 0 || syncStatus.blocked > 0) && <div className={syncStatus.blocked ? "sync-warning" : "sync-status"} role="status">
          {syncStatus.blocked > 0 ? `${syncStatus.blocked} operação(ões) precisam de revisão: ${syncStatus.lastError || "conflito de sincronização"}` : `${syncStatus.pending} operação(ões) aguardam sincronização.${syncStatus.lastError ? ` Última falha: ${syncStatus.lastError}` : ""}`}
          {syncStatus.blocked > 0 ? <button className="text-button" onClick={async () => { await retryBlockedSync(); await refresh(); }}>Tentar enviar novamente</button> : <button className="text-button" onClick={async () => { await syncPendingOperations(); await refresh(); }}>Sincronizar agora</button>}
        </div>}
        {notice && (
          <div className="notice">
            <CheckCircle2 size={17} />
            {notice}
          </div>
        )}
        {loading ? (
          <div className="empty">Carregando dados locais…</div>
        ) : (
          <>
            {tab === "overview" && (
              <section className="content operational-content">
                {!events.length ? (
                  <div className="welcome card">
                    <div className="welcome-icon">
                      <Trophy size={26} />
                    </div>
                    <h2>Vamos cadastrar a primeira vaquejada</h2>
                    <p>
                      {backendConfigured
                        ? "Cadastre a primeira vaquejada para começar a operação deste parque."
                        : "Cadastre a primeira vaquejada. Os dados serão salvos neste aparelho e não serão sincronizados com uma conta do servidor."}
                    </p>
                    <button
                      className="primary"
                      onClick={() => openEventEditor()}
                    >
                      <Plus size={17} /> Cadastrar vaquejada
                    </button>
                  </div>
                ) : !event ? (
                  <EmptySelect />
                ) : (
                  <>
                    <div className="event-banner">
                      <div>
                        <span className="eyebrow light">
                          EVENTO SELECIONADO
                        </span>
                        <h2>{event?.name || "Selecione um evento"}</h2>
                        <p>
                          {event?.location || "Local não informado"}{" "}
                          {event?.date ? `• ${formatDateBR(event.date)}` : ""}
                        </p>
                      </div>
                      <span className="event-tag">{event?.categories?.join(" • ")}</span>
                      {!isEventScoped && <button className="secondary" type="button" disabled={!event} onClick={() => { if (event) openEventEditor(event.id); }}><Pencil size={15} /> Editar vaquejada</button>}
                    </div>
                    <div className="stats-grid">
                      <Stat
                        label="Senhas cadastradas"
                        value={eventEntries.length}
                        hint="Inscrições deste evento"
                      />
                      {(!isEventScoped || currentRole === "event_supervisor") && <Stat
                        label="Pagamentos confirmados"
                        value={eventEntries.filter((e) => getPaymentStatus(e) === "paid").length}
                        hint="Senhas pagas"
                      />}
                      <Stat
                        label="Resultados confirmados"
                        value={
                          eventResults.filter((r) => r.status === "official")
                            .length
                        }
                        hint="Confirmação do registro; não significa classificação oficial"
                      />
                      <Stat
                        label="Pontos registrados"
                        value={eventResults
                          .filter((r) => r.status === "official")
                          .reduce((s, r) => s + r.points, 0)}
                        hint="Soma provisória dos pontos registrados"
                      />
                    </div>
                    <div className="section-head">
                      <div>
                        <h2>Apuração provisória</h2>
                        <p>Soma dos pontos registrados; sem posições ou desempates até aprovação do regulamento.</p>
                      </div>
                      {(!isEventScoped || currentRole === "judge" || currentRole === "track_operator") && <button
                        className="secondary"
                        onClick={() => navigateTab("track")}
                      >
                        Registrar resultado
                      </button>}
                    </div>
                    {(!isEventScoped || currentRole !== "office") && !classificationReadiness.ready && <div className="offline-warning" role="status">{classificationReadiness.reason} A lista abaixo é somente uma soma informativa dos pontos registrados e não deve ser usada nem divulgada como classificação do evento.</div>}
                    {(!isEventScoped || currentRole !== "office") && (event?.categories || []).map((category) => (
                      <div key={category} style={{ marginBottom: 18 }}>
                        <div className="section-head"><h2>{category}</h2></div>
                        <ProvisionalPoints rows={provisionalPoints
                          .filter((x) => x.entry.category === category)
                          .slice(0, 5)
                          .map((x) => ({ name: x.entry.vaqueiro, number: x.entry.number, points: x.points }))} />
                      </div>
                    ))}
                  </>
                )}
              </section>
            )}
            {tab === "settings" && (
              <section className="content operational-content">
                <div className="section-head">
                  <div>
                    <h2>Vaquejadas cadastradas</h2>
                    <p>Selecione uma vaquejada no topo para trabalhar com ela.</p>
                  </div>
                  <button className="primary" type="button" onClick={() => openEventEditor()}>
                    <Plus size={17} /> Cadastrar vaquejada
                  </button>
                </div>
                <div className="card">
                  {events.length === 0 ? (
                    <div className="empty small">
                      Nenhuma vaquejada cadastrada ainda.
                    </div>
                  ) : (
                    <div className="event-list">
                      {events.map((e) => (
                        <div className={`event-list-row ${backendConfigured && park?.access_role === "park_manager" ? "event-list-row-publication" : ""}`} key={e.id}>
                          <button
                            className={`event-list-item ${activeEvent === e.id ? "selected" : ""}`}
                            onClick={() => setActiveEvent(e.id)}
                          >
                            <div>
                              <strong>{e.name}</strong>
                              <span>
                                {e.location || "Local não informado"} • {formatDateBR(e.date)}{e.endsAt && e.endsAt !== e.date ? ` a ${formatDateBR(e.endsAt)}` : ""} • {(e.categories || []).join(", ")}
                              </span>
                            </div>
                            <span className={`event-state ${getEventState(e.date, e.endsAt || e.date)}`}>{getEventStateLabel(getEventState(e.date, e.endsAt || e.date))}</span>
                          </button>
                          <div className="event-list-actions">
                          <button className="icon-button" type="button" aria-label={`Editar ${e.name}`} onClick={() => openEventEditor(e.id)}>
                            <Pencil size={15} />
                            Editar
                          </button>
                          {backendConfigured && park?.access_role === "park_manager" && <button className="text-button" type="button" disabled={["approved", "published"].includes(publicationStatuses[e.id]?.status || "")} onClick={async () => {
                            const publication = publicationStatuses[e.id];
                            const description = window.prompt("Resumo que poderá ser exibido no site público. Confirme que as informações estão autorizadas pelo parque:", "");
                            if (description === null) return;
                            const initialPrizes = (publication?.public_prizes || (e.prizes || []).filter((prize): prize is string => typeof prize === "string")).join("\n");
                            const prizesText = window.prompt("Premiações autorizadas para divulgação (uma por linha; deixe vazio se não houver confirmação):", initialPrizes);
                            if (prizesText === null) return;
                            try {
                              await confirmParkEventPublication(e.id, description, prizesText.split("\n").map((prize) => prize.trim()).filter(Boolean));
                              setPublicationStatuses((current) => ({ ...current, [e.id]: { event_id: e.id, status: "park_confirmed", public_description: description, public_prizes: prizesText.split("\n").map((prize) => prize.trim()).filter(Boolean) } }));
                              try {
                                const rows = await getMyEventPublicationStatuses();
                                setPublicationStatuses(Object.fromEntries(rows.map((row) => [row.event_id, row])));
                              } catch { /* Preserve the confirmed state from the successful mutation. */ }
                              setNotice("Dados confirmados pelo parque e enviados para revisão da Connect. O evento ainda não está público.");
                            } catch (error) {
                              setNotice(error instanceof Error ? error.message : "Não foi possível enviar os dados para revisão.");
                            }
                          }}>{publicationStatuses[e.id]?.status === "published" ? "Evento publicado" : publicationStatuses[e.id]?.status === "approved" ? "Aprovado · aguardando publicação" : publicationStatuses[e.id]?.status === "park_confirmed" ? "Atualizar confirmação" : ["withdrawn", "changes_requested"].includes(publicationStatuses[e.id]?.status || "") ? "Reenviar para revisão" : "Confirmar dados para divulgação"}</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
            {tab === "park" && park && (
              <section className="content operational-content">
                <div className="park-profile-hero">
                  <div className="park-profile-mark"><img src="/Simbolo-Connect-Vaquejada.png" alt="" /></div>
                  <div className="park-profile-title"><span className="eyebrow">PERFIL DO PARQUE</span><h2>{park.name}</h2><p>{park.address} <span aria-hidden="true">·</span> {park.city}/{park.state}</p></div>
                  <span className="park-profile-badge">Conta do parque</span>
                </div>
                <ParkEditor park={park} onSave={onSavePark} />
                {park.access_role === "park_manager" && backendConfigured && <div className="park-team-section"><div className="park-team-intro"><span className="eyebrow">ACESSO E COLABORAÇÃO</span><h2>Equipe do parque</h2><p>Convide pessoas e acompanhe quem tem acesso à operação.</p></div><TeamManager park={park} /></div>}
              </section>
            )}
            {tab === "backup" && (
              <section className="content operational-content">
                <div className="card form-card backup-card">
                  <div className="card-heading"><div className="icon-box"><Download size={20} /></div><div><h2>Cópia de segurança dos dados</h2><p>Exporte vaquejadas, inscrições e resultados disponíveis nesta conta/aparelho.</p></div></div>
                  <button className="primary" type="button" onClick={async () => {
                    try {
                      const localAudit = backendConfigured ? [] : await getAuditRecords();
                      downloadBackup(events, entries, results, localAudit, reservations);
                      setNotice("Arquivo de backup exportado.");
                    } catch { setNotice("O navegador não conseguiu gerar o arquivo de backup."); }
                  }}><Download size={16} /> Exportar backup JSON</button>
                  {backendConfigured ? (
                    <div className="form-note"><CircleAlert size={17} /> A exportação inclui os dados que a conta autenticada pode consultar. A restauração remota está desabilitada; não importe arquivos diretamente no banco.</div>
                  ) : (
                    <Field label="Restaurar backup local JSON">
                      <input type="file" accept="application/json,.json" onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        void importBackupFile(file);
                        event.currentTarget.value = "";
                      }} />
                    </Field>
                  )}
                  <p className="subtle">A restauração local acrescenta registros, preserva os já existentes, aceita reimportação idempotente e interrompe o processo ao detectar IDs ou números de senha conflitantes. O arquivo contém dados pessoais e não é criptografado; guarde cópias em local protegido e também fora deste aparelho.</p>
                </div>
              </section>
            )}
            {tab === "network" && !backendConfigured && (
              <section className="content operational-content">
                <div className="card form-card">
                  <div className="card-heading"><div className="icon-box"><Wifi size={20} /></div><div><h2>Coordenador do parque</h2><p>Configure o serviço Node instalado em um computador conectado à rede Wi-Fi do parque.</p></div></div>
                  <form onSubmit={async (e) => { e.preventDefault(); try { saveCoordinatorSettings(coordinatorSettings); setCoordinatorConfigured(true); const health = await checkCoordinator(); setCoordinatorHealth(health); const status = await syncLocalCoordinator(); setCoordinatorStatus(status); if (!status.connected) throw new Error(status.lastError || "Não foi possível autenticar no coordenador local."); await refresh(); setNotice("Conexão autenticada com o coordenador local validada."); } catch (error) { setCoordinatorHealth(null); setNotice(error instanceof Error ? error.message : "Não foi possível conectar ao coordenador."); } }}>
                    <Field label="Endereço do coordenador"><input required type="url" placeholder="https://192.168.1.20:8787" value={coordinatorSettings.url} onChange={(e) => setCoordinatorSettings({ ...coordinatorSettings, url: e.target.value })} /></Field>
                    <Field label="Token individual do operador"><input required minLength={32} type="password" autoComplete="new-password" value={coordinatorSettings.token} onChange={(e) => setCoordinatorSettings({ ...coordinatorSettings, token: e.target.value })} /></Field>
                    <button className="primary" type="submit"><Wifi size={16} /> Salvar e testar conexão</button>
                    {coordinatorConfigured && <button className="secondary" type="button" onClick={() => { clearCoordinatorSettings(); setCoordinatorConfigured(false); setCoordinatorSettings({ url: "", token: "" }); setCoordinatorHealth(null); setCoordinatorStatus({ pending: 0, blocked: 0, checked: false, connected: false }); setNotice("Credencial do coordenador removida deste aparelho."); }}>Remover credencial deste aparelho</button>}
                  </form>
                  {coordinatorHealth && <p className="form-note">Conectado ao servidor local.</p>}
                  <p className="subtle">A fila fica salva neste aparelho até ser validada pelo coordenador; a credencial deve pertencer ao operador autenticado e fica no armazenamento local deste aparelho. O servidor rejeita token expirado/desativado e aplica permissões por operação. Configure HTTPS com certificado confiável. Este coordenador local não consulta alterações recentes de perfil do Supabase: revogação exige desativar/rotacionar a credencial também no servidor e reiniciá-lo.</p>
                </div>
                {getCoordinatorSettings() && <CoordinatorQueueReview onUpdated={refresh} />}
              </section>
            )}
            {tab === "audit" && (
              <section className="content operational-content">
                <div className="card table-card">
                  <div className="table-title">
                    <h2>Histórico de alterações</h2>
                    <span className="subtle">{backendConfigured ? "Até 250 registros recentes · acesso protegido pelo banco" : "Registro local deste aparelho · sem identidade autenticada"}</span>
                  </div>
                  {auditLoading ? <div className="empty small">Carregando auditoria…</div> : auditRecords.length === 0 ? (
                    <div className="empty small">Nenhuma alteração registrada neste {backendConfigured ? "parque" : "aparelho"}.</div>
                  ) : <div className="table-scroll"><table>
                    <thead><tr><th>Data e hora</th><th>Ação</th><th>Registro</th><th>Evento</th><th>Responsável</th><th>Detalhes</th></tr></thead>
                    <tbody>{auditRecords.map((record) => <tr key={record.id}>
                      <td>{new Date(record.occurredAt).toLocaleString("pt-BR")}</td>
                      <td>{auditActionLabel(record.action)}</td>
                      <td>{auditTableLabel(record.recordTable)} · {record.recordId.slice(0, 8)}</td>
                      <td>{events.find((item) => item.id === record.eventId)?.name || (record.eventId ? record.eventId.slice(0, 8) : "Conta do parque")}</td>
                      <td>{record.actorLabel || (record.actorUserId ? record.actorUserId.slice(0, 8) : "Não identificado")}</td>
                      <td><details><summary>Ver antes/depois</summary><pre className="audit-json">{JSON.stringify({ antes: record.beforeData, depois: record.afterData }, null, 2)}</pre></details></td>
                    </tr>)}</tbody>
                  </table></div>}
                </div>
              </section>
            )}
            {tab === "entries" && (
              <section className="content operational-content">
                {!event ? (
                  <EmptySelect />
                ) : (
                  <>
                    <div className="section-head">
                      <div>
                        <h2>Nova inscrição</h2>
                        <p>
                          O cavalo e a representação pertencem à senha, não
                          apenas ao vaqueiro.
                        </p>
                      </div>
                      <span className="count-pill">
                        {eventEntries.length}{event.ticketQuantity ? ` / ${event.ticketQuantity}` : ""} senhas
                      </span>
                    </div>
                    <div className="card form-card">
                      <form
                        key={entryFormKey}
                        onSubmit={async (e) => {
                          e.preventDefault();
                          try {
                            const saved = await createEntry(new FormData(e.currentTarget));
                            if (saved) {
                              setSelectedReservationId("");
                              setEntryFormKey((value) => value + 1);
                            }
                          } catch (error) {
                            setNotice(error instanceof Error ? error.message : "Não foi possível cadastrar a inscrição.");
                          }
                        }}
                      >
                        <div className="form-row three">
                          <Field label="Número da senha">
                            <input
                              name="number"
                              type="number"
                              min="1"
                              required
                              placeholder="Ex.: 150"
                              value={selectedReservation?.number ?? undefined}
                              readOnly={Boolean(selectedReservation)}
                            />
                          </Field>
                          <Field label="Vaqueiro / puxador">
                            <input
                              name="vaqueiro"
                              required
                              placeholder="Nome completo"
                            />
                          </Field>
                          <Field label="Categoria">
                            <select
                              name="entryCategory"
                              required
                              defaultValue={event.categories?.[0] || ""}
                            >
                              {event.categories?.map((category) => <option key={category}>{category}</option>)}
                            </select>
                          </Field>
                        </div>
                        {selectedReservation && <><input type="hidden" name="reservationId" value={selectedReservation.id} /><p className="form-note">Esta inscrição converterá a reserva de {selectedReservation.reservedFor}.</p></>}
                        <div className="form-row">
                          <Field label="Cavalo">
                            <input name="horse" placeholder="Nome do cavalo" />
                          </Field>
                          <Field label="Representação">
                            <input
                              name="representation"
                              placeholder="Rancho, equipe ou representante"
                            />
                          </Field>
                        </div>
                        <div className="payment-fields">
                          <div className="form-row three">
                            <Field label="Situação do pagamento">
                              <select name="paymentStatus" defaultValue="pending">
                                <option value="pending">Pendente</option>
                                <option value="paid">Pago</option>
                                <option value="exempt">Isento</option>
                              </select>
                            </Field>
                            <Field label="Valor recebido (R$)">
                              <input name="paidAmount" type="number" min="0" step="0.01" defaultValue={0} />
                            </Field>
                            <Field label="Forma de pagamento">
                              <select name="paymentMethod" defaultValue="">
                                <option value="">Não informada</option>
                                <option value="cash">Dinheiro</option>
                                <option value="pix">Pix</option>
                                <option value="transfer">Transferência</option>
                                <option value="card">Cartão</option>
                                <option value="other">Outra</option>
                              </select>
                            </Field>
                          </div>
                          {!backendConfigured && <Field label="Recebido por (registro local)"><input name="paymentReceivedBy" placeholder="Nome do operador" /></Field>}
                        </div>
                        <button className="primary" type="submit">
                          <Plus size={17} /> Salvar inscrição
                        </button>
                      </form>
                    </div>
                    <div className="card form-card">
                      <div className="card-heading"><div className="icon-box"><ClipboardList size={20} /></div><div><h2>Reservar senha</h2><p>A reserva ocupa a capacidade e expira automaticamente no prazo informado.</p></div></div>
                      <form onSubmit={async (e) => { e.preventDefault(); try { await createReservation(new FormData(e.currentTarget)); e.currentTarget.reset(); } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível reservar a senha."); } }}>
                        <div className="form-row three">
                          <Field label="Número"><input name="reservationNumber" type="number" min="1" required /></Field>
                          <Field label="Reservada para"><input name="reservedFor" required /></Field>
                          <Field label="Expira em"><input name="expiresAt" type="datetime-local" required /></Field>
                        </div>
                        <Field label="Motivo (opcional)"><input name="reservationReason" /></Field>
                        <button className="secondary" type="submit" disabled={backendConfigured && !networkOnline}><Plus size={16} /> Criar reserva</button>
                      </form>
                      {eventReservations.length > 0 && <div className="table-scroll"><table><thead><tr><th>Senha</th><th>Reservada para</th><th>Validade</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
                        {eventReservations.map((reservation) => <tr key={reservation.id}><td>{reservation.number}</td><td>{reservation.reservedFor}</td><td>{new Date(reservation.expiresAt).toLocaleString("pt-BR")}</td><td>{reservation.status === "active" ? "Ativa" : reservation.status === "expired" ? "Expirada" : reservation.status === "converted" ? "Convertida" : "Liberada"}</td><td>{isReservationActive(reservation) && <><button className="text-button" type="button" onClick={() => { setSelectedReservationId(reservation.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Cadastrar inscrição</button> <button className="text-button" type="button" onClick={async () => { const reason = window.prompt("Motivo para liberar esta reserva (mínimo 10 caracteres):"); if (!reason) return; try { await releaseTicketReservation(reservation, reason); await refresh(); setNotice("Reserva liberada."); } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível liberar a reserva."); } }}>Liberar</button></>}</td></tr>)}
                      </tbody></table></div>}
                    </div>
                    <div className="card table-card">
                      <div className="table-title">
                        <h2>Senhas cadastradas</h2>
                        <span className="subtle">{visibleEntries.length} de {eventEntries.length} · {eventEntries.filter((row) => getPaymentStatus(row) === "paid").length} pagas · {eventEntries.filter((row) => getPaymentStatus(row) === "pending").length} pendentes</span>
                      </div>
                      {eventEntries.length > 0 && <div className="form-card" style={{ paddingTop: 8 }}>
                        <div className="form-row three">
                          <Field label="Pesquisar senha, vaqueiro, cavalo ou representação"><input value={entrySearch} onChange={(e) => setEntrySearch(e.target.value)} placeholder="Digite para filtrar" /></Field>
                          <Field label="Categoria"><select value={entryCategoryFilter} onChange={(e) => setEntryCategoryFilter(e.target.value)}><option value="">Todas</option>{getEventCategories(event).map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
                          <Field label="Pagamento"><select value={entryPaymentFilter} onChange={(e) => setEntryPaymentFilter(e.target.value)}><option value="">Todos</option><option value="paid">Pago</option><option value="pending">Pendente</option><option value="exempt">Isento</option></select></Field>
                        </div>
                        <div className="section-head" style={{ marginTop: 12, marginBottom: 0 }}>
                          <Field label="Situação da inscrição"><select value={entryStatusFilter} onChange={(e) => setEntryStatusFilter(e.target.value)}><option value="">Todas</option><option value="active">Ativa</option><option value="cancelled">Cancelada</option></select></Field>
                          <button className="text-button" type="button" onClick={() => { setEntrySearch(""); setEntryCategoryFilter(""); setEntryPaymentFilter(""); setEntryStatusFilter(""); }}>Limpar filtros</button>
                          <button className="secondary" type="button" disabled={!visibleEntries.length} onClick={() => printEntrySequence(visibleEntries)}><Printer size={16} /> Imprimir sequência ({visibleEntries.length})</button>
                        </div>
                      </div>}
                      {eventEntries.length === 0 ? (
                        <div className="empty small">
                          Nenhuma inscrição cadastrada.
                        </div>
                      ) : (
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Senha</th>
                                <th>Vaqueiro</th>
                                <th>Cavalo</th>
                                <th>Representação</th>
                                <th>Categoria</th>
                                <th>Pagamento</th>
                                <th>Forma</th>
                                <th>Recebido em</th>
                                <th>Ação</th>
                                <th>Comprovante</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleEntries.length === 0 && <tr><td colSpan={10} className="empty-cell">Nenhuma senha corresponde aos filtros selecionados.</td></tr>}
                              {visibleEntries
                                .map((entry) => (
                                  <Fragment key={entry.id}>
                                  <tr>
                                    <td>
                                      <strong className="senha-number">
                                        {entry.number}
                                      </strong>
                                    </td>
                                    <td>
                                      {entry.vaqueiro}{entry.partner ? <span className="cell-sub">Dupla: {entry.partner}</span> : null}
                                      <span className="cell-sub">
                                        {entry.category}
                                      </span>
                                    </td>
                                    <td>{entry.horse || "—"}</td>
                                    <td>{entry.representation || "—"}</td>
                                    <td>{entry.category}<span className="cell-sub">{getEntryStatus(entry) === "cancelled" ? "Cancelada" : "Ativa"}</span></td>
                                    <td>
                                      <span
                                        className={entry.paymentRestricted ? "status" : getPaymentStatus(entry) === "paid"
                                          ? "status paid" : getPaymentStatus(entry) === "exempt" ? "status exempt" : "status unpaid"}
                                      >
                                        {entry.paymentRestricted ? "Restrito" : getPaymentStatus(entry) === "paid" ? `Pago · ${formatBRL(entry.paidAmount || 0)}` : getPaymentStatus(entry) === "exempt" ? "Isento" : "Pendente"}
                                      </span>
                                    </td>
                                    <td>{entry.paymentRestricted ? "Restrito" : entry.paymentMethod ? paymentMethodLabel(entry.paymentMethod) : "—"}</td>
                                    <td>{entry.paymentRestricted ? "Restrito" : entry.paidAt ? new Date(entry.paidAt).toLocaleString("pt-BR") : "—"}</td>
                                    <td>
                                      {getEntryStatus(entry) === "active" ? <>
                                        {canChangePayments && <button className="text-button" onClick={() => { setPaymentEntryId(paymentEntryId === entry.id ? "" : entry.id); setTransferEntryId(""); }}>{paymentEntryId === entry.id ? "Fechar" : "Pagamento"}</button>}
                                        {!isEventScoped && <><button className="text-button" onClick={() => { setTransferEntryId(transferEntryId === entry.id ? "" : entry.id); setPaymentEntryId(""); }}>{transferEntryId === entry.id ? "Fechar" : "Transferir"}</button><button className="text-button danger-text" onClick={() => void cancelEntry(entry)}>Cancelar senha</button></>}
                                      </> : <span className="cell-sub">{entry.statusReason || "Cancelada"}</span>}
                                    </td>
                                    <td>
                                      <button
                                        className="icon-button"
                                        title="Imprimir comprovante"
                                        onClick={() => printEntry(entry)}
                                      >
                                        <Printer size={17} /> Imprimir
                                      </button>
                                    </td>
                                  </tr>
                                   {paymentEntryId === entry.id && getEntryStatus(entry) === "active" && <tr><td colSpan={10}><PaymentEditor entry={entry} expectedAmount={event.ticketPrice || 0} onSave={updateEntryPayment} onCancel={() => setPaymentEntryId("")} /></td></tr>}
                                   {transferEntryId === entry.id && getEntryStatus(entry) === "active" && <tr><td colSpan={10}><EntryTransferEditor entry={entry} categories={event.categories || []} onSave={(changes, reason) => saveTransfer(entry, changes, reason)} onCancel={() => setTransferEntryId("")} /></td></tr>}
                                  </Fragment>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            )}
            {tab === "track" && (
              <section className="content operational-content">
                {!event ? (
                  <EmptySelect />
                ) : (
                  <>
                    <Suspense fallback={<div className="empty" role="status">Carregando console da pista...</div>}>
                      <TrackConsole event={event} entries={eventEntries} accessRole={currentRole || null} onMessage={setNotice} />
                    </Suspense>
                    <div hidden>
                      <div>
                        <span className="eyebrow light">
                          LANÇAMENTO DE RESULTADO
                        </span>
                        <h2>{event.name}</h2>
                        <p>
                          {event.scoringMode === "instant"
                            ? "Registro imediato"
                            : "Resultados exigem confirmação"}
                        </p>
                      </div>
                    </div>
                    <div className="card form-card">
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          try { await addResult(new FormData(e.currentTarget)); }
                          catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível registrar o resultado."); }
                        }}
                      >
                        <div className="form-row three">
                          <Field label="Senha">
                            <select name="entryId" required defaultValue="">
                              <option value="" disabled>
                                Selecione a senha
                              </option>
                              {[...eventEntries.filter((entry) => getEntryStatus(entry) === "active")]
                                .sort((a, b) => a.number - b.number)
                                .map((en) => (
                                  <option key={en.id} value={en.id}>
                                    {en.number} — {en.vaqueiro} ({en.category})
                                  </option>
                                ))}
                            </select>
                          </Field>
                          <Field label="Rodízio configurado"><select name="rodizio" required defaultValue={event.competition?.rotations.slice().sort((a, b) => a.order - b.order)[0]?.name || ""}>
                            {!event.competition?.rotations.length && <option value="">Configure rodízios no evento</option>}
                            {event.competition?.rotations.slice().sort((a, b) => a.order - b.order).map((rotation) => <option key={rotation.id} value={rotation.name}>{rotation.order}. {rotation.name}</option>)}
                          </select></Field>
                          <Field label="Número do boi">
                            <input
                              name="bullNumber"
                              type="number"
                              min="1"
                              defaultValue="1"
                            />
                          </Field>
                        </div>
                        <div className="form-row three">
                          <Field label="Tipo de resultado">
                            <select name="resultType" defaultValue="points">
                              <option value="points">Pontuação</option>
                              <option value="zero">Zero</option>
                              <option value="return">Retorno a tratar</option>
                            </select>
                          </Field>
                          <Field label="Pontos informados pelo juiz">
                            <input
                              name="points"
                              type="number"
                              min="0"
                              defaultValue="0"
                            />
                          </Field>
                          <Field label="Operador">
                            <input
                              name="operator"
                              placeholder="Nome do locutor/auxiliar"
                              defaultValue="Operador"
                            />
                          </Field>
                        </div>
                        <div className="form-note">
                          <CircleAlert size={17} /> Pontos são lançados conforme
                          informado pelo juiz. Este protótipo ainda não aplica
                          todas as regras de retorno e rodízio do regulamento.
                        </div>
                        <button className="primary" type="submit">
                          <CheckCircle2 size={17} /> Registrar resultado
                        </button>
                      </form>
                    </div>
                    <div className="card table-card">
                      <div className="table-title">
                        <h2>Histórico de resultados</h2>
                        <span className="subtle">
                          {eventResults.length} registros
                        </span>
                      </div>
                      {eventResults.length === 0 ? (
                        <div className="empty small">
                          Ainda não há resultados registrados.
                        </div>
                      ) : (
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Senha</th>
                                <th>Categoria</th>
                                <th>Rodízio</th>
                                <th>Boi</th>
                                <th>Resultado</th>
                                <th>Pontos informados</th>
                                <th>Status</th>
                                <th>Ação</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...eventResults]
                                .sort((a, b) =>
                                  b.createdAt.localeCompare(a.createdAt),
                                )
                                .map((r) => {
                                  const en = eventEntries.find(
                                    (x) => x.id === r.entryId,
                                  );
                                  return (
                                    <Fragment key={r.id}><tr>
                                      <td>
                                        {en?.number ?? "—"} —{" "}
                                        {en?.vaqueiro ?? "Inscrição removida"}
                                      </td>
                                      <td>{en?.category ?? "—"}</td>
                                      <td>{r.rodizio}</td>
                                      <td>{r.bullNumber}</td>
                                      <td>
                                        {r.resultType === "points"
                                          ? "Pontuação"
                                          : r.resultType === "zero"
                                            ? "Zero"
                                            : "Retorno"}
                                      </td>
                                      <td>
                                        <strong>{r.points}</strong>
                                      </td>
                                      <td>
                                        <span
                                          className={
                                            r.status === "official"
                                              ? "status paid"
                                              : r.status === "pending" ? "status pending" : "status exempt"
                                          }
                                        >
                                          {r.status === "official" ? "Confirmado" : r.status === "pending" ? "Pendente de confirmação" : "Substituído"}
                                        </span>
                                        {r.correctionReason && <span className="cell-sub">Motivo: {r.correctionReason}</span>}
                                      </td>
                                      <td>
                                        {r.status === "pending" ? (
                                          <button
                                            className="text-button"
                                            onClick={() => confirmResult(r)}
                                          >
                                            Confirmar
                                          </button>
                                        ) : r.status === "official" ? (
                                          <button className="text-button" onClick={() => setCorrectionResultId(correctionResultId === r.id ? "" : r.id)}>
                                            {correctionResultId === r.id ? "Fechar" : "Corrigir"}
                                          </button>
                                        ) : (
                                          <span className="subtle">—</span>
                                        )}
                                      </td>
                                    </tr>{correctionResultId === r.id && <tr><td colSpan={8}><ResultCorrectionEditor result={r} onSave={(form) => correctResult(form, r)} onCancel={() => setCorrectionResultId("")} /></td></tr>}</Fragment>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        )}
        {eventModalOpen && (
          <EventEditorModal
            key={editingEventId || "new-event"}
            event={editingEvent}
            onClose={closeEventEditor}
            onSave={async (form) => {
              try {
                return await createEvent(form);
              } catch (error) {
                setNotice(error instanceof Error ? error.message : "Não foi possível cadastrar o evento.");
                return false;
              }
            }}
          />
        )}
        <footer>
          Operacao do parque · os dados ficam neste aparelho ou na conta autenticada.
          Acesso entre aparelhos depende de sincronizacao configurada.
        </footer>
      </main>
    </div>
  );
}
function EntryTransferEditor({ entry, categories, onSave, onCancel }: {
  entry: Entry; categories: Category[];
  onSave: (changes: EntryTransferChanges, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return <form className="payment-editor" onSubmit={async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const vaqueiro = String(data.get("vaqueiro") || "").trim();
    const reason = String(data.get("reason") || "").trim();
    if (!vaqueiro || reason.length < 10) return;
    setBusy(true);
    try {
      await onSave({ vaqueiro, partner: String(data.get("partner") || "").trim(), horse: String(data.get("horse") || "").trim(), representation: String(data.get("representation") || "").trim(), category: String(data.get("category") || "") as Category }, reason);
    } finally { setBusy(false); }
  }}>
    <strong>Transferir senha {entry.number} · o histórico anterior será preservado</strong>
    <div className="form-row three">
      <Field label="Novo vaqueiro"><input name="vaqueiro" required defaultValue={entry.vaqueiro}/></Field>
      <Field label="Cavalo"><input name="horse" defaultValue={entry.horse}/></Field>
      <Field label="Representação"><input name="representation" defaultValue={entry.representation}/></Field>
    </div>
    <div className="form-row two">
      <Field label="Categoria"><select name="category" defaultValue={entry.category}>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
      <Field label="Motivo (mínimo 10 caracteres)"><input name="reason" required minLength={10} placeholder="Informe o motivo da transferência"/></Field>
    </div>
    <div className="payment-editor-actions"><button className="primary" disabled={busy}>{busy ? "Transferindo…" : "Confirmar transferência"}</button><button className="secondary" type="button" onClick={onCancel}>Cancelar</button></div>
  </form>;
}

function PaymentEditor({ entry, expectedAmount, onSave, onCancel }: {
  entry: Entry; expectedAmount: number; onSave: (entry: Entry) => Promise<void>; onCancel: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  return <form className="payment-editor" onSubmit={async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const status = String(data.get("paymentStatus") || "pending") as PaymentStatus;
    const amount = status === "paid" ? Number(data.get("paidAmount") || 0) : 0;
    if (!Number.isFinite(amount) || amount < 0) { setNotice("Informe um valor recebido válido."); return; }
    const method = status === "paid" && data.get("paymentMethod") ? String(data.get("paymentMethod")) as PaymentMethod : undefined;
    const updated: Entry = {
      ...entry, paymentStatus: status, paid: status === "paid", paidAmount: amount,
      paymentMethod: method, paidAt: status === "paid" ? entry.paidAt || new Date().toISOString() : undefined,
      paidBy: status === "paid" ? entry.paidBy || (String(data.get("paymentReceivedBy") || "").trim() || undefined) : undefined,
    };
    setBusy(true); setNotice("");
    try { await onSave(updated); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao atualizar o pagamento."); }
    finally { setBusy(false); }
  }}>
    <div className="payment-editor-fields">
      <Field label="Situação"><select name="paymentStatus" defaultValue={getPaymentStatus(entry)}><option value="pending">Pendente</option><option value="paid">Pago</option><option value="exempt">Isento</option></select></Field>
      <Field label="Valor recebido (R$)"><input name="paidAmount" type="number" min="0" step="0.01" defaultValue={entry.paid ? entry.paidAmount ?? 0 : 0}/></Field>
      <Field label="Forma de pagamento"><select name="paymentMethod" defaultValue={entry.paymentMethod || ""}><option value="">Não informada</option><option value="cash">Dinheiro</option><option value="pix">Pix</option><option value="transfer">Transferência</option><option value="card">Cartão</option><option value="other">Outra</option></select></Field>
      {!backendConfigured && <Field label="Recebido por"><input name="paymentReceivedBy" defaultValue={entry.paidBy || ""} placeholder="Operador"/></Field>}
    </div>
    {notice && <div className="account-error" role="alert">{notice}</div>}
    <div className="payment-editor-actions"><button className="primary" disabled={busy}>{busy ? "Salvando…" : "Salvar pagamento"}</button><button className="secondary" type="button" onClick={onCancel}>Cancelar</button></div>
  </form>;
}

function ResultCorrectionEditor({ result, onSave, onCancel }: {
  result: RunResult; onSave: (form: FormData) => Promise<void>; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return <form className="result-correction" onSubmit={async (event) => {
    event.preventDefault();
    setBusy(true);
    try { await onSave(new FormData(event.currentTarget)); }
    finally { setBusy(false); }
  }}>
    <strong>Corrigir resultado confirmado · senha vinculada preservada</strong>
    <div className="form-row three">
      <Field label="Rodízio"><input name="rodizio" required defaultValue={result.rodizio}/></Field>
      <Field label="Número do boi"><input name="bullNumber" type="number" min="1" required defaultValue={result.bullNumber}/></Field>
      <Field label="Tipo de resultado"><select name="resultType" defaultValue={result.resultType}><option value="points">Pontuação</option><option value="zero">Zero</option><option value="return">Retorno</option></select></Field>
    </div>
    <div className="form-row two">
      <Field label="Pontos corrigidos"><input name="points" type="number" min="0" step="0.01" required defaultValue={result.points}/></Field>
      {!backendConfigured && <Field label="Operador responsável"><input name="operator" required defaultValue="Operador local"/></Field>}
    </div>
    <Field label="Motivo obrigatório (mínimo 10 caracteres)"><textarea name="reason" required minLength={10} rows={3} placeholder="Descreva por que o resultado está sendo corrigido"/></Field>
    <div className="payment-editor-actions"><button className="primary" disabled={busy}>{busy ? "Registrando…" : "Registrar correção"}</button><button className="secondary" type="button" onClick={onCancel}>Cancelar</button></div>
  </form>;
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="stat card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
function formatBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
function paymentMethodLabel(method: PaymentMethod) {
  return ({ cash: "Dinheiro", pix: "Pix", transfer: "Transferência", card: "Cartão", other: "Outra" })[method];
}
function paymentStatusLabel(status: PaymentStatus) {
  return status === "paid" ? "Pago" : status === "exempt" ? "Isento" : "Pendente";
}
function auditActionLabel(action: AuditRecord["action"]) {
  return action === "INSERT" ? "Inclusão" : action === "UPDATE" ? "Alteração" : "Exclusão";
}
function auditTableLabel(table: string) {
  return table === "parks" ? "Dados do parque" : table === "events" ? "Vaquejada" : table === "entries" ? "Inscrição" : table === "run_results" ? "Resultado" : table === "result_corrections" ? "Correção de resultado" : table === "backups" ? "Restauração" : table;
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function EventEditorModal({ event, onSave, onClose }: {
  event: EventConfig | undefined;
  onSave: (form: FormData) => Promise<boolean>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<Array<{ id: string; date: string }>>(() =>
    event?.competition?.days?.length ? event.competition.days.map((day) => ({ id: day.id || uid(), date: day.date })) : []
  );
  const [rotations, setRotations] = useState<Array<{ id: string; name: string; dayId: string; order: number; callOrder: "ticket-asc" | "ticket-desc"; capacity: string; racesPerEntry: string; ticketFrom: string; ticketTo: string }>>(() =>
    event?.competition?.rotations?.length ? event.competition.rotations.map((rotation) => ({
      id: rotation.id || uid(),
      name: rotation.name,
      dayId: rotation.dayId,
      order: rotation.order,
      callOrder: rotation.callOrder,
      capacity: rotation.capacity == null ? "" : String(rotation.capacity),
      racesPerEntry: rotation.racesPerEntry == null ? "" : String(rotation.racesPerEntry),
      ticketFrom: rotation.ticketRange?.from == null ? "" : String(rotation.ticketRange.from),
      ticketTo: rotation.ticketRange?.to == null ? "" : String(rotation.ticketRange.to),
    })) : []
  );
  const [callWindowSeconds, setCallWindowSeconds] = useState(event?.competition?.callWindowSeconds ?? DEFAULT_CALL_WINDOW_SECONDS);

  const competitionPreview = useMemo(() => {
    const nextDays = days.filter((day) => day.date).map((day) => ({ id: day.id, date: day.date }));
    const nextRotations = rotations.filter((rotation) => rotation.name.trim() && rotation.dayId).map((rotation) => ({
      id: rotation.id,
      name: rotation.name.trim(),
      dayId: rotation.dayId,
      order: Number(rotation.order) || 1,
      callOrder: rotation.callOrder,
      ...(rotation.capacity ? { capacity: Number(rotation.capacity) } : {}),
      ...(rotation.racesPerEntry ? { racesPerEntry: Number(rotation.racesPerEntry) } : {}),
      ...(rotation.ticketFrom || rotation.ticketTo ? {
        ticketRange: {
          ...(rotation.ticketFrom ? { from: Number(rotation.ticketFrom) } : {}),
          ...(rotation.ticketTo ? { to: Number(rotation.ticketTo) } : {}),
        },
      } : {}),
    }));
    const config = {
      days: nextDays,
      rotations: nextRotations,
      callWindowSeconds: Math.max(1, Number(callWindowSeconds) || DEFAULT_CALL_WINDOW_SECONDS),
    };
    return (nextDays.length || nextRotations.length) ? config : null;
  }, [callWindowSeconds, days, rotations]);

  function addDay() {
    setDays((current) => [...current, { id: uid(), date: event?.date || today }]);
  }

  function addRotation() {
    setRotations((current) => [...current, {
      id: uid(),
      name: "",
      dayId: days[0]?.id || "",
      order: current.length + 1,
      callOrder: "ticket-asc",
      capacity: "",
      racesPerEntry: "",
      ticketFrom: "",
      ticketTo: "",
    }]);
  }

  function updateDay(dayId: string, patch: Partial<{ date: string }>) {
    setDays((current) => current.map((day) => (day.id === dayId ? { ...day, ...patch } : day)));
  }

  function updateRotation(rotationId: string, patch: Partial<{ name: string; dayId: string; order: number; callOrder: "ticket-asc" | "ticket-desc"; capacity: string; racesPerEntry: string; ticketFrom: string; ticketTo: string }>) {
    setRotations((current) => current.map((rotation) => (rotation.id === rotationId ? { ...rotation, ...patch } : rotation)));
  }

  function removeDay(dayId: string) {
    setDays((current) => current.filter((day) => day.id !== dayId));
    setRotations((current) => current.map((rotation) => 
      rotation.dayId === dayId ? { ...rotation, dayId: "" } : rotation
    ).filter((rotation) => rotation.dayId));
  }

  function removeRotation(rotationId: string) {
    setRotations((current) => current.filter((rotation) => rotation.id !== rotationId));
  }

  return (
    <div className="modal-backdrop" onMouseDown={(click) => {
      if (click.target === click.currentTarget) onClose();
    }}>
      <section className="event-modal card" role="dialog" aria-modal="true" aria-labelledby="event-modal-title">
        <header className="event-modal-header">
          <div className="card-heading">
            <div className="icon-box"><Trophy size={20} /></div>
            <div>
              <h2 id="event-modal-title">{event ? "Editar vaquejada" : "Nova vaquejada"}</h2>
              <p>As regras variáveis ficam vinculadas ao evento.</p>
            </div>
          </div>
          <button className="icon-button" type="button" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
        </header>
        <form
          key={event?.id || "new-event"}
          onSubmit={async (submit) => {
            submit.preventDefault();
            setBusy(true);
            try {
              if (await onSave(new FormData(submit.currentTarget))) onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Nome da vaquejada">
            <input name="name" required placeholder="Ex.: Parque São José" defaultValue={event?.name || ""} />
          </Field>
          <Field label="Local">
            <input name="location" placeholder="Município" defaultValue={event?.location || ""} />
          </Field>
          <div className="form-row">
            <Field label="Data">
              <input name="date" type="date" lang="pt-BR" title="dd/mm/aaaa" defaultValue={event?.date || today} />
            </Field>
            <Field label="Último dia">
              <input name="endsAt" type="date" lang="pt-BR" title="dd/mm/aaaa" defaultValue={event?.endsAt || event?.date || today} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Quantidade de senhas">
              <input name="ticketQuantity" type="number" min="1" placeholder="Opcional" defaultValue={event?.ticketQuantity ?? ""} />
            </Field>
            <Field label="Valor da senha (R$)">
              <input name="ticketPrice" type="number" min="0" step="0.01" placeholder="Opcional" defaultValue={event?.ticketPrice ?? ""} />
            </Field>
          </div>
          <Field label="Premiações (uma por linha)">
            <textarea name="prizes" rows={3} placeholder="Ex.: 1º lugar — definir" defaultValue={event?.prizes?.map(String).join("\n") || ""} />
          </Field>
          <Field label="Regulamento e observações">
            <textarea name="regulation" rows={4} placeholder="Registre as regras confirmadas para este evento" defaultValue={String(event?.rules?.regulation || "")} />
          </Field>

          <Field label="Dias e rodízios do evento">
            <div className="competition-editor">
              <div className="competition-section">
                <div className="section-head compact">
                  <h3>Dias</h3>
                  <button type="button" className="secondary small" onClick={addDay}>Adicionar dia</button>
                </div>
                {days.length === 0 ? <p className="subtle">Nenhum dia adicionado ainda.</p> : days.map((day) => (
                  <div className="competition-item" key={day.id}>
                    <div className="form-row two">
                      <Field label="Data do dia">
                        <input type="date" lang="pt-BR" title="dd/mm/aaaa" value={day.date} onChange={(event) => updateDay(day.id, { date: event.target.value })} />
                      </Field>
                      <button type="button" className="text-button danger" onClick={() => removeDay(day.id)}>Remover</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="competition-section">
                <div className="section-head compact">
                  <h3>Rodízios</h3>
                  <button type="button" className="secondary small" onClick={addRotation}>Adicionar rodízio</button>
                </div>
                {rotations.length === 0 ? <p className="subtle">Nenhum rodízio configurado ainda.</p> : rotations.map((rotation) => (
                  <div className="competition-item" key={rotation.id}>
                    <div className="form-row three">
                      <Field label="Nome">
                        <input value={rotation.name} onChange={(event) => updateRotation(rotation.id, { name: event.target.value })} placeholder="Ex.: Rodízio A" />
                      </Field>
                      <Field label="Dia">
                        <select value={rotation.dayId} onChange={(event) => updateRotation(rotation.id, { dayId: event.target.value })}>
                          <option value="">Selecione</option>
                          {days.map((day) => <option key={day.id} value={day.id}>{day.date ? formatDateBR(day.date) : "Sem data"}</option>)}
                        </select>
                      </Field>
                      <Field label="Ordem">
                        <input type="number" min="1" value={rotation.order} onChange={(event) => updateRotation(rotation.id, { order: Number(event.target.value) || 1 })} />
                      </Field>
                    </div>
                    <div className="form-row three">
                      <Field label="Chamada">
                        <select value={rotation.callOrder} onChange={(event) => updateRotation(rotation.id, { callOrder: event.target.value as "ticket-asc" | "ticket-desc" })}>
                          <option value="ticket-asc">Crescente</option>
                          <option value="ticket-desc">Decrescente</option>
                        </select>
                      </Field>
                      <Field label="Corridas por inscrição">
                        <input type="number" min="1" value={rotation.racesPerEntry} onChange={(event) => updateRotation(rotation.id, { racesPerEntry: event.target.value })} placeholder="Opcional" />
                      </Field>
                      <Field label="Capacidade">
                        <input type="number" min="1" value={rotation.capacity} onChange={(event) => updateRotation(rotation.id, { capacity: event.target.value })} placeholder="Opcional" />
                      </Field>
                    </div>
                    <div className="form-row two">
                      <Field label="Faixa de senhas — de">
                        <input type="number" min="1" value={rotation.ticketFrom} onChange={(event) => updateRotation(rotation.id, { ticketFrom: event.target.value })} placeholder="Opcional" />
                      </Field>
                      <Field label="Faixa de senhas — até">
                        <input type="number" min="1" value={rotation.ticketTo} onChange={(event) => updateRotation(rotation.id, { ticketTo: event.target.value })} placeholder="Opcional" />
                      </Field>
                    </div>
                    <button type="button" className="text-button danger" onClick={() => removeRotation(rotation.id)}>Remover rodízio</button>
                  </div>
                ))}
              </div>
            </div>
            <input type="hidden" name="competitionConfig" value={competitionPreview ? JSON.stringify(competitionPreview, null, 2) : ""} />
          </Field>

          <Field label="Janela de chamada (segundos)">
            <input type="number" min="1" value={callWindowSeconds} onChange={(event) => setCallWindowSeconds(Number(event.target.value) || DEFAULT_CALL_WINDOW_SECONDS)} />
          </Field>

          <p className="subtle">Defina os dias e os rodízios abaixo; o sistema gera a configuração da pista automaticamente.</p>

          <Field label="Categorias oferecidas">
            <div className="category-options">
              {AVAILABLE_CATEGORIES.map((category, index) => (
                <label className="check-row" key={category}>
                  <input type="checkbox" name="categories" value={category} defaultChecked={event ? getEventCategories(event).includes(category) : index === 0} />
                  {category}
                </label>
              ))}
            </div>
          </Field>
          <details className="category-rules">
            <summary>Regras específicas por categoria (opcional)</summary>
            <div className="category-rules-list">
              {AVAILABLE_CATEGORIES.map((category) => (
                <Field key={category} label={category}>
                  <textarea name={`categoryRule:${category}`} rows={2} placeholder="Registre apenas regras confirmadas para esta categoria" defaultValue={String(event?.categorySettings?.[category]?.regulation || "")} />
                </Field>
              ))}
            </div>
          </details>
          <Field label="Confirmação de pontuação">
            <select name="mode" defaultValue={event?.scoringMode || "instant"}>
              <option value="instant">Registro imediato</option>
              <option value="confirm">Exigir confirmação</option>
            </select>
          </Field>
          <div className="event-modal-actions">
            <button className="primary" type="submit" disabled={busy}>
              {event ? <Pencil size={17} /> : <Plus size={17} />}
              {busy ? "Salvando…" : event ? "Salvar alterações" : "Criar vaquejada"}
            </button>
            <button className="secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </section>
    </div>
  );
}
function EmptySelect() {
  return (
    <div className="card empty-state">
      <Trophy size={28} />
      <h2>Selecione uma vaquejada</h2>
      <p>Cadastre um evento na área “Vaquejadasâ€ para começar.</p>
    </div>
  );
}
function getEventState(start: string, end: string) {
  return getEventStatus(start, end, localDateString());
}
function getEventStateLabel(state: string) {
  return state === "future" ? "Futuro" : state === "current" ? "Em andamento" : "Encerrado";
}
function ProvisionalPoints({
  rows,
}: {
  rows: { name: string; number: number; points: number }[];
}) {
  return (
    <div className="card table-card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Vaqueiro</th>
              <th>Senha</th>
              <th>Pontos registrados (provisórios)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty-cell">
                  Ainda não há inscrições.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.number}-${r.name}`}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td>{r.number}</td>
                  <td>
                    <strong>{r.points}</strong>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
