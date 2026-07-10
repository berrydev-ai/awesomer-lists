import type { RepositoryMetadata } from "./domain/types";

export const PREVIEW_SNAPSHOT_CAPTURED_AT = "2026-07-10T13:32:33Z";
export const PREVIEW_README_SOURCE_URL =
  "https://github.com/andyrewlee/awesome-agent-orchestrators#readme";
export const PREVIEW_METADATA_SOURCE_URL = "https://api.github.com/graphql";

export const PREVIEW_MARKDOWN = `# Awesome Agent Orchestrators UI Snapshot

## Parallel Agent Runners

- [cmux](https://github.com/manaflow-ai/cmux) - Open-source platform for running multiple coding agents in parallel.
- [Orca](https://github.com/stablyai/orca) - IDE for running multiple CLI coding agents side-by-side across isolated git worktrees.
- [t3code](https://github.com/pingdotgg/t3code) - Minimal web GUI for coding agents.

## Personal Assistants

- [babyagi3](https://github.com/yoheinakajima/babyagi3) - A minimal AI agent you configure once, then run through natural language.
- [openclaw](https://github.com/openclaw/openclaw) - Your own personal AI assistant.

## Multi-Agent Swarms

- [scion](https://github.com/GoogleCloudPlatform/scion) - Multi-agent orchestration testbed that runs AI agents in parallel isolated containers.

## Autonomous Loop Runners

- [ralph-claude-code](https://github.com/frankbria/ralph-claude-code) - Autonomous AI development loop for Claude Code with intelligent exit detection.
- [ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator) - Hat-based orchestration that keeps agents in a loop until done.

## Additional Maintenance States

- [AgentGPT](https://github.com/reworkd/AgentGPT) - Assemble, configure, and deploy autonomous AI agents in your browser.
- [SuperAGI](https://github.com/TransformerOptimus/SuperAGI) - Developer-first autonomous AI agent framework.
`;

export const PREVIEW_METADATA: RepositoryMetadata[] = [
  {
    nameWithOwner: "manaflow-ai/cmux",
    url: "https://github.com/manaflow-ai/cmux",
    description:
      "Open source Ghostty-based macOS terminal with vertical tabs and notifications for AI coding agents. Built for multitasking, organization, and programmability.",
    stars: 24_103,
    forks: 1_926,
    openIssues: 1_393,
    lastCommitAt: "2026-07-10T10:28:07Z",
    license: "NOASSERTION",
    isArchived: false,
    fetchedAt: PREVIEW_SNAPSHOT_CAPTURED_AT,
  },
  {
    nameWithOwner: "stablyai/orca",
    url: "https://github.com/stablyai/orca",
    description:
      "Orca is the ADE for working with a fleet of parallel agents. Run any coding agent with your own subscription. Available on desktop and mobile.",
    stars: 15_717,
    forks: 1_227,
    openIssues: 517,
    lastCommitAt: "2026-07-10T13:00:41Z",
    license: "MIT",
    isArchived: false,
    fetchedAt: PREVIEW_SNAPSHOT_CAPTURED_AT,
  },
  {
    nameWithOwner: "pingdotgg/t3code",
    url: "https://github.com/pingdotgg/t3code",
    description: null,
    stars: 13_495,
    forks: 2_797,
    openIssues: 342,
    lastCommitAt: "2026-07-09T14:00:51Z",
    license: "MIT",
    isArchived: false,
    fetchedAt: PREVIEW_SNAPSHOT_CAPTURED_AT,
  },
  {
    nameWithOwner: "yoheinakajima/babyagi3",
    url: "https://github.com/yoheinakajima/babyagi3",
    description: null,
    stars: 127,
    forks: 15,
    openIssues: 0,
    lastCommitAt: "2026-02-08T05:48:58Z",
    license: "MIT",
    isArchived: false,
    fetchedAt: PREVIEW_SNAPSHOT_CAPTURED_AT,
  },
  {
    nameWithOwner: "openclaw/openclaw",
    url: "https://github.com/openclaw/openclaw",
    description: "Your own personal AI assistant. Any OS. Any Platform.",
    stars: 382_460,
    forks: 80_255,
    openIssues: 3_570,
    lastCommitAt: "2026-07-10T13:32:11Z",
    license: "NOASSERTION",
    isArchived: false,
    fetchedAt: PREVIEW_SNAPSHOT_CAPTURED_AT,
  },
  {
    nameWithOwner: "GoogleCloudPlatform/scion",
    url: "https://github.com/GoogleCloudPlatform/scion",
    description: null,
    stars: 1_624,
    forks: 246,
    openIssues: 51,
    lastCommitAt: "2026-07-09T23:37:52Z",
    license: "Apache-2.0",
    isArchived: false,
    fetchedAt: PREVIEW_SNAPSHOT_CAPTURED_AT,
  },
  {
    nameWithOwner: "frankbria/ralph-claude-code",
    url: "https://github.com/frankbria/ralph-claude-code",
    description:
      "Autonomous AI development loop for Claude Code with intelligent exit detection",
    stars: 9_523,
    forks: 726,
    openIssues: 22,
    lastCommitAt: "2026-07-10T07:08:27Z",
    license: "MIT",
    isArchived: false,
    fetchedAt: PREVIEW_SNAPSHOT_CAPTURED_AT,
  },
  {
    nameWithOwner: "mikeyobrien/ralph-orchestrator",
    url: "https://github.com/mikeyobrien/ralph-orchestrator",
    description:
      "An improved implementation of the Ralph Wiggum technique for autonomous AI agent orchestration",
    stars: 2_993,
    forks: 279,
    openIssues: 9,
    lastCommitAt: "2026-06-23T02:33:09Z",
    license: "MIT",
    isArchived: false,
    fetchedAt: PREVIEW_SNAPSHOT_CAPTURED_AT,
  },
  {
    nameWithOwner: "reworkd/AgentGPT",
    url: "https://github.com/reworkd/AgentGPT",
    description:
      "Assemble, configure, and deploy autonomous AI Agents in your browser.",
    stars: 36_262,
    forks: 9_304,
    openIssues: 132,
    lastCommitAt: "2025-04-29T01:19:07Z",
    license: "GPL-3.0",
    isArchived: true,
    fetchedAt: PREVIEW_SNAPSHOT_CAPTURED_AT,
  },
  {
    nameWithOwner: "TransformerOptimus/SuperAGI",
    url: "https://github.com/TransformerOptimus/SuperAGI",
    description:
      "SuperAGI - A dev-first open source autonomous AI agent framework.",
    stars: 17_614,
    forks: 2_219,
    openIssues: 191,
    lastCommitAt: "2025-01-22T22:14:07Z",
    license: "MIT",
    isArchived: false,
    fetchedAt: PREVIEW_SNAPSHOT_CAPTURED_AT,
  },
];
