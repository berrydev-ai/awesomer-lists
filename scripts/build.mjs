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
  build({
    entryPoints: [resolve(root, "src/token.ts")],
    outfile: resolve(outputDirectory, "token.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome114",
    legalComments: "none",
  }),
]);

await cp(resolve(root, "public"), outputDirectory, { recursive: true });

const fontFiles = [
  ["@fontsource/geist", "geist-latin-400-normal.woff2"],
  ["@fontsource/geist", "geist-latin-500-normal.woff2"],
  ["@fontsource/geist", "geist-latin-600-normal.woff2"],
  ["@fontsource/geist", "geist-latin-700-normal.woff2"],
  ["@fontsource/geist-mono", "geist-mono-latin-400-normal.woff2"],
  ["@fontsource/geist-mono", "geist-mono-latin-500-normal.woff2"],
];
const fontDirectory = resolve(outputDirectory, "fonts");
await mkdir(fontDirectory, { recursive: true });
await Promise.all(
  fontFiles.map(([packageName, fileName]) =>
    cp(
      resolve(root, "node_modules", packageName, "files", fileName),
      resolve(fontDirectory, fileName),
    ),
  ),
);
await Promise.all([
  cp(
    resolve(root, "node_modules", "@fontsource", "geist", "LICENSE"),
    resolve(fontDirectory, "GEIST-LICENSE.txt"),
  ),
  cp(
    resolve(root, "node_modules", "@fontsource", "geist-mono", "LICENSE"),
    resolve(fontDirectory, "GEIST-MONO-LICENSE.txt"),
  ),
]);
