import { FormEvent, ReactNode } from "react";
import { ArrowLeft, Building2, CalendarDays, ClipboardList, Cog, Copy, Database, ShieldCheck, UsersRound } from "lucide-react";
import { BrazilianPhoneInput, BrazilianStateOptions } from "./BrazilFields";
import { AdminSectionHeader, AdminStateCard } from "./ConnectAdminComponents";
import { ConnectParkProfile, ConnectPlatformAudit, PlatformContext } from "./backend";

export type ParkProfileTab = "overview" | "events" | "team" | "configuration" | "audit" | "diagnostics";

type Props = {
  profile: ConnectParkProfile;
  context: PlatformContext;
  busy: boolean;
  activeTab: ParkProfileTab;
  onTabChange: (tab: ParkProfileTab) => void;
  onBack: () => void;
  onStatus: (status: "active" | "suspended" | "closed") => void;
  onToggleEvent: (eventId: string, status: "active" | "closed") => void;
  onOpenEvents: () => void;
  selectedEventId: string;
  onSelectEvent: (eventId: string) => void;
  parkFormState: string;
  onParkFormStateChange: (state: string) => void;
  onSavePark: (event: FormEvent<HTMLFormElement>) => void;
  editingPark: boolean;
  onToggleEditing: () => void;
  onCreateManagerInvitation: (email: string) => void;
  managerInviteLink: string;
  audit: ConnectPlatformAudit[];
  auditError: string;
  onCopyAreaLink: (area: "office" | "announcer" | "operational") => void;
};

const tabs: { id: ParkProfileTab; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Visão geral", icon: <Building2 size={16} /> },
  { id: "events", label: "Eventos", icon: <CalendarDays size={16} /> },
  { id: "team", label: "Equipe e acessos", icon: <UsersRound size={16} /> },
  { id: "configuration", label: "Configuração", icon: <Cog size={16} /> },
  { id: "audit", label: "Histórico", icon: <ClipboardList size={16} /> },
  { id: "diagnostics", label: "Diagnóstico", icon: <Database size={16} /> },
];

