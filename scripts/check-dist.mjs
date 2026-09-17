import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { buildTargets, parseBuildTarget } from "./build.mjs";
import {
  bundledScripts,
  findDistributionProblems,
  requiredFiles,
} from "./verify-dist.mjs";

const root = resolve(import.meta.dirname, "..");
const target = parseBuildTarget(process.argv.slice(2));
const distributionName = buildTargets[target].outputDirectory;
const distributionDirectory = resolve(root, distributionName);

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
  console.error(
    `${distributionName} does not exist. Run \`npm run build${target === "safari" ? ":safari" : ""}\` first.`,
  );
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
  target,
  distributionName,
  manifest,
  packageVersion: packageJson?.version,
  presentFiles,
  scriptSources,
});

if (problems.length > 0) {
  console.error(`The ${target} extension failed verification:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `${distributionName} looks good: ${target} manifest v${manifest.version}, ${requiredFiles.length} required files present.`,
);
