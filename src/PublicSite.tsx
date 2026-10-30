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

const publicMonths = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(2024, month, 1)));

function eventYearMonth(value: string) {
  const isoDate = /^(\d{4})-(\d{2})/.exec(value);
  if (isoDate) return { year: Number(isoDate[1]), month: Number(isoDate[2]) - 1 };
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : { year: date.getFullYear(), month: date.getMonth() };
}

export function PublicSite() {
  const route = publicRouteForPath(window.location.pathname);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const needsPublicEvents = route.type !== "not-found" && route.type !== "about" && route.type !== "contact";
  const [loading, setLoading] = useState(needsPublicEvents);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("q") || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactFeedback, setContactFeedback] = useState("");
  const [calendarYear, setCalendarYear] = useState(() => Math.max(2026, new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());
  const [textScale, setTextScale] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem("connect-public-text-scale"));
      return Number.isInteger(saved) && saved >= -2 && saved <= 3 ? saved : 0;
    } catch { return 0; }
  });
  const [highContrast, setHighContrast] = useState(() => {
    try { return window.localStorage.getItem("connect-public-high-contrast") === "true"; }
    catch { return false; }
  });

  useEffect(() => {
    try { window.localStorage.setItem("connect-public-text-scale", String(textScale)); } catch { /* storage may be unavailable */ }
  }, [textScale]);
  useEffect(() => {
    try { window.localStorage.setItem("connect-public-high-contrast", String(highContrast)); } catch { /* storage may be unavailable */ }
  }, [highContrast]);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".public-site");
    if (!root) return;

    const scale = 1 + textScale * 0.1;
    const resizeText = () => {
      root.querySelectorAll<HTMLElement>("*").forEach((element) => {
        const ownsText = Array.from(element.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
        );
        if (!ownsText) return;

        const savedSize = Number(element.dataset.publicBaseFontSize);
        const baseSize = savedSize || Number.parseFloat(getComputedStyle(element).fontSize) / scale;
        if (!savedSize) element.dataset.publicBaseFontSize = String(baseSize);
        element.style.fontSize = `${baseSize * scale}px`;
      });
    };

    resizeText();
    const observer = new MutationObserver(resizeText);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [textScale]);

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
    if (needsPublicEvents) void refresh();
  }, []);

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    if (!needle) return events;
    return events.filter((event) => `${event.event_name} ${event.park_name} ${event.city} ${event.state}`.toLocaleLowerCase("pt-BR").includes(needle));
  }, [events, query]);
  const selectedEvent = route.type === "event" ? events.find((item) => item.event_id === route.id) : undefined;
  const monthEvents = useMemo(() => events.filter((event) => {
    const date = eventYearMonth(event.starts_at);
    return date?.year === calendarYear && date.month === selectedMonth;
  }), [events, calendarYear, selectedMonth]);
  const isHome = route.type === "home";
  const isAbout = route.type === "about";
  const isContact = route.type === "contact";
  const isListing = route.type === "events";
  const showEvent = route.type === "event";

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    window.location.assign(`/eventos${params.size ? `?${params.toString()}` : ""}`);
  }

  function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recipient = import.meta.env.VITE_PUBLIC_CONTACT_EMAIL?.trim();
    if (!recipient) {
      setContactFeedback("O envio ainda não está configurado. Sua mensagem não foi enviada; tente novamente mais tarde.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const subject = `Contato pelo site Connect Vaquejada: ${String(form.get("name") || "")}`;
    const body = [
      `Nome: ${String(form.get("name") || "")}`,
      `Email: ${String(form.get("email") || "")}`,
      `WhatsApp: ${String(form.get("whatsapp") || "")}`,
      "",
      "Mensagem:",
      String(form.get("message") || ""),
    ].join("\n");
    window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setContactFeedback("Abrimos seu aplicativo de email para concluir o envio da mensagem.");
  }

  return <main className={`public-site public-redesign${highContrast ? " public-high-contrast" : ""}`}>
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
          <a href="/" onClick={() => setMenuOpen(false)}>Início</a>
          <a href="/eventos" onClick={() => setMenuOpen(false)}>Vaquejadas</a>
          <a href="/sobre" onClick={() => setMenuOpen(false)}>Sobre</a>
          <a href="/contato" onClick={() => setMenuOpen(false)}>Contato</a>
        </nav>
        <form className="public-header-search" role="search" onSubmit={submitSearch}>
          <label className="visually-hidden" htmlFor="header-event-search">Buscar vaquejadas</label>
          <Search size={17} aria-hidden="true" />
          <input id="header-event-search" type="search" placeholder="Buscar vaquejadas" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" aria-label="Buscar"><ArrowRight size={16} /></button>
        </form>
        <div className="public-accessibility-controls" role="group" aria-label="Acessibilidade">
          <button type="button" aria-label="Aumentar texto" title="Aumentar texto" disabled={textScale >= 3} onClick={() => setTextScale((scale) => Math.min(3, scale + 1))}>A+</button>
          <button type="button" aria-label="Diminuir texto" title="Diminuir texto" disabled={textScale <= -2} onClick={() => setTextScale((scale) => Math.max(-2, scale - 1))}>A-</button>
          <button type="button" className="public-contrast-toggle" aria-pressed={highContrast} onClick={() => setHighContrast((enabled) => !enabled)}>Contraste</button>
        </div>
      </div>
    </header>

    {needsPublicEvents && <section className="public-month-calendar" aria-label="Calendário de vaquejadas" aria-busy={loading}>
      <div className={`public-month-grid${calendarYear === 2026 ? " is-first-calendar-year" : ""}`} role="group" aria-label={`Meses de ${calendarYear}`}>
        {calendarYear > 2026 && <button className="public-calendar-year-nav" type="button" aria-label={`Ano anterior: ${calendarYear - 1}`} onClick={() => setCalendarYear((year) => Math.max(2026, year - 1))}><ArrowLeft size={14} /><span>{calendarYear - 1}</span></button>}
        {publicMonths.map((month, index) => {
          const hasEvents = events.some((event) => {
            const date = eventYearMonth(event.starts_at);
            return date?.year === calendarYear && date.month === index;
          });
          return <button key={month} type="button" className={selectedMonth === index ? "is-selected" : ""} aria-pressed={selectedMonth === index} onClick={() => setSelectedMonth(index)}>
            <span>{month}</span>{hasEvents && <i aria-label="Há vaquejadas neste mês" />}
          </button>;
        })}
        <button className="public-calendar-year-nav" type="button" aria-label={`Próximo ano: ${calendarYear + 1}`} onClick={() => setCalendarYear((year) => year + 1)}><span>{calendarYear + 1}</span><ArrowRight size={14} /></button>
      </div>
    </section>}

    {needsPublicEvents && monthEvents.length > 0 && <section className="public-section public-calendar-events" aria-live="polite" aria-labelledby="public-calendar-events-title">
      <div className="public-section-heading public-section-heading-compact"><div><span className="public-kicker public-kicker-light">{calendarYear}</span><h2 id="public-calendar-events-title">Vaquejadas em {publicMonths[selectedMonth]}</h2></div><span className="public-result-count">{monthEvents.length} {monthEvents.length === 1 ? "vaquejada" : "vaquejadas"}</span></div>
      <EventCollection events={monthEvents} loading={false} error="" onRetry={() => void refresh()} />
    </section>}

    {isHome && <>
      <section className="public-hero" aria-labelledby="public-home-title">
        <div className="public-hero-pattern" aria-hidden="true" />
        <div className="public-hero-content">
          <span className="public-kicker"><span /> Bem Vindo(a)</span>
          <h1 id="public-home-title">TRADIÇÃO NA PISTA.<br /><em>CONEXÃO EM CADA RESULTADO.</em></h1>
          <p>Acompanhe os eventos e as informações divulgadas pelos parques em um só lugar.</p>

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

    {isAbout && <>
      <section className="public-detail-banner public-about-banner" aria-labelledby="public-about-page-title">
        <div className="public-detail-banner-inner public-about-banner-inner"><span className="public-kicker">CONNECT VAQUEJADA</span><h1 id="public-about-page-title">Sobre o Connect</h1><p>Tradição na pista, conexão em cada resultado.</p></div>
      </section>
      <section className="public-section public-about-page" aria-labelledby="public-about-purpose-title">
        <div className="public-about-page-copy">
          <span className="public-kicker public-kicker-light">NOSSO PROPÓSITO</span>
          <h2 id="public-about-purpose-title">A vaquejada conectada com quem faz parte dela.</h2>
          <p>O <strong>Connect Vaquejada</strong> aproxima <strong>parques e participantes</strong> com informações públicas organizadas. Cada parque escolhe quais dados de seus eventos deseja divulgar.</p>
          <p>Consulte as <strong>vaquejadas publicadas</strong>, confira datas e detalhes disponíveis e acompanhe as informações diretamente na página de cada evento.</p>
          <a className="public-inline-link public-about-action" href="/eventos">Ver vaquejadas <ArrowRight size={17} /></a>
        </div>
        <aside className="public-contact-card" id="contato" aria-labelledby="public-contact-title">
          <div className="public-contact-card-heading"><span className="public-contact-card-icon" aria-hidden="true"><MapPin size={21} /></span><span className="public-kicker public-kicker-light">CONTATO</span></div>
          <h2 id="public-contact-title">Fale com o parque do evento</h2>
          <p>Para informações sobre inscrições, horários, regras ou premiações, entre em contato pelos canais oficiais do parque responsável. Consulte as vaquejadas publicadas para encontrar o evento.</p>
          <a className="public-inline-link public-contact-action" href="/eventos">Localizar uma vaquejada <ArrowRight size={17} /></a>
        </aside>
      </section>
    </>}

    {isContact && <>
      <section className="public-detail-banner" aria-labelledby="public-contact-page-title">
        <div className="public-detail-banner-inner"><span className="public-kicker">CONNECT VAQUEJADA</span><h1 id="public-contact-page-title">Fale com a gente</h1><p>Preencha os dados e escreva sua mensagem.</p></div>
      </section>
      <section className="public-section public-contact-page">
        <aside className="public-contact-intro" aria-labelledby="public-contact-intro-title">
          <span className="public-kicker public-kicker-light">ESTAMOS À DISPOSIÇÃO</span>
          <h2 id="public-contact-intro-title">Sua mensagem chega até nós.</h2>
          <p>Use o formulário para falar com a equipe do Connect Vaquejada. Preencha seus dados para que possamos entender como ajudar.</p>
          <div className="public-contact-event-note">
            <MapPin size={20} aria-hidden="true" />
            <p>Quer saber sobre inscrições, horários ou regras de uma prova? Consulte a página da vaquejada e fale diretamente com o parque responsável.</p>
          </div>
          <a className="public-inline-link" href="/eventos">Localizar uma vaquejada <ArrowRight size={17} /></a>
        </aside>
        <form className="public-contact-form" onSubmit={submitContact}>
          <div className="public-contact-form-heading"><span className="public-kicker public-kicker-light">FORMULÁRIO</span><h2>Envie sua mensagem</h2><p>Os campos marcados são obrigatórios.</p></div>
          <label>Nome<input name="name" type="text" autoComplete="name" required maxLength={120} /></label>
          <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <label>WhatsApp<input name="whatsapp" type="tel" autoComplete="tel" required maxLength={32} placeholder="(00) 00000-0000" /></label>
          <label className="public-contact-message">Mensagem<textarea name="message" rows={6} required maxLength={4000} /></label>
          <button type="submit">Enviar mensagem <ArrowRight size={17} /></button>
          <p className="public-contact-feedback" role="status" aria-live="polite">{contactFeedback}</p>
        </form>
      </section>
    </>}

    {isListing && <section className="public-listing-intro">
      <div className="public-listing-inner"><span className="public-kicker">CALENDÁRIO CONNECT</span><h1>Vaquejadas</h1><p>Consulte as vaquejadas divulgadas pelos parques participantes.</p>
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
      <div className="public-footer-main">
        <div className="public-footer-brand-area">
          <a className="public-brand public-brand-footer" href="/" aria-label="Connect Vaquejada, p&aacute;gina inicial"><img src="/Simbolo-Connect-Vaquejada.png" alt="" /><span className="public-brand-wordmark"><strong>CONNECT</strong><small>VAQUEJADA</small></span></a>
        </div>
        <nav className="public-footer-group public-footer-explore" aria-labelledby="public-footer-explore-title"><h2 id="public-footer-explore-title">Explorar</h2><ul>
          <li><a href="/">In&iacute;cio</a></li><li><a href="/eventos">Vaquejadas</a></li><li><a href="/sobre">Sobre o Connect</a></li>
        </ul></nav>
        <nav className="public-footer-group public-footer-information" aria-labelledby="public-footer-information-title"><h2 id="public-footer-information-title">Informa&ccedil;&otilde;es</h2><ul>
          <li><span>Pol&iacute;tica de Privacidade</span></li><li><span>Termos de Uso</span></li><li><a href="/contato">Contato</a></li>
        </ul></nav>
      </div>
      <div className="public-footer-bottom"><span>&copy; {new Date().getFullYear()} Connect Vaquejada. Todos os direitos reservados.</span><span>Informa&ccedil;&otilde;es p&uacute;blicas conforme divulga&ccedil;&atilde;o autorizada pelos parques.</span></div>
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
