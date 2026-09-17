import type { AuthStatus } from "./messages";

const TOKEN_KEY = "auth.githubToken";
const LOGIN_KEY = "auth.githubLogin";
const RECOVERY_KEY = "auth.tokenStoreRecoveryRequired";

export interface TokenRecord {
  token: string;
  login: string;
}

export interface PersistentTokenStore {
  read(): Promise<TokenRecord | null>;
  write(record: TokenRecord): Promise<void>;
  clear(): Promise<void>;
}

interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  setAccessLevel?(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

/** Extension-origin IndexedDB is unavailable to website content scripts. */
export function createPersistentTokenStore(
  factory: IDBFactory = indexedDB,
  databaseName = "awesomer-private-auth",
): PersistentTokenStore {
  const transact = <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      const opening = factory.open(databaseName, 1);
      let blocked = false;
      opening.onupgradeneeded = () => {
        if (!opening.result.objectStoreNames.contains("credentials")) {
          opening.result.createObjectStore("credentials");
        }
      };
      opening.onerror = () =>
        reject(new Error("Could not open private token storage."));
      opening.onblocked = () => {
        blocked = true;
        reject(new Error("Close other extension windows and try again."));
      };
      opening.onsuccess = () => {
        const database = opening.result;
        if (blocked) {
          database.close();
          return;
        }

        try {
          const transaction = database.transaction("credentials", mode);
          const request = action(transaction.objectStore("credentials"));
          transaction.oncomplete = () => {
            database.close();
            resolve(request.result);
          };
          transaction.onabort = transaction.onerror = () => {
            database.close();
            reject(new Error("Could not update private token storage."));
          };
        } catch {
          database.close();
          reject(new Error("Could not update private token storage."));
        }
      };
    });

  return {
    async read() {
      const record: unknown = await transact("readonly", (store) => store.get("github"));
      if (
        typeof record === "object" && record !== null &&
        "token" in record && typeof record.token === "string" &&
        "login" in record && typeof record.login === "string"
      ) return { token: record.token, login: record.login };
      return null;
    },
    async write(record) {
      await transact("readwrite", (store) => store.put(record, "github"));
    },
    async clear() {
      await transact("readwrite", (store) => store.delete("github"));
    },
  };
}

