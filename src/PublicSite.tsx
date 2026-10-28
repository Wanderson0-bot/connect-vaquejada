import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, MapPin, RefreshCw } from "lucide-react";
import { getPublicEvents, PublicEvent } from "./backend";
import { publicRouteForPath } from "./navigation.mjs";

function formatDate(value: string, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", includeTime
    ? { dateStyle: "long", timeStyle: "short" }
    : { day: "2-digit", month: "long", year: "numeric" });
}

export function PublicSite() {
  const route = publicRouteForPath(window.location.pathname);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(route.type === "events" || route.type === "event");
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const rows = await getPublicEvents();
      setEvents(rows.filter((row) => row && typeof row.event_id === "string" && row.event_id.trim() &&
        typeof row.event_name === "string" && row.event_name.trim() && typeof row.park_name === "string" &&
        row.park_name.trim() && typeof row.starts_at === "string" && Number.isFinite(Date.parse(row.starts_at)) &&
        typeof row.ends_at === "string" && Number.isFinite(Date.parse(row.ends_at)) &&
        Array.isArray(row.categories) && Array.isArray(row.prizes)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "N\u00e3o foi poss\u00edvel carregar os eventos publicados.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (route.type === "home" || route.type === "events" || route.type === "event") void refresh();
  }, []);

  const selectedEvent = route.type === "event" ? events.find((item) => item.event_id === route.id) : undefined;
  const showList = route.type === "home" || route.type === "events";
  const showEvent = route.type === "event";
  const heroTitle = route.type === "home" ? "Connect Vaquejada"
    : route.type === "park" ? "Perfil p\u00fablico do parque indispon\u00edvel"
    : showEvent ? selectedEvent?.event_name || "Detalhes do evento"
      : route.type === "not-found" ? "P&#225;gina n&#227;o encontrada" : "Vaquejadas Connect";
  const heroDescription = selectedEvent
    ? [selectedEvent.park_name, selectedEvent.city, selectedEvent.state].filter(Boolean).join(" · ")
    : route.type === "home" ? "Tradi\u00e7\u00e3o na pista, conex\u00e3o em cada resultado."
      : showList ? "Eventos divulgados e autorizados pelas equipes respons\u00e1veis."
      : route.type === "park" ? "O calendario publico continua disponivel para consulta."
        : "Tradição na pista, conexão em cada resultado.";

  return <main className="public-site">
    <header className="public-site-header">
      <a className="public-site-brand" href="/" aria-label="Connect Vaquejada, página inicial pública">
        <img src="/Simbolo-Principal-Connect-Vaquejada.png" alt="" />
        <span><strong>CONNECT</strong><small>VAQUEJADA</small></span>
      </a>
      <a className="public-site-login" href="/eventos">Calendário de eventos</a>
    </header>
    <section className="public-site-hero">
      <span className="eyebrow">Tradição na pista, conexão em cada resultado.</span>
      <h1>{heroTitle}</h1>
      <p>{heroDescription}</p>
    </section>
    {(showEvent || route.type === "park" || route.type === "not-found") && <div className="public-event-back-wrap"><a className="public-event-back" href="/eventos"><ArrowLeft size={16} /> Voltar ao calend&#225;rio</a></div>}
    <section className="public-site-events" aria-live="polite">
      {showList && <div className="public-site-section-head"><div><span className="eyebrow">CALEND&#193;RIO</span><h2>Eventos publicados</h2></div><button className="secondary" type="button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} /> Atualizar</button></div>}
      {showList && (loading ? <div className="public-site-empty">Carregando eventos publicados...</div>
        : error ? <div className="public-site-empty public-site-error" role="alert">{error}<button className="text-button" type="button" onClick={() => void refresh()}>Tentar novamente</button></div>
          : events.length === 0 ? <div className="public-site-empty">Ainda n&#227;o h&#225; eventos publicados.</div>
            : <div className="public-event-grid">{events.map((event) => <PublicEventCard key={event.event_id} event={event} />)}</div>)}
      {showEvent && (loading ? <div className="public-site-empty">Carregando evento publicado...</div>
        : error ? <div className="public-site-empty public-site-error" role="alert">{error}<button className="text-button" type="button" onClick={() => void refresh()}>Tentar novamente</button></div>
          : selectedEvent ? <div className="public-event-detail"><PublicEventCard event={selectedEvent} detail /><p className="public-publication-note">Esta p&#225;gina exibe somente informa&#231;&#245;es autorizadas para divulga&#231;&#227;o p&#250;blica. Resultados e classifica&#231;&#245;es n&#227;o s&#227;o expostos por esta consulta.</p></div>
            : <div className="public-site-empty">Este evento n&#227;o est&#225; dispon&#237;vel publicamente ou o endere&#231;o est&#225; incorreto.<a href="/eventos">Voltar ao calend&#225;rio</a></div>)}
      {route.type === "park" && <div className="public-site-empty public-park-unavailable"><p>O servi&#231;o p&#250;blico atual n&#227;o oferece uma consulta de perfil do parque nem fornece um identificador p&#250;blico do parque junto aos eventos. Para evitar apresentar dados administrativos ou inferidos, este perfil n&#227;o est&#225; dispon&#237;vel.</p><a href="/eventos">Consultar eventos publicados</a></div>}
      {route.type === "not-found" && <div className="public-site-empty">Este endere&#231;o p&#250;blico n&#227;o existe.<a href="/eventos">Voltar ao calend&#225;rio</a></div>}
    </section>
    <footer className="public-site-footer">Connect Vaquejada · Informa&#231;&#245;es p&#250;blicas aprovadas para divulga&#231;&#227;o.</footer>
  </main>;
}

function PublicEventCard({ event, detail = false }: { event: PublicEvent; detail?: boolean }) {
  const prizeList = Array.isArray(event.prizes) ? event.prizes.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const start = formatDate(event.starts_at, true);
  const end = formatDate(event.ends_at, true);
  const sameDay = new Date(event.starts_at).toDateString() === new Date(event.ends_at).toDateString();
  const location = [event.location, event.city, event.state].filter((part) => typeof part === "string" && part.trim()).join(" · ");
  return <article className={`public-event-card${detail ? " public-event-card-detail" : ""}`}>
    <div className="public-event-card-top"><span className="public-event-mark"><CalendarDays size={18} /></span><span className="public-event-date">{start}{end && !sameDay ? ` — ${end}` : ""}</span><span className="public-event-status">Publicado</span></div>
    <div className="public-event-card-body">
      <h3>{event.event_name}</h3>
      <p className="public-event-park">{event.park_name}</p>
      {location && <p className="public-event-location"><MapPin size={14} />{location}</p>}
      {event.public_description && <p className="public-event-description">{event.public_description}</p>}
      {event.categories.length > 0 && <div className="public-event-categories">{event.categories.filter((category) => typeof category === "string" && category.trim()).map((category) => <span key={category}>{category}</span>)}</div>}
      {prizeList.length > 0 && <div className="public-event-prizes"><strong>Premia&#231;&#227;o autorizada</strong><ul>{prizeList.map((prize, index) => <li key={`${index}-${prize}`}>{prize}</li>)}</ul></div>}
      {!detail && <a className="public-event-open" href={`/eventos/${encodeURIComponent(event.event_id)}`}>Ver detalhes do evento <span aria-hidden="true">→</span></a>}
    </div>
  </article>;
}
