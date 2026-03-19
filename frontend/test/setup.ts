import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

type FakeRequest<T> = {
  error: DOMException | null;
  onerror: ((event: Event) => void) | null;
  onsuccess: ((event: Event) => void) | null;
  result: T;
};

type FakeOpenRequest = FakeRequest<IDBDatabase> & {
  onupgradeneeded: ((event: Event) => void) | null;
};

type FakeStoreMap = Map<string, Map<string, unknown>>;

const indexedDbState = new Map<string, FakeStoreMap>();

function queueTask(callback: () => void) {
  window.setTimeout(callback, 0);
}

function createFakeEvent(target: object): Event {
  return { target } as Event;
}

function createFakeRequest<T>(initialResult: T): FakeRequest<T> {
  return {
    result: initialResult,
    error: null,
    onsuccess: null,
    onerror: null,
  };
}

function createObjectStoreNames(stores: FakeStoreMap): DOMStringList {
  const names = Array.from(stores.keys());
  const domStringList = {
    length: names.length,
    contains: (value: string) => stores.has(value),
    item: (index: number) => names[index] ?? null,
  } as DOMStringList & Record<number, string>;

  names.forEach((name, index) => {
    domStringList[index] = name;
  });

  return domStringList;
}

function createFakeIndexedDb(): IDBFactory {
  return {
    cmp(first: unknown, second: unknown) {
      if (first === second) {
        return 0;
      }
      return String(first) < String(second) ? -1 : 1;
    },
    databases: async () =>
      Array.from(indexedDbState.keys()).map((name) => ({
        name,
        version: 1,
      })),
    deleteDatabase(name: string) {
      const request = createFakeRequest<undefined>(undefined);
      queueTask(() => {
        indexedDbState.delete(name);
        request.onsuccess?.(createFakeEvent(request));
      });
      return request as unknown as IDBOpenDBRequest;
    },
    open(name: string, version?: number) {
      const request = {
        ...createFakeRequest<IDBDatabase>(undefined as unknown as IDBDatabase),
        onupgradeneeded: null,
      } as FakeOpenRequest;

      queueTask(() => {
        const hadDatabase = indexedDbState.has(name);
        const stores = indexedDbState.get(name) ?? new Map<string, Map<string, unknown>>();
        indexedDbState.set(name, stores);

        const database = {
          close() {},
          createObjectStore(storeName: string) {
            if (!stores.has(storeName)) {
              stores.set(storeName, new Map<string, unknown>());
            }
            return {} as IDBObjectStore;
          },
          deleteObjectStore(storeName: string) {
            stores.delete(storeName);
          },
          get name() {
            return name;
          },
          get objectStoreNames() {
            return createObjectStoreNames(stores);
          },
          get version() {
            return version ?? 1;
          },
          transaction(storeName: string) {
            if (!stores.has(storeName)) {
              stores.set(storeName, new Map<string, unknown>());
            }
            const store = stores.get(storeName)!;
            const transaction = {
              error: null,
              onabort: null,
              oncomplete: null,
              onerror: null,
              objectStoreNames: createObjectStoreNames(new Map([[storeName, store]])),
              abort() {
                transaction.onabort?.(createFakeEvent(transaction));
              },
              addEventListener() {},
              commit() {},
              db: database as IDBDatabase,
              dispatchEvent() {
                return true;
              },
              durability: "default",
              mode: "readwrite",
              objectStore() {
                return {
                  add(value: { storage_key: string }) {
                    const addRequest = createFakeRequest<string>("");
                    queueTask(() => {
                      const key = String(value.storage_key);
                      store.set(key, value);
                      addRequest.result = key;
                      addRequest.onsuccess?.(createFakeEvent(addRequest));
                      transaction.oncomplete?.(createFakeEvent(transaction));
                    });
                    return addRequest as IDBRequest;
                  },
                  addEventListener() {},
                  autoIncrement: false,
                  clear() {
                    const clearRequest = createFakeRequest<undefined>(undefined);
                    queueTask(() => {
                      store.clear();
                      clearRequest.onsuccess?.(createFakeEvent(clearRequest));
                      transaction.oncomplete?.(createFakeEvent(transaction));
                    });
                    return clearRequest as IDBRequest;
                  },
                  count() {
                    const countRequest = createFakeRequest<number>(0);
                    queueTask(() => {
                      countRequest.result = store.size;
                      countRequest.onsuccess?.(createFakeEvent(countRequest));
                    });
                    return countRequest as IDBRequest<number>;
                  },
                  createIndex() {
                    return {} as IDBIndex;
                  },
                  dispatchEvent() {
                    return true;
                  },
                  delete(key: string) {
                    const deleteRequest = createFakeRequest<undefined>(undefined);
                    queueTask(() => {
                      store.delete(String(key));
                      deleteRequest.onsuccess?.(createFakeEvent(deleteRequest));
                      transaction.oncomplete?.(createFakeEvent(transaction));
                    });
                    return deleteRequest as IDBRequest;
                  },
                  deleteIndex() {},
                  get(key: string) {
                    const getRequest = createFakeRequest<unknown>(undefined);
                    queueTask(() => {
                      getRequest.result = store.get(String(key));
                      getRequest.onsuccess?.(createFakeEvent(getRequest));
                    });
                    return getRequest as IDBRequest;
                  },
                  getAll() {
                    const getAllRequest = createFakeRequest<unknown[]>([]);
                    queueTask(() => {
                      getAllRequest.result = Array.from(store.values());
                      getAllRequest.onsuccess?.(createFakeEvent(getAllRequest));
                    });
                    return getAllRequest as IDBRequest<unknown[]>;
                  },
                  getAllKeys() {
                    const getAllKeysRequest = createFakeRequest<string[]>([]);
                    queueTask(() => {
                      getAllKeysRequest.result = Array.from(store.keys());
                      getAllKeysRequest.onsuccess?.(createFakeEvent(getAllKeysRequest));
                    });
                    return getAllKeysRequest as IDBRequest<string[]>;
                  },
                  getKey(key: string) {
                    const getKeyRequest = createFakeRequest<string | undefined>(undefined);
                    queueTask(() => {
                      getKeyRequest.result = store.has(String(key)) ? String(key) : undefined;
                      getKeyRequest.onsuccess?.(createFakeEvent(getKeyRequest));
                    });
                    return getKeyRequest as IDBRequest;
                  },
                  index() {
                    return {} as IDBIndex;
                  },
                  indexNames: createObjectStoreNames(new Map()),
                  keyPath: "storage_key",
                  name: storeName,
                  openCursor() {
                    return createFakeRequest<IDBCursorWithValue | null>(null) as IDBRequest;
                  },
                  openKeyCursor() {
                    return createFakeRequest<IDBCursor | null>(null) as IDBRequest;
                  },
                  put(value: { storage_key: string }) {
                    const putRequest = createFakeRequest<string>("");
                    queueTask(() => {
                      const key = String(value.storage_key);
                      store.set(key, value);
                      putRequest.result = key;
                      putRequest.onsuccess?.(createFakeEvent(putRequest));
                      transaction.oncomplete?.(createFakeEvent(transaction));
                    });
                    return putRequest as IDBRequest;
                  },
                  removeEventListener() {},
                  transaction: transaction as unknown as IDBTransaction,
                } as unknown as IDBObjectStore;
              },
              removeEventListener() {},
            } as IDBTransaction & {
              error: DOMException | null;
              onabort: ((event: Event) => void) | null;
              oncomplete: ((event: Event) => void) | null;
              onerror: ((event: Event) => void) | null;
            };
            return transaction as unknown as IDBTransaction;
          },
        } as IDBDatabase;

        request.result = database;
        if (!hadDatabase) {
          request.onupgradeneeded?.(createFakeEvent(request));
        }
        request.onsuccess?.(createFakeEvent(request));
      });

      return request as unknown as IDBOpenDBRequest;
    },
  } as IDBFactory;
}

Object.defineProperty(globalThis, "indexedDB", {
  configurable: true,
  value: createFakeIndexedDb(),
});

afterEach(() => {
  indexedDbState.clear();
  cleanup();
});
