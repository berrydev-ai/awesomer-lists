import type { RepositoryMetadata } from "./domain/types";
import type {
  AuthStatus,
  ExtensionRequest,
  ExtensionResponse,
  MetadataLoadResult,
} from "./messages";

type ContentListener = (message: unknown) => void;

const SOURCE_REPOSITORY = "andyrewlee/awesome-agent-orchestrators";
const SOURCE_URL = `https://github.com/${SOURCE_REPOSITORY}#readme`;
const DAY_IN_MILLISECONDS = 86_400_000;
const now = new Date();

const markdown = `# Awesome Agent Orchestrators

## Agent Frameworks

- [Mastra](https://github.com/mastra-ai/mastra) - Build AI applications and agents with TypeScript.
- [CrewAI](https://github.com/crewAIInc/crewAI) - Framework for orchestrating role-playing autonomous agents.

## Parallel Agent Runners

- [OpenHands](https://github.com/All-Hands-AI/OpenHands) - Platform for software development agents.
- [Codex](https://github.com/openai/codex) - Lightweight coding agent that runs in your terminal.
- [Orca](https://github.com/stablyai/orca) - Run multiple coding agents across isolated worktrees.

## Session & Memory

- [Mem0](https://github.com/mem0ai/mem0) - Universal memory layer for AI agents.

## Legacy and Archived

- [AutoGen](https://github.com/microsoft/autogen) - Framework for agentic AI applications.
`;

const previewMetadata: RepositoryMetadata[] = [
  createMetadata("mastra-ai/mastra", {
    description: "Build AI applications and agents with TypeScript.",
    stars: 20_480,
    forks: 1_620,
    openIssues: 132,
    commitDaysAgo: 1,
    license: "Apache-2.0",
  }),
  createMetadata("crewAIInc/crewAI", {
    description: "Framework for orchestrating role-playing autonomous agents.",
    stars: 42_190,
    forks: 5_880,
    openIssues: 218,
    commitDaysAgo: 18,
    license: "MIT",
  }),
  createMetadata("All-Hands-AI/OpenHands", {
    description: "Platform for software development agents.",
    stars: 68_320,
    forks: 8_410,
    openIssues: 480,
    commitDaysAgo: 54,
    license: "MIT",
  }),
  createMetadata("openai/codex", {
    description: "Lightweight coding agent that runs in your terminal.",
    stars: 39_760,
    forks: 4_120,
    openIssues: 305,
    commitDaysAgo: 3,
    license: "Apache-2.0",
  }),
  createMetadata("stablyai/orca", {
    description: "Run multiple coding agents across isolated worktrees.",
    stars: 15_002,
    forks: 1_048,
    openIssues: 51,
    commitDaysAgo: 180,
    license: "MIT",
  }),
  createMetadata("mem0ai/mem0", {
    description: "Universal memory layer for AI agents.",
    stars: 44_860,
    forks: 4_690,
    openIssues: 164,
    commitDaysAgo: 520,
    license: "Apache-2.0",
  }),
  createMetadata("microsoft/autogen", {
    description: "Framework for agentic AI applications.",
    stars: 52_240,
    forks: 7_610,
    openIssues: 690,
    commitDaysAgo: 760,
    license: "CC-BY-4.0",
    isArchived: true,
  }),
];

let listener: ContentListener | null = null;
let connected = true;
const openPreviewButton = getOpenPreviewButton();

(
  globalThis as typeof globalThis & {
    __AWESOMER_PREVIEW__?: { pageUrl: string; sourceLabel: string };
  }
).__AWESOMER_PREVIEW__ = {
  pageUrl: SOURCE_URL,
  sourceLabel: `${SOURCE_REPOSITORY} · UI preview fixtures`,
};

globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener: (nextListener: ContentListener) => {
        listener = nextListener;
      },
    },
    sendMessage: async (request: ExtensionRequest) =>
      handlePreviewRequest(request),
    getURL: (path: string) =>
      new URL(
        path === "token.html" ? "token.html?preview=1" : path,
        location.href,
      ).href,
  },
} as unknown as typeof chrome;

void import("./content").then(() => {
  if (!listener) throw new Error("The UI preview could not start.");
  listener({ type: "awesomer.toggle" });
  openPreviewButton.addEventListener("click", () =>
    listener?.({ type: "awesomer.toggle" }),
  );
});

function getOpenPreviewButton(): HTMLButtonElement {
  const existing = document.querySelector<HTMLButtonElement>(
    "#open-preview-button",
  );
  if (existing) return existing;

  const button = document.createElement("button");
  button.id = "open-preview-button";
  button.type = "button";
  button.textContent = "Open UI preview";
  document.body.append(button);
  return button;
}

function createMetadata(
  nameWithOwner: string,
  values: {
    description: string;
    stars: number;
    forks: number;
    openIssues: number;
    commitDaysAgo: number;
    license: string;
    isArchived?: boolean;
  },
): RepositoryMetadata {
  return {
    nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    description: values.description,
    stars: values.stars,
    forks: values.forks,
    openIssues: values.openIssues,
    lastCommitAt: new Date(
      now.getTime() - values.commitDaysAgo * DAY_IN_MILLISECONDS,
    ).toISOString(),
    license: values.license,
    isArchived: values.isArchived ?? false,
    fetchedAt: now.toISOString(),
  };
}

async function handlePreviewRequest(
  request: ExtensionRequest,
): Promise<ExtensionResponse<unknown>> {
  if (request.type === "auth.status") {
    return success<AuthStatus>({
      hasToken: connected,
      remembered: false,
      login: connected ? "UI preview" : null,
    });
  }

  if (request.type === "auth.save") {
    connected = true;
    return success<AuthStatus>({
      hasToken: true,
      remembered: request.remember,
      login: "UI preview",
    });
  }

  if (request.type === "auth.clear") {
    connected = false;
    return success<AuthStatus>({
      hasToken: false,
      remembered: false,
      login: null,
    });
  }

  if (request.type === "readme.load") return success(markdown);

  const requested = new Set(
    request.repositories.map((repository) => repository.toLocaleLowerCase()),
  );
  const result: MetadataLoadResult = {
    metadata: previewMetadata.filter((item) =>
      requested.has(item.nameWithOwner.toLocaleLowerCase()),
    ),
    missing: [],
    rateLimit: {
      remaining: 4_868,
      resetAt: new Date(now.getTime() + 3_600_000).toISOString(),
    },
    cachedCount: request.refresh ? 0 : 2,
  };
  return success(result);
}

function success<T>(data: T): ExtensionResponse<T> {
  return { ok: true, data };
}
