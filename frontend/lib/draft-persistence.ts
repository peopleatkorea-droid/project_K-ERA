"use client";

type PersistedDraftBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type PersistedDraftImageAsset = {
  draft_id: string;
  name: string;
  type: string;
  last_modified: number;
  view: string;
  is_representative: boolean;
  blob: Blob;
};

export type PersistedDraftAssetRecord = {
  storage_key: string;
  updated_at: string;
  images: PersistedDraftImageAsset[];
  lesion_boxes: Record<string, PersistedDraftBox | null>;
};

const DB_NAME = "kera-workspace";
const STORE_NAME = "draft_assets";
const DB_VERSION = 1;

function getIndexedDb(): IDBFactory | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.indexedDB ?? null;
}

function openDraftDatabase(): Promise<IDBDatabase | null> {
  const indexedDb = getIndexedDb();
  if (!indexedDb) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "storage_key" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Unable to open the local draft database."));
    };
  });
}

export async function readPersistedDraftAssets(storageKey: string): Promise<PersistedDraftAssetRecord | null> {
  const database = await openDraftDatabase();
  if (!database) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(storageKey);

    request.onsuccess = () => {
      resolve((request.result as PersistedDraftAssetRecord | undefined) ?? null);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Unable to read the local draft assets."));
    };

    transaction.oncomplete = () => {
      database.close();
    };
    transaction.onabort = () => {
      database.close();
    };
    transaction.onerror = () => {
      database.close();
    };
  });
}

export async function writePersistedDraftAssets(record: PersistedDraftAssetRecord): Promise<void> {
  const database = await openDraftDatabase();
  if (!database) {
    return;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(record);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Unable to store the local draft assets."));
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Unable to store the local draft assets."));
    };
  });
}

export async function deletePersistedDraftAssets(storageKey: string): Promise<void> {
  const database = await openDraftDatabase();
  if (!database) {
    return;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.delete(storageKey);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Unable to remove the local draft assets."));
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Unable to remove the local draft assets."));
    };
  });
}
