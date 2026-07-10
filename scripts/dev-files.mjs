import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Copies current source files and removes files copied by an earlier sync.
 *
 * @param {string} sourceDirectory
 * @param {string} outputDirectory
 * @param {Set<string>} previousFiles
 * @returns {Promise<Set<string>>}
 */
export async function syncCopiedFiles(
  sourceDirectory,
  outputDirectory,
  previousFiles,
) {
  const currentFiles = await collectFilePaths(sourceDirectory);
  const removedFiles = [...previousFiles].filter(
    (filePath) => !currentFiles.has(filePath),
  );
  await Promise.all(
    removedFiles.map((filePath) =>
      rm(join(outputDirectory, filePath), { force: true }),
    ),
  );
  await cp(sourceDirectory, outputDirectory, { recursive: true });
  return currentFiles;
}

async function collectFilePaths(directory, relativeDirectory = "") {
  const entries = await readdir(join(directory, relativeDirectory), {
    withFileTypes: true,
  });
  const files = new Set();

  for (const entry of entries) {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      const nestedFiles = await collectFilePaths(directory, relativePath);
      for (const nestedFile of nestedFiles) files.add(nestedFile);
    } else {
      files.add(relativePath);
    }
  }

  return files;
}
