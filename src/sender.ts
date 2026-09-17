import type { ExtensionRequest } from "./messages";

export type SenderRole = "content" | "token" | "options";

function parseUrl(value: string | undefined): URL | null {
  try { return value ? new URL(value) : null; } catch { return null; }
}

export function senderRole(
  sender: chrome.runtime.MessageSender,
  extensionUrl: string,
  extensionId: string,
): SenderRole | null {
  if (sender.id && sender.id !== extensionId) return null;
  const root = new URL(extensionUrl);
  const url = parseUrl(sender.url);
  if (!url || url.username || url.password) return null;
  const isExtension = (value: URL): boolean =>
    value.protocol === root.protocol && value.host === root.host;
  const isGitHub = (value: URL): boolean =>
    value.protocol === "https:" && value.hostname === "github.com" && value.port === "";

  if (isExtension(url)) {
    if (url.pathname === "/options.html") return "options";
    if (url.pathname === "/token.html") {
      const tab = parseUrl(sender.tab?.url);
      return !tab || isGitHub(tab) || isExtension(tab) ? "token" : null;
    }
    return null;
  }

  const tab = parseUrl(sender.tab?.url);
  return isGitHub(url) && tab && isGitHub(tab) &&
    (sender.frameId === undefined || sender.frameId === 0)
    ? "content" : null;
}

export function mayRequest(role: SenderRole, type: ExtensionRequest["type"]): boolean {
  if (role === "token") return type === "auth.status" || type === "auth.save";
  if (role === "options") return type === "cache.status" || type === "cache.clear";
  return type === "auth.status" || type === "auth.clear" ||
    type === "readme.load" || type === "metadata.load";
}
