import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  connectPathForView,
  connectParkIdForPath,
  connectParkPath,
  connectViewForPath,
  isConnectPath,
  isOperationPath,
  isPublicEventsPath,
  isPublicParkPath,
  publicRouteForPath,
  operationPathForTab,
  operationUrlForTab,
  operationTabForArea,
  operationTabForLocation,
  operationTabForPath,
} from "../src/navigation.mjs";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const connectSource = await readFile(new URL("../src/ConnectAdmin.tsx", import.meta.url), "utf8");
const connectProfileSource = await readFile(new URL("../src/ConnectParkProfilePage.tsx", import.meta.url), "utf8");
const backendSource = await readFile(new URL("../src/backend.ts", import.meta.url), "utf8");
const accountSource = await readFile(new URL("../src/Account.tsx", import.meta.url), "utf8");
const publicSiteSource = await readFile(new URL("../src/PublicSite.tsx", import.meta.url), "utf8");

test("operational UI distinguishes local data and event selection states", () => {
  assert.match(appSource, /: !event \? \(/);
  assert.match(appSource, /<EmptySelect \/>/);
  assert.match(appSource, /sincronizados com uma conta do servidor/);
  assert.match(appSource, /aria-label={`Abrir perfil de \$\{park\.name\}/);
  assert.match(appSource, /Perfil do parque/);
  assert.match(appSource, /className="content operational-content"/);
});

test("rotas operacionais resolvem páginas e preservam atalhos da secretaria e pista", () => {
  assert.equal(operationTabForPath("/"), null);
  assert.equal(operationTabForPath("/operacao"), "overview");
  assert.equal(operationTabForPath("/operacao/"), "overview");
  assert.equal(operationTabForPath("/operacao/inscricoes"), "entries");
  assert.equal(operationTabForPath("/operacao/pista"), "track");
  assert.equal(operationTabForArea("office"), "entries");
  assert.equal(operationTabForArea("announcer"), "track");
  assert.equal(operationTabForArea("operational"), "track");
  assert.equal(operationTabForArea("admin"), null);
  assert.equal(operationTabForLocation("/", "office"), null);
  assert.equal(operationTabForLocation("/", "announcer"), null);
  assert.equal(operationTabForLocation("/operacao", "office"), "entries");
  assert.equal(operationTabForLocation("/operacao", "announcer"), "track");
  assert.equal(operationTabForLocation("/operacao/pista", "office"), "track");
  assert.equal(operationPathForTab("overview"), "/operacao");
  assert.equal(operationPathForTab("track"), "/operacao/pista");
  const tabUrl = operationUrlForTab("track", "https://connect.test/?area=announcer&event=evt-1&invite=temporary#access_token=private");
  assert.equal(tabUrl.pathname, "/operacao/pista");
  assert.equal(tabUrl.search, "?event=evt-1");
  assert.equal(tabUrl.hash, "");
  assert.equal(isOperationPath("/operacao/invalida"), false);
  assert.equal(isOperationPath("/"), false);
  assert.equal(isOperationPath("/operacao"), true);
});

test("rotas Connect continuam separadas e /connect continua sendo o painel inicial", () => {
  assert.equal(connectViewForPath("/connect"), "overview");
  assert.equal(connectPathForView("parks"), "/connect/parques");
  assert.equal(connectViewForPath("/connect/parques"), "parks");
  assert.equal(connectViewForPath("/connect/invalida"), null);
  assert.equal(isConnectPath("/connect"), true);
  assert.equal(isConnectPath("/connect/plataforma"), true);
});

test("perfil administrativo do parque tem rota individual com retorno seguro à seção parques", () => {
  assert.equal(connectParkPath("park-123"), "/connect/parques/park-123");
  assert.throws(() => connectParkPath("park/a"), /single non-empty path segment/);
  assert.equal(connectParkIdForPath("/connect/parques/park-123"), "park-123");
  assert.equal(connectParkIdForPath("/connect/parques/park-123/"), "park-123");
  assert.equal(connectViewForPath("/connect/parques/park-123"), "parks");
  assert.equal(connectParkIdForPath("/connect/parques/%E0%A4%A"), null);
  assert.equal(connectParkIdForPath("/connect/parques"), null);
  assert.equal(isConnectPath("/connect/parques/park-123"), true);
});

test("páginas públicas e áreas autenticadas permanecem em famílias de rota distintas", () => {
  assert.deepEqual(publicRouteForPath("/"), { type: "home" });
  assert.equal(isOperationPath("/"), false);
  assert.equal(isPublicEventsPath("/eventos"), true);
  assert.equal(isPublicEventsPath("/eventos/evento-publicado"), true);
  assert.equal(isPublicEventsPath("/eventos-privados"), false);
  assert.equal(isConnectPath("/operacao/pista"), false);
  assert.equal(isOperationPath("/connect"), false);
  assert.match(appSource, /pathname === "\/"[\s\S]*?<PublicSite \/>/);
  assert.doesNotMatch(publicSiteSource, /href="\/(?:connect|operacao)(?:\/|"|\?)/);
  assert.doesNotMatch(publicSiteSource, /Area interna|Abrir painel|Acesso da equipe/i);
  assert.match(accountSource, /if \(!backendConfigured\)[\s\S]*?Área protegida indisponível/);
  assert.doesNotMatch(accountSource, /if \(!backendConfigured\)\s*return children/);
  assert.match(accountSource, /setSession\(null\);\s*setPark\(null\);\s*setPlatformContext\(null\);/);
  assert.match(backendSource, /As permissões reais não podem ser revalidadas offline/);
});

test("atualizar e voltar/avançar sincronizam a navegação sem contornar permissões", () => {
  assert.match(appSource, /window\.history\.pushState/);
  assert.match(appSource, /addEventListener\("popstate"/);
  assert.match(appSource, /allowedTabs\.includes\(nextTab\)/);
  assert.match(appSource, /window\.history\.replaceState/);
  assert.match(connectSource, /window\.history\.pushState/);
  assert.match(connectSource, /addEventListener\("popstate"/);
  assert.match(connectSource, /navigation\.some\(\(item\) => item\.id === nextView\)/);
  assert.match(accountSource, /pathname\.startsWith\("\/connect\/"\)/);
  assert.match(accountSource, /connectRoute && session && platformContext && canAccessPlatform/);
});

test("perfil de parque permanece protegido e mostra falhas sem presumir que o parque existe", () => {
  assert.match(connectSource, /connectParkIdForPath\(window\.location\.pathname\)/);
  assert.match(connectSource, /getConnectParkProfile\(parkRouteId\)/);
  assert.match(connectSource, /parkProfileError/);
  assert.match(connectSource, /Perfil indisponível/);
  assert.match(backendSource, /getConnectParkProfile\(parkId: string\)[\s\S]*?requirePlatformRole\(\["platform_admin", "deployment", "support"\]\)/);
  assert.match(backendSource, /get_connect_park_profile/);
  assert.match(connectSource, /window\.confirm\(`Confirmar \$\{action\} o acesso de/);
  assert.match(connectSource, /window\.confirm\(`Confirmar \$\{action\} o evento/);
  assert.match(connectSource, /await setConnectParkStatus\(park\.id,status,reason\)/);
  assert.match(connectSource, /await updateConnectPark\(next\)/);
  assert.match(connectProfileSource, /activeTab === "events"/);
  assert.match(connectProfileSource, /activeTab === "team"/);
  assert.match(connectProfileSource, /activeTab === "configuration"/);
  assert.match(connectProfileSource, /activeTab === "audit"/);
  assert.match(connectProfileSource, /activeTab === "diagnostics"/);
  assert.match(connectProfileSource, /Logotipo não cadastrado/);
  assert.match(connectProfileSource, /Categorias e outros detalhes esportivos não estão disponíveis/);
});

test("public routes reject malformed identifiers and keep park profiles separate", () => {
  assert.deepEqual(publicRouteForPath("/eventos"), { type: "events" });
  assert.deepEqual(publicRouteForPath("/eventos/event-123"), { type: "event", id: "event-123" });
  assert.deepEqual(publicRouteForPath("/eventos/%2Fprivate"), { type: "not-found" });
  assert.deepEqual(publicRouteForPath("/eventos/%E0%A4%A"), { type: "not-found" });
  assert.deepEqual(publicRouteForPath("/parques/park-123"), { type: "park", id: "park-123" });
  assert.equal(isPublicParkPath("/parques/park-123"), true);
  assert.equal(isPublicParkPath("/connect/parques/park-123"), false);
  assert.deepEqual(publicRouteForPath("/parques/park-123/edit"), { type: "not-found" });
});
