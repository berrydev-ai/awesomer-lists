import type {
  AwesomeEntry,
  ProjectRow,
  RepositoryMetadata,
  SortDirection,
  SortField,
  TableGroup,
  TableOptions,
} from "./types";

const DAY_IN_MILLISECONDS = 86_400_000;

function compareNullable(
  left: number | string | null,
  right: number | string | null,
  direction: SortDirection,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const result =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right));

  return direction === "asc" ? result : -result;
}

function sortValue(row: ProjectRow, field: SortField): number | string | null {
  if (field === "name") return row.title.toLocaleLowerCase();
  if (field === "lastCommitAt") return row.metadata?.lastCommitAt ?? null;
  return row.metadata?.[field] ?? null;
}

function matchesQuery(row: ProjectRow, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) return true;

  return [
    row.title,
    row.description,
    row.repository.nwo,
    row.sectionPath.join(" "),
    row.metadata?.description ?? "",
  ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

function matchesMetadataFilters(row: ProjectRow, options: TableOptions): boolean {
  if (options.hideArchived && row.metadata?.isArchived) {
    return false;
  }

  if (options.updatedWithinDays === null) {
    return true;
  }

  const lastCommitAt = row.metadata?.lastCommitAt;

  if (!lastCommitAt) {
    return false;
  }

  const cutoff =
    options.now.getTime() - options.updatedWithinDays * DAY_IN_MILLISECONDS;

  return new Date(lastCommitAt).getTime() >= cutoff;
}

/**
 * Builds grouped, sortable table rows while preserving the README section order.
 */
export function buildTableGroups(
  entries: readonly AwesomeEntry[],
  metadata: readonly RepositoryMetadata[],
  options: TableOptions,
): TableGroup[] {
  const metadataByRepository = new Map(
    metadata.map((item) => [item.nwo.toLowerCase(), item]),
  );
  const groups = new Map<string, TableGroup>();

  for (const entry of entries) {
    const row: ProjectRow = {
      ...entry,
      metadata:
        metadataByRepository.get(entry.repository.nwo.toLowerCase()) ?? null,
    };

    if (
      !matchesQuery(row, options.query) ||
      !matchesMetadataFilters(row, options)
    ) {
      continue;
    }

    const sectionPath = entry.sectionPath.length
      ? entry.sectionPath
      : ["Other"];
    const key = sectionPath.join("\u001f");
    const group = groups.get(key) ?? {
      key,
      label: sectionPath.join(" › "),
      sectionPath,
      rows: [],
    };

    group.rows.push(row);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((left, right) =>
      compareNullable(
        sortValue(left, options.sort.field),
        sortValue(right, options.sort.field),
        options.sort.direction,
      ),
    ),
  }));
}