export function ConnectParkProfilePage(props: Props) {
  const { profile, context, busy, activeTab, onTabChange, onBack, onStatus, onToggleEvent, onOpenEvents,
    selectedEventId, onSelectEvent, parkFormState, onParkFormStateChange, onSavePark, editingPark,
    onToggleEditing, onCreateManagerInvitation, managerInviteLink, audit, auditError, onCopyAreaLink } = props;
  const { park } = profile;
  const canManage = context.role === "platform_admin" || context.role === "deployment";
  const canReadAudit = context.role === "platform_admin" || context.role === "support";
  const selectedEvent = profile.events.find((event) => event.id === selectedEventId) ?? profile.events[0];

  return <div className="connect-park-profile-page">
    <button className="connect-park-back secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> Voltar para parques</button>
    <header className="connect-park-identity">
      <div className="connect-park-logo-fallback" aria-label="Logotipo não cadastrado"><Building2 size={25} /></div>
      <div className="connect-park-identity-copy">
        <span className="connect-dashboard-eyebrow">PERFIL ADMINISTRATIVO DO PARQUE</span>
        <h2>{park.name}</h2>
        <p><code>{park.connect_code || "Código indisponível"}</code><span aria-hidden="true"> · </span>{park.city}/{park.state}</p>
      </div>
      <span className={`connect-park-lifecycle ${park.lifecycle_status}`}>{parkLifecycleLabel(park.lifecycle_status)}</span>
      <div className="connect-park-identity-actions">
        {canManage && park.access_status === "active" && <button type="button" className="secondary" disabled={busy} onClick={() => onStatus("suspended")}>Suspender acesso</button>}
        {canManage && park.access_status === "suspended" && <button type="button" className="secondary" disabled={busy} onClick={() => onStatus("active")}>Reativar acesso</button>}
        {canManage && park.access_status === "closed" && <button type="button" className="secondary" disabled={busy} onClick={() => onStatus("active")}>Reativar parque arquivado</button>}
        {canManage && park.access_status !== "closed" && <button type="button" className="text-button" disabled={busy} onClick={() => onStatus("closed")}>Arquivar parque</button>}
      </div>
    </header>

    <nav className="connect-park-profile-tabs" aria-label={`Seções administrativas de ${park.name}`}>
      {tabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} aria-current={activeTab === tab.id ? "page" : undefined} onClick={() => onTabChange(tab.id)}>{tab.icon}<span>{tab.label}</span></button>)}
    </nav>

    {activeTab === "overview" && <section className="card form-card connect-park-profile-panel">
      <AdminSectionHeader eyebrow="CADASTRO" title="Resumo do parque" description="Informações administrativas retornadas pelo serviço Connect." actions={canManage && <button className="secondary" type="button" disabled={busy} onClick={() => { onTabChange("configuration"); if (!editingPark) onToggleEditing(); }}>Editar cadastro</button>} />
      <div className="connect-park-profile-grid">
        <div><span>Situação de acesso</span><strong>{parkAccessLabel(park.access_status)}</strong></div>
        <div><span>Responsável contratante</span><strong>{park.manager_name || "Não informado"}</strong></div>
        <div><span>Telefone autorizado</span><strong>{park.phone || "Não informado"}</strong></div>
        <div><span>Email da identidade vinculada</span><strong>{park.owner_email || "Ainda não vinculada"}</strong></div>
        <div><span>Endereço</span><strong>{park.address || "Não informado"}</strong></div>
        <div><span>Cadastrado por</span><strong>{profile.created_by_email || profile.created_by_user_id || "Ator não identificado"}</strong></div>
        <div><span>Cadastro registrado em</span><strong>{new Date(profile.created_by_at || park.created_at).toLocaleString("pt-BR")}</strong></div>
        <div><span>Última atualização</span><strong>{new Date(park.updated_at).toLocaleString("pt-BR")}</strong></div>
      </div>
      <div className="connect-park-profile-metrics">
        <article><span>Eventos cadastrados</span><strong>{profile.event_count.toLocaleString("pt-BR")}</strong></article>
        <article><span>Eventos com término passado</span><strong>{profile.completed_event_count.toLocaleString("pt-BR")}</strong></article>
      </div>
    </section>}

    {activeTab === "events" && <section className="card form-card connect-park-profile-panel">
      <AdminSectionHeader eyebrow={`PARQUE · ${park.name}`} title="Eventos associados" description="O serviço do perfil retorna datas e situação operacional. Categorias e outros detalhes esportivos não estão disponíveis nesta consulta." actions={canManage && <button className="primary" type="button" onClick={onOpenEvents}>Criar evento</button>} />
      {profile.events.length === 0 ? <p className="empty small">Nenhum evento foi retornado para este parque.</p> : <div className="connect-park-events-grid">
        <div className="connect-park-event-selector" role="list" aria-label="Eventos do parque">
          {profile.events.map((event) => <button key={event.id} type="button" className={selectedEvent?.id === event.id ? "active" : ""} onClick={() => onSelectEvent(event.id)}>
            <strong>{event.name}</strong><span>{new Date(event.starts_at).toLocaleDateString("pt-BR")} – {new Date(event.ends_at).toLocaleDateString("pt-BR")}</span><small>{event.operational_status === "active" ? "Ativo" : "Encerrado"}</small>
          </button>)}
        </div>
        {selectedEvent && <article className="connect-park-event-detail">
          <span className="connect-dashboard-eyebrow">DETALHES DISPONÍVEIS</span><h3>{selectedEvent.name}</h3>
          <dl><div><dt>Início</dt><dd>{new Date(selectedEvent.starts_at).toLocaleString("pt-BR")}</dd></div><div><dt>Término</dt><dd>{new Date(selectedEvent.ends_at).toLocaleString("pt-BR")}</dd></div><div><dt>Situação operacional</dt><dd>{selectedEvent.operational_status === "active" ? "Ativo" : "Encerrado"}</dd></div><div><dt>ID do evento</dt><dd><code>{selectedEvent.id}</code></dd></div></dl>
          {canManage && <button className="secondary" type="button" disabled={busy} onClick={() => onToggleEvent(selectedEvent.id, selectedEvent.operational_status === "active" ? "closed" : "active")}>{selectedEvent.operational_status === "active" ? "Encerrar evento" : "Reabrir evento"}</button>}
        </article>}
      </div>}
      {profile.event_count > profile.events.length && <p className="subtle">Exibindo os {profile.events.length} eventos mais recentes de {profile.event_count} cadastrados.</p>}
      {profile.events.length > 0 && <div className="connect-park-area-links"><label className="field"><span>Evento para atalhos operacionais</span><select value={selectedEventId || selectedEvent?.id || ""} onChange={(event) => onSelectEvent(event.target.value)}>{profile.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label><div>
        <button className="secondary" type="button" onClick={() => onCopyAreaLink("office")}><Copy size={14} /> Copiar link Escritório</button><button className="secondary" type="button" onClick={() => onCopyAreaLink("announcer")}><Copy size={14} /> Copiar link Locução</button><button className="secondary" type="button" onClick={() => onCopyAreaLink("operational")}><Copy size={14} /> Copiar link operacional</button>
      </div><p>Os links apenas direcionam; identidade, vínculo e permissões continuam sendo validados pelo sistema.</p></div>}
    </section>}

    {activeTab === "team" && <section className="card form-card connect-park-profile-panel">
      <AdminSectionHeader eyebrow={`ACESSO · ${park.name}`} title="Equipe e permissões" description="Contas e funções que o serviço de perfil autorizou consultar." />
      {profile.members.length || profile.event_staff.length || park.owner_user_id ? <div className="table-scroll"><table><thead><tr><th>Conta autorizada</th><th>Permissão</th><th>Escopo</th><th>Situação</th><th>Validade</th></tr></thead><tbody>
        {park.owner_user_id && <tr key={`owner-${park.owner_user_id}`}><td>{park.owner_email || shortAccountId(park.owner_user_id)}</td><td>Responsável contratante</td><td>Parque</td><td>Ativo</td><td>Sem expiração informada</td></tr>}
        {profile.members.map((member) => <tr key={`member-${member.user_id}`}><td>{member.email || shortAccountId(member.user_id)}</td><td>{roleLabel(member.role)}</td><td>Parque</td><td>{member.disabled_at ? "Desativado" : "Ativo"}</td><td>Sem expiração informada</td></tr>)}
        {profile.event_staff.map((member) => <tr key={`staff-${member.event_id}-${member.user_id}`}><td>{member.email || shortAccountId(member.user_id)}</td><td>{roleLabel(member.role)}</td><td>{member.event_name}</td><td>{member.revoked_at ? "Revogado" : new Date(member.expires_at) <= new Date() ? "Expirado" : "Ativo"}</td><td>{new Date(member.expires_at).toLocaleString("pt-BR")}</td></tr>)}
      </tbody></table></div> : <p className="empty small">Nenhuma conta vinculada foi retornada pelo serviço.</p>}
      <p className="subtle">Este perfil permite consultar os vínculos. Convites e permissões de evento continuam sendo gerenciados na seção Equipe e acessos.</p>
    </section>}

    {activeTab === "configuration" && <section className="card form-card connect-park-profile-panel">
      <AdminSectionHeader eyebrow="CONFIGURAÇÃO SUPORTADA" title="Dados cadastrais e acesso do responsável" description="Somente os campos persistidos pelos serviços atuais aparecem nesta seção." actions={canManage && !editingPark && <button className="secondary" type="button" disabled={busy} onClick={onToggleEditing}>Editar cadastro</button>} />
      {editingPark && canManage && <form className="connect-park-edit-form" onSubmit={onSavePark}>
        <div className="form-row"><Field name="name" label="Nome do parque" value={park.name} required /><Field name="manager_name" label="Responsável contratante" value={park.manager_name} required /></div>
        <div className="form-row"><label className="field"><span>Telefone administrativo</span><BrazilianPhoneInput defaultValue={park.phone} state={parkFormState} /></label><Field name="city" label="Cidade" value={park.city} required /><label className="field"><span>UF</span><select name="state" required value={parkFormState} onChange={(event) => onParkFormStateChange(event.target.value)}><option value="">Selecione a UF</option>{BrazilianStateOptions()}</select></label></div>
        <Field name="address" label="Endereço" value={park.address} required />
        <div className="connect-park-profile-actions"><button className="primary" type="submit" disabled={busy}>Salvar dados administrativos</button><button className="secondary" type="button" disabled={busy} onClick={onToggleEditing}>Cancelar</button></div>
      </form>}
      {canManage && park.access_status === "active" && <div className="connect-park-manager-invitation"><h3>Acesso de responsável do parque</h3><p>O convite concede gestão deste parque, não da plataforma Connect. O sistema gera um link e não envia email automaticamente.</p><form className="form-row" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onCreateManagerInvitation(String(form.get("email") || "")); }}><Field name="email" label="Email individual do responsável" type="email" required /><button className="secondary" type="submit" disabled={busy}>Criar convite</button></form>{managerInviteLink && <label className="field"><span>Copie e envie este link ao mesmo endereço por email ou canal confiável</span><textarea readOnly value={managerInviteLink} /></label>}</div>}
      {!canManage && <AdminStateCard title="Edição indisponível para este perfil">Sua função pode consultar o cadastro, mas não editar dados nem criar convites administrativos.</AdminStateCard>}
    </section>}

    {activeTab === "audit" && <section className="card form-card connect-park-profile-panel">
      <AdminSectionHeader eyebrow="AUDITORIA ADMINISTRATIVA" title="Histórico de alterações" description="Registros do serviço de auditoria do Connect para este parque." />
      {!canReadAudit ? <AdminStateCard title="Consulta não autorizada para este perfil">A consulta de auditoria não está disponível para a função de implantação.</AdminStateCard>
        : auditError ? <AdminStateCard title="Histórico indisponível" tone="error">{auditError}</AdminStateCard>
          : audit.length ? <div className="table-scroll"><table><thead><tr><th>Data</th><th>Ação</th><th>Ator</th><th>Evento</th><th>Motivo</th><th>Detalhes</th></tr></thead><tbody>{audit.map((item) => <tr key={item.id}><td>{new Date(item.occurred_at).toLocaleString("pt-BR")}</td><td>{item.action}</td><td>{item.actor_email || item.actor_user_id || "Sistema"}</td><td>{item.event_id || "—"}</td><td>{item.reason || "—"}</td><td><code>{JSON.stringify(item.details)}</code></td></tr>)}</tbody></table></div>
            : <p className="empty small">Nenhum registro de auditoria retornado para este parque.</p>}
    </section>}

    {activeTab === "diagnostics" && <section className="card form-card connect-park-profile-panel">
      <AdminSectionHeader eyebrow="DIAGNÓSTICO" title="Estado conhecido do serviço" description="Sinais derivados das consultas reais disponíveis no perfil do parque." />
      <div className="connect-park-diagnostic checked"><ShieldCheck size={18} /><div><strong>Consulta do perfil Connect</strong><span>O servidor retornou os dados administrativos deste parque nesta sessão.</span></div><b>Verificado</b></div>
      <AdminStateCard title="Diagnósticos técnicos por parque indisponíveis">O backend não fornece indicadores específicos de conectividade, backup ou erros recentes para este parque.</AdminStateCard>
    </section>}
  </div>;
}

function Field({ name, label, value = "", required = false, type = "text" }: { name: string; label: string; value?: string; required?: boolean; type?: string }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} defaultValue={value} required={required} /></label>;
}

function parkLifecycleLabel(status: ConnectParkProfile["park"]["lifecycle_status"]): string {
  return status === "provisioned" ? "Provisionado" : status === "pending_configuration" ? "Pendente de configuração" : status === "suspended" ? "Suspenso" : "Arquivado";
}

function parkAccessLabel(status: ConnectParkProfile["park"]["access_status"]): string {
  return status === "active" ? "Ativo" : status === "suspended" ? "Suspenso" : "Arquivado";
}

function shortAccountId(id: string): string { return `Conta …${id.slice(-6)}`; }

function roleLabel(role: string): string {
  const labels: Record<string, string> = { park_manager: "Responsável do parque", office: "Escritório", announcer: "Locução", judge: "Julgador", track_operator: "Operador de pista", event_supervisor: "Supervisor do evento" };
  return labels[role] || role;
}
