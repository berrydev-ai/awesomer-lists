import type { GitHubRepositoryPage } from "./github-page";

/**
 * Converts GitHub's raw-file link shapes into one URL restricted to the active repository.
 */
export function normalizeGitHubRawUrl(
  candidateUrl: string,
  repository: GitHubRepositoryPage,
): string | null {
  let url: URL;

  try {
    url = new URL(candidateUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  let rawSegments: string[];

  if (url.hostname === "raw.githubusercontent.com") {
    rawSegments = segments;
  } else if (
    (url.hostname === "github.com" || url.hostname === "www.github.com") &&
    segments[2] === "raw"
  ) {
    rawSegments = [segments[0] ?? "", segments[1] ?? "", ...segments.slice(3)];
  } else {
    return null;
  }

  const [owner, name, ...sourcePath] = rawSegments;

  if (
    owner?.toLowerCase() !== repository.owner.toLowerCase() ||
    name?.toLowerCase() !== repository.name.toLowerCase() ||
    sourcePath.length === 0
  ) {
    return null;
  }

  return `https://raw.githubusercontent.com/${rawSegments.join("/")}`;
}
