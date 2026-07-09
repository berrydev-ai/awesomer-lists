import type { AwesomeEntry, RepositoryRef } from "./types";

const GITHUB_LINK_PATTERN =
  /\[([^\]]+)]\((https?:\/\/(?:www\.)?github\.com\/[^)\s]+)\)/i;
const REFERENCE_LINK_PATTERN = /\[([^\]]+)]\[([^\]]+)]/;
const REFERENCE_DEFINITION_PATTERN =
  /^\s*\[([^\]]+)]:\s*(?:<([^>]+)>|(\S+))/;

interface ExtractedLink {
  title: string;
  url: string;
  endIndex: number;
}

function parseRepository(url: string): RepositoryRef | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
    return null;
  }

  const [owner, rawName] = parsed.pathname.split("/").filter(Boolean);

  if (!owner || !rawName) {
    return null;
  }

  const name = rawName.replace(/\.git$/i, "");

  return {
    owner,
    name,
    nwo: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

function cleanHeading(value: string): string {
  return value.replace(/\[([^\]]+)]\([^)]+\)/g, "$1").trim();
}

function contentLines(markdown: string): string[] {
  const lines: string[] = [];
  let fenceMarker: "`" | "~" | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];

    if (fence) {
      const marker = fence[0] as "`" | "~";

      if (fenceMarker === null) {
        fenceMarker = marker;
      } else if (fenceMarker === marker) {
        fenceMarker = null;
      }
      continue;
    }

    if (fenceMarker === null) {
      lines.push(line);
    }
  }

  return lines;
}

function collectReferences(lines: readonly string[]): Map<string, string> {
  const references = new Map<string, string>();

  for (const line of lines) {
    const definition = REFERENCE_DEFINITION_PATTERN.exec(line);

    if (definition?.[1]) {
      references.set(
        definition[1].toLowerCase(),
        definition[2] ?? definition[3] ?? "",
      );
    }
  }

  return references;
}

function extractLink(
  listItem: string,
  references: ReadonlyMap<string, string>,
): ExtractedLink | null {
  const inlineLink = GITHUB_LINK_PATTERN.exec(listItem);

  if (inlineLink?.[1] && inlineLink[2]) {
    return {
      title: inlineLink[1],
      url: inlineLink[2],
      endIndex: (inlineLink.index ?? 0) + inlineLink[0].length,
    };
  }

  const referenceLink = REFERENCE_LINK_PATTERN.exec(listItem);
  const referenceUrl = referenceLink?.[2]
    ? references.get(referenceLink[2].toLowerCase())
    : undefined;

  if (!referenceLink?.[1] || !referenceUrl) {
    return null;
  }

  return {
    title: referenceLink[1],
    url: referenceUrl,
    endIndex: (referenceLink.index ?? 0) + referenceLink[0].length,
  };
}

/**
 * Converts an Awesome-style Markdown README into repository rows grouped by headings.
 */
export function parseAwesomeList(markdown: string): AwesomeEntry[] {
  const headings = new Map<number, string>();
  const entries: AwesomeEntry[] = [];
  const lines = contentLines(markdown);
  const references = collectReferences(lines);

  for (const line of lines) {
    const heading = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line);

    if (heading) {
      const level = heading[1]?.length ?? 2;
      const title = cleanHeading(heading[2] ?? "");

      for (const existingLevel of headings.keys()) {
        if (existingLevel >= level) {
          headings.delete(existingLevel);
        }
      }

      headings.set(level, title);
      continue;
    }

    const listItem = /^\s*[-*+]\s+(.+)$/.exec(line)?.[1];
    const link = listItem ? extractLink(listItem, references) : null;

    if (!listItem || !link) {
      continue;
    }

    const sourceUrl = link.url;
    const repository = parseRepository(sourceUrl);

    if (!repository) {
      continue;
    }

    const description = listItem
      .slice(link.endIndex)
      .replace(/^\s*[-–—:]\s*/, "")
      .trim();

    entries.push({
      title: link.title.trim() || repository.name,
      description,
      repository,
      sectionPath: [...headings.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, value]) => value),
      sourceUrl,
    });
  }

  return entries;
}
