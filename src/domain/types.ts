export interface RepositoryRef {
  owner: string;
  name: string;
  nameWithOwner: string;
  url: string;
}

export interface AwesomeEntry {
  title: string;
  description: string;
  repository: RepositoryRef;
  sectionPath: string[];
  sourceUrl: string;
}

export interface RepositoryMetadata {
  nameWithOwner: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  lastCommitAt: string | null;
  license: string | null;
  isArchived: boolean;
  fetchedAt: string;
}

export type SortField =
  | "name"
  | "maintenance"
  | "stars"
  | "lastCommitAt"
  | "openIssues"
  | "license";
export type SortDirection = "asc" | "desc";

export interface TableOptions {
  query: string;
  hideArchived: boolean;
  updatedWithinDays: number | null;
  maintenanceStatuses?: readonly MaintenanceStatus[];
  licenses?: readonly string[];
  sort: {
    field: SortField;
    direction: SortDirection;
  };
  now: Date;
}

export interface ProjectRow extends AwesomeEntry {
  metadata: RepositoryMetadata | null;
}

export interface TableGroup {
  key: string;
  label: string;
  sectionPath: string[];
  rows: ProjectRow[];
}

export interface TableFacets {
  total: number;
  maintenance: Record<MaintenanceStatus, number>;
  licenses: Array<{ value: string; count: number }>;
}
import type { MaintenanceStatus } from "./maintenance";
