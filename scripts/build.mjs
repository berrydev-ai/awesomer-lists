import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "dist");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await Promise.all([
  build({
    entryPoints: [resolve(root, "src/background.ts")],
    outfile: resolve(outputDirectory, "background.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome114",
    legalComments: "none",
  }),
  build({
    entryPoints: [resolve(root, "src/content.ts")],
    outfile: resolve(outputDirectory, "content.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome114",
    legalComments: "none",
  }),
]);

await cp(resolve(root, "public"), outputDirectory, { recursive: true });
