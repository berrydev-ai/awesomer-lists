import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

import {
  bundledScripts,
  findDistributionProblems,
  requiredFiles,
} from "./verify-dist.mjs";

// Reads the built extension in dist and reports anything wrong with it.
// Run after `npm run build`. CI and the release workflow both call this.

const root = resolve(import.meta.dirname, "..");
const distributionDirectory = resolve(root, "dist");

const listFilesRecursively = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFilesRecursively(path) : [path];
    }),
  );
  return files.flat();
};

let presentFiles = [];
try {
  const paths = await listFilesRecursively(distributionDirectory);
  presentFiles = paths.map((path) => relative(distributionDirectory, path));
} catch {
  console.error("dist does not exist. Run `npm run build` first.");
  process.exit(1);
}

const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};

const manifest = await readJson(resolve(distributionDirectory, "manifest.json"));
const packageJson = await readJson(resolve(root, "package.json"));

const scriptSources = Object.fromEntries(
  await Promise.all(
    bundledScripts
      .filter((file) => presentFiles.includes(file))
      .map(async (file) => [
        file,
        await readFile(resolve(distributionDirectory, file), "utf8"),
      ]),
  ),
);

const problems = findDistributionProblems({
  manifest,
  packageVersion: packageJson?.version,
  presentFiles,
  scriptSources,
  cacheServerUrl: process.env.AWESOMER_CACHE_SERVER_URL ?? "",
});

if (problems.length > 0) {
  console.error("The built extension failed verification:");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(
  `dist looks good: manifest v${manifest.version}, ${requiredFiles.length} required files present.`,
);
