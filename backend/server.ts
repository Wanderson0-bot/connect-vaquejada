import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import eventAccessHandler from "./event-access.js";

const port = Number.parseInt(process.env.PORT || "10000", 10);
const maxBodyBytes = 16 * 1024;

function loadAllowedOrigins(): Set<string> {
  const configured = (process.env.BACKEND_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length === 0) throw new Error("BACKEND_ALLOWED_ORIGINS precisa listar ao menos uma origem exata do frontend.");

  return new Set(configured.map((value) => {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error("BACKEND_ALLOWED_ORIGINS contém uma origem inválida."); }
    const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((!isLocalHttp && url.protocol !== "https:") || url.origin !== value) {
      throw new Error("BACKEND_ALLOWED_ORIGINS deve conter origens HTTPS exatas, sem caminho ou barra final.");
    }
    return url.origin;
  }));
}

const allowedOrigins = loadAllowedOrigins();

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.end(JSON.stringify(body));
}

function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
  response.setHeader("Vary", "Origin");
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) {
    sendJson(response, 403, { error: "Origem não autorizada." });
    return false;
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  return true;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const declaredSize = Number(request.headers["content-length"] || 0);
  if (declaredSize > maxBodyBytes) throw Object.assign(new Error("Corpo da requisição muito grande."), { statusCode: 413 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw Object.assign(new Error("Corpo da requisição muito grande."), { statusCode: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function adaptResponse(response: ServerResponse) {
  return {
    status(code: number) { response.statusCode = code; return this; },
    setHeader(name: string, value: string) { response.setHeader(name, value); return this; },
    json(body: unknown) {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(body));
    },
  };
}

const server = createServer(async (request, response) => {
  if (!applyCors(request, response)) return;
  const pathname = new URL(request.url || "/", "http://localhost").pathname;

  if (pathname === "/health" && request.method === "GET") {
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (pathname !== "/api/event-access") {
    sendJson(response, 404, { error: "Rota não encontrada." });
    return;
  }
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Método não permitido." });
    return;
  }

  try {
    const body = await readRequestBody(request);
    await eventAccessHandler(
      { method: request.method, headers: request.headers, body },
      adaptResponse(response),
    );
  } catch (error) {
    const statusCode = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode : 500;
    if (statusCode >= 500) console.error("Falha HTTP no serviço de acesso Connect.", { statusCode });
    if (!response.headersSent) sendJson(response, statusCode, {
      error: statusCode === 413 ? "A solicitação excede o tamanho permitido." : "Não foi possível processar a solicitação.",
    });
    else response.end();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Connect backend listening on port ${port}.`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down Connect backend.`);
  server.close((error) => {
    if (error) {
      console.error("Backend shutdown failed.", { name: error.name, code: Reflect.get(error, "code") });
      process.exitCode = 1;
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
