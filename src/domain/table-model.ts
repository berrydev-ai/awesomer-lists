import { getMaintenanceStatus } from "./maintenance";
import type {
  AwesomeEntry,
  ProjectRow,
  RepositoryMetadata,
  SortDirection,
  SortField,
  TableFacets,
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

function sortValue(
  row: ProjectRow,
  field: SortField,
  now: Date,
): number | string | null {
  if (field === "name") return row.title.toLocaleLowerCase();
  if (field === "maintenance") {
    const rank = { active: 0, quiet: 1, stale: 2, archived: 3, unknown: 4 };
    return rank[
      getMaintenanceStatus(
        row.metadata?.lastCommitAt ?? null,
        row.metadata?.isArchived ?? false,
        now,
      )
    ];
  }
  if (field === "lastCommitAt") return row.metadata?.lastCommitAt ?? null;
  if (field === "license") return row.metadata?.license?.toLocaleLowerCase() ?? null;
  return row.metadata?.[field] ?? null;
}

function matchesQuery(row: ProjectRow, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) return true;

  return [
    row.title,
    row.description,
    row.repository.nameWithOwner,
    row.sectionPath.join(" "),
    row.metadata?.description ?? "",
  ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

function matchesBaseMetadataFilters(
  row: ProjectRow,
  options: TableOptions,
): boolean {
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

function matchesMaintenance(row: ProjectRow, options: TableOptions): boolean {
  if (!options.maintenanceStatuses?.length) return true;

  return options.maintenanceStatuses.includes(
    getMaintenanceStatus(
      row.metadata?.lastCommitAt ?? null,
      row.metadata?.isArchived ?? false,
      options.now,
    ),
  );
}

function matchesLicense(row: ProjectRow, options: TableOptions): boolean {
  if (!options.licenses?.length) return true;
  return options.licenses.includes(row.metadata?.license ?? "No license");
}

function createRows(
  entries: readonly AwesomeEntry[],
  metadata: readonly RepositoryMetadata[],
): ProjectRow[] {
  const metadataByRepository = new Map(
    metadata.map((item) => [item.nameWithOwner.toLowerCase(), item]),
  );

  return entries.map((entry) => ({
    ...entry,
    metadata:
      metadataByRepository.get(entry.repository.nameWithOwner.toLowerCase()) ?? null,
  }));
}

/**
 * Builds grouped, sortable table rows while preserving the README section order.
 */
export function buildTableGroups(
  entries: readonly AwesomeEntry[],
  metadata: readonly RepositoryMetadata[],
  options: TableOptions,
): TableGroup[] {
  const groups = new Map<string, TableGroup>();

  for (const row of createRows(entries, metadata)) {
    if (
      !matchesQuery(row, options.query) ||
      !matchesBaseMetadataFilters(row, options) ||
      !matchesMaintenance(row, options) ||
      !matchesLicense(row, options)
    ) {
      continue;
    }

    const sectionPath = row.sectionPath.length ? row.sectionPath : ["Other"];
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
        sortValue(left, options.sort.field, options.now),
        sortValue(right, options.sort.field, options.now),
        options.sort.direction,
      ),
    ),
  }));
}

/**
 * Counts maintenance and license choices while honoring the other active facet.
 */
export function buildTableFacets(
  entries: readonly AwesomeEntry[],
  metadata: readonly RepositoryMetadata[],
  options: TableOptions,
): TableFacets {
  const rows = createRows(entries, metadata).filter(
    (row) =>
      matchesQuery(row, options.query) &&
      matchesBaseMetadataFilters(row, options),
  );
  const maintenance: TableFacets["maintenance"] = {
    active: 0,
    quiet: 0,
    stale: 0,
    archived: 0,
    unknown: 0,
  };

  rows.filter((row) => matchesLicense(row, options)).forEach((row) => {
    const status = getMaintenanceStatus(
      row.metadata?.lastCommitAt ?? null,
      row.metadata?.isArchived ?? false,
      options.now,
    );
    maintenance[status] += 1;
  });

  const licenseCounts = new Map<string, number>();
  rows.filter((row) => matchesMaintenance(row, options)).forEach((row) => {
    const license = row.metadata?.license ?? "No license";
    licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
  });

  return {
    total: rows.length,
    maintenance,
    licenses: [...licenseCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => left.value.localeCompare(right.value)),
  };
}
