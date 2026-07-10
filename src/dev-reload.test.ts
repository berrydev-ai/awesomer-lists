import { describe, expect, it, vi } from "vitest";

import { watchForDevReload } from "./dev-reload";

describe("development reload watcher", () => {
  it("reloads after the development server announces a source change", () => {
    const reload = vi.fn();
    const unsubscribe = vi.fn();
    const reloadAnnouncements: Array<() => void> = [];

    const stop = watchForDevReload({
      reload,
      subscribe: (nextReload) => {
        reloadAnnouncements.push(nextReload);
        return unsubscribe;
      },
    });

    expect(reload).not.toHaveBeenCalled();
    const announceReload = reloadAnnouncements[0];
    if (!announceReload) {
      throw new Error("Development reload listener was not subscribed.");
    }
    announceReload();
    expect(reload).toHaveBeenCalledOnce();
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
