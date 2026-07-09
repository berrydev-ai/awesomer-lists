import { describe, expect, it } from "vitest";

import { getMaintenanceStatus } from "./maintenance";

describe("getMaintenanceStatus", () => {
  it("classifies maintenance from commit age and archived state", () => {
    const now = new Date("2026-07-09T12:00:00Z");

    expect(getMaintenanceStatus("2026-07-01T12:00:00Z", false, now)).toBe(
      "active",
    );
    expect(getMaintenanceStatus("2026-01-01T12:00:00Z", false, now)).toBe(
      "quiet",
    );
    expect(getMaintenanceStatus("2024-01-01T12:00:00Z", false, now)).toBe(
      "stale",
    );
    expect(getMaintenanceStatus("2026-07-01T12:00:00Z", true, now)).toBe(
      "archived",
    );
    expect(getMaintenanceStatus(null, false, now)).toBe("unknown");
  });
});