/** Keep secrets out of extension storage that content scripts can access. */
export function createTokenVault(
  local: StorageArea,
  session: StorageArea,
  persistent: PersistentTokenStore = createPersistentTokenStore(),
) {
  let queue: Promise<unknown> = Promise.resolve();
  let failedClosed: Error | null = null;
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  };

  const unsafeStateError = (): Error =>
    new Error(
      "Private token storage could not be restored. Disconnect to clear it.",
    );

  const failClosed = async (): Promise<Error> => {
    failedClosed = unsafeStateError();
    try {
      await local.set({ [RECOVERY_KEY]: true });
    } catch {
      // The in-memory lock still prevents this worker from returning a token.
    }
    return failedClosed;
  };

  const initialize = async (): Promise<void> => {
    // Session storage is private by default on all supported browser versions.
    if (session.setAccessLevel) {
      await session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    }
    // Safari versions before local.setAccessLevel support still keep tokens private
    // because remembered credentials live in the extension-origin database.
    if (local.setAccessLevel) {
      await local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
    }
    const old = await local.get([TOKEN_KEY, LOGIN_KEY, RECOVERY_KEY]);
    if (old[RECOVERY_KEY] === true) {
      failedClosed = unsafeStateError();
      return;
    }
    const temporary = await session.get([TOKEN_KEY, LOGIN_KEY]);
    if (
      typeof temporary[TOKEN_KEY] === "string" &&
      typeof temporary[LOGIN_KEY] !== "string" &&
      typeof old[LOGIN_KEY] === "string"
    ) {
      await session.set({ [LOGIN_KEY]: old[LOGIN_KEY] });
    }
    if (typeof old[TOKEN_KEY] === "string") {
      const existing = await persistent.read();
      if (!existing) {
        await persistent.write({
          token: old[TOKEN_KEY],
          login: typeof old[LOGIN_KEY] === "string" ? old[LOGIN_KEY] : "",
        });
      }
    }
    await local.remove([TOKEN_KEY, LOGIN_KEY]);
  };

  let ready = initialize();
  const observeInitialization = (): void => {
    // The handler that uses the vault reports startup failures to the user.
    void ready.catch(() => undefined);
  };
  observeInitialization();

  const readSession = async (): Promise<TokenRecord | null> => {
    const temporary = await session.get([TOKEN_KEY, LOGIN_KEY]);
    if (typeof temporary[TOKEN_KEY] === "string") {
      return {
        token: temporary[TOKEN_KEY],
        login:
          typeof temporary[LOGIN_KEY] === "string" ? temporary[LOGIN_KEY] : "",
      };
    }
    return null;
  };

  const readUnqueued = async (): Promise<{
    record: TokenRecord | null;
    remembered: boolean;
  }> => {
    if (failedClosed) throw unsafeStateError();
    const temporary = await readSession();
    if (temporary) return { record: temporary, remembered: false };
    return { record: await persistent.read(), remembered: true };
  };

  const statusUnqueued = async (): Promise<AuthStatus> => {
    const { record, remembered } = await readUnqueued();
    return {
      hasToken: record !== null,
      remembered: record !== null && remembered,
      login: record?.login || null,
    };
  };

  const snapshotUnqueued = async (): Promise<{
    session: TokenRecord | null;
    persistent: TokenRecord | null;
  }> => ({
    session: await readSession(),
    persistent: await persistent.read(),
  });

  const restoreSnapshot = async (snapshot: {
    session: TokenRecord | null;
    persistent: TokenRecord | null;
  }): Promise<boolean> => {
    const results = await Promise.allSettled([
      snapshot.session
        ? session.set({
            [TOKEN_KEY]: snapshot.session.token,
            [LOGIN_KEY]: snapshot.session.login,
          })
        : session.remove([TOKEN_KEY, LOGIN_KEY]),
      snapshot.persistent
        ? persistent.write(snapshot.persistent)
        : persistent.clear(),
    ]);
    return results.every((result) => result.status === "fulfilled");
  };

  const transition = async (
    operation: () => Promise<void>,
  ): Promise<AuthStatus> => {
    if (failedClosed) throw unsafeStateError();
    const snapshot = await snapshotUnqueued();
    await local.set({ [RECOVERY_KEY]: true });
    try {
      await operation();
      const nextStatus = await statusUnqueued();
      await local.remove(RECOVERY_KEY);
      return nextStatus;
    } catch (error) {
      const restored = await restoreSnapshot(snapshot);
      let markerRemoved = false;
      if (restored) {
        try {
          await local.remove(RECOVERY_KEY);
          markerRemoved = true;
        } catch {
          markerRemoved = false;
        }
      }
      if (!restored || !markerRemoved) throw await failClosed();
      throw error;
    }
  };

  return {
    get ready(): Promise<void> {
      return ready;
    },
    token(): Promise<string | null> {
      return serialize(async () => {
        await ready;
        return (await readUnqueued()).record?.token ?? null;
      });
    },
    status(): Promise<AuthStatus> {
      return serialize(async () => {
        await ready;
        return statusUnqueued();
      });
    },
    save(record: TokenRecord, remember: boolean): Promise<AuthStatus> {
      return serialize(async () => {
        await ready;
        return transition(async () => {
          if (remember) {
            await persistent.write(record);
            await session.remove([TOKEN_KEY, LOGIN_KEY]);
          } else {
            await session.set({
              [TOKEN_KEY]: record.token,
              [LOGIN_KEY]: record.login,
            });
            await persistent.clear();
          }
        });
      });
    },
    clear(): Promise<AuthStatus> {
      return serialize(async () => {
        await ready.catch(() => undefined);
        const results = await Promise.allSettled([
          persistent.clear(),
          session.remove([TOKEN_KEY, LOGIN_KEY]),
          local.remove([TOKEN_KEY, LOGIN_KEY, RECOVERY_KEY]),
        ]);
        if (results.some((result) => result.status === "rejected")) {
          await failClosed();
          throw new Error(
            "Could not clear private token storage. Disconnect and try again.",
          );
        }
        failedClosed = null;
        ready = initialize();
        observeInitialization();
        await ready;
        return statusUnqueued();
      });
    },
  };
}
