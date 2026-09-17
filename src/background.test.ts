import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionRequest, ExtensionResponse } from "./messages";
import { METADATA_PORT_NAME } from "./messages";

const client = vi.hoisted(() => ({ validateGitHubToken: vi.fn(), fetchRepositoryMetadataBatch: vi.fn(), fetchRepositoryReadme: vi.fn() }));
vi.mock("./github/client", async () => ({
  ...await vi.importActual<typeof import("./github/client")>("./github/client"), ...client,
}));
type Listener = (message: unknown, sender: chrome.runtime.MessageSender, reply: (response: ExtensionResponse<unknown>) => void) => boolean | undefined;
let listener: Listener;
let connect: (port: chrome.runtime.Port) => void;
let click: (tab: chrome.tabs.Tab) => Promise<void>;
let tabSendMessage: ReturnType<typeof vi.fn>;

function storage(data: Record<string, unknown> = {}) {
  return {
    data,
    get: vi.fn(async (keys?: string | string[] | null) => {
      const selected = keys == null ? Object.keys(data) : typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(selected.filter((key) => key in data).map((key) => [key, data[key]]));
    }),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; }),
    setAccessLevel: vi.fn(async () => undefined),
  };
}
let local: ReturnType<typeof storage>;
let session: ReturnType<typeof storage>;
const root = "safari-web-extension://test/";
const contentSender = { id: "test", url: "https://github.com/a/list", frameId: 0, tab: { id: 1, url: "https://github.com/a/list" } as chrome.tabs.Tab };
const tokenSender = { id: "test", url: `${root}token.html` };
const optionsSender = { id: "test", url: `${root}options.html` };
const record = (name = "mastra-ai/mastra") => ({
  nameWithOwner: name, url: `https://github.com/${name}`, description: "Agent framework",
  stars: 20_000, forks: 1500, openIssues: 125, lastCommitAt: "2026-07-08T12:00:00Z",
  license: "Apache-2.0", isArchived: false, fetchedAt: new Date().toISOString(),
});

async function loadBackground() {
  tabSendMessage = vi.fn();
  globalThis.chrome = {
    runtime: {
      id: "test", getURL: (path: string) => new URL(path, root).href,
      onMessage: { addListener: (value: Listener) => { listener = value; } },
      onConnect: { addListener: (value: typeof connect) => { connect = value; } },
    },
    action: {
      onClicked: { addListener: (value: typeof click) => { click = value; } },
      setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(),
    },
    scripting: { executeScript: vi.fn() }, tabs: { sendMessage: tabSendMessage }, storage: { local, session },
  } as unknown as typeof chrome;
  await import("./background");
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  client.validateGitHubToken.mockReset().mockResolvedValue("octocat");
  client.fetchRepositoryMetadataBatch.mockReset().mockImplementation(async (repos) => ({
    metadata: repos.map((repo: { nameWithOwner: string }) => record(repo.nameWithOwner)), missing: [], rateLimit: null,
  }));
  client.fetchRepositoryReadme.mockReset().mockResolvedValue("# Awesome");
  local = storage(); session = storage();
  await loadBackground();
});

function request(message: ExtensionRequest, sender: chrome.runtime.MessageSender = contentSender) {
  return new Promise<ExtensionResponse<unknown>>((resolve, reject) => {
    if (!listener(message, sender, resolve)) reject(new Error("Sender rejected"));
  });
}
async function authenticate(remember = false) {
  return request({ type: "auth.save", token: "dedicated-test-token-value", remember }, tokenSender);
}
function port(sender: chrome.runtime.MessageSender = contentSender) {
  let message: (value: unknown) => void = () => undefined;
  let disconnect: () => void = () => undefined;
  const postMessage = vi.fn();
  const result = {
    name: METADATA_PORT_NAME, sender, postMessage,
    onMessage: { addListener: (next: typeof message) => { message = next; } },
    onDisconnect: { addListener: (next: typeof disconnect) => { disconnect = next; } },
    disconnect: vi.fn(() => disconnect()),
  };
  connect(result as unknown as chrome.runtime.Port);
  return { ...result, send: (value: unknown) => message(value), drop: () => disconnect() };
}
async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for background progress");
}

