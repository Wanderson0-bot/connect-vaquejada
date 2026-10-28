import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, Compass, MapPin, Menu, RefreshCw,
  Search, ShieldCheck, Smartphone, X,
} from "lucide-react";
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
  const [loading, setLoading] = useState(route.type === "home" || route.type === "events" || route.type === "event");
  const [error, setError] = useState("");
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("q") || "");
  const [menuOpen, setMenuOpen] = useState(false);

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
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os eventos publicados.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (route.type === "home" || route.type === "events" || route.type === "event") void refresh();
  }, []);

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    if (!needle) return events;
    return events.filter((event) => `${event.event_name} ${event.park_name} ${event.city} ${event.state}`.toLocaleLowerCase("pt-BR").includes(needle));
  }, [events, query]);
  const selectedEvent = route.type === "event" ? events.find((item) => item.event_id === route.id) : undefined;
  const isHome = route.type === "home";
  const isListing = route.type === "events";
  const showEvent = route.type === "event";

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    window.location.assign(`/eventos${params.size ? `?${params.toString()}` : ""}`);
  }

  return <main className="public-site public-redesign">
    <header className="public-header">
      <div className="public-header-inner">
        <a className="public-brand" href="/" aria-label="Connect Vaquejada, página inicial">
          <img src="/Simbolo-Connect-Vaquejada.png" alt="" />
          <span className="public-brand-wordmark"><strong>CONNECT</strong><small>VAQUEJADA</small></span>
        </a>
        <button className="public-menu-toggle" type="button" aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} aria-controls="public-navigation" onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <nav id="public-navigation" className={`public-navigation${menuOpen ? " is-open" : ""}`} aria-label="Navegação pública">
          <a href="/eventos" onClick={() => setMenuOpen(false)}>Eventos</a>
          {isHome && <a href="#sobre" onClick={() => setMenuOpen(false)}>Sobre</a>}
          <a className="public-login-link" href="/entrar" onClick={() => setMenuOpen(false)}>Entrar <ArrowRight size={15} /></a>
        </nav>
      </div>
    </header>

    {isHome && <>
      <section className="public-hero" aria-labelledby="public-home-title">
        <div className="public-hero-pattern" aria-hidden="true" />
        <div className="public-hero-content">
          <span className="public-kicker"><span /> Bem Vindo(a)</span>
          <h1 id="public-home-title">TRADIÇÃO NA PISTA.<br /><em>CONEXÃO EM CADA RESULTADO.</em></h1>
          <p>Acompanhe os eventos e as informações divulgadas pelos parques em um só lugar.</p>
          <form className="public-search" role="search" onSubmit={submitSearch}>
            <label className="visually-hidden" htmlFor="home-event-search">Buscar eventos públicos</label>
            <Search size={19} aria-hidden="true" />
            <input id="home-event-search" type="search" placeholder="Busque pelo nome do evento" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button type="submit">Buscar eventos <ArrowRight size={17} /></button>
          </form>
          <a className="public-hero-text-link" href="/eventos">Explorar calendário <ArrowRight size={16} /></a>
        </div>
        <div className="public-hero-mark" aria-hidden="true"><img src="/Simbolo-Connect-Vaquejada.png" alt="" /></div>
        <div className="public-hero-caption">TRADIÇÃO NA PISTA <span>•</span> CONEXÃO EM CADA RESULTADO</div>
      </section>

      <section className="public-section public-featured" id="eventos" aria-labelledby="featured-title">
        <div className="public-section-heading">
          <div><span className="public-kicker public-kicker-light">CALENDÁRIO PÚBLICO</span><h2 id="featured-title">Eventos em destaque</h2><p>Encontre a próxima vaquejada e consulte as informações divulgadas pelo parque.</p></div>
          <a className="public-inline-link" href="/eventos">Ver todos os eventos <ArrowRight size={17} /></a>
        </div>
        <EventCollection events={filteredEvents.slice(0, 3)} loading={loading} error={error} onRetry={() => void refresh()} compact />
      </section>

      <section className="public-about" id="sobre" aria-labelledby="about-title">
        <div className="public-about-stamp" aria-hidden="true"><Compass size={32} /><span>RAIZ<br />E CAMINHO</span></div>
        <div className="public-about-copy"><span className="public-kicker">NOSSO PROPÓSITO</span><h2 id="about-title">A tradição merece<br />estar sempre conectada.</h2><p>O Connect Vaquejada aproxima eventos e participantes com informações públicas organizadas. Uma experiência clara para acompanhar o que cada parque escolhe divulgar.</p><p className="public-about-slogan">“Tradição na pista, conexão em cada resultado.”</p></div>
        <div className="public-benefits" aria-label="Recursos da plataforma">
          <Benefit icon={<CalendarDays />} title="Eventos organizados" text="Consulte eventos e detalhes publicados pelas equipes responsáveis." />
          <Benefit icon={<Smartphone />} title="Acesso onde você estiver" text="Site adaptável para celular, tablet e computador." />
          <Benefit icon={<ShieldCheck />} title="Informação autorizada" text="As páginas públicas exibem os dados liberados para divulgação." />
        </div>
      </section>
    </>}

    {isListing && <section className="public-listing-intro">
      <div className="public-listing-inner"><a className="public-crumb" href="/">Início</a><span className="public-kicker">CALENDÁRIO CONNECT</span><h1>Eventos públicos</h1><p>Consulte as vaquejadas divulgadas pelos parques participantes.</p>
        <form className="public-search public-search-light" role="search" onSubmit={(event) => event.preventDefault()}>
          <label className="visually-hidden" htmlFor="events-search">Buscar eventos pelo nome</label><Search size={19} aria-hidden="true" />
          <input id="events-search" type="search" placeholder="Buscar por evento, parque ou município" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button className="public-search-clear" type="button" aria-label="Limpar busca" onClick={() => setQuery("")}><X size={17} /></button>}
        </form>
      </div>
    </section>}

    {isListing && <section className="public-section public-listing-results" aria-live="polite">
      <div className="public-section-heading public-section-heading-compact"><div><span className="public-kicker public-kicker-light">AGENDA</span><h2>{query.trim() ? "Resultados da busca" : "Todos os eventos"}</h2></div><span className="public-result-count">{loading ? "Carregando" : !error ? `${filteredEvents.length} ${filteredEvents.length === 1 ? "evento" : "eventos"}` : ""}</span></div>
      <EventCollection events={filteredEvents} loading={loading} error={error} onRetry={() => void refresh()} />
    </section>}

    {showEvent && <>
      <section className="public-detail-banner"><div className="public-detail-banner-inner"><a className="public-crumb" href="/eventos"><ArrowLeft size={15} /> Todos os eventos</a><span className="public-kicker">DETALHES DO EVENTO</span><h1>{selectedEvent?.event_name || "Evento público"}</h1>{selectedEvent && <p>{selectedEvent.park_name}</p>}</div></section>
      <section className="public-section public-detail-section" aria-live="polite">
        {loading ? <StatePanel kind="loading" text="Carregando informações públicas do evento…" />
          : error ? <StatePanel kind="error" text={error} onRetry={() => void refresh()} />
            : selectedEvent ? <><PublicEventCard event={selectedEvent} detail /><p className="public-publication-note"><ShieldCheck size={17} /> Esta página apresenta apenas informações autorizadas para divulgação pública. Resultados e classificações não estão disponíveis nesta consulta.</p></>
              : <StatePanel kind="empty" text="Este evento não está disponível publicamente ou o endereço está incorreto." link={{ href: "/eventos", label: "Voltar ao calendário" }} />}
      </section>
    </>}

    {route.type === "park" && <><section className="public-detail-banner"><div className="public-detail-banner-inner"><a className="public-crumb" href="/eventos"><ArrowLeft size={15} /> Eventos</a><span className="public-kicker">CONNECT VAQUEJADA</span><h1>Perfil público do parque indisponível</h1></div></section><section className="public-section public-detail-section"><StatePanel kind="empty" text="O serviço público atual não oferece uma consulta de perfil do parque. Para evitar apresentar dados administrativos ou inferidos, este perfil não está disponível." link={{ href: "/eventos", label: "Consultar eventos publicados" }} /></section></>}

    {route.type === "not-found" && <><section className="public-detail-banner"><div className="public-detail-banner-inner"><span className="public-kicker">CONNECT VAQUEJADA</span><h1>Página não encontrada</h1></div></section><section className="public-section public-detail-section"><StatePanel kind="empty" text="Este endereço público não existe." link={{ href: "/", label: "Voltar ao início" }} /></section></>}

    <footer className="public-footer">
      <div className="public-footer-main"><a className="public-brand public-brand-footer" href="/" aria-label="Connect Vaquejada, página inicial"><img src="/Simbolo-Connect-Vaquejada.png" alt="" /><span className="public-brand-wordmark"><strong>CONNECT</strong><small>VAQUEJADA</small></span></a><p>Tradição na pista,<br />conexão em cada resultado.</p><nav aria-label="Links do rodapé"><a href="/eventos">Eventos públicos</a><a href="/#sobre">Sobre o Connect</a><a href="/entrar">Entrar</a></nav></div>
      <div className="public-footer-bottom"><span>© Connect Vaquejada</span><span>Informações públicas conforme divulgação autorizada pelos parques.</span></div>
    </footer>
  </main>;
}

