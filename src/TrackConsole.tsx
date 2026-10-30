import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CompetitionConfig, Entry, EventConfig, TrackAction, TrackState, buildRotationQueue, calculateProvisionalTrackTotals, getEntryStatus, getPaymentStatus, officialClassificationReadiness, trackOperationMessage } from "./domain";
import { applyTrackOperation, getTrackState, syncTrackOperations } from "./db";

export function TrackConsole({ event, entries, accessRole, onMessage }: { event: EventConfig; entries: Entry[]; accessRole?: "park_manager" | "office" | "announcer" | "judge" | "track_operator" | "event_supervisor" | null; onMessage: (message: string) => void }) {
  const config = event.competition;
  const [state, setState] = useState<TrackState | null>(null);
  const [rotationId, setRotationId] = useState("");
  const [operator, setOperator] = useState("");
  const [distanceUnit, setDistanceUnit] = useState("");
  const [distance, setDistance] = useState("");
  const [announcedPoints, setAnnouncedPoints] = useState("");
  const [applyBonus, setApplyBonus] = useState(false);
  const [bonusReason, setBonusReason] = useState("");
  const [occurrence, setOccurrence] = useState("");
  const [observation, setObservation] = useState("");
  const [busy, setBusy] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClockNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let alive = true;
    if (!config) { setState(null); return; }
    void getTrackState(event.id, config).then((loaded) => { if (alive) { setState(loaded); setRotationId((current) => current || config.rotations.slice().sort((a,b) => a.order-b.order)[0]?.id || ""); } })
      .catch((error: unknown) => onMessage(error instanceof Error ? error.message : "Falha ao carregar a pista."));
    return () => { alive = false; };
  }, [event.id, config, onMessage]);
  const rotation = config?.rotations.find((item) => item.id === rotationId);
  const runtime = state?.rotations.find((item) => item.rotationId === rotationId);
  const queue = useMemo(() => {
    if (!rotation || !state) return { eligible: [] as Entry[], deferred: [] as Entry[] };
    const rotationCalls = state.calls.filter((call) => call.rotationId === rotationId);
    const calledIds = rotationCalls.filter((call) => !(call.status === "deferred" && call.movedAt)).map((call) => call.entryId);
    const movedIds = rotationCalls.filter((call) => call.status === "deferred" && call.movedAt).map((call) => call.entryId);
    return buildRotationQueue(entries.filter((entry) => entry.eventId === event.id), rotation, calledIds, movedIds);
  }, [entries, event.id, rotation, rotationId, state]);
  const activeCall = state?.calls.find((call) => call.rotationId === rotationId && ["called","present","absent"].includes(call.status));
  const activeRace = state?.races.find((race) => race.id === activeCall?.raceId);
  const trackTotals = useMemo(() => calculateProvisionalTrackTotals(entries.filter((entry) => entry.eventId === event.id), state || undefined), [entries, event.id, state]);
  useEffect(() => {
    setAnnouncedPoints("");
    setApplyBonus(false);
    setBonusReason("");
  }, [activeRace?.id]);
  const canOperateQueue = !accessRole || accessRole === "park_manager" || accessRole === "track_operator";
  const canJudge = !accessRole || accessRole === "park_manager" || accessRole === "judge" || accessRole === "announcer";
  const canConfirmOrCorrect = !accessRole || accessRole === "park_manager";
  const canWriteTrack = canOperateQueue || canJudge || canConfirmOrCorrect;
  async function perform(action: TrackAction, name: string) {
    const actingOperator = operator.trim() || (accessRole === "announcer" ? "Locutor" : "");
    if (!config || !actingOperator) { onMessage("Informe o operador da pista antes de registrar ações."); return; }
    setBusy(true);
    try {
      const updated = await applyTrackOperation(event.id, config, action, crypto.randomUUID(), actingOperator);
      setState(updated);
      onMessage(trackOperationMessage(updated.syncState, name));
    } catch (error) { onMessage(error instanceof Error ? error.message : "Não foi possível registrar a ação."); }
    finally { setBusy(false); }
  }
  if (!config) return <div className="offline-warning">Configure dias e rodízios para este evento antes de operar a pista.</div>;
  const readiness = officialClassificationReadiness(config);
  const announcerRows = accessRole === "announcer"
    ? entries.filter((entry) => entry.eventId === event.id && getEntryStatus(entry) === "active" && getPaymentStatus(entry) === "paid")
      .sort((a, b) => a.number - b.number)
    : [];
  if (accessRole === "announcer") {
    const currentEntry = activeCall ? entries.find((entry) => entry.id === activeCall.entryId) : undefined;
    const resultRace = activeRace?.status === "running" ? activeRace : undefined;
    const announceOutcome = (outcome: "points" | "zero" | "return") => {
      if (!resultRace) return;
      const points = outcome === "points" ? window.prompt("Pontos anunciados pelo juiz:") : null;
      if (outcome === "points" && (points === null || points.trim() === "" || !Number.isFinite(Number(points)) || Number(points) < 0)) return;
      const reason = outcome === "return" ? window.prompt("Ocorrência / motivo do retorno:") : null;
      void perform({ kind: "race.judge", raceId: resultRace.id, outcome, points: outcome === "points" ? Number(points) : undefined, occurrence: reason?.trim() || undefined }, outcome === "points" ? "Valeu o boi" : outcome === "zero" ? "Zero" : "Retorno solicitado");
    };
    return <section className="announcer-screen" aria-label="Painel do locutor">
      <header className="announcer-header">
        <img src="/Simbolo-Principal-Connect-Vaquejada.png" alt="Connect Vaquejada" />
        <div className="announcer-live"><span><i /> AO VIVO</span><b>{event.location || event.name}</b></div>
      </header>
      <div className="announcer-stage">
        <div className="announcer-rider">
          <AnnouncerInfo label="Vaqueiro" value={currentEntry?.vaqueiro || "Aguardando chamada"} />
          <AnnouncerInfo label="Cavalo" value={currentEntry?.horse || "—"} />
          <AnnouncerInfo label="Equipe" value={currentEntry?.representation || "—"} />
        </div>
        <div className="announcer-ticket"><div className="announcer-ticket-label">SENHA ATUAL</div><strong>{currentEntry ? String(currentEntry.number).padStart(2,"0") : "—"}</strong><span>{resultRace ? `CORRIDA ${resultRace.raceNumber} · ${resultRace.status === "running" ? "NA PISTA" : resultRace.status}` : activeCall?.status === "called" ? "CHAMADA" : "PRÓXIMA SENHA"}</span></div>
      </div>
      <div className="announcer-actions" aria-label="Registrar resultado anunciado">
        <button className="announcer-success" disabled={busy || !resultRace} onClick={() => announceOutcome("points")}>VALEU O BOI</button>
        <button className="announcer-zero" disabled={busy || !resultRace} onClick={() => announceOutcome("zero")}>ZERO</button>
        <button className="announcer-return" disabled={busy || !resultRace} onClick={() => announceOutcome("return")}>RETORNO</button>
      </div>
      {!resultRace && <p className="announcer-hint">Os botões de resultado ficam disponíveis durante uma corrida em andamento.</p>}
      <div className="announcer-queue"><strong>Fila de locução</strong><span>{announcerRows.length} senhas pagas e ativas</span><div>{announcerRows.slice(0, 6).map((entry) => <span key={entry.id} className={entry.id === currentEntry?.id ? "current" : ""}><b>{String(entry.number).padStart(2,"0")}</b>{entry.vaqueiro}</span>)}</div></div>
    </section>;
  }
  return <section className="content operational-content">
    <div className="card form-card">
      <div className="section-head"><div><h2>Console operacional da pista</h2><p>Fila e corridas persistidas por evento no IndexedDB, com sincronização quando configurada.</p></div><span className={`count-pill status ${state?.syncState || "local"}`}>{state?.syncState === "synced" ? "Sincronizado" : state?.syncState === "conflict" ? "Conflito" : state?.syncState === "blocked" ? "Sincronização bloqueada" : state?.syncState === "pending" ? "Pendente" : "Local"}</span></div>
      {!readiness.ready && <div className="offline-warning" role="status">{readiness.reason} Distâncias podem ser registradas sem calcular pontos.</div>}
      <div className={`form-row ${canWriteTrack ? "three" : "two"}`}>{canWriteTrack && <Field label="Responsável da operação"><input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="Nome do operador" /></Field>}
        <Field label="Rodízio"><select value={rotationId} onChange={(e) => setRotationId(e.target.value)}>{config.rotations.slice().sort((a,b) => a.order-b.order).map((item) => <option key={item.id} value={item.id}>{item.order}. {item.name}</option>)}</select></Field>
        <Field label="Situação"><input readOnly value={runtime?.status || "carregando"} /></Field></div>
      {canOperateQueue && <div className="form-row"><button className="secondary" disabled={busy || runtime?.status !== "active"} onClick={() => { const reason = askReason("Motivo da pausa"); if (reason) void perform({kind:"rotation.pause",rotationId,reason},"Pausa"); }}>Pausar</button>
        <button className="secondary" disabled={busy || runtime?.status !== "paused"} onClick={() => { const reason = askReason("Motivo da retomada"); if (reason) void perform({kind:"rotation.resume",rotationId,reason},"Retomada"); }}>Retomar</button>
        <button className="secondary" disabled={busy || runtime?.status !== "active"} onClick={() => { const reason = askReason("Motivo do encerramento"); if (reason) void perform({kind:"rotation.close",rotationId,reason},"Encerramento"); }}>Encerrar</button>
        <button className="secondary" disabled={busy || runtime?.status !== "closed"} onClick={() => { const reason = askReason("Justificativa para reabrir"); if (reason) void perform({kind:"rotation.reopen",rotationId,reason},"Reabertura"); }}>Reabrir com justificativa</button></div>}
    </div>
    <div className="card form-card"><div className="section-head"><div><h2>Chamada</h2><p>Prazo de resposta: {config.callWindowSeconds} segundo(s). Rabo da gata exige ausência registrada e ação do operador.</p></div></div>
      <div className="stats-grid"><Stat label="Senha atual" value={activeCall ? String(entries.find((e)=>e.id===activeCall.entryId)?.number ?? "—") : "—"} hint={activeCall?.status || "Sem chamada ativa"}/><Stat label="Próxima senha" value={String(queue.eligible[0]?.number ?? "—")} hint={queue.eligible[0]?.vaqueiro || "Fila elegível"}/><Stat label="Fila elegível" value={queue.eligible.length} hint="Somente inscrições pagas"/><Stat label="Sem pagamento" value={entries.filter((entry)=>entry.eventId===event.id&&getEntryStatus(entry)==="active"&&getPaymentStatus(entry)!=="paid").length} hint="Não entram na chamada"/><Stat label="Aguardando etapa posterior" value={queue.deferred.length} hint="Fora do intervalo ou capacidade"/></div>
      {canOperateQueue && (activeCall ? <div className="form-row">{activeCall.status === "called" && <><button className="secondary" disabled={busy} onClick={() => void perform({kind:"call.present",callId:activeCall.id},"Comparecimento")}>Registrar comparecimento</button>
        <button className="secondary" disabled={busy || clockNow < Date.parse(activeCall.deadlineAt || activeCall.calledAt)} onClick={() => void perform({kind:"call.absent",callId:activeCall.id,reason:"Prazo de chamada encerrado"},"Ausência")}>Registrar ausência após prazo</button></>}
        {activeCall.status === "absent" && <button className="secondary" disabled={busy} onClick={() => { const reason = askReason("Justificativa do deslocamento"); if (reason) void perform({kind:"call.move_tail",callId:activeCall.id,reason},"Rabo da gata"); }}>Mover para final da fila</button>}</div>
        : <button className="primary" disabled={busy || runtime?.status !== "active" || !queue.eligible.length} onClick={() => { const entry=queue.eligible[0]; if(entry) void perform({kind:"call.create",rotationId,entry,callId:crypto.randomUUID(),raceId:crypto.randomUUID()},"Chamada"); }}>Chamar senha {queue.eligible[0]?.number ?? ""}</button>)}
      <p className="form-note">Fila restante: {queue.eligible.map((entry)=>`${entry.number} ${entry.vaqueiro}`).join(" · ") || "vazia"}. Chamadas adiadas: {state?.calls.filter((call)=>call.rotationId===rotationId&&call.status==="deferred").map((call)=>`${entries.find((entry)=>entry.id===call.entryId)?.number ?? "?"}: ${call.reason || "sem justificativa"}`).join(" · ") || "nenhuma"}.</p>
    </div>
    {activeRace && activeCall?.status === "present" && <RacePanel race={activeRace} busy={busy} canStart={canOperateQueue} canJudge={canJudge} canConfirmOrCorrect={canConfirmOrCorrect} distance={distance} setDistance={setDistance} distanceUnit={distanceUnit} setDistanceUnit={setDistanceUnit} announcedPoints={announcedPoints} setAnnouncedPoints={setAnnouncedPoints} bonus={config.scoring?.bonus} applyBonus={applyBonus} setApplyBonus={setApplyBonus} bonusReason={bonusReason} setBonusReason={setBonusReason} occurrence={occurrence} setOccurrence={setOccurrence} observation={observation} setObservation={setObservation} onAction={perform}/>}
    <div className="card table-card"><div className="table-title"><h2>Corridas registradas</h2><span className="subtle">{state?.races.length || 0} registros</span></div><div className="table-scroll"><table><thead><tr><th>Senha</th><th>Corrida</th><th>Estado</th><th>Resultado</th><th>Pontos do juiz / bônus</th><th>Distância registrada</th><th>Ação</th></tr></thead><tbody>{(state?.races || []).slice().reverse().map((race)=><tr key={race.id}><td>{race.ticketNumber}</td><td>{race.raceNumber}</td><td>{race.status}</td><td>{race.resultStatus === "official" ? "Resultado confirmado" : race.resultStatus === "pending" ? "Aguardando confirmação" : "Não registrado"}</td><td>{race.resultStatus === "official" ? `${race.announcedPoints ?? 0}${race.bonusPoints ? ` + ${race.bonusPoints} bônus` : ""} pts` : "—"}</td><td>{race.distance == null ? "—" : `${race.distance} ${race.distanceUnit || "(unidade pendente)"}`}</td><td>{race.resultStatus === "official" && canConfirmOrCorrect && <button className="text-button" disabled={busy} onClick={()=>{let points:number|undefined;if(race.outcome==="points"){const value=window.prompt("Nova pontuação anunciada pelo juiz:",String(race.announcedPoints??""));if(value===null)return;points=Number(value);}const reason=window.prompt("Justificativa obrigatória para correção de resultado confirmado (mínimo 10 caracteres):");if(reason)void perform({kind:"result.correct",raceId:race.id,outcome:race.outcome||"points",distance:race.distance,distanceUnit:race.distanceUnit,occurrence:race.occurrence,observation:race.observation,points,reason},"Correção de resultado registrada");}}>Corrigir</button>}</td></tr>)}</tbody></table></div></div>
    <div className="card table-card"><div className="table-title"><h2>Totais provisórios por inscrição</h2><span className="subtle">Sem posições oficiais; cada senha é apurada separadamente.</span></div><div className="table-scroll"><table><thead><tr><th>Categoria</th><th>Senha</th><th>Puxador</th><th>Corridas confirmadas</th><th>Total registrado</th></tr></thead><tbody>{trackTotals.slice().sort((a,b)=>a.entry.category.localeCompare(b.entry.category,"pt-BR")||a.entry.number-b.entry.number).map(({entry,points,confirmedRaces})=><tr key={entry.id}><td>{entry.category}</td><td>{entry.number}</td><td>{entry.vaqueiro}</td><td>{confirmedRaces}</td><td>{points} pts</td></tr>)}</tbody></table></div></div>
    <div className="card table-card"><div className="table-title"><h2>Histórico auditável</h2><span className="subtle">{state?.history.length || 0} ações</span></div><div className="table-scroll"><table><thead><tr><th>Horário</th><th>Ação</th><th>Senha</th><th>Operador</th><th>Motivo / ocorrência</th></tr></thead><tbody>{(state?.history || []).slice().reverse().map((item)=><tr key={item.id}><td>{new Date(item.occurredAt).toLocaleString("pt-BR")}</td><td>{item.action}</td><td>{entries.find((entry)=>entry.id===item.entryId)?.number ?? "—"}</td><td>{item.operator}</td><td>{item.reason || "—"}</td></tr>)}</tbody></table></div></div>
  </section>;
}
function AnnouncerInfo({label,value}:{label:string;value:string}) { return <div className="announcer-info"><span>{label}</span><strong>{value}</strong><i /></div>; }
function RacePanel({race,busy,canStart,canJudge,canConfirmOrCorrect,distance,setDistance,distanceUnit,setDistanceUnit,announcedPoints,setAnnouncedPoints,bonus,applyBonus,setApplyBonus,bonusReason,setBonusReason,occurrence,setOccurrence,observation,setObservation,onAction}:{race:TrackState["races"][number];busy:boolean;canStart:boolean;canJudge:boolean;canConfirmOrCorrect:boolean;distance:string;setDistance:(v:string)=>void;distanceUnit:string;setDistanceUnit:(v:string)=>void;announcedPoints:string;setAnnouncedPoints:(v:string)=>void;bonus:NonNullable<CompetitionConfig["scoring"]>["bonus"];applyBonus:boolean;setApplyBonus:(v:boolean)=>void;bonusReason:string;setBonusReason:(v:string)=>void;occurrence:string;setOccurrence:(v:string)=>void;observation:string;setObservation:(v:string)=>void;onAction:(a:TrackAction,n:string)=>Promise<void>}) {
  return <div className="card form-card"><h2>Corrida {race.raceNumber} · {race.status}</h2>
    {race.status === "pending" && canStart && <button className="primary" disabled={busy} onClick={()=>void onAction({kind:"race.start",raceId:race.id},"Início da corrida")}>Iniciar corrida</button>}
    {race.status === "running" && canJudge && <><div className="form-row three"><Field label="Pontuação anunciada pelo juiz"><input type="number" min="0" step="any" value={announcedPoints} onChange={(e)=>setAnnouncedPoints(e.target.value)}/></Field><Field label="Distância julgada (registro opcional)"><input type="number" min="0" step="any" value={distance} onChange={(e)=>setDistance(e.target.value)}/></Field><Field label="Unidade da distância"><input value={distanceUnit} onChange={(e)=>setDistanceUnit(e.target.value)} placeholder="Opcional"/></Field></div><Field label="Ocorrência / retorno"><input value={occurrence} onChange={(e)=>setOccurrence(e.target.value)}/></Field><Field label="Observações"><input value={observation} onChange={(e)=>setObservation(e.target.value)}/></Field>{bonus?.enabled && <div className="form-row"><Field label={`Aplicar bônus de ${bonus.points} pontos: ${bonus.conditions}`}><input type="checkbox" checked={applyBonus} onChange={(e)=>setApplyBonus(e.target.checked)}/></Field>{applyBonus && <Field label="Motivo pelo qual a condição foi atendida"><input value={bonusReason} onChange={(e)=>setBonusReason(e.target.value)}/></Field>}</div>}<div className="form-row">{(["points","zero","return"] as const).map((outcome)=><button key={outcome} className="secondary" disabled={busy||(outcome==="points"&&announcedPoints==="")} onClick={()=>void onAction({kind:"race.judge",raceId:race.id,outcome,distance:distance===""?undefined:Number(distance),distanceUnit:distanceUnit||undefined,occurrence:occurrence||undefined,observation:observation||undefined,points:outcome==="points"?Number(announcedPoints):undefined,applyBonus:outcome==="points"?applyBonus:undefined,bonusReason:applyBonus?bonusReason:undefined},`Julgamento ${outcome}`)}>{outcome === "points" ? "Registrar corrida pontuada" : outcome === "zero" ? "Confirmar zero" : "Solicitar retorno"}</button>)}</div><p className="form-note">A pontuação é exatamente a anunciada pelo juiz; a distância é somente registrada e não a calcula. Zero registra 0; retorno não recebe pontos nesta corrida.</p></>}
    {race.status === "return_requested" && canJudge && <div className="form-row"><button className="secondary" disabled={busy} onClick={()=>{const reason=askReason("Justificativa da autorização");if(reason)void onAction({kind:"return.decide",raceId:race.id,decision:"approved",reason},"Retorno autorizado");}}>Autorizar retorno</button><button className="secondary" disabled={busy} onClick={()=>{const reason=askReason("Justificativa da negativa");if(reason)void onAction({kind:"return.decide",raceId:race.id,decision:"denied",reason},"Retorno negado");}}>Negar retorno</button></div>}
    {race.status === "return_authorized" && canJudge && <button className="secondary" disabled={busy} onClick={()=>void onAction({kind:"return.create_race",raceId:race.id,newRaceId:crypto.randomUUID()},"Corrida de retorno criada")}>Criar corrida de retorno autorizada</button>}
    {race.resultStatus === "pending" && canConfirmOrCorrect && <button className="secondary" disabled={busy} onClick={()=>void onAction({kind:"result.confirm",raceId:race.id},"Resultado confirmado")}>Confirmar resultado</button>}
    {race.resultStatus === "official" && canConfirmOrCorrect && <button className="secondary" disabled={busy} onClick={()=>{const reason=askReason("Justificativa obrigatória para corrigir resultado confirmado (mínimo 10 caracteres):");if(reason)void onAction({kind:"result.correct",raceId:race.id,outcome:race.outcome||"points",distance:race.distance,distanceUnit:race.distanceUnit,occurrence:race.occurrence,observation:race.observation,reason},"Correção de resultado registrada");}}>Corrigir resultado confirmado</button>}
  </div>;
}
function Field({label,children}:{label:string;children:ReactNode}) { return <label className="field"><span>{label}</span>{children}</label>; }
function Stat({label,value,hint}:{label:string;value:string|number;hint:string}) {return <div className="stat"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;}
function askReason(label: string): string | null { return window.prompt(label)?.trim() || null; }
