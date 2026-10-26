import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

async function listFiles(directory: string): Promise<string[]> {
  const children = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(children.map((child) => {
    const absolute = join(directory, child.name);
    return child.isDirectory() ? listFiles(absolute) : [absolute];
  }));
  return nested.flat();
}

function offlineServiceWorker() {
  let outputDirectory = join(projectRoot, "dist");
  return {
    name: "connect-pdm-offline-service-worker",
    apply: "build" as const,
    configResolved(config: { build: { outDir: string } }) {
      outputDirectory = config.build.outDir;
    },
    async closeBundle() {
      const dist = outputDirectory;
      const files = (await listFiles(dist))
        .filter((file) => !file.endsWith(".map") && !file.endsWith("sw.js"))
        .map((file) => `/${relative(dist, file).split(sep).join("/")}`)
        .sort();
      const revision = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
      const source = `const CACHE_NAME = "connect-pdm-shell-${revision}";
const PRECACHE_URLS = ${JSON.stringify(files)};
const API_PATHS = ["/rest/v1/", "/auth/v1/", "/storage/v1/"];
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: "reload" })); } catch { /* Keep other app resources available if one cache entry fails. */ }
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("connect-pdm-shell-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || API_PATHS.some((path) => url.pathname.includes(path))) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE_NAME)).put("/", response.clone());
        return response;
      } catch {
        return (await caches.match(request)) || (await caches.match("/")) || (await caches.match("/index.html"));
      }
    })());
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.endsWith("/manifest.webmanifest")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
`;
      await writeFile(join(dist, "sw.js"), source, "utf8");
    },
  };
}

export default defineConfig({ plugins: [react(), offlineServiceWorker()] });
