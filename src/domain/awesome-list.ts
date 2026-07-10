import type { AwesomeEntry, RepositoryRef } from "./types";
import { parseGitHubRepositoryPage } from "./github-page";

const REFERENCE_DEFINITION_PATTERN =
  /^\s*\[([^\]]+)]:\s*(?:<([^>]+)>|(\S+))/;
const LIST_ITEM_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;

interface ExtractedLink {
  title: string;
  url: string;
  endIndex: number;
}

interface DiscoveredLink extends ExtractedLink {
  startIndex: number;
}

function parseRepository(url: string): RepositoryRef | null {
  const parsed = parseGitHubRepositoryPage(url);

  if (!parsed) return null;

  const { owner, name } = parsed;

  return {
    owner,
    name,
    nameWithOwner: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

function cleanHeading(value: string): string {
  return value.replace(/\[([^\]]+)]\([^)]+\)/g, "$1").trim();
}

function sectionPath(headings: ReadonlyMap<number, string>): string[] {
  return [...headings.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value);
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

  return joinListContinuations(lines);
}

function joinListContinuations(lines: readonly string[]): string[] {
  const joined: string[] = [];

  for (const line of lines) {
    const previousIndex = joined.length - 1;
    const previous = joined[previousIndex];
    const isContinuation =
      /^\s{2,}\S/.test(line) &&
      !LIST_ITEM_PATTERN.test(line) &&
      previous !== undefined &&
      LIST_ITEM_PATTERN.test(previous);

    if (isContinuation) {
      joined[previousIndex] = `${previous} ${line.trim()}`;
    } else {
      joined.push(line);
    }
  }

  return joined;
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
  const links: DiscoveredLink[] = [];

  for (const match of listItem.matchAll(/\[([^\]]+)]\(([^)\s]+)\)/g)) {
    const isImage = match.index !== undefined && listItem[match.index - 1] === "!";

    if (match[1] && match[2] && match.index !== undefined && !isImage) {
      links.push({
        title: match[1],
        url: match[2],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  for (const match of listItem.matchAll(/\[([^\]]+)]\[([^\]]+)]/g)) {
    const isImage = match.index !== undefined && listItem[match.index - 1] === "!";
    const referenceUrl = match[2]
      ? references.get(match[2].toLowerCase())
      : undefined;

    if (match[1] && referenceUrl && match.index !== undefined && !isImage) {
      links.push({
        title: match[1],
        url: referenceUrl,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  for (const match of listItem.matchAll(
    /<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi,
  )) {
    if (match[2] && match[3] && match.index !== undefined) {
      links.push({
        title: match[3].replace(/<[^>]+>/g, "").trim(),
        url: match[2],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  links.sort((left, right) => left.startIndex - right.startIndex);
  const projectLink = links[0];
  const repositoryLink = links.find((link) => parseRepository(link.url));

  if (!projectLink || !repositoryLink) return null;

  return {
    title: projectLink.title,
    url: repositoryLink.url,
    endIndex: projectLink.endIndex,
  };
}

function cleanDescription(value: string): string {
  return value
    .replace(/^\s*[-–—:]\s*/, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)]\[[^\]]+]/g, "$1")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();

  if (!trimmed.startsWith("|") || !trimmed.includes("|", 1)) {
    return null;
  }

  const content = trimmed.endsWith("|")
    ? trimmed.slice(1, -1)
    : trimmed.slice(1);
  const cells: string[] = [];
  let cell = "";

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === "\\" && content[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(cells: readonly string[]): boolean {
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
  );
}

function findDescriptionColumn(headers: readonly string[]): number {
  return headers.findIndex((header) =>
    /^(description|details|notes?|summary)$/i.test(
      header.replace(/[*_`]/g, "").trim(),
    ),
  );
}

function createEntry(
  link: ExtractedLink,
  description: string,
  headings: ReadonlyMap<number, string>,
): AwesomeEntry | null {
  const repository = parseRepository(link.url);

  if (!repository) return null;

  return {
    title: link.title.trim() || repository.name,
    description,
    repository,
    sectionPath: sectionPath(headings),
    sourceUrl: link.url,
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
  let tableHeaders: string[] | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line);

    if (heading) {
      tableHeaders = null;
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

    const tableCells = splitTableRow(line);
    const nextTableCells = splitTableRow(lines[index + 1] ?? "");

    if (tableCells && nextTableCells && isTableSeparator(nextTableCells)) {
      tableHeaders = tableCells;
      index += 1;
      continue;
    }

    if (tableCells && isTableSeparator(tableCells)) {
      continue;
    }

    if (tableCells && tableHeaders) {
      const linkedCell = tableCells
        .map((cell) => ({ cell, link: extractLink(cell, references) }))
        .find(({ link }) => link !== null);

      if (!linkedCell?.link) {
        continue;
      }

      const descriptionIndex = findDescriptionColumn(tableHeaders);
      const description =
        descriptionIndex >= 0
          ? cleanDescription(tableCells[descriptionIndex] ?? "")
          : "";
      const entry = createEntry(linkedCell.link, description, headings);

      if (entry) entries.push(entry);
      continue;
    }

    if (!tableCells && line.trim()) {
      tableHeaders = null;
    }

    const listItem = LIST_ITEM_PATTERN.exec(line)?.[1];
    const link = listItem ? extractLink(listItem, references) : null;

    if (!listItem || !link) {
      continue;
    }

    const description = cleanDescription(listItem.slice(link.endIndex));
    const entry = createEntry(link, description, headings);

    if (entry) entries.push(entry);
  }

  return entries;
}
