import { watch } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

import { context } from "esbuild";

import { syncCopiedFiles } from "./dev-files.mjs";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "dist");
const host = "127.0.0.1";
const port = 4_173;
const hotReload = process.argv.includes("--hot");
const sourceDirectory = resolve(root, "src");
const previewDirectory = resolve(root, "preview");
const publicDirectory = resolve(root, "public");
const previewHtmlPath = resolve(previewDirectory, "index.html");
const outputPreviewHtmlPath = resolve(outputDirectory, "preview.html");
const reloadClients = new Set();
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff2", "font/woff2"],
]);

await import("./build.mjs");
let publicFiles = await syncCopiedFiles(
  publicDirectory,
  outputDirectory,
  new Set(),
);
await writePreviewHtml();

const previewContext = await context({
  entryPoints: [resolve(root, "src/preview.ts")],
  outfile: resolve(outputDirectory, "preview.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome114",
  legalComments: "none",
});

const buildContexts = [previewContext];
if (hotReload) {
  buildContexts.push(
    await context({
      entryPoints: [resolve(root, "src/token.ts")],
      outfile: resolve(outputDirectory, "token.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "chrome114",
      legalComments: "none",
    }),
    await context({
      entryPoints: [resolve(root, "src/dev-reload-entry.ts")],
      outfile: resolve(outputDirectory, "dev-reload.js"),
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "chrome114",
      legalComments: "none",
    }),
  );
}

await Promise.all(buildContexts.map((buildContext) => buildContext.rebuild()));
if (!hotReload) await previewContext.watch();

let hotServer = null;
let serverPort = port;
if (hotReload) {
  hotServer = createServer((request, response) => {
    void servePreviewFile(request, response);
  });
  await new Promise((resolveListening, rejectListening) => {
    hotServer.once("error", rejectListening);
    hotServer.listen(port, host, resolveListening);
  });
} else {
  const previewServer = await previewContext.serve({
    servedir: outputDirectory,
    host,
    port,
  });
  serverPort = previewServer.port;
}

const previewUrl = `http://${host}:${serverPort}/preview.html`;
process.stdout.write(`Awesomer Lists UI preview: ${previewUrl}\n`);
if (hotReload) process.stdout.write("Hot reload enabled.\n");
process.stdout.write("Press Ctrl+C to stop.\n");

let sourceRefreshTimer = null;
let sourceRefreshQueue = Promise.resolve();
let staticRefreshTimer = null;
let staticRefreshQueue = Promise.resolve();
const fileWatchers = hotReload
  ? [
      watch(sourceDirectory, { recursive: true }, scheduleSourceRefresh),
      watch(previewDirectory, { recursive: true }, scheduleStaticRefresh),
      watch(publicDirectory, { recursive: true }, scheduleStaticRefresh),
    ]
  : [];

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  for (const fileWatcher of fileWatchers) fileWatcher.close();
  if (sourceRefreshTimer) clearTimeout(sourceRefreshTimer);
  if (staticRefreshTimer) clearTimeout(staticRefreshTimer);
  await Promise.all([sourceRefreshQueue, staticRefreshQueue]);
  for (const reloadClient of reloadClients) reloadClient.end();
  reloadClients.clear();
  if (hotServer) {
    await new Promise((resolveClosed) => hotServer.close(resolveClosed));
  }
  await Promise.all(
    buildContexts.map((buildContext) => buildContext.dispose()),
  );
  process.exit(0);
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise(() => undefined);

async function writePreviewHtml() {
  if (!hotReload) {
    await cp(previewHtmlPath, outputPreviewHtmlPath);
    return;
  }

  const html = await readFile(previewHtmlPath, "utf8");
  const reloadScript = '    <script src="dev-reload.js"></script>\n';
  await writeFile(
    outputPreviewHtmlPath,
    html.replace("  </body>", `${reloadScript}  </body>`),
  );
}

function scheduleSourceRefresh() {
  if (sourceRefreshTimer) clearTimeout(sourceRefreshTimer);
  sourceRefreshTimer = setTimeout(() => {
    sourceRefreshTimer = null;
    sourceRefreshQueue = sourceRefreshQueue.then(refreshSourceFiles).catch(
      (error) => {
        process.stderr.write(`Could not rebuild preview: ${String(error)}\n`);
      },
    );
  }, 50);
}

async function refreshSourceFiles() {
  await Promise.all(
    buildContexts.map((buildContext) => buildContext.rebuild()),
  );
  notifyReload();
}

function scheduleStaticRefresh() {
  if (staticRefreshTimer) clearTimeout(staticRefreshTimer);
  staticRefreshTimer = setTimeout(() => {
    staticRefreshTimer = null;
    staticRefreshQueue = staticRefreshQueue.then(refreshStaticFiles).catch(
      (error) => {
        process.stderr.write(
          `Could not refresh preview files: ${String(error)}\n`,
        );
      },
    );
  }, 50);
}

async function refreshStaticFiles() {
  [publicFiles] = await Promise.all([
    syncCopiedFiles(publicDirectory, outputDirectory, publicFiles),
    writePreviewHtml(),
  ]);
  notifyReload();
}

async function servePreviewFile(request, response) {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (requestUrl.pathname === "/dev-events") {
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      });
      response.write(": connected\n\n");
      reloadClients.add(response);
      request.once("close", () => reloadClients.delete(response));
      return;
    }

    const relativePath =
      requestUrl.pathname === "/"
        ? "preview.html"
        : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
    const filePath = resolve(outputDirectory, relativePath);
    if (!filePath.startsWith(`${outputDirectory}${sep}`)) {
      response.writeHead(403).end();
      return;
    }

    const body = await readFile(filePath);
    response.setHeader(
      "Content-Type",
      contentTypes.get(extname(filePath)) ?? "application/octet-stream",
    );
    response.setHeader("Cache-Control", "no-store");
    response.writeHead(200);
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404).end();
  }
}

function notifyReload() {
  for (const reloadClient of reloadClients) {
    reloadClient.write("event: reload\ndata: source-change\n\n");
  }
}
