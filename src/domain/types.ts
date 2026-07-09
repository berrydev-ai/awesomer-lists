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

export type SortField = "name" | "stars" | "lastCommitAt" | "openIssues";
export type SortDirection = "asc" | "desc";

export interface TableOptions {
  query: string;
  hideArchived: boolean;
  updatedWithinDays: number | null;
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
