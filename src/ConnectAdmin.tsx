import { FormEvent, useEffect, useState } from "react";
import {
  Activity, AlertTriangle, Building2, CalendarDays, CheckCircle2, ClipboardCheck, Database, Globe, KeyRound,
  LayoutDashboard, Search, Server, Settings2, ShieldCheck, UserPlus, UsersRound,
} from "lucide-react";
import {
  ConnectAdminDashboard, ConnectEvent, ConnectPark, ConnectParkLifecycleStatus, ConnectParkListItem, ConnectParkProfile, ConnectPlatformAudit, ConnectPublication, EventRoleAccess, EventStaff, LegacyStaffReconciliationAudit,
  LegacyStaffReconciliationItem, PlatformContext,
  createConnectParkEvent, createConnectParkManagerInvitation, createEventRoleAccess, createEventStaffInvitation,
  getConnectAdminDashboard, getConnectParkProfile, getConnectPublicationQueue, getLegacyStaffReconciliation, getLegacyStaffReconciliationAudit,
  listConnectParks,
  listConnectPlatformAudit, listConnectParkEvents, listEventRoleAccess, listEventStaff,
  manageConnectPlatformStaff, provisionConnectPark, revokeConnectPlatformStaff,
  activateLegacyStaffMapping, prepareLegacyStaffReconciliation, reviewLegacyStaffMapping,
  revokeEventRoleAccess, revokeEventStaff, setConnectEventPublication, setConnectEventStatus, setConnectParkStatus, updateConnectPark,
} from "./backend";
import { AVAILABLE_CATEGORIES } from "./domain";
import { BrazilianPhoneInput, BrazilianStateOptions } from "./BrazilFields";
import { PageHeading } from "./PageHeading";
import { AdminGoToParks, AdminSectionHeader, AdminStateCard } from "./ConnectAdminComponents";
import { ConnectParkProfilePage, ParkProfileTab } from "./ConnectParkProfilePage";
import { RouteNotFound } from "./RouteNotFound";
import { connectParkIdForPath, connectParkPath, connectPathForView, connectViewForPath, ConnectView } from "./navigation.mjs";

type Props = { context: PlatformContext; onSignOut: () => Promise<void> };
type AdminView = ConnectView;

