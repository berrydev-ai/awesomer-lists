import { parseGitHubRepositoryPage } from "./domain/github-page";
import type { RepositoryRef } from "./domain/types";

/**
 * Validates, caps, and deduplicates repository names received from a page script.
 */
export function normalizeRepositoryNames(
  values: readonly string[],
  maximum: number,
): RepositoryRef[] {
  if (values.length > maximum) {
    throw new Error(`Awesome lists are limited to ${maximum} projects.`);
  }

  const seen = new Set<string>();
  const repositories: RepositoryRef[] = [];

  for (const value of values) {
    const parsed = parseGitHubRepositoryPage(`https://github.com/${value}`);

    if (!parsed) {
      throw new Error("Invalid repository name.");
    }

    const nameWithOwner = `${parsed.owner}/${parsed.name}`;
    const key = nameWithOwner.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      repositories.push({
        ...parsed,
        nameWithOwner,
        url: `https://github.com/${nameWithOwner}`,
      });
    }
  }

  return repositories;
}