function Benefit({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <article className="public-benefit"><span className="public-benefit-icon">{icon}</span><div><h3>{title}</h3><p>{text}</p></div></article>;
}

function EventCollection({ events, loading, error, onRetry, compact = false }: { events: PublicEvent[]; loading: boolean; error: string; onRetry: () => void; compact?: boolean }) {
  if (loading) return <StatePanel kind="loading" text="Carregando eventos publicados…" />;
  if (error) return <StatePanel kind="error" text={error} onRetry={onRetry} />;
  if (events.length === 0) return <StatePanel kind="empty" text="Ainda não há eventos públicos correspondentes à busca." />;
  return <div className={`public-event-grid${compact ? " public-event-grid-featured" : ""}`}>{events.map((event) => <PublicEventCard key={event.event_id} event={event} />)}</div>;
}

function StatePanel({ kind, text, onRetry, link }: { kind: "loading" | "error" | "empty"; text: string; onRetry?: () => void; link?: { href: string; label: string } }) {
  return <div className={`public-state-panel public-state-${kind}`} role={kind === "error" ? "alert" : "status"}>
    <span className="public-state-symbol">{kind === "loading" ? <RefreshCw size={22} /> : kind === "error" ? <ShieldCheck size={22} /> : <CalendarDays size={22} />}</span>
    <p>{text}</p>{onRetry && <button className="public-state-action" type="button" onClick={onRetry}>Tentar novamente <RefreshCw size={15} /></button>}{link && <a className="public-state-action" href={link.href}>{link.label} <ArrowRight size={15} /></a>}
  </div>;
}

function PublicEventCard({ event, detail = false }: { event: PublicEvent; detail?: boolean }) {
  const prizeList = Array.isArray(event.prizes) ? event.prizes.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const start = formatDate(event.starts_at, true);
  const end = formatDate(event.ends_at, true);
  const sameDay = new Date(event.starts_at).toDateString() === new Date(event.ends_at).toDateString();
  const location = [event.location, event.city, event.state].filter((part) => typeof part === "string" && part.trim()).join(" · ");
  return <article className={`public-event-card${detail ? " public-event-card-detail" : ""}`}>
    <div className="public-event-card-top"><span className="public-event-mark"><CalendarDays size={18} /></span><span className="public-event-date">{start}{end && !sameDay ? ` — ${end}` : ""}</span><span className="public-event-status"><Check size={13} /> Publicado</span></div>
    <div className="public-event-card-body"><span className="public-event-overline">VAQUEJADA · EVENTO PÚBLICO</span><h3>{event.event_name}</h3><p className="public-event-park">{event.park_name}</p>
      {location && <p className="public-event-location"><MapPin size={15} />{location}</p>}
      {event.public_description && <p className="public-event-description">{event.public_description}</p>}
      {event.categories.length > 0 && <div className="public-event-categories" aria-label="Categorias publicadas">{event.categories.filter((category) => typeof category === "string" && category.trim()).map((category) => <span key={category}>{category}</span>)}</div>}
      {prizeList.length > 0 && <div className="public-event-prizes"><strong>Premiação autorizada</strong><ul>{prizeList.map((prize, index) => <li key={`${index}-${prize}`}>{prize}</li>)}</ul></div>}
      {!detail && <a className="public-event-open" href={`/eventos/${encodeURIComponent(event.event_id)}`}>Ver detalhes do evento <ArrowRight size={17} /></a>}
    </div>
  </article>;
}
