const DAY_IN_MILLISECONDS = 86_400_000;

export type MaintenanceStatus =
  | "active"
  | "quiet"
  | "stale"
  | "archived"
  | "unknown";

/**
 * Classifies repository maintenance using explicit, easy-to-explain thresholds.
 */
export function getMaintenanceStatus(
  lastCommitAt: string | null,
  isArchived: boolean,
  now: Date,
): MaintenanceStatus {
  if (isArchived) return "archived";
  if (!lastCommitAt) return "unknown";

  const commitTime = new Date(lastCommitAt).getTime();

  if (Number.isNaN(commitTime)) return "unknown";

  const ageInDays = (now.getTime() - commitTime) / DAY_IN_MILLISECONDS;

  if (ageInDays <= 90) return "active";
  if (ageInDays <= 365) return "quiet";
  return "stale";
}
