import { describe, expect, it } from "vitest";

import { parseAwesomeList } from "./awesome-list";

describe("parseAwesomeList", () => {
  it("turns a linked project into a row under its full heading path", () => {
    const markdown = `# Awesome Agents

## Frameworks

### TypeScript

- [Mastra](https://github.com/mastra-ai/mastra) - Build AI applications and agents.
`;

    expect(parseAwesomeList(markdown)).toEqual([
      {
        title: "Mastra",
        description: "Build AI applications and agents.",
        repository: {
          owner: "mastra-ai",
          name: "mastra",
          nameWithOwner: "mastra-ai/mastra",
          url: "https://github.com/mastra-ai/mastra",
        },
        sectionPath: ["Frameworks", "TypeScript"],
        sourceUrl: "https://github.com/mastra-ai/mastra",
      },
    ]);
  });

  it("resolves reference-style repository links", () => {
    const markdown = `# Awesome Agents

## Frameworks

- [LangChain][langchain] - Build context-aware applications.

[langchain]: https://github.com/langchain-ai/langchain
`;

    expect(parseAwesomeList(markdown)[0]).toMatchObject({
      title: "LangChain",
      description: "Build context-aware applications.",
      repository: { nameWithOwner: "langchain-ai/langchain" },
      sectionPath: ["Frameworks"],
    });
  });

  it("does not treat a non-GitHub reference link as a repository", () => {
    const markdown = `# Awesome Agents

## Articles

- [Agent guide][guide] - A practical guide.

[guide]: https://example.com/guides/agents
`;

    expect(parseAwesomeList(markdown)).toEqual([]);
  });

  it("ignores repository links shown inside fenced code examples", () => {
    const markdown = `# Awesome Agents

## Contribution format

\`\`\`markdown
- [Project](https://github.com/example/example) - Description.
\`\`\`

## Frameworks

- [Mastra](https://github.com/mastra-ai/mastra) - Build AI applications.
`;

    expect(
      parseAwesomeList(markdown).map((entry) => entry.repository.nameWithOwner),
    ).toEqual(["mastra-ai/mastra"]);
  });

  it("keeps the project title when its GitHub repository is a later source link", () => {
    const markdown = `# Awesome Agents

## Frameworks

- [Mastra](https://mastra.ai) - Build AI applications. ([Source](https://github.com/mastra-ai/mastra))
`;

    expect(parseAwesomeList(markdown)[0]).toMatchObject({
      title: "Mastra",
      description: "Build AI applications. (Source)",
      repository: { nameWithOwner: "mastra-ai/mastra" },
    });
  });

  it("recognizes numbered items containing HTML repository links", () => {
    const markdown = `# Awesome Agents

## Frameworks

1. <a href="https://github.com/mastra-ai/mastra">Mastra</a> - Build AI applications.
`;

    expect(parseAwesomeList(markdown)[0]).toMatchObject({
      title: "Mastra",
      description: "Build AI applications.",
      repository: { nameWithOwner: "mastra-ai/mastra" },
      sectionPath: ["Frameworks"],
    });
  });

  it("keeps an indented continuation as part of the project description", () => {
    const markdown = `# Awesome Agents

## Swarms

- [AgentsMesh](https://github.com/AgentsMesh/AgentsMesh) - Coordinate remote agent workstations.
  Supports multiple coding-agent runtimes.
`;

    expect(parseAwesomeList(markdown)[0]?.description).toBe(
      "Coordinate remote agent workstations. Supports multiple coding-agent runtimes.",
    );
  });

  it("parses repository rows from Markdown tables", () => {
    const markdown = `# Awesome cmux

## Feature Dimensions

### Sidebar & Status Pills

| Repo | Agent | Description | Stars |
|------|-------|-------------|-------|
| ![TypeScript](https://img.shields.io/badge/typescript) [cmux-hub](https://github.com/azu/cmux-hub) | Claude Code | Review sessions in a browser-based diff viewer. | 23 |
| [ocx](https://github.com/kdcokenny/ocx) | OpenCode | Manage portable configuration profiles. | 669 |
`;

    expect(parseAwesomeList(markdown)).toEqual([
      expect.objectContaining({
        title: "cmux-hub",
        description: "Review sessions in a browser-based diff viewer.",
        repository: expect.objectContaining({ nameWithOwner: "azu/cmux-hub" }),
        sectionPath: ["Feature Dimensions", "Sidebar & Status Pills"],
      }),
      expect.objectContaining({
        title: "ocx",
        description: "Manage portable configuration profiles.",
        repository: expect.objectContaining({ nameWithOwner: "kdcokenny/ocx" }),
        sectionPath: ["Feature Dimensions", "Sidebar & Status Pills"],
      }),
    ]);
  });
});
