import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

export const buildTargets = {
  chrome: {
    outputDirectory: "dist",
    javascriptTarget: "chrome114",
  },
  safari: {
    outputDirectory: "dist-safari",
    javascriptTarget: "safari17.1",
  },
};

export function parseBuildTarget(argumentsList) {
  const targetIndex = argumentsList.indexOf("--target");
  const target = targetIndex === -1 ? "chrome" : argumentsList[targetIndex + 1];

  if (!(target in buildTargets)) {
    throw new Error(
      `Unknown extension target ${JSON.stringify(target)}. Use chrome or safari.`,
    );
  }

  return target;
}

export function createTargetManifest(sourceManifest, target) {
  const manifest = structuredClone(sourceManifest);

  if (target === "chrome") {
    manifest.minimum_chrome_version = "114";
    delete manifest.browser_specific_settings;
  } else if (target === "safari") {
    delete manifest.minimum_chrome_version;
    if (manifest.background) delete manifest.background.type;
    if (manifest.options_ui) delete manifest.options_ui.open_in_tab;
    manifest.browser_specific_settings = {
      safari: { strict_min_version: "17.1" },
    };
  } else {
    throw new Error(`Cannot create a manifest for ${JSON.stringify(target)}.`);
  }

  return manifest;
}

export async function buildExtension(target) {
  const targetConfiguration = buildTargets[target];
  if (!targetConfiguration) {
    throw new Error(`Cannot build unknown target ${JSON.stringify(target)}.`);
  }

  const outputDirectory = resolve(root, targetConfiguration.outputDirectory);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const shared = {
    bundle: true,
    platform: "browser",
    target: targetConfiguration.javascriptTarget,
    legalComments: "none",
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
  const sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = createTargetManifest(sourceManifest, target);
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildExtension(parseBuildTarget(process.argv.slice(2)));
}