describe("background authorization and tokens", () => {
  it("accepts Safari token-frame messages without a tab and never returns the token", async () => {
    const reply = await authenticate();
    expect(reply).toEqual({ ok: true, data: { hasToken: true, remembered: false, login: "octocat" } });
    expect(JSON.stringify(reply)).not.toContain("dedicated-test-token-value");
    expect(session.data["auth.githubToken"]).toBe("dedicated-test-token-value");
    expect(local.data["auth.githubToken"]).toBeUndefined();
  });
  it("stores remembered credentials outside content-script storage", async () => {
    expect(await authenticate(true)).toEqual({ ok: true, data: { hasToken: true, remembered: true, login: "octocat" } });
    expect(session.data["auth.githubToken"]).toBeUndefined();
    expect(local.data["auth.githubToken"]).toBeUndefined();
    await request({ type: "auth.clear" });
    expect(await request({ type: "auth.status" })).toEqual({ ok: true, data: { hasToken: false, remembered: false, login: null } });
  });
  it("rejects writes from content scripts, other extensions, and unrecognized extension pages", () => {
    const reply = vi.fn();
    expect(listener({ type: "auth.save", token: "bad", remember: true }, contentSender, reply)).toBe(false);
    expect(listener({ type: "auth.status" }, { ...contentSender, id: "other" }, reply)).toBe(false);
    expect(listener({ type: "auth.save" }, { url: `${root}other.html` }, reply)).toBe(false);
    expect(reply).not.toHaveBeenCalled();
  });
  it("cancels pending token validation when the user disconnects", async () => {
    let finish!: (login: string) => void;
    client.validateGitHubToken.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const saving = authenticate();
    await eventually(() => Boolean(finish));
    await request({ type: "auth.clear" });
    finish("octocat");
    expect((await saving).ok).toBe(false);
    expect(await request({ type: "auth.status" })).toMatchObject({ data: { hasToken: false } });
  });
  it("ignores toolbar clicks outside GitHub", async () => {
    await click({ id: 1, url: "https://example.com/" } as chrome.tabs.Tab);
    expect(tabSendMessage).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
  it("injects the top frame when presence detection rejects", async () => {
    tabSendMessage
      .mockRejectedValueOnce(new Error("No listener"))
      .mockResolvedValueOnce("awesomer.ready");
    await click(contentSender.tab);
    expect(tabSendMessage).toHaveBeenNthCalledWith(1, 1, { type: "awesomer.ping" }, { frameId: 0 });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1, frameIds: [0] }, files: ["content.js"] });
    expect(tabSendMessage).toHaveBeenNthCalledWith(2, 1, { type: "awesomer.toggle" }, { frameId: 0 });
  });
  it("injects when Safari resolves missing presence with undefined", async () => {
    tabSendMessage
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("awesomer.ready");
    await click(contentSender.tab);
    expect(chrome.scripting.executeScript).toHaveBeenCalledOnce();
  });
  it("toggles without injection when the content listener acknowledges presence", async () => {
    tabSendMessage.mockResolvedValue("awesomer.ready");
    await click(contentSender.tab);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(tabSendMessage).toHaveBeenCalledTimes(2);
    expect(tabSendMessage).toHaveBeenLastCalledWith(1, { type: "awesomer.toggle" }, { frameId: 0 });
  });
  it("opens the toolbar UI when token-vault initialization fails", async () => {
    vi.resetModules();
    local = storage();
    session = storage();
    session.setAccessLevel.mockRejectedValue(new Error("Session storage unavailable"));
    await loadBackground();
    tabSendMessage.mockResolvedValue("awesomer.ready");

    await click(contentSender.tab);

    expect(tabSendMessage).toHaveBeenCalledTimes(2);
    expect(tabSendMessage).toHaveBeenLastCalledWith(1, { type: "awesomer.toggle" }, { frameId: 0 });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: "" });
  });
  it("serializes rapid clicks so injection cannot overlap", async () => {
    let finishPing!: (response: unknown) => void;
    tabSendMessage
      .mockImplementationOnce(() => new Promise((resolve) => { finishPing = resolve; }))
      .mockResolvedValue("awesomer.ready");

    const first = click(contentSender.tab);
    const second = click(contentSender.tab);
    await eventually(() => Boolean(finishPing));
    expect(tabSendMessage).toHaveBeenCalledTimes(1);

    finishPing(undefined);
    await Promise.all([first, second]);
    expect(chrome.scripting.executeScript).toHaveBeenCalledOnce();
    expect(tabSendMessage).toHaveBeenCalledTimes(4);
  });
  it("shows an error badge when content injection fails", async () => {
    tabSendMessage.mockResolvedValueOnce(undefined);
    vi.mocked(chrome.scripting.executeScript).mockRejectedValueOnce(new Error("Injection denied"));
    await click(contentSender.tab);
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: "!" });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 1, color: "#b42318" });
  });
});

