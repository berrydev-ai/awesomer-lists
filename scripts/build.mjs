import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

import { readCacheServerUrl } from "./cache-server-url.mjs";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "dist");
const cacheServerUrl = readCacheServerUrl(process.env.AWESOMER_CACHE_SERVER_URL);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const shared = {
  bundle: true,
  platform: "browser",
  target: "chrome114",
  legalComments: "none",
  define: {
    __AWESOMER_CACHE_SERVER_URL__: JSON.stringify(cacheServerUrl),
  },
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [resolve(root, "src/background.ts")],
    outfile: resolve(outputDirectory, "background.js"),
    format: "esm",
  }),
  build({
    ...shared,
    entryPoints: [resolve(root, "src/content.ts")],
    outfile: resolve(outputDirectory, "content.js"),
    format: "iife",
  }),
  build({
    ...shared,
    entryPoints: [resolve(root, "src/token.ts")],
    outfile: resolve(outputDirectory, "token.js"),
    format: "esm",
  }),
  build({
    ...shared,
    entryPoints: [resolve(root, "src/options.ts")],
    outfile: resolve(outputDirectory, "options.js"),
    format: "esm",
  }),
]);

await cp(resolve(root, "public"), outputDirectory, { recursive: true });

const manifestPath = resolve(outputDirectory, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (cacheServerUrl) {
  manifest.host_permissions = [
    ...manifest.host_permissions,
    `${new URL(cacheServerUrl).origin}/*`,
  ];
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

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
