const DB_NAME = "fighting-collider-editor";
const STORE_NAME = "handles";
const HANDLE_KEY = "framedata-directory";

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const saveDirectoryHandle = async (handle: FileSystemDirectoryHandle) => {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");

  transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const loadDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).get(HANDLE_KEY);

  return new Promise((resolve, reject) => {
    request.onsuccess = () =>
      resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
};

export const queryDirectoryPermission = async (
  handle: FileSystemDirectoryHandle,
  mode: FileSystemPermissionMode = "readwrite",
) => (await handle.queryPermission({ mode })) === "granted";

export const requestDirectoryPermission = async (
  handle: FileSystemDirectoryHandle,
  mode: FileSystemPermissionMode = "readwrite",
) => {
  if (await queryDirectoryPermission(handle, mode)) {
    return true;
  }

  return (await handle.requestPermission({ mode })) === "granted";
};
