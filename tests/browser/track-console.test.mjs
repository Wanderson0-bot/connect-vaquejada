import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const viteCli = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const defaultEdge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const edgePath = process.env.CONNECT_PDM_EDGE_PATH || defaultEdge;

class DevToolsPage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        const item = this.pending.get(message.id);
        if (!item) return;
        clearTimeout(item.timer);
        this.pending.delete(message.id);
        if (message.error) item.reject(new Error(message.error.message));
        else item.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  once(method) {
    return new Promise((resolve) => this.on(method, resolve));
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools command timed out: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result?.value;
  }
}

async function reserveLoopbackPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitFor(description, predicate, timeoutMs = 12000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timeout aguardando ${description}${last instanceof Error ? `: ${last.message}` : ""}`);
}

function accessibleButtonExpression(name) {
  return `(() => { const buttons = [...document.querySelectorAll('button')]; const button = buttons.find((item) => (item.getAttribute('aria-label') || item.title || item.innerText).trim() === ${JSON.stringify(name)}); return button ? { disabled: button.disabled, name: (button.getAttribute('aria-label') || button.title || button.innerText).trim() } : null; })()`;
}

async function clickButton(page, name) {
  const result = await page.evaluate(`(() => { const buttons = [...document.querySelectorAll('button')]; const button = buttons.find((item) => (item.getAttribute('aria-label') || item.title || item.innerText).trim() === ${JSON.stringify(name)}); if (!button) return { error: 'button not found' }; if (button.disabled) return { error: 'button disabled' }; button.click(); return { clicked: true }; })()`);
  assert.deepEqual(result, { clicked: true }, `Botao acessivel "${name}" precisa existir e estar habilitado.`);
}

async function fillField(page, labelFragment, value) {
  await waitFor(`campo com rotulo ${labelFragment}`, async () => page.evaluate(`(() => { const labels = [...document.querySelectorAll('label')]; const label = labels.find((item) => item.innerText.trim().includes(${JSON.stringify(labelFragment)})); return Boolean(label?.querySelector('input:not([type="checkbox"]), textarea, select')); })()`));
  const result = await page.evaluate(`(() => { const labels = [...document.querySelectorAll('label')].filter((item) => item.innerText.trim().includes(${JSON.stringify(labelFragment)})); labels.sort((a, b) => (a.querySelector('span')?.innerText.trim().length ?? a.innerText.length) - (b.querySelector('span')?.innerText.trim().length ?? b.innerText.length)); const label = labels[0]; const control = label?.querySelector('input:not([type="checkbox"]), textarea, select'); if (!control) return { error: 'labeled control not found' }; const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, ${JSON.stringify(String(value))}); control.dispatchEvent(new Event('input', { bubbles: true })); control.dispatchEvent(new Event('change', { bubbles: true })); return { value: control.value }; })()`);
  assert.equal(result?.value, String(value), `Campo com rotulo "${labelFragment}" deve aceitar o valor de teste.`);
}

async function bodyText(page) {
  return (await page.evaluate("document.body?.innerText || ''")) || "";
}

async function captureVisual(page, name) {
  const screenshot = await page.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(tmpdir(), `connect-pdm-visual-${name}.png`), Buffer.from(screenshot.data, "base64"));
}

async function waitForNotice(page, expected) {
  await waitFor(`mensagem de operação: ${expected}`, async () => page.evaluate(`(() => [...document.querySelectorAll('.notice')].some((item) => item.innerText.trim() === ${JSON.stringify(expected)}))()`));
}

async function waitForButton(page, name) {
  await waitFor(`botao ${name}`, async () => {
    const button = await page.evaluate(accessibleButtonExpression(name));
    return button && !button.disabled ? button : false;
  });
}

async function finishRace(page, points) {
  await waitForButton(page, "Registrar comparecimento");
  await clickButton(page, "Registrar comparecimento");
  await waitForButton(page, "Iniciar corrida");
  await clickButton(page, "Iniciar corrida");
  if (points == null) {
    await waitForButton(page, "Confirmar zero");
    await clickButton(page, "Confirmar zero");
  } else {
    await fillField(page, "Pontuação anunciada pelo juiz", points);
    await waitForButton(page, "Registrar corrida pontuada");
    await clickButton(page, "Registrar corrida pontuada");
  }
  await waitForButton(page, "Confirmar resultado");
  await clickButton(page, "Confirmar resultado");
  await waitFor("resultado confirmado", async () => (await bodyText(page)).includes("Resultado confirmado"));
}

async function readLocalDatabase(page, eventId) {
  return page.evaluate(`(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pdm-local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = ['entries', 'track_states', 'track_outbox', 'coordinator_outbox'];
    const transaction = db.transaction(stores, 'readonly');
    const all = (name) => new Promise((resolve, reject) => {
      const request = transaction.objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [entries, states, trackOutbox, coordinatorOutbox] = await Promise.all(stores.map(all));
    const state = states.find((item) => item.eventId === ${JSON.stringify(eventId)});
    return {
      tickets: entries.filter((item) => item.eventId === ${JSON.stringify(eventId)}).map((item) => item.number).sort((a, b) => a - b),
      state: state ? {
        syncState: state.syncState,
        calls: state.calls.map((item) => ({ id: item.id, entryId: item.entryId, status: item.status, raceId: item.raceId, movedFrom: item.movedFrom, movedTo: item.movedTo })),
        races: state.races.map((item) => ({ id: item.id, entryId: item.entryId, ticketNumber: item.ticketNumber, status: item.status, resultStatus: item.resultStatus, outcome: item.outcome, announcedPoints: item.announcedPoints, bonusPoints: item.bonusPoints })),
        history: state.history.map((item) => ({ action: item.action, recordId: item.recordId, before: item.before, after: item.after })),
      } : null,
      trackOutbox: trackOutbox.filter((item) => item.eventId === ${JSON.stringify(eventId)}).length,
      coordinatorOutbox: coordinatorOutbox.length,
    };
  })()`);
}

test("Edge production UI: public home and anonymous protected-route denial", { timeout: 180000 }, async (t) => {
  assert.equal(typeof WebSocket, "function", "Node runtime precisa oferecer WebSocket para CDP sem dependencias adicionais.");
  await stat(viteCli);
  await stat(edgePath);

  const port = await reserveLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const profilePath = await mkdtemp(join(tmpdir(), "connect-pdm-e2e-"));
  const isolatedEnvDir = join(profilePath, "env");
  const isolatedBuildDir = join(profilePath, "dist");
  const isolatedConfigPath = join(profilePath, "vite.config.ts");
  await mkdir(isolatedEnvDir);
  await writeFile(isolatedConfigPath, [
    `import baseConfig from ${JSON.stringify(pathToFileURL(join(projectRoot, "vite.config.ts")).href)};`,
    `export default { ...baseConfig, root: ${JSON.stringify(projectRoot)}, envDir: ${JSON.stringify(isolatedEnvDir)}, build: { ...baseConfig.build, outDir: ${JSON.stringify(isolatedBuildDir)}, emptyOutDir: true } };`,
    "",
  ].join("\n"), "utf8");
  const previewEnv = { ...process.env, VITE_NEON_DATA_API_URL: "", VITE_BACKEND_API_URL: "" };
  const build = spawn(process.execPath, [viteCli, "build", "--config", isolatedConfigPath, "--configLoader", "runner"], {
    cwd: projectRoot, env: previewEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let buildLog = "";
  build.stdout.setEncoding("utf8"); build.stderr.setEncoding("utf8");
  build.stdout.on("data", (chunk) => { buildLog += chunk; });
  build.stderr.on("data", (chunk) => { buildLog += chunk; });
  let buildTimeoutId;
  const buildTimeout = new Promise((resolve) => {
    buildTimeoutId = setTimeout(() => resolve({ timeout: true }), 120000);
  });
  const buildResult = await Promise.race([
    once(build, "exit").then(([code]) => ({ code })),
    buildTimeout,
  ]);
  clearTimeout(buildTimeoutId);
  if (buildResult.timeout) {
    build.kill();
    throw new Error(`Build isolado excedeu 120 segundos: ${buildLog}`);
  }
  assert.equal(buildResult.code, 0, `Build isolado deve concluir sem usar a configuracao do ambiente: ${buildLog}`);
  const preview = spawn(process.execPath, [viteCli, "preview", "--config", isolatedConfigPath, "--configLoader", "runner", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: projectRoot, env: previewEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let previewLog = "";
  preview.stdout.setEncoding("utf8"); preview.stderr.setEncoding("utf8");
  preview.stdout.on("data", (chunk) => { previewLog += chunk; });
  preview.stderr.on("data", (chunk) => { previewLog += chunk; });
  let browser;
  let page;
  let browserLog = "";
  const consoleErrors = [];
  const genericResourceErrors = [];
  const faviconErrors = [];
  const requestFailures = [];
  const expectedOfflineFailures = [];
  const requestUrls = new Map();
  const dialogResponses = [];
  let pageSocket;
  let testedEventId;
  let offlineSimulation = false;
  const recordConsoleError = (message) => {
    if (message.startsWith("Failed to load resource: the server responded with a status of 404")) genericResourceErrors.push(message);
    else if (offlineSimulation && message.includes("net::ERR_INTERNET_DISCONNECTED")) expectedOfflineFailures.push(message);
    else consoleErrors.push(message);
  };

  const stopChild = async (child) => {
    if (!child || child.exitCode !== null) return;
    if (!child.killed) child.kill();
    await Promise.race([once(child, "exit").catch(() => {}), delay(5000)]);
  };
  const removeProfile = async () => {
    let lastError;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { await rm(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); return; }
      catch (error) {
        lastError = error;
        if (!error || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
        await delay(250);
      }
    }
    throw lastError;
  };
  t.after(async () => {
    if (page) {
      try { await page.call("Browser.close"); } catch { /* The browser may already have exited after a failed assertion. */ }
    }
    if (pageSocket && pageSocket.readyState < WebSocket.CLOSING) pageSocket.close();
    await stopChild(browser);
    await stopChild(preview);
    await removeProfile();
  });

  try {
    await waitFor("preview do build de producao", async () => {
      if (preview.exitCode !== null) throw new Error(`Vite preview saiu com ${preview.exitCode}: ${previewLog}`);
      const response = await fetch(baseUrl).catch(() => null);
      if (!response?.ok) return false;
      const html = await response.text();
      assert.match(html, /<div id="root"><\/div>/, "Preview deve servir o index do app.");
      return true;
    }, 20000);

    browser = spawn(edgePath, [
      "--headless=new", "--disable-background-networking", "--disable-sync",
      "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
      `--user-data-dir=${profilePath}`, "about:blank",
    ], { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    browser.stderr.setEncoding("utf8");
    browser.stderr.on("data", (chunk) => { browserLog += chunk; });
    const devToolsFile = join(profilePath, "DevToolsActivePort");
    await waitFor("Edge DevToolsActivePort no perfil isolado", async () => {
      if (browser.exitCode !== null) throw new Error(`Edge encerrou com ${browser.exitCode}: ${browserLog}`);
      try { return await readFile(devToolsFile, "utf8"); } catch { return false; }
    }, 20000);
    const devToolsPort = Number((await readFile(devToolsFile, "utf8")).split(/\r?\n/)[0]);
    assert.ok(Number.isInteger(devToolsPort) && devToolsPort > 0, "Edge deve escolher uma porta CDP local dinamica.");
    const browserInfoResponse = await fetch(`http://127.0.0.1:${devToolsPort}/json/version`);
    assert.equal(browserInfoResponse.status, 200);
    const browserInfo = await browserInfoResponse.json();
    const targetsResponse = await fetch(`http://127.0.0.1:${devToolsPort}/json/list`);
    const targets = await targetsResponse.json();
    const target = targets.find((item) => item.type === "page" && item.url === "about:blank") || targets.find((item) => item.type === "page");
    assert.ok(target, `Edge deve abrir a URL local, target observado: ${JSON.stringify(targets.map(({ type, url }) => ({ type, url })))}`);
    pageSocket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      pageSocket.addEventListener("open", resolve, { once: true });
      pageSocket.addEventListener("error", reject, { once: true });
    });
    page = new DevToolsPage(pageSocket);
    page.on("Runtime.consoleAPICalled", (event) => {
      if (event.type === "error") {
        const message = event.args.map((arg) => arg.value || arg.description || "").join(" ");
        recordConsoleError(message);
      }
    });
    page.on("Runtime.exceptionThrown", (event) => recordConsoleError(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || "uncaught browser exception"));
    page.on("Log.entryAdded", ({ entry }) => { if (entry.level === "error") recordConsoleError(entry.text); });
    page.on("Network.loadingFailed", ({ requestId, errorText, canceled }) => {
      if (!canceled && errorText !== "net::ERR_ABORTED") {
        const failure = `${requestUrls.get(requestId) || requestId}: ${errorText}`;
        if (offlineSimulation && errorText === "net::ERR_INTERNET_DISCONNECTED") expectedOfflineFailures.push(failure);
        else requestFailures.push(failure);
      }
    });
    page.on("Network.requestWillBeSent", ({ requestId, request }) => requestUrls.set(requestId, request.url));
    page.on("Network.responseReceived", ({ response }) => {
      if (response.status >= 400 && response.url.endsWith("/favicon.ico")) faviconErrors.push(`${response.status} ${response.url}`);
      else if (response.status >= 400) requestFailures.push(`${response.status} ${response.url}`);
    });
    page.on("Page.javascriptDialogOpening", ({ type }) => {
      const promptText = dialogResponses.shift() || "Motivo ficticio de homologacao";
      if (type !== "prompt") consoleErrors.push(`Unexpected browser dialog type: ${type}`);
      void page.call("Page.handleJavaScriptDialog", { accept: true, promptText }).catch((error) => consoleErrors.push(error.message));
    });
    await Promise.all([page.call("Runtime.enable"), page.call("Page.enable"), page.call("Network.enable"), page.call("Log.enable")]);
    consoleErrors.length = 0;
    genericResourceErrors.length = 0;
    faviconErrors.length = 0;
    requestFailures.length = 0;
    const navigate = async (url) => {
      const loaded = page.once("Page.loadEventFired");
      await page.call("Page.navigate", { url });
      await loaded;
    };
    await navigate(baseUrl);
    await waitFor("public home at root", async () => (await bodyText(page)).includes("TRADIÇÃO NA PISTA.") && (await bodyText(page)).includes("Eventos em destaque"));
    let text = await bodyText(page);
    assert.doesNotMatch(text, /Vis.o geral|Console operacional|rea interna|Pista e resultados/);
    const publicLinks = await page.evaluate("[...document.querySelectorAll('a')].map((item) => item.getAttribute('href'))");
    assert.equal(publicLinks.some((href) => href && (/^\/connect(?:\/|$)/.test(href) || /^\/operacao(?:\/|$)/.test(href))), false, "Public navigation must not reveal internal areas.");
    t.diagnostic(`Browser: ${browserInfo.Browser}; local URL: ${baseUrl}; Neon deliberately unset; anonymous session.`);

    for (const area of ["office", "announcer", "operational"]) {
      await navigate(`${baseUrl}?area=${area}&event=private-test-id`);
      await waitFor(`public home after ${area} shortcut parameters`, async () => (await bodyText(page)).includes("Eventos em destaque"));
      text = await bodyText(page);
      assert.match(text, /Connect Vaquejada/);
      assert.doesNotMatch(text, /Vis.o geral|Console operacional|private-test-id/);
    }

    for (const path of [
      "operacao", "operacao/inscricoes", "operacao/pista", "operacao/vaquejadas", "operacao/parque", "operacao/auditoria", "operacao/backup", "operacao/coordenador",
      "connect", "connect/parques", "connect/parques/park-test-id", "connect/eventos", "connect/equipe", "connect/reconciliacao", "connect/publicacoes", "connect/plataforma",
    ]) {
      await navigate(`${baseUrl}${path}`);
      await waitFor(`protected route /${path} denied`, async () => /protegida indispon.vel/.test(await bodyText(page)));
      text = await bodyText(page);
      assert.doesNotMatch(text, /Console operacional da pista|Dados locais neste aparelho|Vis.o geral do parque/);
      if (path === "operacao/pista") for (const width of [360, 768, 1366]) {
        await page.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 650 });
        const layout = await page.evaluate("({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, mainTop: document.querySelector('main')?.getBoundingClientRect().top ?? Infinity })");
        assert.equal(layout.viewport, width);
        assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `Denied screen must not overflow at ${width}px: ${JSON.stringify(layout)}`);
        assert.ok(layout.mainTop < 900, `Denied screen must be visible at ${width}px: ${JSON.stringify(layout)}`);
        await captureVisual(page, `protected-denied-${width}`);
      }
    }

    await navigate(`${baseUrl}eventos`);
    await waitFor("public event calendar", async () => (await bodyText(page)).includes("Vaquejadas"));
    await page.call("Page.reload");
    await waitFor("direct public calendar refresh", async () => (await bodyText(page)).includes("Todos os eventos"));
    assert.match(await bodyText(page), /A consulta p.blica ainda n.o est. dispon.vel|Ainda n.o h. eventos publicados\./, "With Neon unset, the site must show actual unavailability or an empty list, never invented events.");

    for (const path of ["", "eventos", "eventos/invalid-id", "sobre", "contato"]) {
      const widthPaths = path ? `${baseUrl}${path}` : baseUrl;
      await navigate(widthPaths);
      const expected = path === "" ? "TRADIÇÃO NA PISTA." : path === "eventos" ? "Vaquejadas" : path === "sobre" ? "Sobre o Connect" : path === "contato" ? "Fale com a gente" : "Evento público";
      await waitFor(`public page ${path || "/"}`, async () => (await bodyText(page)).includes(expected));
      assert.ok((await bodyText(page)).includes("Termos de Uso"), `Public footer must appear on ${path || "/"}.`);
      if (!path) {
        const footerRoutes = await page.evaluate("({ explore: [...document.querySelectorAll('.public-footer-explore a')].map(a => a.getAttribute('href')), information: [...document.querySelectorAll('.public-footer-information a')].map(a => a.getAttribute('href')), legalTextOnly: [...document.querySelectorAll('.public-footer-information li span')].length })");
        assert.deepEqual(footerRoutes, { explore: ["/", "/eventos", "/sobre"], information: ["/contato"], legalTextOnly: 2 });
        assert.ok((await bodyText(page)).includes(String(new Date().getFullYear())), "Footer copyright year must be current.");
      }
      for (const width of [360, 390, 768, 1024, 1366]) {
        await page.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 650 });
        const layout = await page.evaluate("({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, title: document.querySelector('h1')?.getBoundingClientRect().toJSON() ?? null, search: document.querySelector('input[type=search]')?.getBoundingClientRect().toJSON() ?? null })");
        assert.equal(layout.viewport, width);
        assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `Public page ${path || "/"} must not overflow at ${width}px: ${JSON.stringify(layout)}`);
        assert.ok(layout.title && layout.title.width > 0, `Public page title must be visible at ${width}px: ${JSON.stringify(layout)}`);
        if (width === 360 || width === 1366) await captureVisual(page, `public-${(path || "home").replace(/[^a-z0-9_-]/gi, "-")}-${width}`);
      }
      if (!path) {
        await page.call("Emulation.setDeviceMetricsOverride", { width: 360, height: 900, deviceScaleFactor: 1, mobile: true });
        await clickButton(page, "Abrir menu");
        const mobileNavigation = await bodyText(page);
        assert.match(mobileNavigation, /Vaquejadas[\s\S]*Sobre[\s\S]*Contato/);
        assert.doesNotMatch(mobileNavigation, /Entrar/);
        const expanded = await page.evaluate("document.querySelector('.public-menu-toggle')?.getAttribute('aria-expanded')");
        assert.equal(expanded, "true", "Mobile public navigation must expose its expanded state.");
      }
    }

    await navigate(`${baseUrl}eventos/invalid-id`);
    await waitFor("public event unavailable without Neon", async () => /A consulta p.blica ainda n.o est. dispon.vel/.test(await bodyText(page)));
    assert.deepEqual(consoleErrors, [], `Unexpected browser console errors: ${JSON.stringify(consoleErrors)}; browser: ${browserLog}`);
    assert.deepEqual(requestFailures, [], `Unexpected failed requests: ${JSON.stringify(requestFailures)}; Vite: ${previewLog}`);
    t.diagnostic("Public home, events, about, contact and event detail verified at 360/390/768/1024/1366px; footer routes and current year verified; mobile menu opened; 16 internal routes blocked anonymously; area/event shortcuts grant no access; public data reports actual unavailability; consoleErrors=0; requestFailures=0.");
  } catch (error) {
    let renderedPage = "<page unavailable>";
    try { renderedPage = await bodyText(page); } catch { /* Preserve the first failure. */ }
    let databaseState = "<database unavailable>";
    try { if (testedEventId) databaseState = JSON.stringify(await readLocalDatabase(page, testedEventId)); } catch { /* Preserve the first failure. */ }
    const details = `\nURL: ${baseUrl}\nPage text: ${renderedPage}\nDatabase: ${databaseState}\nBrowser stderr: ${browserLog}\nVite log: ${previewLog}\nConsole: ${JSON.stringify(consoleErrors)}\nResource console: ${JSON.stringify(genericResourceErrors)}\nRequests: ${JSON.stringify(requestFailures)}`;
    error.message += details;
    throw error;
  }
});