describe("local metadata workflow", () => {
  it("reuses cache and allows options to clear only metadata", async () => {
    await authenticate();
    const load: ExtensionRequest = { type: "metadata.load", repositories: ["mastra-ai/mastra"], refresh: false };
    expect((await request(load)).ok).toBe(true);
    expect(await request(load)).toMatchObject({ ok: true, data: { cachedCount: 1, pendingCount: 0, complete: true } });
    expect(client.fetchRepositoryMetadataBatch).toHaveBeenCalledTimes(1);
    expect(await request({ type: "cache.status" }, optionsSender)).toMatchObject({ ok: true, data: { entries: 1 } });
    expect(await request({ type: "cache.clear" }, optionsSender)).toMatchObject({ ok: true, data: { entries: 0 } });
    expect(session.data["auth.githubToken"]).toBe("dedicated-test-token-value");
    expect(listener({ type: "cache.save", serverUrl: "https://server.test" }, optionsSender, vi.fn())).toBe(false);
  });
  it("emits cached data before GitHub and sends a final snapshot", async () => {
    await authenticate();
    const cached = { ...record(), fetchedAt: new Date(Date.now() - 7 * 3600_000).toISOString() };
    local.data["metadata.mastra-ai/mastra"] = { value: cached, expiresAt: Date.now() - 3600_000 };
    let finish!: (value: unknown) => void;
    client.fetchRepositoryMetadataBatch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const stream = port();
    stream.send({ type: "metadata.load", repositories: ["mastra-ai/mastra"], refresh: false });
    await eventually(() => stream.postMessage.mock.calls.length > 0 && Boolean(finish));
    expect(stream.postMessage.mock.calls[0]?.[0]).toMatchObject({ ok: true, data: { metadata: [cached], staleCount: 1, complete: false } });
    finish({ metadata: [{ ...record(), stars: 20001 }], missing: [], rateLimit: null });
    await eventually(() => stream.postMessage.mock.calls.some(([value]) => value.data?.complete));
    expect(stream.postMessage.mock.lastCall?.[0]).toMatchObject({ data: { complete: true, staleCount: 0, metadata: [expect.objectContaining({ stars: 20001 })] } });
  });
  it("rejects unauthorized ports and malformed metadata requests", async () => {
    expect(port(tokenSender).disconnect).toHaveBeenCalled();
    const stream = port();
    stream.send({ type: "metadata.load", repositories: ["../evil"], refresh: false });
    await eventually(() => stream.postMessage.mock.calls.length > 0);
    expect(stream.postMessage.mock.lastCall?.[0]).toMatchObject({ ok: false });
    expect(client.fetchRepositoryMetadataBatch).not.toHaveBeenCalled();
  });
  it("stops additional batches and messages after the modal disconnects", async () => {
    await authenticate();
    let finish!: (value: unknown) => void;
    client.fetchRepositoryMetadataBatch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const names = Array.from({ length: 21 }, (_, index) => `owner/repo-${index}`);
    const stream = port();
    stream.send({ type: "metadata.load", repositories: names, refresh: false });
    await eventually(() => Boolean(finish));
    stream.drop();
    const count = stream.postMessage.mock.calls.length;
    finish({ metadata: names.slice(0, 20).map(record), missing: [], rateLimit: null });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(client.fetchRepositoryMetadataBatch).toHaveBeenCalledTimes(1);
    expect(stream.postMessage).toHaveBeenCalledTimes(count);
  });
});
