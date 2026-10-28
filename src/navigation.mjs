const operationRoutes = {
  overview: "/operacao",
  entries: "/operacao/inscricoes",
  track: "/operacao/pista",
  settings: "/operacao/vaquejadas",
  park: "/operacao/parque",
  audit: "/operacao/auditoria",
  backup: "/operacao/backup",
  network: "/operacao/coordenador",
};

const connectRoutes = {
  overview: "/connect",
  parks: "/connect/parques",
  events: "/connect/eventos",
  people: "/connect/equipe",
  reconciliation: "/connect/reconciliacao",
  publications: "/connect/publicacoes",
  platform: "/connect/plataforma",
};

const tabByArea = { office: "entries", announcer: "track", operational: "track" };

export function operationTabForPath(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return Object.entries(operationRoutes).find(([, path]) => path === normalized)?.[0] || null;
}

export function operationPathForTab(tab) {
  return operationRoutes[tab] || operationRoutes.overview;
}

export function operationUrlForTab(tab, currentUrl) {
  const nextUrl = new URL(currentUrl);
  const eventId = nextUrl.searchParams.get("event");
  nextUrl.pathname = operationPathForTab(tab);
  nextUrl.search = "";
  nextUrl.hash = "";
  if (eventId) nextUrl.searchParams.set("event", eventId);
  return nextUrl;
}

export function operationTabForArea(area) {
  return tabByArea[area] || null;
}

export function operationTabForLocation(pathname, area) {
  const areaTab = operationTabForArea(area);
  const pathTab = operationTabForPath(pathname);
  if (pathname === "/operacao" && areaTab) return areaTab;
  return pathTab;
}

export function isOperationPath(pathname) {
  return operationTabForPath(pathname) !== null;
}

export function connectViewForPath(pathname) {
  if (pathname === "/connect/") return "overview";
  if (connectParkIdForPath(pathname)) return "parks";
  return Object.entries(connectRoutes).find(([, path]) => path === pathname)?.[0] || null;
}

export function connectParkIdForPath(pathname) {
  const match = pathname.match(/^\/connect\/parques\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]).trim();
    return id && !id.includes("/") ? id : null;
  } catch {
    return null;
  }
}

export function connectParkPath(parkId) {
  const id = String(parkId).trim();
  if (!id || id.includes("/")) throw new TypeError("A park ID must be a single non-empty path segment.");
  return `/connect/parques/${encodeURIComponent(id)}`;
}

export function connectPathForView(view) {
  return connectRoutes[view] || connectRoutes.overview;
}

export function isConnectPath(pathname) {
  return pathname === "/connect" || pathname.startsWith("/connect/");
}

export function isPublicEventsPath(pathname) {
  return pathname === "/eventos" || pathname === "/eventos/" || pathname.startsWith("/eventos/");
}

export function isPublicParkPath(pathname) {
  return pathname === "/parques" || pathname.startsWith("/parques/");
}

export function publicRouteForPath(pathname) {
  if (pathname === "/" || pathname === "/index.html") return { type: "home" };
  if (pathname === "/eventos" || pathname === "/eventos/") return { type: "events" };
  const match = pathname.match(/^\/(eventos|parques)\/([^/]+)\/?$/);
  if (!match) return { type: "not-found" };
  try {
    const id = decodeURIComponent(match[2]).trim();
    if (!id || id.includes("/")) return { type: "not-found" };
    return { type: match[1] === "eventos" ? "event" : "park", id };
  } catch {
    return { type: "not-found" };
  }
}
