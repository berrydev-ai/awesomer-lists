export interface DevReloadOptions {
  subscribe?: (reload: () => void) => () => void;
  reload?: () => void;
}

/** Subscribes the browser to successful development rebuild notifications. */
export function watchForDevReload(
  options: DevReloadOptions = {},
): () => void {
  const reload = options.reload ?? (() => location.reload());
  const subscribe = options.subscribe ?? subscribeToReloadEvents;
  return subscribe(reload);
}

function subscribeToReloadEvents(reload: () => void): () => void {
  const events = new EventSource("./dev-events");
  events.addEventListener("reload", reload);
  return () => {
    events.removeEventListener("reload", reload);
    events.close();
  };
}
