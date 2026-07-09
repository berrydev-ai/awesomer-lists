const RESERVED_ROOT_ROUTES = new Set([
  "about",
  "collections",
  "contact",
  "events",
  "explore",
  "features",
  "login",
  "marketplace",
  "notifications",
  "organizations",
  "orgs",
  "pricing",
  "security",
  "settings",
  "signup",
  "site",
  "sponsors",
  "topics",
]);

export interface GitHubRepositoryPage {
  owner: string;
  name: string;
}

/**
 * Extracts an owner and repository only from a GitHub repository page URL.
 */
export function parseGitHubRepositoryPage(
  pageUrl: string,
): GitHubRepositoryPage | null {
  const url = new URL(pageUrl);

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const [owner, rawName] = url.pathname.split("/").filter(Boolean);

  if (
    !owner ||
    !rawName ||
    RESERVED_ROOT_ROUTES.has(owner.toLowerCase()) ||
    !/^[a-z0-9_.-]+$/i.test(owner) ||
    !/^[a-z0-9_.-]+$/i.test(rawName)
  ) {
    return null;
  }

  return { owner, name: rawName.replace(/\.git$/i, "") };
}
