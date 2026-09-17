import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createPersistentTokenStore, createTokenVault } from "./token-store";

function area(data: Record<string, unknown> = {}) {
  return {
    data,
    async get(keys: string | string[]) {
      return Object.fromEntries((typeof keys === "string" ? [keys] : keys)
        .filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(values: Record<string, unknown>) { Object.assign(data, values); },
    async remove(keys: string | string[]) {
      for (const key of typeof keys === "string" ? [keys] : keys) delete data[key];
    },
  };
}

function persistent(initial: { token: string; login: string } | null = null) {
  let record = initial;
  return {
    async read() { return record; },
    async write(value: { token: string; login: string }) { record = value; },
    async clear() { record = null; },
    current() { return record; },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
}

describe("private token storage", () => {
  it("closes an IndexedDB connection that succeeds after an open was blocked", async () => {
    const opening: Record<string, unknown> = {};
    const close = vi.fn();
    const transaction = vi.fn();
    const factory = {
      open: vi.fn(() => opening),
    } as unknown as IDBFactory;
    const store = createPersistentTokenStore(factory);
    const reading = store.read();
    const request = opening as unknown as IDBOpenDBRequest;

    request.onblocked?.(new Event("blocked") as IDBVersionChangeEvent);
    await expect(reading).rejects.toThrow("Close other extension windows");
    Object.assign(opening, { result: { close, transaction } });
    request.onsuccess?.(new Event("success"));

    expect(close).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("closes IndexedDB when transaction setup throws", async () => {
    const opening: Record<string, unknown> = {};
    const close = vi.fn();
    const factory = {
      open: vi.fn(() => opening),
    } as unknown as IDBFactory;
    const store = createPersistentTokenStore(factory);
    const reading = store.read();
    const request = opening as unknown as IDBOpenDBRequest;
    Object.assign(opening, {
      result: {
        close,
        transaction: () => { throw new Error("missing store"); },
      },
    });
    request.onsuccess?.(new Event("success"));

    await expect(reading).rejects.toThrow("Could not update private token storage");
    expect(close).toHaveBeenCalledOnce();
  });

  it("persists remembered credentials in the extension database across worker restarts", async () => {
    const factory = new IDBFactory();
    const local = area();
    const first = createTokenVault(local, area(), createPersistentTokenStore(factory));
    await first.save({ token: "remembered-test-token", login: "octocat" }, true);
    expect(local.data).toEqual({});
    const restarted = createTokenVault(local, area(), createPersistentTokenStore(factory));
    expect(await restarted.token()).toBe("remembered-test-token");
    expect(await restarted.status()).toEqual({ hasToken: true, remembered: true, login: "octocat" });
    expect(JSON.stringify(await restarted.status())).not.toContain("remembered-test-token");
  });

  it("keeps session credentials out of persistent storage and loses them on browser restart", async () => {
    const factory = new IDBFactory();
    const local = area();
    const session = area();
    const store = createPersistentTokenStore(factory);
    const vault = createTokenVault(local, session, store);
    await vault.save({ token: "temporary-test-token", login: "octocat" }, false);
    expect(await vault.token()).toBe("temporary-test-token");
    expect(await store.read()).toBeNull();
    expect(local.data).toEqual({});
    const restarted = createTokenVault(local, area(), store);
    expect(await restarted.status()).toEqual({ hasToken: false, remembered: false, login: null });
  });

  it("migrates existing Chrome tokens without leaving a copy accessible to content scripts", async () => {
    const local = area({ "auth.githubToken": "legacy-test-token", "auth.githubLogin": "octocat", "metadata.a/b": {} });
    const store = createPersistentTokenStore(new IDBFactory());
    const vault = createTokenVault(local, area(), store);
    expect(await vault.token()).toBe("legacy-test-token");
    expect(await store.read()).toEqual({ token: "legacy-test-token", login: "octocat" });
    expect(local.data).toEqual({ "metadata.a/b": {} });
  });

  it("moves the legacy local login beside an existing session token", async () => {
    const local = area({
      "auth.githubLogin": "octocat",
      "metadata.a/b": {},
    });
    const session = area({ "auth.githubToken": "temporary-test-token" });
    const vault = createTokenVault(local, session, persistent());

    await expect(vault.status()).resolves.toEqual({
      hasToken: true,
      remembered: false,
      login: "octocat",
    });
    expect(session.data).toEqual({
      "auth.githubToken": "temporary-test-token",
      "auth.githubLogin": "octocat",
    });
    expect(local.data).toEqual({ "metadata.a/b": {} });
  });

  it("works when Safari cannot restrict local storage access", async () => {
    const local = { ...area(), setAccessLevel: vi.fn().mockRejectedValue(new Error("Unsupported")) };
    const session = { ...area(), setAccessLevel: vi.fn().mockResolvedValue(undefined) };
    const vault = createTokenVault(local, session, createPersistentTokenStore(new IDBFactory()));
    await vault.save({ token: "safari-test-token", login: "octocat" }, true);
    expect(await vault.token()).toBe("safari-test-token");
    expect(local.data).toEqual({});
    expect(session.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it("preserves the original token if migration cannot commit", async () => {
    const local = area({ "auth.githubToken": "legacy-test-token" });
    const store = {
      read: async () => null,
      write: vi.fn().mockRejectedValue(new Error("disk full")),
      clear: vi.fn(async () => undefined),
    };
    const vault = createTokenVault(local, area(), store);
    await expect(vault.ready).rejects.toThrow("disk full");
    await expect(vault.token()).rejects.toThrow("disk full");
    expect(local.data["auth.githubToken"]).toBe("legacy-test-token");

    await expect(vault.clear()).resolves.toEqual({
      hasToken: false,
      remembered: false,
      login: null,
    });
    await expect(vault.token()).resolves.toBeNull();
    expect(local.data).toEqual({});
  });

  it("switches from remembered to session-only and clears all token copies on disconnect", async () => {
    const local = area({ "metadata.a/b": {} });
    const session = area();
    const store = createPersistentTokenStore(new IDBFactory());
    const vault = createTokenVault(local, session, store);
    await vault.save({ token: "remembered-test-token", login: "old" }, true);
    await vault.save({ token: "temporary-test-token", login: "new" }, false);
    expect(await store.read()).toBeNull();
    expect(await vault.status()).toEqual({ hasToken: true, remembered: false, login: "new" });
    await vault.clear();
    expect(await vault.token()).toBeNull();
    expect(session.data).toEqual({});
    expect(local.data).toEqual({ "metadata.a/b": {} });
  });

  it("makes token reads wait for an active save", async () => {
    const gate = deferred();
    const store = persistent();
    const write = vi.spyOn(store, "write");
    let saved: { token: string; login: string } | null = null;
    write.mockImplementation(async (record) => {
      await gate.promise;
      saved = record;
    });
    vi.spyOn(store, "read").mockImplementation(async () => saved);
    const vault = createTokenVault(area(), area(), store);
    const saving = vault.save(
      { token: "new-remembered-token", login: "new" },
      true,
    );
    await vi.waitFor(() => expect(write).toHaveBeenCalled());

    let readFinished = false;
    const reading = vault.token().then((value) => {
      readFinished = true;
      return value;
    });
    await Promise.resolve();
    expect(readFinished).toBe(false);

    gate.resolve();
    await expect(saving).resolves.toMatchObject({ remembered: true });
    await expect(reading).resolves.toBe("new-remembered-token");
  });

  it("makes token reads wait for an active clear", async () => {
    const gate = deferred();
    let current: { token: string; login: string } | null = {
      token: "remembered-test-token",
      login: "old",
    };
    const store = {
      async read() { return current; },
      async write(record: { token: string; login: string }) { current = record; },
      async clear() { await gate.promise; current = null; },
    };
    const vault = createTokenVault(area(), area(), store);
    await vault.ready;
    const clearing = vault.clear();
    await Promise.resolve();

    let readFinished = false;
    const reading = vault.token().then((value) => {
      readFinished = true;
      return value;
    });
    await Promise.resolve();
    expect(readFinished).toBe(false);

    gate.resolve();
    await expect(clearing).resolves.toMatchObject({ hasToken: false });
    await expect(reading).resolves.toBeNull();
  });

  it("makes a clear wait for a token read that started first", async () => {
    const gate = deferred();
    const old = { token: "remembered-test-token", login: "old" };
    let current: { token: string; login: string } | null = old;
    const read = vi.fn(async () => {
      await gate.promise;
      return current;
    });
    const store = {
      read,
      async write(record: { token: string; login: string }) { current = record; },
      async clear() { current = null; },
    };
    const vault = createTokenVault(area(), area(), store);
    await vault.ready;
    const reading = vault.token();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());

    let clearFinished = false;
    const clearing = vault.clear().then((value) => {
      clearFinished = true;
      return value;
    });
    await Promise.resolve();
    expect(clearFinished).toBe(false);

    gate.resolve();
    await expect(reading).resolves.toBe("remembered-test-token");
    await expect(clearing).resolves.toMatchObject({ hasToken: false });
    expect(current).toBeNull();
  });

  it("restores a session credential when switching to remembered storage fails", async () => {
    const session = area({
      "auth.githubToken": "old-session-token",
      "auth.githubLogin": "old",
    });
    const originalRemove = session.remove.bind(session);
    vi.spyOn(session, "remove")
      .mockRejectedValueOnce(new Error("session unavailable"))
      .mockImplementation(originalRemove);
    const store = persistent();
    const vault = createTokenVault(area(), session, store);

    await expect(
      vault.save({ token: "new-remembered-token", login: "new" }, true),
    ).rejects.toThrow("session unavailable");
    await expect(vault.token()).resolves.toBe("old-session-token");
    expect(store.current()).toBeNull();
  });

  it("restores a remembered credential when switching to session storage fails", async () => {
    const old = { token: "old-remembered-token", login: "old" };
    const store = persistent(old);
    const originalClear = store.clear.bind(store);
    vi.spyOn(store, "clear")
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockImplementation(originalClear);
    const session = area();
    const vault = createTokenVault(area(), session, store);

    await expect(
      vault.save({ token: "new-session-token", login: "new" }, false),
    ).rejects.toThrow("database unavailable");
    await expect(vault.token()).resolves.toBe("old-remembered-token");
    expect(session.data).toEqual({});
    expect(store.current()).toEqual(old);
  });

  it("fails closed when rollback cannot remove a newly entered credential", async () => {
    const old = { token: "old-remembered-token", login: "old" };
    const store = persistent(old);
    const originalClear = store.clear.bind(store);
    vi.spyOn(store, "clear")
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockImplementation(originalClear);
    const session = area();
    const originalRemove = session.remove.bind(session);
    vi.spyOn(session, "remove")
      .mockRejectedValueOnce(new Error("session unavailable"))
      .mockImplementation(originalRemove);
    const local = area();
    const vault = createTokenVault(local, session, store);

    await expect(
      vault.save({ token: "new-session-token", login: "new" }, false),
    ).rejects.toThrow(/Disconnect to clear/);
    expect(session.data["auth.githubToken"]).toBe("new-session-token");
    await expect(vault.token()).rejects.toThrow(/Disconnect to clear/);
    await expect(vault.status()).rejects.toThrow(/Disconnect to clear/);
    expect(local.data["auth.tokenStoreRecoveryRequired"]).toBe(true);

    const restarted = createTokenVault(local, session, store);
    await expect(restarted.token()).rejects.toThrow(/Disconnect to clear/);

    await expect(restarted.clear()).resolves.toEqual({
      hasToken: false,
      remembered: false,
      login: null,
    });
    await expect(restarted.token()).resolves.toBeNull();
    expect(session.data).toEqual({});
    expect(local.data).toEqual({});
    expect(store.current()).toBeNull();
  });

  it("does not report disconnect success until both stores are cleared", async () => {
    const store = persistent({
      token: "old-remembered-token",
      login: "old",
    });
    const originalClear = store.clear.bind(store);
    vi.spyOn(store, "clear")
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockImplementation(originalClear);
    const vault = createTokenVault(area(), area(), store);

    await expect(vault.clear()).rejects.toThrow(
      "Could not clear private token storage",
    );
    await expect(vault.token()).rejects.toThrow(/Disconnect to clear/);
    expect(store.current()).toMatchObject({ token: "old-remembered-token" });

    await expect(vault.clear()).resolves.toMatchObject({ hasToken: false });
    await expect(vault.token()).resolves.toBeNull();
  });
});
