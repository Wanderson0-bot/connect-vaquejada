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

test("Edge production UI: fictional event, track queue, IndexedDB reload and local offline recovery", { timeout: 180000 }, async (t) => {
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
  const previewEnv = { ...process.env, VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" };
  const build = spawn(process.execPath, [viteCli, "build", "--config", isolatedConfigPath, "--configLoader", "runner"], {
    cwd: projectRoot, env: previewEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let buildLog = "";
  build.stdout.setEncoding("utf8"); build.stderr.setEncoding("utf8");
  build.stdout.on("data", (chunk) => { buildLog += chunk; });
  build.stderr.on("data", (chunk) => { buildLog += chunk; });
  const buildResult = await Promise.race([
    once(build, "exit").then(([code]) => ({ code })),
    delay(120000).then(() => ({ timeout: true })),
  ]);
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
    const pageLoad = page.once("Page.loadEventFired");
    await page.call("Page.navigate", { url: baseUrl });
    await pageLoad;
    await waitFor("aplicacao Connect PDM carregada", async () => (await page.evaluate("document.querySelector('main') && document.body.innerText.includes('Visão geral') && !document.body.innerText.includes('Carregando dados locais')")) || false);
    const initialText = await bodyText(page);
    assert.match(initialText, /Dados locais neste aparelho/, "Ensaio deve iniciar no modo local sem Supabase.");
    t.diagnostic(`Navegador: ${browserInfo.Browser}; URL local: ${baseUrl}; modo: IndexedDB local isolado.`);

    const eventId = `e2e-${crypto.randomUUID()}`;
    testedEventId = eventId;
    const eventName = `Evento fictício Connect PDM ${eventId.slice(-8)}`;
    const day = new Date();
    const localDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;

    await clickButton(page, "Vaquejadas");
    assert.equal(await page.evaluate("document.querySelector('[role=dialog]') === null"), true, "O formulário deve ficar fechado na lista de vaquejadas.");
    await clickButton(page, "Cadastrar vaquejada");
    assert.equal(await page.evaluate("document.querySelector('[role=dialog]') !== null"), true, "O formulário deve abrir em um modal.");
    await fillField(page, "Nome da vaquejada", eventName);
    await clickButton(page, "Adicionar dia");
    await fillField(page, "Data do dia", localDate);
    await clickButton(page, "Adicionar rodízio");
    await fillField(page, "Nome", "Rodízio de homologação");
    const dayId = await page.evaluate("document.querySelector('select option[value]:not([value=\"\"])')?.value || ''");
    assert.ok(dayId, "O dia criado deve estar disponível para o rodízio.");
    await fillField(page, "Dia", dayId);
    await fillField(page, "Ordem", 1);
    await fillField(page, "Capacidade", 3);
    await fillField(page, "Faixa de senhas — de", 1);
    await fillField(page, "Faixa de senhas — até", 3);
    await fillField(page, "Janela de chamada", 1);
    await fillField(page, "Local", "Parque fictício local");
    await fillField(page, "Confirmação de pontuação", "confirm");
    const categoryReady = await page.evaluate("[...document.querySelectorAll('input[name=categories]')].some((item) => item.checked)");
    assert.equal(categoryReady, true, "O evento ficticio precisa ter ao menos uma categoria selecionada.");
    await clickButton(page, "Criar vaquejada");
    await waitFor("cadastro do evento ficticio", async () => (await bodyText(page)).includes(`${eventName}`));
    const activeEventId = await page.evaluate("document.querySelector('#activeEvent')?.value || ''");
    assert.ok(activeEventId, "O evento criado deve ficar selecionado.");
    testedEventId = activeEventId;

    for (const number of [1, 2, 3]) {
      await fillField(page, "Número da senha", number);
      await fillField(page, "Vaqueiro / puxador", `Competidor fictício ${number}`);
      await fillField(page, "Cavalo", `Cavalo fictício ${number}`);
      await fillField(page, "Representação", `Parceiro fictício ${number}`);
      await fillField(page, "Situação do pagamento", "paid");
      await clickButton(page, "Salvar inscrição");
      await waitFor(`inscricao ficticia ${number}`, async () => (await bodyText(page)).includes(`Competidor fictício ${number}`));
      const entryText = await bodyText(page);
      assert.doesNotMatch(entryText, /Não foi possível cadastrar a inscrição/, `Inscricao ${number} nao deve terminar com erro de interface.`);
    }

    await clickButton(page, "Pista e resultados");
    await fillField(page, "Responsável da operação", "Operador fictício de teste");
    await waitFor("estado inicial do rodizio", async () => (await bodyText(page)).includes("Console operacional da pista") && (await bodyText(page)).includes("Senha atual"));
    assert.match(await bodyText(page), /Classificação oficial bloqueada/, "A falta de tabela aprovada deve continuar visivel.");

    await clickButton(page, "Chamar senha 1");
    await waitFor("chamada da senha 1", async () => (await bodyText(page)).includes("Senha atual\n1"));
    await finishRace(page);
    let database = await readLocalDatabase(page, activeEventId);
    assert.equal(database.state?.races.length, 1);
    assert.equal(database.state.races[0].status, "official");
    assert.equal(database.state.races[0].outcome, "zero", "Resultado ficticio usa zero, sem inventar pontuacao.");
    assert.deepEqual(database.tickets, [1, 2, 3]);

    await page.call("Page.reload");
    await waitFor("recarregamento e recuperacao do evento", async () => (await bodyText(page)).includes(eventName));
    await clickButton(page, "Pista e resultados");
    await waitFor("reabrir console e resultado", async () => {
      const text = await bodyText(page);
      return text.includes("Console operacional da pista") && text.includes("Resultado confirmado");
    });
    await fillField(page, "Responsável da operação", "Operador fictício de teste");
    database = await readLocalDatabase(page, activeEventId);
    assert.equal(database.state?.races.length, 1, "Reload nao pode duplicar corrida.");
    assert.equal(database.state?.history.some((item) => item.action === "result.confirm"), true, "Historico do resultado confirmado precisa sobreviver ao reload.");

    await clickButton(page, "Chamar senha 2");
    await waitFor("chamada ativa da senha 2", async () => (await bodyText(page)).includes("Senha atual\n2"));
    await waitForButton(page, "Registrar ausência após prazo");
    await clickButton(page, "Registrar ausência após prazo");
    await waitForButton(page, "Mover para final da fila");
    dialogResponses.push("Ausência fictícia confirmada para homologação");
    await clickButton(page, "Mover para final da fila");
    await waitForButton(page, "Chamar senha 3");
    database = await readLocalDatabase(page, activeEventId);
    const deferredCall = database.state.calls.find((item) => item.entryId && item.movedFrom !== undefined);
    assert.ok(deferredCall, "A chamada ausente deve preservar as posicoes anterior e final.");
    const deferredEntryId = deferredCall.entryId;
    const stableTicket = database.tickets[1];
    assert.equal(stableTicket, 2, "Mover a chamada nao altera a senha original.");

    await clickButton(page, "Chamar senha 3");
    await finishRace(page, 35);
    database = await readLocalDatabase(page, activeEventId);
    assert.equal(database.state.races.find((item) => item.ticketNumber === 3)?.announcedPoints, 35, "A nota registrada deve corresponder exatamente à anunciada pelo juiz.");
    await clickButton(page, "Chamar senha 2");
    await waitFor("reconvocacao da senha original", async () => (await bodyText(page)).includes("Senha atual\n2"));
    database = await readLocalDatabase(page, activeEventId);
    const callsForDeferred = database.state.calls.filter((item) => item.entryId === deferredEntryId);
    assert.equal(callsForDeferred.length, 2, "A nova convocacao gera novo historico de chamada sem duplicar a chamada original.");
    assert.notEqual(callsForDeferred[0].id, callsForDeferred[1].id, "A reconvocacao tem identificador proprio, distinto da chamada ausente.");
    assert.equal(new Set(callsForDeferred.map((item) => item.raceId)).size, 1, "A mesma inscricao retoma a corrida pendente original, sem duplicar corrida.");
    assert.equal(database.state.races.filter((item) => item.entryId === deferredEntryId).length, 1, "A senha 2 continua com uma corrida apesar da ausencia e reconvocacao.");
    assert.equal(database.state.races.length, 3, "As tres inscricoes chamadas possuem tres corridas no total.");
    assert.equal(database.state.races.find((item) => item.entryId === deferredEntryId)?.ticketNumber, 2);
    assert.deepEqual(database.tickets, [1, 2, 3]);
    assert.equal(database.state.history.some((item) => item.action === "call.move_tail"), true);
    const absenceHistory = database.state.history.find((item) => item.action === "call.absent" && item.recordId === callsForDeferred[0].id);
    const moveHistory = database.state.history.find((item) => item.action === "call.move_tail" && item.recordId === callsForDeferred[0].id);
    assert.equal(absenceHistory?.after?.status, "absent", "A auditoria preserva o registro da chamada anterior como ausência.");
    assert.equal(moveHistory?.before?.status, "absent", "A ação de mover para o fim parte da chamada registrada como ausente.");

    await finishRace(page);
    database = await readLocalDatabase(page, activeEventId);
    assert.equal(database.state.races.length, 3, "Tres inscricoes ficticias produzem tres corridas, sem corrida duplicada para o ausente.");
    assert.equal(database.state.calls.length, 4, "Historico conserva chamada original, deslocamento e reconvocacao.");
    assert.equal(database.trackOutbox, 0, "Sem backend, o modo local nao deve alegar outbox remota.");
    assert.equal(database.coordinatorOutbox, 0, "Sem coordenador configurado, nao ha outbox LAN.");

    await page.call("Page.reload");
    await waitFor("reload do evento com tres corridas", async () => (await bodyText(page)).includes(eventName));
    await clickButton(page, "Pista e resultados");
    await waitFor("persistencia das tres corridas apos reload", async () => {
      const text = await bodyText(page);
      return text.includes("Console operacional da pista") && text.includes("Resultado confirmado") && text.includes("3 registros");
    });
    await fillField(page, "Responsável da operação", "Operador fictício de teste");
    database = await readLocalDatabase(page, activeEventId);
    assert.equal(database.state.races.length, 3);
    assert.equal(database.state.calls.length, 4);
    assert.deepEqual(database.tickets, [1, 2, 3]);

    dialogResponses.push("Pausa fictícia de teste");
    await clickButton(page, "Pausar");
    await waitFor("rodizio pausado", async () => (await page.evaluate(`(() => [...document.querySelectorAll('label')].find((item) => item.innerText.includes('Situação'))?.querySelector('input')?.value)()`)) === "paused");
    await page.call("Page.reload");
    await waitFor("evento apos reload de pausa", async () => (await bodyText(page)).includes(eventName));
    await clickButton(page, "Pista e resultados");
    await waitFor("recuperacao da pausa", async () => (await page.evaluate(`(() => [...document.querySelectorAll('label')].find((item) => item.innerText.includes('Situação'))?.querySelector('input')?.value)()`)) === "paused");
    await fillField(page, "Responsável da operação", "Operador fictício de teste");
    const pausedCall = await page.evaluate("(() => [...document.querySelectorAll('button')].find((item) => item.innerText.trim().startsWith('Chamar senha'))?.disabled)()");
    assert.equal(pausedCall, true, "A chamada deve estar bloqueada com o rodizio pausado.");

    dialogResponses.push("Retomada fictícia de teste");
    await clickButton(page, "Retomar");
    await waitFor("rodizio retomado", async () => (await page.evaluate(`(() => [...document.querySelectorAll('label')].find((item) => item.innerText.includes('Situação'))?.querySelector('input')?.value)()`)) === "active");
    dialogResponses.push("Encerramento fictício de teste");
    await clickButton(page, "Encerrar");
    await waitFor("rodizio encerrado", async () => (await page.evaluate(`(() => [...document.querySelectorAll('label')].find((item) => item.innerText.includes('Situação'))?.querySelector('input')?.value)()`)) === "closed");
    const closedCall = await page.evaluate("(() => [...document.querySelectorAll('button')].find((item) => item.innerText.trim().startsWith('Chamar senha'))?.disabled)()");
    assert.equal(closedCall, true, "A chamada deve estar bloqueada com o rodizio encerrado.");

    dialogResponses.push("Reabertura fictícia autorizada para teste offline");
    await clickButton(page, "Reabrir com justificativa");
    await waitFor("rodizio reaberto", async () => (await page.evaluate(`(() => [...document.querySelectorAll('label')].find((item) => item.innerText.includes('Situação'))?.querySelector('input')?.value)()`)) === "active");

    await waitFor("service worker pronto para testar navegacao offline", async () => page.evaluate("navigator.serviceWorker?.controller !== null") || false, 10000);
    offlineSimulation = true;
    await page.call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: "none" });
    await waitFor("estado offline da interface", async () => (await bodyText(page)).includes("Dados locais · sem rede"));
    assert.match(await bodyText(page), /Dados locais · sem rede/);
    dialogResponses.push("Pausa local fictícia durante perda de rede");
    await clickButton(page, "Pausar");
    await waitForNotice(page, "Operação “Pausa” registrada no aparelho.");
    await waitFor("operacao local de pista offline", async () => {
      const database = await readLocalDatabase(page, activeEventId);
      return database.state?.history.at(-1)?.action === "rotation.pause";
    });
    database = await readLocalDatabase(page, activeEventId);
    assert.equal(database.state.syncState, "local");
    assert.equal(database.state.history.at(-1)?.action, "rotation.pause", "A acao offline precisa ser persistida no historico local.");
    assert.equal(database.trackOutbox, 0, "Sem backend configurado, a operacao offline nao pode parecer enfileirada remotamente.");
    await page.call("Page.reload");
    await waitFor("recovery offline da shell e do IndexedDB", async () => {
      return (await bodyText(page)).includes(eventName);
    }, 20000);
    await clickButton(page, "Pista e resultados");
    await waitFor("console aberto enquanto offline", async () => {
      const text = await bodyText(page);
      const rotationStatus = await page.evaluate(`(() => [...document.querySelectorAll('label')].find((item) => item.innerText.includes('Situação'))?.querySelector('input')?.value)()`);
      return text.includes("Console operacional da pista") && rotationStatus === "paused";
    });
    database = await readLocalDatabase(page, activeEventId);
    assert.equal(database.state.syncState, "local");
    assert.equal(database.state.history.at(-1)?.action, "rotation.pause");
    await page.call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: "wifi" });
    await waitFor("restauracao de conectividade local", async () => (await bodyText(page)).includes("Dados locais neste aparelho"));
    database = await readLocalDatabase(page, activeEventId);
    assert.equal(database.state.syncState, "local", "Recuperar a conectividade nao significa sincronizacao remota.");
    assert.equal(database.trackOutbox, 0, "Sem Supabase, nao ha confirmacao nem reenvio remoto.");
    offlineSimulation = false;

    for (const width of [360, 768, 1366]) {
      await page.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 650 });
      const layout = await page.evaluate("({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, mainTop: document.querySelector('main')?.getBoundingClientRect().top ?? Infinity, mainHeight: document.querySelector('main')?.getBoundingClientRect().height ?? 0 })");
      assert.equal(layout.viewport, width, `Viewport deve ser ${width}px.`);
      assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `Operacao nao deve criar rolagem horizontal da pagina em ${width}px: ${JSON.stringify(layout)}`);
      assert.ok(layout.mainTop < 900 && layout.mainHeight > 0, `Conteudo principal deve permanecer visivel no primeiro viewport em ${width}px: ${JSON.stringify(layout)}`);
      await captureVisual(page, `operation-${width}`);
    }

    const publicListLoad = page.once("Page.loadEventFired");
    await page.call("Page.navigate", { url: `${baseUrl}eventos` });
    await publicListLoad;
    await waitFor("rota publica carregada diretamente", async () => (await bodyText(page)).includes("Eventos publicados"));
    await page.call("Page.reload");
    await waitFor("refresh direto do calendario publico", async () => (await bodyText(page)).includes("Eventos publicados"));
    for (const width of [360, 768, 1366]) {
      await page.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 650 });
      const layout = await page.evaluate("({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth })");
      assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `Calendario nao deve criar rolagem horizontal em ${width}px: ${JSON.stringify(layout)}`);
      await captureVisual(page, `public-events-${width}`);
    }
    const parkLoad = page.once("Page.loadEventFired");
    await page.call("Page.navigate", { url: `${baseUrl}parques/park-test-id` });
    await parkLoad;
    await waitFor("estado seguro do perfil publico sem endpoint", async () => (await bodyText(page)).includes("consulta de perfil do parque"));
    assert.match(await bodyText(page), /dados administrativos ou inferidos/);
    await page.call("Emulation.setDeviceMetricsOverride", { width: 360, height: 900, deviceScaleFactor: 1, mobile: true });
    await captureVisual(page, "public-park-unavailable-360");
    const invalidIdLoad = page.once("Page.loadEventFired");
    await page.call("Page.navigate", { url: `${baseUrl}eventos/invalid-id` });
    await invalidIdLoad;
    await waitFor("estado indisponivel do detalhe publico sem Supabase", async () => (await bodyText(page)).includes("A consulta pública ainda não está disponível."));
    await captureVisual(page, "public-event-unavailable-360");

    assert.ok(genericResourceErrors.length <= faviconErrors.length, `Falha de recurso sem URL correspondente a favicon: ${JSON.stringify({ genericResourceErrors, faviconErrors })}`);
    assert.deepEqual(consoleErrors, [], `Erros fatais/console: ${JSON.stringify(consoleErrors)}; navegador: ${browserLog}`);
    assert.deepEqual(requestFailures, [], `Falhas de requisicao: ${JSON.stringify(requestFailures)}; Vite: ${previewLog}`);
    t.diagnostic(`Evento ficticio ${eventId}; inscricoes 1/2/3; chamadas ${database.state.calls.length}; corridas ${database.state.races.length}; IndexedDB reload/offline local confirmados; outbox remota nao configurada; consoleErrors=0; favicon404=${faviconErrors.length}; falhasOfflineEsperadas=${expectedOfflineFailures.length}; requestFailures=0.`);
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
