import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { syncCopiedFiles } from "./dev-files.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("development static-file sync", () => {
  it("removes a copied file after its source is deleted", async () => {
    const source = await createTemporaryDirectory("awesomer-source-");
    const output = await createTemporaryDirectory("awesomer-output-");
    const sourceFile = join(source, "token.html");
    const outputFile = join(output, "token.html");
    await writeFile(sourceFile, "secure token page");

    const initialFiles = await syncCopiedFiles(source, output, new Set());
    await access(outputFile);
    await rm(sourceFile);

    await syncCopiedFiles(source, output, initialFiles);

    await expect(access(outputFile)).rejects.toThrow();
  });
});

async function createTemporaryDirectory(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
