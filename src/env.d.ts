/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROJECT_STORAGE_MODE?: "local" | "remote";
  readonly VITE_FRAMEDATA_CDN_BASE_URL?: string;
  readonly VITE_FRAMEDATA_SAVE_URL?: string;
  readonly VITE_FRAMEDATA_PROFILE_SLUG?: string;
  readonly VITE_FRAMEDATA_REQUEST_CREDENTIALS?: "omit" | "include";
  readonly VITE_CHARACTER_MODEL_URL?: string;
  readonly VITE_DRACO_DECODER_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(options?: {
    mode?: FileSystemPermissionMode;
  }): Promise<FileSystemDirectoryHandle>;
}
