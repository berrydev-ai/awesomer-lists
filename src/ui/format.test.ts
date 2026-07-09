import { describe, expect, it } from "vitest";

import { formatRepositoryCount } from "./format";

describe("formatRepositoryCount", () => {
  it("shows the exact total instead of rounding large counts", () => {
    expect(formatRepositoryCount(12_345, "en-US")).toBe("12,345");
    expect(formatRepositoryCount(1_234_567, "en-US")).toBe("1,234,567");
  });
});
