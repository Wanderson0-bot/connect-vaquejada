import { useCallback, useEffect, useState } from "react";
import { getCoordinatorConflicts, getCoordinatorOperator, CoordinatorConflict, CoordinatorOperator } from "./coordinator";
import { adoptCoordinatorReviewOperation, CoordinatorReviewOperation, getCoordinatorReviewQueue } from "./db";

type Props = { onUpdated: () => Promise<void> };

function operationTitle(item: CoordinatorReviewOperation): string {
  const payload = item.payload;
  if (item.entityType === "events") return String(payload.name || item.entityId);
  if (item.entityType === "entries") return `Senha ${payload.number ?? "?"} · ${String(payload.vaqueiro || "Competidor sem nome")}`;
  if (item.entityType === "reservations") return `Reserva ${payload.number ?? "?"}`;
  if (item.entityType === "run_results") return `Resultado da senha ${payload.number ?? payload.entryId ?? "?"}`;
  return `Estado de pista · ${item.entityId}`;
}

function roleLabel(role: CoordinatorOperator["role"]): string {
  return ({ park_manager: "Responsável do parque", office: "Secretaria", announcer: "Locução", judge: "Julgamento", track_operator: "Operação de pista" })[role];
}

export function CoordinatorQueueReview({ onUpdated }: Props) {
  const [operator, setOperator] = useState<CoordinatorOperator | null>(null);
  const [items, setItems] = useState<CoordinatorReviewOperation[]>([]);
  const [conflicts, setConflicts] = useState<CoordinatorConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const identity = await getCoordinatorOperator();
      const [queue, serverConflicts] = await Promise.all([
        getCoordinatorReviewQueue(),
        identity.role === "park_manager" ? getCoordinatorConflicts() : Promise.resolve([]),
      ]);
      setOperator(identity);
      setItems(queue);
      setConflicts(serverConflicts);
      setMessage("");
    } catch (error) {
      setOperator(null);
      setItems([]);
      setConflicts([]);
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar a fila de revisão.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function adopt(item: CoordinatorReviewOperation) {
    const title = operationTitle(item);
    if (!window.confirm(`Você, como ${roleLabel(operator!.role)}, vai assumir e enviar esta alteração ao coordenador?\n\n${title}\n\nO servidor vai validar sua permissão e registrar sua identidade. Se houver conflito, os dois conteúdos serão preservados para revisão.`)) return;
    setBusyId(item.operationId);
    setMessage("");
    try {
      const result = await adoptCoordinatorReviewOperation(item.operationId);
      let feedback: string;
      if (result.outcome === "accepted" || result.outcome === "duplicate") {
        feedback = "Alteração aceita pelo coordenador e registrada sob sua identidade.";
      } else if (result.outcome === "conflict") {
        feedback = "Conflito preservado no servidor. O aparelho foi atualizado com a versão central; confira as duas versões abaixo antes de lançar uma nova alteração.";
      } else {
        feedback = result.error || "O coordenador não aceitou a alteração.";
      }
      await load();
      setMessage(feedback);
      await onUpdated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar a alteração.");
    } finally { setBusyId(""); }
  }

  return (
    <section className="card form-card coordinator-review-card" aria-labelledby="coordinator-review-title">
      <div className="card-heading">
        <div><h3 id="coordinator-review-title">Fila local aguardando autorização</h3><p>Alterações offline só são compartilhadas depois que um operador autenticado as assume.</p></div>
        <button className="secondary" type="button" disabled={loading || Boolean(busyId)} onClick={() => void load()}>Atualizar fila</button>
      </div>
      {operator && <p className="coordinator-review-identity">Conectado como <strong>{roleLabel(operator.role)}</strong> · identidade {operator.userId}</p>}
      {message && operator && <p className="form-note" role="status">{message}</p>}
      {loading ? <p className="empty small">Consultando fila local…</p>
        : message && !operator ? <p className="sync-warning" role="alert">{message}</p>
          : items.length ? <div className="coordinator-review-list">
            {items.map((item) => (
              <article className="coordinator-review-item" key={item.operationId}>
                <div><strong>{operationTitle(item)}</strong><span>{item.entityType} · {item.action} · versão base {item.baseVersion}</span><small>{new Date(item.createdAt).toLocaleString()}</small>
                  {item.lastError && <small className="coordinator-review-error">{item.lastError}</small>}</div>
                {item.entityType === "track_states" && <small className="coordinator-review-error">O servidor ainda bloqueia a gravação da pista até validar transições por ação.</small>}
                <button className="primary" type="button" disabled={!operator || Boolean(busyId) || item.entityType === "track_states"} onClick={() => void adopt(item)}>{busyId === item.operationId ? "Enviando…" : item.entityType === "track_states" ? "Envio suspenso" : "Assumir e enviar"}</button>
              </article>
            ))}
          </div> : <p className="empty small">Nenhuma alteração local aguarda autorização.</p>}
      {operator?.role === "park_manager" && <div className="coordinator-conflicts">
        <h4>Conflitos preservados no coordenador</h4>
        {conflicts.length ? conflicts.map((conflict) => (
          <details className="coordinator-conflict-item" key={conflict.id}>
            <summary>{conflict.entityType} · {conflict.entityId} · versão enviada {conflict.expectedVersion}, versão central {conflict.currentVersion} · {new Date(conflict.createdAt).toLocaleString()}</summary>
            <div className="coordinator-conflict-grid">
              <div><strong>Alteração enviada</strong><pre>{JSON.stringify(conflict.attempted, null, 2)}</pre></div>
              <div><strong>Versão central mantida</strong><pre>{JSON.stringify(conflict.current, null, 2)}</pre></div>
            </div>
          </details>
        )) : <p className="empty small">Nenhum conflito registrado.</p>}
      </div>}
      <p className="subtle">Cada envio usa sua credencial atual. O coordenador verifica as permissões da operação, grava sua identidade no histórico e preserva alterações em conflito para revisão.</p>
    </section>
  );
}
