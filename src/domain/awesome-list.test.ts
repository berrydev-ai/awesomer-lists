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
          nwo: "mastra-ai/mastra",
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
      repository: { nwo: "langchain-ai/langchain" },
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
      parseAwesomeList(markdown).map((entry) => entry.repository.nwo),
    ).toEqual(["mastra-ai/mastra"]);
  });
});
