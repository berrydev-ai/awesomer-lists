import { cp } from "node:fs/promises";
import { resolve } from "node:path";

import { context } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "dist");
const host = "127.0.0.1";
const port = 4_173;

await import("./build.mjs");
await cp(
  resolve(root, "preview", "index.html"),
  resolve(outputDirectory, "preview.html"),
);

const previewContext = await context({
  entryPoints: [resolve(root, "src/preview.ts")],
  outfile: resolve(outputDirectory, "preview.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome114",
  legalComments: "none",
});

await previewContext.rebuild();
const server = await previewContext.serve({
  servedir: outputDirectory,
  host,
  port,
});

const previewUrl = `http://${host}:${server.port}/preview.html`;
process.stdout.write(`Awesomer Lists UI preview: ${previewUrl}\n`);
process.stdout.write("Press Ctrl+C to stop.\n");

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await previewContext.dispose();
  process.exit(0);
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise(() => undefined);