export function ConnectAdminConsole({ context, onSignOut }: Props) {
  const [parkLookupName, setParkLookupName] = useState("");
  const [parkLookupCity, setParkLookupCity] = useState("");
  const [parkLookupState, setParkLookupState] = useState("");
  const [park, setPark] = useState<ConnectPark | null>(null);
  const [parkFormState, setParkFormState] = useState("");
  const [events, setEvents] = useState<ConnectEvent[]>([]);
  const [staff, setStaff] = useState<EventStaff[]>([]);
  const [roleAccesses, setRoleAccesses] = useState<EventRoleAccess[]>([]);
  const [issuedCredentials, setIssuedCredentials] = useState<{ role: EventRoleAccess["role"]; accessCode: string; pin: string; expiresAt: string } | null>(null);
  const [reconciliationBatch, setReconciliationBatch] = useState("");
  const [reconciliationItems, setReconciliationItems] = useState<LegacyStaffReconciliationItem[]>([]);
  const [reconciliationAudit, setReconciliationAudit] = useState<LegacyStaffReconciliationAudit[]>([]);
  const [audit, setAudit] = useState<ConnectPlatformAudit[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [managerInviteLink, setManagerInviteLink] = useState("");
  const [adminView, setAdminView] = useState<AdminView>(() => {
    const requested = connectViewForPath(window.location.pathname);
    return requested && (context.role === "platform_admin" || !["publications", "platform"].includes(requested)) ? requested : "overview";
  });
  const [routeInvalid, setRouteInvalid] = useState(() => connectViewForPath(window.location.pathname) === null);
  const [dashboard, setDashboard] = useState<ConnectAdminDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardRevision, setDashboardRevision] = useState(0);
  const [parkRows, setParkRows] = useState<ConnectParkListItem[]>([]);
  const [parkTotal, setParkTotal] = useState(0);
  const [parkSearch, setParkSearch] = useState("");
  const [parkStateFilter, setParkStateFilter] = useState("");
  const [parkCityFilter, setParkCityFilter] = useState("");
  const [parkLifecycleFilter, setParkLifecycleFilter] = useState<ConnectParkLifecycleStatus | "">("");
  const [parkPage, setParkPage] = useState(0);
  const [parkListRevision, setParkListRevision] = useState(0);
  const [parkListLoading, setParkListLoading] = useState(false);
  const [parkListError, setParkListError] = useState("");
  const [parkProfile, setParkProfile] = useState<ConnectParkProfile | null>(null);
  const [parkRouteId, setParkRouteId] = useState<string | null>(() => connectParkIdForPath(window.location.pathname));
  const [parkProfileLoading, setParkProfileLoading] = useState(false);
  const [parkProfileError, setParkProfileError] = useState("");
  const [parkProfileRevision, setParkProfileRevision] = useState(0);
  const [parkProfileTab, setParkProfileTab] = useState<ParkProfileTab>("overview");
  const [parkAuditError, setParkAuditError] = useState("");
  const [editingPark, setEditingPark] = useState(false);
  const [publicationRows, setPublicationRows] = useState<ConnectPublication[]>([]);
  const [publicationLoading, setPublicationLoading] = useState(false);
  const [publicationError, setPublicationError] = useState("");
  const [publicationRevision, setPublicationRevision] = useState(0);
  const canProvision = context.role === "platform_admin" || context.role === "deployment";
  const isAdmin = context.role === "platform_admin";
  const navigation: { id: AdminView; label: string; icon: JSX.Element; group: string }[] = [
    { id: "overview", label: "Painel de controle", icon: <LayoutDashboard size={18} />, group: "GESTÃO" },
    { id: "parks", label: "Parques", icon: <Building2 size={18} />, group: "GESTÃO" },
    { id: "events", label: "Eventos", icon: <CalendarDays size={18} />, group: "GESTÃO" },
    { id: "people", label: "Equipe e acessos", icon: <UsersRound size={18} />, group: "ACESSOS" },
    { id: "reconciliation", label: "Reconciliação", icon: <ClipboardCheck size={18} />, group: "ACESSOS" },
    ...(isAdmin ? [
      { id: "publications" as AdminView, label: "Publicações", icon: <Globe size={18} />, group: "PLATAFORMA" },
      { id: "platform" as AdminView, label: "Equipe Connect", icon: <Settings2 size={18} />, group: "PLATAFORMA" },
    ] : []),
  ];
  const pageTitle = navigation.find((item) => item.id === adminView)?.label ?? "Painel de controle";
  const pageDescription: Record<AdminView, string> = {
    overview: "Indicadores consultados no servidor Connect e estado conhecido das integrações.",
    parks: "Consulte os cadastros autorizados, refine a lista e abra os dados administrativos disponíveis.",
    events: "Crie eventos vinculados ao parque selecionado e acompanhe o estado operacional cadastrado.",
    people: "Gerencie convites e permissões por parque e evento, conforme seu perfil de acesso.",
    reconciliation: "Revise pendências com evidências e decisões registradas antes de qualquer ativação.",
    publications: "Revise dados confirmados pelo parque e acompanhe cada etapa real da publicação.",
    platform: "Gerencie perfis internos da plataforma com autorização administrativa Connect.",
  };

  function navigateAdminView(nextView: AdminView, replace = false) {
    if (!navigation.some((item) => item.id === nextView)) return;
    setRouteInvalid(false);
    setParkRouteId(null);
    setAdminView(nextView);
    const nextPath = connectPathForView(nextView);
    if (window.location.pathname !== nextPath || window.location.search) {
      if (replace) window.history.replaceState(null, "", nextPath);
      else window.history.pushState(null, "", nextPath);
    }
  }

  useEffect(() => {
    const synchronizeRoute = () => {
      const parkId = connectParkIdForPath(window.location.pathname);
      if (parkId) {
        setRouteInvalid(false);
        setAdminView("parks");
        setParkRouteId(parkId);
        return;
      }
      setParkRouteId(null);
      const requested = connectViewForPath(window.location.pathname);
      if (!requested) {
        setRouteInvalid(true);
        return;
      }
      setRouteInvalid(false);
      const allowed = requested && navigation.some((item) => item.id === requested);
      navigateAdminView(allowed ? requested : "overview", true);
    };
    window.addEventListener("popstate", synchronizeRoute);
    return () => window.removeEventListener("popstate", synchronizeRoute);
  }, [isAdmin]);

  useEffect(() => {
    if (!navigation.some((item) => item.id === adminView)) navigateAdminView("overview", true);
  }, [adminView, isAdmin]);
  const roleLabel = context.role === "platform_admin" ? "Administrador Connect" : context.role === "deployment" ? "Implantação" : "Suporte";

  useEffect(() => {
    if (adminView !== "overview") return;
    let active = true;
    setDashboardLoading(true);
    setDashboardError("");
    setDashboard(null);
    void getConnectAdminDashboard()
      .then((summary) => { if (active) setDashboard(summary); })
      .catch((error: unknown) => {
        if (active) {
          setDashboard(null);
          setDashboardError(error instanceof Error ? error.message : "Não foi possível verificar o painel.");
        }
      })
      .finally(() => { if (active) setDashboardLoading(false); });
    return () => { active = false; };
  }, [adminView, dashboardRevision]);

  useEffect(() => {
    if (adminView !== "publications" || !isAdmin) return;
    let active = true;
    setPublicationLoading(true);
    setPublicationError("");
    getConnectPublicationQueue().then((rows) => {
      if (active) setPublicationRows(rows);
    }).catch((error: unknown) => {
      if (active) {
        setPublicationRows([]);
        setPublicationError(error instanceof Error ? error.message : "NÃ£o foi possÃ­vel carregar a fila de publicaÃ§Ã£o.");
      }
    }).finally(() => { if (active) setPublicationLoading(false); });
    return () => { active = false; };
  }, [adminView, isAdmin, publicationRevision]);

  useEffect(() => {
    if (adminView !== "parks" || parkRouteId) return;
    let active = true;
    setParkListLoading(true);
    setParkListError("");
    void listConnectParks({
      search: parkSearch,
      state: parkStateFilter,
      city: parkCityFilter,
      lifecycleStatus: parkLifecycleFilter,
      limit: 25,
      offset: parkPage * 25,
    }).then((rows) => {
      if (!active) return;
      setParkRows(rows);
      setParkTotal(rows[0]?.total_count ?? 0);
    }).catch((error: unknown) => {
      if (active) {
        setParkRows([]);
        setParkTotal(0);
        setParkListError(error instanceof Error ? error.message : "Não foi possível carregar a lista de parques.");
      }
    }).finally(() => { if (active) setParkListLoading(false); });
    return () => { active = false; };
  }, [adminView, parkRouteId, parkSearch, parkStateFilter, parkCityFilter, parkLifecycleFilter, parkPage, parkListRevision]);

  useEffect(() => {
    if (adminView !== "parks" || !parkRouteId) return;
    let active = true;
    setParkProfileLoading(true);
    setParkProfileError("");
    setParkProfile(null);
    setPark(null);
    setParkAuditError("");
    setManagerInviteLink("");
    setAudit([]);
    void (async () => {
      try {
        const profile = await getConnectParkProfile(parkRouteId);
        if (!active) return;
        setParkProfile(profile);
        setPark(profile.park);
        setParkFormState(profile.park.state);
        setEvents(profile.events);
        setSelectedEvent((current) => profile.events.some((item) => item.id === current) ? current : profile.events[0]?.id || "");
        setEditingPark(false);
        if (context.role !== "deployment") {
          try {
            const rows = await listConnectPlatformAudit(parkRouteId);
            if (active) setAudit(rows);
          } catch (error) {
            if (active) setParkAuditError(error instanceof Error ? error.message : "Não foi possível consultar a auditoria.");
          }
        }
      } catch (error) {
        if (active) setParkProfileError(error instanceof Error ? error.message : "Não foi possível carregar os dados deste parque.");
      } finally {
        if (active) setParkProfileLoading(false);
      }
    })();
    return () => { active = false; };
  }, [adminView, parkRouteId, context.role, parkProfileRevision]);

  useEffect(() => { setParkPage(0); }, [parkSearch, parkStateFilter, parkCityFilter, parkLifecycleFilter]);

  async function refreshEvents(parkId: string) {
    const rows = await listConnectParkEvents(parkId);
    setEvents(rows);
    if (!selectedEvent || !rows.some((row) => row.id === selectedEvent)) setSelectedEvent(rows[0]?.id || "");
  }
  async function refreshParkAudit(parkId: string): Promise<string> {
    try {
      setAudit(await listConnectPlatformAudit(parkId));
      setParkAuditError("");
      return "";
    } catch (error) {
      setAudit([]);
      const message = error instanceof Error ? error.message : "Falha na consulta";
      setParkAuditError(message);
      return message;
    }
  }
  function searchPark(event?: FormEvent) {
    event?.preventDefault();
    setParkSearch(parkLookupName.trim());
    setParkCityFilter(parkLookupCity.trim());
    setParkStateFilter(parkLookupState.trim().toUpperCase());
    setParkLifecycleFilter("");
    setParkPage(0);
    setPark(null);
    setParkProfile(null);
    setNotice("");
    navigateAdminView("parks");
  }
  async function loadParkProfile(parkId: string): Promise<string> {
    const details = await getConnectParkProfile(parkId);
    setParkProfile(details);
    setPark(details.park);
    setParkFormState(details.park.state);
    setEvents(details.events);
    if (canProvision) await refreshEvents(details.park.id);
    else setSelectedEvent((current) => details.events.some((item) => item.id === current) ? current : details.events[0]?.id || "");
    setEditingPark(false);
    return context.role === "deployment" ? "" : refreshParkAudit(parkId);
  }
  async function openParkProfile(parkId: string) {
    setNotice("");
    setPark(null);
    setParkProfile(null);
    setParkProfileError("");
    setParkProfileTab("overview");
    setManagerInviteLink("");
    setEvents([]);
    setAudit([]);
    setParkRouteId(parkId);
    setAdminView("parks");
    setRouteInvalid(false);
    window.history.pushState(null, "", connectParkPath(parkId));
  }
  async function openRecentPark(parkId: string) {
    await openParkProfile(parkId);
  }
  async function copyParkAreaLink(area: "office" | "announcer" | "operational") {
    if (!parkProfile) return;
    const target = new URL("/operacao", window.location.origin);
    target.searchParams.set("area", area);
    if (selectedEvent) target.searchParams.set("event", selectedEvent);
    try {
      await navigator.clipboard.writeText(target.toString());
      setNotice(`Link de acesso ${area === "office" ? "do Escritório" : area === "announcer" ? "da Locução" : "da Área operacional"} copiado. O acesso ainda exige identidade e permissão válidas.`);
    } catch (error) {
      setNotice(`Não foi possível copiar o link: ${error instanceof Error ? error.message : "permissão da área de transferência indisponível"}`);
    }
  }
  async function submitProvision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get("name") || "").trim(),
      manager_name: String(form.get("manager_name") || "").trim(), phone: String(form.get("phone") || "").trim(),
      city: String(form.get("city") || "").trim(), state: String(form.get("state") || "").trim().toUpperCase(),
      address: String(form.get("address") || "").trim(),
    };
    try {
      const sameName: ConnectParkListItem[] = [];
      let scanOffset = 0;
      let scanCount = 0;
      let scanPage: ConnectParkListItem[];
      do {
        scanPage = await listConnectParks({
          search: input.name,
          state: "",
          city: "",
          lifecycleStatus: "",
          limit: 100,
          offset: scanOffset,
        });
        scanCount = scanPage[0]?.total_count ?? 0;
        sameName.push(...scanPage.filter((row) =>
          row.name.trim().toLocaleLowerCase("pt-BR") === input.name.toLocaleLowerCase("pt-BR"),
        ));
        scanOffset += scanPage.length;
      } while (scanPage.length === 100 && scanOffset < scanCount);

      const sameLocation = sameName.filter((row) =>
        row.city.trim().toLocaleLowerCase("pt-BR") === input.city.toLocaleLowerCase("pt-BR")
        && row.state.toUpperCase() === input.state,
      );
      if (sameLocation.length > 1) {
        setParkSearch(input.name);
        setParkCityFilter(input.city);
        setParkStateFilter(input.state);
        navigateAdminView("parks");
        setNotice("Há mais de um parque com este nome e local. Escolha o cadastro correto na lista antes de recuperar.");
        return;
      }
      const existingPark = sameLocation[0];
      const summary = existingPark
        ? [
          "Um parque com este nome e local já existe. Confirme os dados encontrados para recuperá-lo sem sobrescrever nenhuma informação.",
          `Nome cadastrado: ${existingPark.name}`,
          `Responsável: ${existingPark.manager_name}`,
          `Telefone: ${existingPark.phone || "Não informado"}`,
          `Local: ${existingPark.city}/${existingPark.state}`,
          `Endereço: ${existingPark.address}`,
          `Situação: ${parkLifecycleLabel(existingPark.lifecycle_status)}`,
          "",
          `Dados informados: ${input.name} · ${input.city}/${input.state}`,
        ].join("\n")
        : [
          "Confirme o novo cadastro do parque.",
          ...(sameName.length ? [`Outros parques com o mesmo nome: ${sameName.map((row) => `${row.name} · ${row.city}/${row.state}`).join("; ")}`, "A cidade e a UF serão usadas para diferenciar os cadastros."] : []),
          `Nome: ${input.name}`,
          `Responsável: ${input.manager_name}`,
          `Local: ${input.city}/${input.state}`,
          `Endereço: ${input.address}`,
        ].join("\n");
      if (!window.confirm(summary)) return;

      const result = await provisionConnectPark({ ...input, existingParkId: existingPark?.id });
      setParkListRevision((value) => value + 1);
      const provisionNotice = result.created
        ? `Parque ${result.park_name} provisionado com sucesso.`
        : `Cadastro de ${result.park_name} recuperado. Nenhum dado foi sobrescrito.`;
      openParkProfile(result.park_id);
      setNotice(provisionNotice);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível provisionar o parque."); }
    finally { setBusy(false); }
  }
  async function savePark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!park) return; setBusy(true); setNotice("");
    const form = new FormData(event.currentTarget);
    const next = { ...park, name: String(form.get("name") || "").trim(), manager_name: String(form.get("manager_name") || "").trim(), phone: String(form.get("phone") || "").trim(), city: String(form.get("city") || "").trim(), state: String(form.get("state") || "").trim().toUpperCase(), address: String(form.get("address") || "").trim() };
    try {
      await updateConnectPark(next);
      setEditingPark(false);
      setParkListRevision((value) => value + 1);
      const historyError = await loadParkProfile(next.id);
      setNotice(historyError
        ? `Dados salvos. Histórico indisponível: ${historyError}`
        : "Dados administrativos atualizados e auditados no servidor.");
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao salvar dados do parque."); }
    finally { setBusy(false); }
  }
  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!park) return; setBusy(true); setNotice("");
    const form = new FormData(event.currentTarget);
    const idKey = `connect-pdm-pending-event:${park.id}`;
    const idempotencyId = localStorage.getItem(idKey) || crypto.randomUUID();
    localStorage.setItem(idKey, idempotencyId);
    const categories = form.getAll("categories").map(String);
    try {
      const createdId = await createConnectParkEvent({
        parkId: park.id, idempotencyId, name: String(form.get("name") || "").trim(), location: String(form.get("location") || "").trim(),
        startsAt: new Date(String(form.get("starts_at"))).toISOString(), endsAt: new Date(String(form.get("ends_at"))).toISOString(),
        categories, ticketQuantity: String(form.get("ticket_quantity") || "").trim() ? Number(form.get("ticket_quantity")) : null,
        ticketPrice: String(form.get("ticket_price") || "").trim() ? Number(form.get("ticket_price")) : null,
      });
      localStorage.removeItem(idKey); event.currentTarget.reset(); await refreshEvents(park.id); setSelectedEvent(createdId);
      const auditError = await refreshParkAudit(park.id);
      setNotice(auditError
        ? `Evento criado. Não foi possível atualizar o histórico: ${auditError}`
        : "Evento vinculado ao parque. Regras esportivas não foram presumidas; configure-as com a organização.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao criar evento."); }
    finally { setBusy(false); }
  }
  async function refreshLegacyReconciliation(batchId: string) {
    const [items, auditRows] = await Promise.all([
      getLegacyStaffReconciliation(batchId), getLegacyStaffReconciliationAudit(batchId),
    ]);
    setReconciliationBatch(batchId); setReconciliationItems(items); setReconciliationAudit(auditRows);
  }
  async function prepareLegacyInventory(newBatch = false) {
    if (!park) return;
    setBusy(true); setNotice("");
    const key = `connect-pdm-legacy-reconcile:${park.id}`;
    const batchId = newBatch ? crypto.randomUUID() : (localStorage.getItem(key) || crypto.randomUUID());
    localStorage.setItem(key, batchId);
    try {
      await prepareLegacyStaffReconciliation(batchId, park.id);
      await refreshLegacyReconciliation(batchId);
      setNotice("Inventário preparado. Nenhum acesso foi concedido ou revogado.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao preparar a reconciliação."); }
    finally { setBusy(false); }
  }
  async function reviewLegacyItem(item: LegacyStaffReconciliationItem, classification: "proven" | "ambiguous" | "no_destination") {
    if (!reconciliationBatch) return;
    const evidence = classification === "proven"
      ? window.prompt("Referência da evidência específica deste evento (ex.: event_staff_audit:123 ou review_document:ROSTER-123). Confira o documento fora do sistema:", item.evidence_reference || "")?.trim()
      : null;
    if (classification === "proven" && !evidence) return;
    const reason = window.prompt("Motivo da decisão de revisão (obrigatório):")?.trim();
    if (!reason) return;
    setBusy(true); setNotice("");
    try {
      await reviewLegacyStaffMapping(item.item_id, classification, evidence || null, reason);
      await refreshLegacyReconciliation(reconciliationBatch);
      setNotice("Revisão registrada no servidor. A ativação, se aprovada, exige outro operador.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao revisar o vínculo."); }
    finally { setBusy(false); }
  }
  async function activateLegacyItem(item: LegacyStaffReconciliationItem) {
    if (!reconciliationBatch || !window.confirm("Ativar somente este vínculo pessoa-evento? O servidor exige um operador diferente do revisor e rejeita conflito de papel.")) return;
    setBusy(true); setNotice("");
    try {
      await activateLegacyStaffMapping(item.item_id);
      await refreshLegacyReconciliation(reconciliationBatch);
      setNotice("Vínculo ativado somente para o evento revisado e auditado.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao ativar. Verifique o conflito ou se outro operador aprovou a revisão."); }
    finally { setBusy(false); }
  }
  async function setParkAccess(status: ConnectPark["access_status"]) {
    if (!park) return;
    const action = status === "closed" ? "arquivar" : status === "suspended" ? "suspender" : "reativar";
    if (!window.confirm(`Confirmar ${action} o acesso de ${park.name}?`)) return;
    const reason = window.prompt(`Justificativa para ${status}:`); if (!reason?.trim()) return;
    setBusy(true); try {
      await setConnectParkStatus(park.id,status,reason);
      const historyError = await loadParkProfile(park.id);
      setParkListRevision((value) => value + 1);
      setNotice(historyError
        ? `Acesso do parque atualizado para ${status}. Histórico indisponível: ${historyError}`
        : `Acesso do parque atualizado para ${status}.`);
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao atualizar acesso."); } finally { setBusy(false); }
  }
  async function setParkEventStatus(eventId: string, status: ConnectEvent["operational_status"]) {
    const item = events.find((event) => event.id === eventId) || parkProfile?.events.find((event) => event.id === eventId);
    if (!item || !park) return;
    const action = status === "closed" ? "encerrar" : "reabrir";
    if (!window.confirm(`Confirmar ${action} o evento “${item.name}”?`)) return;
    const reason = window.prompt(`Justificativa para ${action} o evento:`)?.trim();
    if (!reason) return;
    setBusy(true);
    try {
      await setConnectEventStatus(eventId, status, reason);
      await loadParkProfile(park.id);
      setParkListRevision((revision) => revision + 1);
      setNotice(`Estado do evento atualizado para ${status === "active" ? "ativo" : "encerrado"} no servidor.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao atualizar a situação do evento.");
    } finally { setBusy(false); }
  }
  async function createManagerInvitation(email: string) {
    if (!park) return;
    setBusy(true);
    setManagerInviteLink("");
    try {
      const invitation = await createConnectParkManagerInvitation(park.id, email);
      const url = new URL("/entrar", window.location.origin);
      url.searchParams.set("invite", invitation.invitation_token);
      setManagerInviteLink(url.toString());
      const historyError = await refreshParkAudit(park.id);
      setNotice(historyError
        ? `Convite criado; a auditoria não pôde ser atualizada: ${historyError}`
        : `Convite individual válido até ${new Date(invitation.expires_at).toLocaleString("pt-BR")} .`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao criar convite administrativo.");
    } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!selectedEvent || !canProvision) { setStaff([]); return; }
    let active = true;
    void Promise.all([listEventStaff(selectedEvent), listEventRoleAccess(selectedEvent)]).then(([members, accesses]) => {
      if (active) {
        setStaff(members);
        setRoleAccesses(accesses);
        setIssuedCredentials(null);
      }
    }).catch((error: unknown) => { if (active) setNotice(error instanceof Error ? error.message : "Falha ao carregar acessos do evento."); });
    return () => { active = false; };
  }, [selectedEvent, canProvision]);

  async function provisionSharedRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = events.find((item) => item.id === selectedEvent);
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const role = String(form.get("role")) as EventRoleAccess["role"];
    const expiresAt = String(form.get("expires_at") || "");
    setBusy(true); setIssuedCredentials(null);
    try {
      const result = await createEventRoleAccess(selectedEvent, role, new Date(expiresAt).toISOString());
      setIssuedCredentials({ role, accessCode: result.accessCode, pin: result.pin, expiresAt: result.expiresAt });
      setRoleAccesses(await listEventRoleAccess(selectedEvent));
      setNotice("Acesso compartilhado criado. O código e o PIN são exibidos somente agora; compartilhe-os por canal confiável.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao criar acesso compartilhado."); }
    finally { setBusy(false); }
  }

  async function revokeSharedRole(role: EventRoleAccess["role"]) {
    if (!window.confirm("Revogar este acesso compartilhado? A função precisará ser provisionada novamente para voltar a operar.")) return;
    setBusy(true);
    try {
      await revokeEventRoleAccess(selectedEvent, role);
      setRoleAccesses(await listEventRoleAccess(selectedEvent));
      setIssuedCredentials(null);
      setNotice("Acesso compartilhado revogado no servidor.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao revogar acesso compartilhado."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!park || !canProvision) return;
    const batchId = localStorage.getItem(`connect-pdm-legacy-reconcile:${park.id}`);
    if (!batchId) return;
    let active = true;
    void Promise.all([getLegacyStaffReconciliation(batchId), getLegacyStaffReconciliationAudit(batchId)])
      .then(([items, auditRows]) => { if (active) { setReconciliationBatch(batchId); setReconciliationItems(items); setReconciliationAudit(auditRows); } })
      .catch(() => { if (active) { setReconciliationBatch(""); setReconciliationItems([]); setReconciliationAudit([]); } });
    return () => { active = false; };
  }, [park?.id, canProvision]);

  async function actOnPublication(row: ConnectPublication, status: "approved" | "published" | "withdrawn") {
    let reason = "";
    if (status === "approved") {
      const value = window.prompt("Registre a justificativa da revisão e aprovação (mínimo de 10 caracteres):");
      if (value === null) return;
      reason = value.trim();
      if (reason.length < 10) { setNotice("A justificativa da aprovação deve ter pelo menos 10 caracteres."); return; }
    } else if (status === "published") {
      if (!window.confirm(`Publicar “${row.event_name}” no site público?`)) return;
      reason = "Publicado após aprovação Connect e confirmação do parque.";
    } else {
      if (!window.confirm(`Retirar “${row.event_name}” do site público?`)) return;
      const value = window.prompt("Motivo para retirar este evento do site (mínimo de 10 caracteres):");
      if (value === null) return;
      reason = value.trim();
      if (reason.length < 10) { setNotice("O motivo deve ter pelo menos 10 caracteres."); return; }
    }
    setBusy(true);
    try {
      await setConnectEventPublication(row.event_id, status, row.public_description, reason);
      setPublicationRevision((revision) => revision + 1);
      setDashboardRevision((revision) => revision + 1);
      setNotice(status === "approved" ? "Informações aprovadas. A publicação ainda precisa ser liberada." : status === "published" ? "Evento publicado no site público." : "Evento retirado do site público.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível atualizar a publicação.");
    } finally { setBusy(false); }
  }

  async function requestPublicationChanges(row: ConnectPublication) {
    const reason = window.prompt("Explique ao parque quais informações precisam ser corrigidas (mínimo de 10 caracteres):")?.trim();
    if (!reason) return;
    if (reason.length < 10) { setNotice("Explique as correções com pelo menos 10 caracteres."); return; }
    setBusy(true);
    try {
      await setConnectEventPublication(row.event_id, "changes_requested", row.public_description, reason);
      setPublicationRevision((revision) => revision + 1);
      setNotice("Correções solicitadas ao parque. O evento não foi publicado.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível solicitar as correções."); }
    finally { setBusy(false); }
  }

  if (routeInvalid) return <RouteNotFound home="/connect" />;

  return (
    <div className="connect-admin-shell">
      <aside className="connect-admin-sidebar">
        <a className="connect-admin-brand" href="/connect" aria-label="Connect Vaquejada — painel Connect">
          <img src="/Simbolo-Connect-Vaquejada.png" alt="" />
          <span><strong>CONNECT</strong><small>VAQUEJADA</small></span>
        </a>
        <div className="connect-admin-nav-label">ADMINISTRAÇÃO</div>
        <nav className="connect-admin-nav" aria-label="Navegação administrativa Connect">
          {navigation.map((item, index) => (
            <div key={item.id}>
              {(index === 0 || navigation[index - 1].group !== item.group) && <div className="connect-admin-nav-group">{item.group}</div>}
              <button
                type="button"
                className={adminView === item.id ? "connect-admin-nav-item active" : "connect-admin-nav-item"}
                aria-current={adminView === item.id ? "page" : undefined}
                onClick={() => navigateAdminView(item.id)}
              >
                {item.icon}<span>{item.label}</span>
              </button>
            </div>
          ))}
        </nav>
        <div className="connect-admin-sidebar-footer">
          <span className="connect-admin-status-dot" />
          <span>Ambiente administrativo</span>
        </div>
      </aside>
      <main className="connect-admin-main">
        <header className="connect-admin-topbar">
          <PageHeading className="connect-admin-heading" eyebrow={<span className="connect-admin-breadcrumb">CONNECT VAQUEJADA <span>/</span> ADMINISTRAÇÃO</span>} title={pageTitle} description={pageDescription[adminView]} />
          <div className="connect-admin-user">
            <span className="connect-admin-user-icon"><ShieldCheck size={17} /></span>
            <span className="connect-admin-user-label"><strong>{roleLabel}</strong><small>Sessão autenticada · autorização ativa</small></span>
            <button className="connect-admin-logout" onClick={() => void onSignOut()}>Sair</button>
          </div>
        </header>
        <div className="connect-admin-content">
          {notice && <div className="connect-admin-notice" role="status"><Activity size={17} />{notice}</div>}
      {adminView === "overview" && (
        <>
          <section className="connect-dashboard-section" aria-labelledby="connect-summary-title">
            <AdminSectionHeader id="connect-summary-title" eyebrow="VISÃO DA PLATAFORMA" title="Resumo da plataforma" description="Totais retornados pelo serviço administrativo Connect." actions={dashboard?.checked_at && <span className="connect-dashboard-checked">Consultado {new Date(dashboard.checked_at).toLocaleString()}</span>} />
            <div className="connect-dashboard-metrics">
              <article className="connect-dashboard-metric"><span>Parques cadastrados</span><strong>{dashboardLoading ? "…" : dashboard ? dashboard.park_count.toLocaleString("pt-BR") : "—"}</strong><small>{dashboard ? "Total no servidor" : "Não verificado"}</small></article>
              <article className="connect-dashboard-metric"><span>Eventos cadastrados</span><strong>{dashboardLoading ? "…" : dashboard ? dashboard.event_count.toLocaleString("pt-BR") : "—"}</strong><small>{dashboard ? "Total no servidor" : "Não verificado"}</small></article>
              <article className="connect-dashboard-metric"><span>Publicações</span><strong>{dashboardLoading ? "…" : dashboard?.publication_count == null ? "N/D" : dashboard.publication_count.toLocaleString("pt-BR")}</strong><small>{dashboard?.publication_count == null ? "Módulo de publicação indisponível" : "Total publicado"}</small></article>
            </div>
          </section>

          <section className="connect-dashboard-section" aria-labelledby="connect-system-status-title">
            <AdminSectionHeader id="connect-system-status-title" eyebrow="MONITORAMENTO" title="Estado do sistema" description="Apenas verificações confirmadas nesta consulta são marcadas como verificadas." actions={<button className="secondary" type="button" disabled={dashboardLoading} onClick={() => setDashboardRevision((revision) => revision + 1)}>Atualizar</button>} />
            {dashboardError && <p className="connect-dashboard-warning" role="alert"><AlertTriangle size={16} /> Falha ao consultar API/banco: {dashboardError}</p>}
            <div className="connect-dashboard-status-grid">
              <article className={dashboard ? "connect-dashboard-status checked" : "connect-dashboard-status unknown"}>
                <Database size={19} />
                <div><strong>API e banco de dados</strong><span>{dashboardLoading ? "Verificando…" : dashboard ? `Consulta confirmada às ${new Date(dashboard.checked_at).toLocaleTimeString()}` : "Não verificados nesta consulta"}</span></div>
                <b>{dashboard ? "Verificado" : "Não verificado"}</b>
              </article>
              <article className="connect-dashboard-status unknown">
                <Server size={19} />
                <div><strong>Servidor local</strong><span>Verificação administrativa ainda não configurada</span></div>
                <b>Não verificado</b>
              </article>
              <article className="connect-dashboard-status unknown">
                <Activity size={19} />
                <div><strong>Erros recentes</strong><span>Fonte central de erros ainda não configurada</span></div>
                <b>Não verificado</b>
              </article>
            </div>
          </section>

          <section className="connect-dashboard-section" aria-labelledby="connect-recent-parks-title">
            <AdminSectionHeader id="connect-recent-parks-title" eyebrow="CADASTROS" title="Parques cadastrados recentemente" description="Registros recentes fornecidos pelo servidor Connect." actions={<button className="secondary" type="button" onClick={() => navigateAdminView("parks")}>Ver todos os parques</button>} />
            {dashboardLoading ? <p className="connect-dashboard-empty">Carregando parques do servidor…</p>
              : dashboardError ? <p className="connect-dashboard-empty">Lista indisponível porque não foi possível verificar o servidor.</p>
              : dashboard?.recent_parks.length ? (
                <div className="connect-dashboard-recent-list">
                  {dashboard.recent_parks.map((recent) => (
                    <button className="connect-dashboard-recent-park" key={recent.id} type="button" disabled={busy} onClick={() => void openRecentPark(recent.id)}>
                      <span className="connect-dashboard-park-icon"><Building2 size={18} /></span>
                      <span className="connect-dashboard-park-details"><strong>{recent.name}</strong><small>{recent.city}/{recent.state}</small></span>
                      <span className={`connect-dashboard-access ${recent.access_status}`}>{recent.access_status === "active" ? "Ativo" : recent.access_status === "suspended" ? "Suspenso" : "Encerrado"}</span>
                      <span className="connect-dashboard-open">Abrir perfil</span>
                    </button>
                  ))}
                </div>
              ) : <p className="connect-dashboard-empty">{dashboard ? "Nenhum parque cadastrado." : "Lista não verificada."}</p>}
          </section>

          <section className="connect-dashboard-section" aria-labelledby="connect-alerts-title">
            <AdminSectionHeader eyebrow="ATENÇÃO" title="Alertas importantes" description="Disponibilidade atual das fontes de monitoramento." />
            <p className="connect-dashboard-unverified-alert"><AlertTriangle size={17} /> Não há monitoramento configurado para falhas de backup, conectividade ou acessos suspeitos; não é possível confirmar se existem alertas.</p>
          </section>

          <section className="card form-card">
            <div className="card-heading">
              <div className="icon-box"><ShieldCheck size={20} /></div>
              <div>
                <h2>Localizar parque existente</h2>
                <p>Localize pelo nome e refine por cidade/UF para diferenciar parques homônimos.</p>
              </div>
            </div>
            <form className="form-row" onSubmit={searchPark}>
              <label className="field"><span>Nome do parque</span><input value={parkLookupName} onChange={(event) => setParkLookupName(event.target.value)} required /></label>
              <label className="field"><span>Cidade</span><input value={parkLookupCity} onChange={(event) => setParkLookupCity(event.target.value)} /></label>
              <label className="field"><span>UF</span><select value={parkLookupState} onChange={(event) => setParkLookupState(event.target.value)}><option value="">Todas</option>{BrazilianStateOptions()}</select></label>
              <button className="primary" disabled={busy}><Search size={16} /> Localizar</button>
            </form>
          </section>

          {(context.role === "support" || isAdmin) && park && (
            <section className="card table-card">
              <div className="table-title">
                <h2>Auditoria administrativa do parque</h2>
                <span className="subtle">{audit.length} registros recentes · sem leitura de dados de inscrições/pagamentos</span>
              </div>
              {audit.length === 0 ? (
                <p className="empty small">Nenhum registro disponível para este parque.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th><th>Ação</th><th>Ator</th><th>Evento</th><th>Motivo</th><th>Detalhes</th>
                      </tr>
                    </thead>
                    <tbody>{audit.map((item) => (
                      <tr key={item.id}><td>{new Date(item.occurred_at).toLocaleString()}</td><td>{item.action}</td><td>{item.actor_email || item.actor_user_id || "Sistema"}</td><td>{item.event_id || "—"}</td><td>{item.reason || "—"}</td><td><code>{JSON.stringify(item.details)}</code></td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {adminView === "parks" && (
        <>
          {!parkRouteId && <section className="card table-card connect-park-registry">
            <div className="table-title">
              <div className="connect-park-registry-heading">
                <div><h2>Parques cadastrados</h2><p>Consulte e gerencie os cadastros da plataforma.</p></div>
                <span className="connect-park-registry-count">{parkListLoading || parkListError ? "—" : `${parkTotal.toLocaleString("pt-BR")} ${parkTotal === 1 ? "parque" : "parques"}`}</span>
              </div>
              {canProvision && <button className="secondary" type="button" onClick={() => { setPark(null); setParkProfile(null); setParkFormState(""); navigateAdminView("parks"); setNotice(""); }}>Novo cadastro</button>}
            </div>
            <div className="connect-park-registry-filters">
              <label className="field"><span>Parque ou codigo Connect</span><input value={parkSearch} onChange={(event) => setParkSearch(event.target.value)} placeholder="Nome ou codigo Connect" /></label>
              <label className="field"><span>Cidade</span><input value={parkCityFilter} onChange={(event) => setParkCityFilter(event.target.value)} placeholder="Todas" /></label>
              <label className="field"><span>UF</span><select value={parkStateFilter} onChange={(event) => setParkStateFilter(event.target.value)}><option value="">Todas</option>{BrazilianStateOptions()}</select></label>
              <label className="field"><span>Situação</span><select value={parkLifecycleFilter} onChange={(event) => setParkLifecycleFilter(event.target.value as ConnectParkLifecycleStatus | "")}>
                <option value="">Todas</option><option value="provisioned">Provisionado</option><option value="pending_configuration">Pendente de configuração</option><option value="suspended">Suspenso</option><option value="archived">Arquivado</option>
              </select></label>
              {(parkSearch || parkCityFilter || parkStateFilter || parkLifecycleFilter) && (
                <button className="text-button connect-park-clear-filters" type="button" onClick={() => {
                  setParkSearch("");
                  setParkCityFilter("");
                  setParkStateFilter("");
                  setParkLifecycleFilter("");
                }}>Limpar filtros</button>
              )}
            </div>
            {parkListLoading ? <p className="connect-dashboard-empty">Carregando lista autorizada do servidor…</p>
              : parkListError ? <p className="connect-dashboard-empty" role="alert">Falha ao consultar parques: {parkListError}</p>
                : parkRows.length ? (
                  <>
                    <div className="table-scroll">
                      <table>
                        <thead><tr><th>Parque</th><th>Codigo Connect</th><th>Localizacao</th><th>Situacao</th><th>Cadastrado em</th><th>Acao</th></tr></thead>
                        <tbody>{parkRows.map((row) => (
                          <tr key={row.id}>
                            <td><strong className="connect-park-table-name">{row.name}</strong><span className="connect-park-table-manager">{row.manager_name}</span></td>
                            <td><code>{row.connect_code || "-"}</code></td>
                            <td>{row.city}/{row.state}</td>
                            <td><span className={`connect-park-lifecycle ${row.lifecycle_status}`}>{parkLifecycleLabel(row.lifecycle_status)}</span></td>
                            <td>{new Date(row.created_at).toLocaleDateString()}</td>
                            <td><button className="text-button" type="button" disabled={busy} onClick={() => void openParkProfile(row.id)}>Abrir perfil</button></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <div className="connect-park-pagination">
                      <span>{parkPage * 25 + 1}–{Math.min((parkPage + 1) * 25, parkTotal)} de {parkTotal}</span>
                      <div>
                        <button className="secondary" type="button" disabled={parkPage === 0 || parkListLoading} onClick={() => setParkPage((page) => page - 1)}>Anterior</button>
                        <button className="secondary" type="button" disabled={(parkPage + 1) * 25 >= parkTotal || parkListLoading} onClick={() => setParkPage((page) => page + 1)}>Próxima</button>
                      </div>
                    </div>
                  </>
                ) : <p className="connect-dashboard-empty">Nenhum parque corresponde aos filtros selecionados.</p>}
          </section>}

          {parkRouteId && parkProfileLoading && <AdminStateCard title="Carregando perfil do parque">Consultando os dados administrativos autorizados no servidor Connect.</AdminStateCard>}
          {parkRouteId && parkProfileError && <AdminStateCard title="Perfil indisponível" tone="error" action={<div className="connect-park-error-actions"><button type="button" className="secondary" onClick={() => setParkProfileRevision((revision) => revision + 1)}>Tentar novamente</button><button type="button" className="text-button" onClick={() => navigateAdminView("parks")}>Voltar para parques</button></div>}>Não foi possível encontrar ou consultar este parque com a sessão e as permissões atuais. Detalhe do serviço: {parkProfileError}</AdminStateCard>}
          {parkRouteId && parkProfile && !parkProfileLoading && <ConnectParkProfilePage
            profile={parkProfile}
            context={context}
            busy={busy}
            activeTab={parkProfileTab}
            onTabChange={setParkProfileTab}
            onBack={() => navigateAdminView("parks")}
            onStatus={(status) => void setParkAccess(status)}
            onToggleEvent={(eventId, status) => void setParkEventStatus(eventId, status)}
            onOpenEvents={() => navigateAdminView("events")}
            selectedEventId={selectedEvent}
            onSelectEvent={setSelectedEvent}
            parkFormState={parkFormState}
            onParkFormStateChange={setParkFormState}
            onSavePark={savePark}
            editingPark={editingPark}
            onToggleEditing={() => setEditingPark((value) => !value)}
            onCreateManagerInvitation={(email) => void createManagerInvitation(email)}
            managerInviteLink={managerInviteLink}
            audit={audit}
            auditError={parkAuditError}
            onCopyAreaLink={(area) => void copyParkAreaLink(area)}
          />}
          {!parkRouteId && canProvision && !park && (
            <section className="card form-card">
              <h2>Cadastrar parque</h2>
              <p>O nome identifica o parque; cidade e UF diferenciam cadastros homônimos.</p>
              <form onSubmit={submitProvision}>
                <div className="form-row"><AdminField name="name" label="Nome do parque" required /><AdminField name="manager_name" label="Responsável contratante" required /></div>
                <div className="form-row"><label className="field"><span>Telefone administrativo</span><BrazilianPhoneInput state={parkFormState} /></label><AdminField name="city" label="Cidade" required /><label className="field"><span>UF</span><select name="state" required value={parkFormState} onChange={(event) => setParkFormState(event.target.value)}><option value="">Selecione a UF</option>{BrazilianStateOptions()}</select></label></div>
                <AdminField name="address" label="Endereço" required />
                <button className="primary" disabled={busy}>Provisionar ou recuperar parque</button>
              </form>
            </section>
          )}

        </>
      )}

      {adminView === "events" && !canProvision && <AdminStateCard title="Acesso limitado">Seu perfil não tem permissão para criar ou administrar eventos. A navegação não concede acesso adicional.</AdminStateCard>}
      {adminView === "events" && canProvision && !park && <AdminStateCard title="Selecione um parque" action={<AdminGoToParks onClick={() => navigateAdminView("parks")} />}>Os eventos são consultados e criados dentro de um parque autorizado. Abra um perfil na lista de parques para carregar o contexto.</AdminStateCard>}
      {adminView === "events" && park && canProvision && (
        <section className="card form-card">
          <AdminSectionHeader eyebrow={`PARQUE · ${park.name}`} title="Eventos do parque" description="Crie eventos e acompanhe os registros retornados pelo servidor." />
          <h3>Preparar novo evento</h3>
          <p>Cada evento ganha ID próprio e permanece vinculado ao mesmo parque. Nenhuma tabela esportiva ou regra de pontos é criada por este formulário.</p>
          <form onSubmit={createEvent}>
            <AdminField name="name" label="Nome da vaquejada" required />
            <AdminField name="location" label="Local" />
            <div className="form-row">
              <AdminField name="starts_at" label="Início" type="datetime-local" required />
              <AdminField name="ends_at" label="Término" type="datetime-local" required />
            </div>
            <fieldset>
              <legend>Categorias deste evento</legend>
              {AVAILABLE_CATEGORIES.map((category) => (
                <label key={category} className="checkbox-field"><input type="checkbox" name="categories" value={category} />{category}</label>
              ))}
            </fieldset>
            <div className="form-row">
              <AdminField name="ticket_quantity" label="Capacidade de senhas (opcional)" type="number" min="0" />
              <AdminField name="ticket_price" label="Valor de inscrição (opcional)" type="number" min="0" step="0.01" />
            </div>
            <button className="primary" disabled={busy}>Criar evento vinculado</button>
          </form>
          <h3>Eventos deste parque</h3>
          {events.length === 0 ? <AdminStateCard title="Nenhum evento encontrado">Este parque não possui eventos retornados pelo servidor.</AdminStateCard> : events.map((item) => (
            <div className="event-list-item" key={item.id}>
              <div><strong>{item.name}</strong><span>{new Date(item.starts_at).toLocaleString()} – {new Date(item.ends_at).toLocaleString()} · {item.operational_status} · {item.id}</span></div>
              <button className="text-button" disabled={busy} onClick={async () => {
                const reason = window.prompt(`Justificativa para ${item.operational_status === "active" ? "encerrar" : "reabrir"} o evento:`);
                if (!reason?.trim()) return;
                setBusy(true);
                try {
                  await setConnectEventStatus(item.id, item.operational_status === "active" ? "closed" : "active", reason);
                  await refreshEvents(park.id);
                  const auditError = await refreshParkAudit(park.id);
                  setNotice(auditError
                    ? `Estado do evento atualizado. Histórico indisponível: ${auditError}`
                    : "Estado do evento atualizado e auditado.");
                } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao atualizar evento."); }
                finally { setBusy(false); }
              }}>{item.operational_status === "active" ? "Encerrar evento" : "Reabrir evento"}</button>
            </div>
          ))}
        </section>
      )}

      {adminView === "people" && !canProvision && <AdminStateCard title="Acesso limitado">Seu perfil não pode gerenciar convites ou permissões de equipe.</AdminStateCard>}
      {adminView === "people" && canProvision && !park && <AdminStateCard title="Selecione um parque" action={<AdminGoToParks onClick={() => navigateAdminView("parks")} />}>A equipe é organizada por parque e evento. Abra um perfil de parque para selecionar o contexto.</AdminStateCard>}
      {adminView === "people" && park && canProvision && (
        <>
          {selectedEvent && park.access_status === "active" && (
            <section className="card form-card">
              <h2>Acesso compartilhado do responsável</h2>
              <p>Este acesso é somente para acompanhamento em leitura. Locução e escritório recebem contas individuais na seção abaixo.</p>
              <select aria-label="Evento para equipe" value={selectedEvent} onChange={(event) => setSelectedEvent(event.target.value)}>
                {events.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.operational_status}</option>)}
              </select>
              <form className="form-row" onSubmit={provisionSharedRole}>
                <label className="field"><span>Função</span><select name="role"><option value="event_supervisor">Responsável · acompanhamento somente leitura</option></select></label>
                <AdminField name="expires_at" label="Expiração (até o fim do evento)" type="datetime-local" max={events.find((item) => item.id === selectedEvent)?.ends_at.slice(0, 16)} defaultValue={events.find((item) => item.id === selectedEvent)?.ends_at.slice(0, 16)} required />
                <button className="primary" disabled={busy}><KeyRound size={16} /> Gerar/rotacionar código e PIN</button>
              </form>
              {issuedCredentials && (
                <div className="form-note credential-issued" role="status">
                  <div><strong>{issuedCredentials.role === "office" ? "Escritório" : issuedCredentials.role === "announcer" ? "Locução" : "Responsável"}</strong> · válido até {new Date(issuedCredentials.expiresAt).toLocaleString()}<br />Estas credenciais são exibidas somente nesta emissão.</div>
                  <label className="field"><span>Código da função</span><input readOnly value={issuedCredentials.accessCode} /></label>
                  <label className="field"><span>PIN</span><input readOnly value={issuedCredentials.pin} /></label>
                </div>
              )}
              <ul className="event-role-access-list">
                {roleAccesses.map((access) => (
                  <li key={`${access.role}-${access.created_at}`}>
                    {access.role === "office" ? "Escritório" : access.role === "announcer" ? "Locução" : "Responsável · leitura"} · expira {new Date(access.expires_at).toLocaleString()} · {access.revoked_at ? "revogado" : new Date(access.expires_at) <= new Date() ? "expirado" : "ativo"}
                    {!access.revoked_at && new Date(access.expires_at) > new Date() && <button className="text-button" disabled={busy} onClick={() => void revokeSharedRole(access.role)}>Revogar</button>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {selectedEvent && park.access_status === "active" && (
            <section className="card form-card">
              <h2>Contas individuais da equipe do evento</h2>
              <p>Crie um convite para o email de cada pessoa. Ela confirma o email, cria sua senha e acessa somente a função deste evento.</p>
              <form className="form-row" onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const expires = String(form.get("expires_at") || "");
                setBusy(true); setInviteLink("");
                try {
                  const invitation = await createEventStaffInvitation(selectedEvent, String(form.get("email") || ""), String(form.get("role")) as "office" | "announcer" | "judge" | "track_operator", new Date(expires).toISOString());
                  const url = new URL("/entrar", window.location.origin);
                  url.searchParams.set("eventInvite", invitation.invitation_token);
                  setInviteLink(url.toString());
                  const auditError = await refreshParkAudit(park.id);
                  setNotice(auditError
                    ? `Convite criado. Histórico indisponível: ${auditError}`
                    : `Convite válido até ${new Date(invitation.expires_at).toLocaleString()}. Envie por canal confiável.`);
                  setStaff(await listEventStaff(selectedEvent));
                } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao criar convite."); }
                finally { setBusy(false); }
              }}>
                <AdminField name="email" label="Email individual" type="email" required />
                <label className="field"><span>Função</span><select name="role"><option value="office">Escritório</option><option value="announcer">Locução</option><option value="judge">Julgador</option><option value="track_operator">Operador de pista</option></select></label>
                <AdminField name="expires_at" label="Expiração (até o fim do evento)" type="datetime-local" max={events.find((item) => item.id === selectedEvent)?.ends_at.slice(0, 16)} defaultValue={events.find((item) => item.id === selectedEvent)?.ends_at.slice(0, 16)} required />
                <button className="primary" disabled={busy}><UserPlus size={16} /> Criar convite</button>
              </form>
              {inviteLink && <label className="field"><span>Link de convite individual (copiar e enviar por canal confiável)</span><textarea readOnly value={inviteLink} /></label>}
              <ul>
                {staff.map((member) => (
                  <li key={member.user_id}>
                  {member.role === "office" ? "Escritório" : member.role === "announcer" ? "Locução" : member.role === "judge" ? "Julgador" : "Operador de pista"} · conta …{member.user_id.slice(-6)} · expira {new Date(member.expires_at).toLocaleString()} · {member.revoked_at ? "revogado" : new Date(member.expires_at) <= new Date() ? "expirado" : "ativo"}
                    {!member.revoked_at && new Date(member.expires_at) > new Date() && (
                      <button className="text-button" disabled={busy} onClick={async () => {
                        if (!window.confirm("Revogar o acesso desta pessoa ao evento?")) return;
                        setBusy(true);
                        try {
                          await revokeEventStaff(selectedEvent, member.user_id);
                          setStaff(await listEventStaff(selectedEvent));
                          const auditError = await refreshParkAudit(park.id);
                          setNotice(auditError
                            ? `Acesso revogado. Histórico indisponível: ${auditError}`
                            : "Acesso revogado no servidor.");
                        } catch (error) {
                          setNotice(error instanceof Error ? error.message : "Falha ao revogar.");
                        } finally {
                          setBusy(false);
                        }
                      }}>Revogar</button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {adminView === "reconciliation" && !canProvision && <AdminStateCard title="Acesso limitado">Seu perfil não tem permissão para revisar reconciliações de equipe.</AdminStateCard>}
      {adminView === "reconciliation" && canProvision && !park && <AdminStateCard title="Selecione um parque" action={<AdminGoToParks onClick={() => navigateAdminView("parks")} />}>O inventário legado é carregado por parque. Abra um perfil para iniciar ou continuar uma revisão autorizada.</AdminStateCard>}
      {adminView === "reconciliation" && park && canProvision && (
        <section className="card form-card" aria-labelledby="legacy-reconciliation-title">
          <AdminSectionHeader id="legacy-reconciliation-title" eyebrow={`PARQUE · ${park.name}`} title="Reconciliação de equipes legadas" description="O inventário é somente leitura. Designação ao parque não comprova designação ao evento. Evidência externa deve ser conferida pela comissão; a ativação exige outro operador e não substitui vínculos conflitantes." />
          <div className="form-row">
            <button className="secondary" disabled={busy} onClick={() => void prepareLegacyInventory(false)}>Preparar ou repetir inventário</button>
            <button className="text-button" disabled={busy} onClick={() => void prepareLegacyInventory(true)}>Preparar novo lote</button>
          </div>
          {reconciliationBatch && <p>Lote {reconciliationBatch} · {reconciliationItems.length} itens · {reconciliationAudit.length} registros de auditoria</p>}
          {!reconciliationBatch && <AdminStateCard title="Nenhum inventário carregado">Prepare ou repita um inventário somente leitura para consultar as pendências reais deste parque.</AdminStateCard>}
          {reconciliationItems.map((item) => (
            <article className="event-list-item" key={item.item_id}>
              <div>
                <strong>{item.source_role} · {item.source_user_id || `Convite ${item.source_invitation_id || "sem identidade"}`}</strong>
                <span>{item.candidate_event_id ? `${events.find((candidate) => candidate.id === item.candidate_event_id)?.name || "Evento"} · ${item.candidate_event_id}` : "Sem evento candidato"} · {item.classification} · {item.decision}</span>
                <span>Origem: {item.source_kind}; criada por {item.source_created_by || "não identificado"}; {item.source_was_active ? "ativa no snapshot" : "inativa no snapshot"}{item.source_membership_disabled_at ? ` · desativada em ${new Date(item.source_membership_disabled_at).toLocaleString()}` : ""}</span>
                {item.evidence_reference && <span>Evidência: {item.evidence_reference}</span>}
                {item.decision_reason && <span>Motivo: {item.decision_reason} · revisor {item.reviewed_by || "—"}</span>}
              </div>
              <div className="form-row">
                {item.candidate_event_id && item.source_kind === "park_membership" && <button className="secondary" disabled={busy} onClick={() => void reviewLegacyItem(item, "proven")}>Revisar como comprovado</button>}
                {item.candidate_event_id && item.decision !== "activated" && <button className="text-button" disabled={busy} onClick={() => void reviewLegacyItem(item, "ambiguous")}>Manter ambíguo</button>}
                {!item.candidate_event_id && item.decision !== "activated" && <button className="text-button" disabled={busy} onClick={() => void reviewLegacyItem(item, "no_destination")}>Confirmar sem destino</button>}
                {item.decision === "approved" && <button className="primary" disabled={busy} onClick={() => void activateLegacyItem(item)}>Ativar com segundo operador</button>}
              </div>
            </article>
          ))}
          {reconciliationAudit.length > 0 && (
            <details>
              <summary>Histórico de reconciliação</summary>
              <ul>{reconciliationAudit.map((record, index) => <li key={`${record.occurred_at}-${index}`}>{new Date(record.occurred_at).toLocaleString()} · {record.action} · ator {record.actor_user_id || "—"}{record.event_id ? ` · evento ${record.event_id}` : ""}{record.reason ? ` · ${record.reason}` : ""}</li>)}</ul>
            </details>
          )}
        </section>
      )}

      {adminView === "publications" && isAdmin && (
        <section className="connect-publications">
          <header className="connect-publications-heading"><div><span className="connect-dashboard-eyebrow">SITE PÚBLICO</span><h2>Revisão e publicação de eventos</h2><p>O parque confirma os dados; a equipe Connect revisa e publica em duas etapas. Esta fila não inclui classificações.</p></div><button className="secondary" type="button" disabled={publicationLoading} onClick={() => setPublicationRevision((revision) => revision + 1)}>Atualizar fila</button></header>
          {publicationError && <p className="connect-dashboard-warning" role="alert">{publicationError}</p>}
          {publicationLoading ? <p className="empty small">Carregando fila de publicação…</p>
            : publicationRows.length === 0 ? <p className="empty small">Não há eventos ativos para revisão.</p>
              : <div className="connect-publication-list">{publicationRows.map((row) => {
                const prizeLabels = Array.isArray(row.prizes) ? row.prizes.filter((item): item is string => typeof item === "string") : [];
                const statusLabel = row.status === "park_confirmed" ? "Aguardando revisão Connect" : row.status === "changes_requested" ? "Correções solicitadas" : row.status === "approved" ? "Aprovado · não publicado" : row.status === "published" ? "Publicado" : row.status === "withdrawn" ? "Retirado" : "Aguardando confirmação do parque";
                return <article className="connect-publication-card" key={row.event_id}>
                  <div className="connect-publication-card-heading"><div><span className="connect-publication-park">{row.park_name} · {row.city}/{row.state}</span><h3>{row.event_name}</h3></div><span className={`connect-publication-status ${row.status}`}>{statusLabel}</span></div>
                  <p className="connect-publication-meta">{row.location || "Local não informado"} · {new Date(row.starts_at).toLocaleDateString("pt-BR")} a {new Date(row.ends_at).toLocaleDateString("pt-BR")}</p>
                  {row.public_description && <p className="connect-publication-description">{row.public_description}</p>}
                  <div className="connect-publication-details"><div><strong>Categorias</strong><span>{row.categories.join(" · ")}</span></div><div><strong>Premiações confirmadas</strong><span>{prizeLabels.length ? prizeLabels.join(" · ") : "Nenhuma informada"}</span></div></div>
                  <div className="connect-publication-actions">
                    {row.status === "park_confirmed" && <><button className="secondary" type="button" disabled={busy} onClick={() => void requestPublicationChanges(row)}>Solicitar correções</button><button className="primary" type="button" disabled={busy} onClick={() => void actOnPublication(row, "approved")}>Aprovar informações</button></>}
                    {row.status === "approved" && <button className="primary" type="button" disabled={busy} onClick={() => void actOnPublication(row, "published")}>Publicar evento</button>}
                    {row.status === "published" && <button className="text-button" type="button" disabled={busy} onClick={() => void actOnPublication(row, "withdrawn")}>Retirar do site</button>}
                    {row.status === "draft" && <span className="subtle">O responsável do parque precisa confirmar os dados.</span>}
                    {(row.status === "withdrawn" || row.status === "changes_requested") && <span className="subtle">O parque precisa revisar e confirmar os dados novamente.</span>}
                  </div>
                </article>;
              })}</div>}
          <a className="connect-publication-preview-link" href="/eventos" target="_blank" rel="noreferrer">Abrir site público</a>
        </section>
      )}

      {adminView === "platform" && !isAdmin && <AdminStateCard title="Acesso restrito">A gestão da equipe Connect está disponível somente para administradores de plataforma.</AdminStateCard>}
      {adminView === "platform" && isAdmin && <PlatformStaffManager busy={busy} setBusy={setBusy} setNotice={setNotice} />}
        </div>
      </main>
    </div>
  );
}

function PlatformStaffManager({ busy, setBusy, setNotice }: { busy: boolean; setBusy: (value: boolean) => void; setNotice: (value: string) => void }) {
  return (
    <section className="card form-card">
      <AdminSectionHeader title="Equipe interna Connect" description="O usuário precisa ter uma identidade Auth individual confirmada. Administradores de plataforma são provisionados separadamente por operador confiável." />
      <AdminStateCard title="Listagem não disponível nesta integração">O serviço atual permite atribuir e revogar perfis, mas não disponibiliza uma consulta de equipe para exibição aqui.</AdminStateCard>
      <form className="form-row" onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (!window.confirm("Revogar o perfil interno Connect desta conta?")) return;
        setBusy(true);
        try {
          await manageConnectPlatformStaff(String(form.get("email") || ""), String(form.get("role")) as "deployment" | "support");
          setNotice("Atribuição de perfil registrada com auditoria.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao atribuir perfil."); }
        finally { setBusy(false); }
      }}>
        <AdminField name="email" label="Email da conta Auth" type="email" required />
        <label className="field"><span>Perfil interno</span><select name="role"><option value="deployment">Implantação</option><option value="support">Suporte sem dados operacionais</option></select></label>
        <button className="primary" disabled={busy}>Atribuir ou atualizar</button>
      </form>
      <form className="form-row" onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        try {
          await revokeConnectPlatformStaff(String(form.get("email") || ""));
          setNotice("Acesso interno revogado.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao revogar perfil."); }
        finally { setBusy(false); }
      }}>
        <AdminField name="email" label="Email para revogar" type="email" required />
        <button className="secondary" disabled={busy}>Revogar acesso interno</button>
      </form>
    </section>
  );
}

function parkLifecycleLabel(status: ConnectParkLifecycleStatus): string {
  return status === "provisioned" ? "Provisionado"
    : status === "pending_configuration" ? "Pendente de configuração"
      : status === "suspended" ? "Suspenso" : "Arquivado";
}

function AdminField({ name, label, type = "text", required = false, defaultValue, min, max, step }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string | number; min?: string; max?: string; step?: string }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} required={required} defaultValue={defaultValue} min={min} max={max} step={step} /></label>;
}
