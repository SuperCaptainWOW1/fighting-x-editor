import type {
  SerializedStateData,
  StateToAnimationData,
} from "../types/framedata";
import {
  normalizeStateAnimationConfig,
  parseStateToAnimation,
} from "../utils/framedata";

const FRAMEDATA_EXTENSION = ".json";
const ANIMATION_FILE = "stateToAnimation.json";
const DRAFTS_KEY = "fighting-collider-editor.drafts";

const getDraftStorageKey = (scope = "local") =>
  scope === "local"
    ? DRAFTS_KEY
    : `${DRAFTS_KEY}.${encodeURIComponent(scope)}`;

export interface LoadedProject {
  framedata: Record<string, SerializedStateData>;
  animations: StateToAnimationData;
}

const isJsonFile = (name: string) => name.endsWith(FRAMEDATA_EXTENSION);

const readJsonFile = async <T>(handle: FileSystemFileHandle): Promise<T> => {
  const file = await handle.getFile();
  const text = await file.text();
  return JSON.parse(text) as T;
};

const writeJsonFile = async (handle: FileSystemFileHandle, data: unknown) => {
  const writable = await handle.createWritable();
  await writable.write(`${JSON.stringify(data, null, 2)}\n`);
  await writable.close();
};

export const pickProjectDirectory = async () => {
  if (!("showDirectoryPicker" in window)) {
    throw new Error("File System Access API не поддерживается в этом браузере");
  }

  return window.showDirectoryPicker({ mode: "readwrite" });
};

export const loadProjectFromDirectory = async (
  directory: FileSystemDirectoryHandle,
): Promise<LoadedProject> => {
  const framedata: Record<string, SerializedStateData> = {};
  let animations: StateToAnimationData = {};

  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== "file" || !isJsonFile(name)) {
      continue;
    }

    if (name === ANIMATION_FILE) {
      animations = parseStateToAnimation(
        await readJsonFile(handle as FileSystemFileHandle),
      );
      continue;
    }

    const stateName = name.slice(0, -FRAMEDATA_EXTENSION.length);
    framedata[stateName] = await readJsonFile<SerializedStateData>(
      handle as FileSystemFileHandle,
    );
  }

  return { framedata, animations };
};

export const exportProjectFiles = async (
  directory: FileSystemDirectoryHandle,
  framedata: Record<string, SerializedStateData>,
  animations: StateToAnimationData,
  selectedNames: string[],
) => {
  for (const name of selectedNames) {
    const payload = framedata[name];

    if (!payload) {
      continue;
    }

    const fileHandle = await directory.getFileHandle(`${name}.json`, {
      create: true,
    });

    await writeJsonFile(fileHandle, payload);
  }

  const animationHandle = await directory.getFileHandle(ANIMATION_FILE, {
    create: true,
  });

  await writeJsonFile(animationHandle, animations);
};

export interface DraftEntryPayload {
  data: SerializedStateData;
  animations: { left: string; right: string };
  boxNames?: Array<string | undefined>;
  savedSnapshot?: string;
}

export interface DraftStore {
  animations: StateToAnimationData;
  entries: Record<string, DraftEntryPayload>;
  addedStateNames?: string[];
  deletedEntries?: Record<string, DraftEntryPayload>;
}

export const loadDraftStore = (scope = "local"): DraftStore | null => {
  const raw = localStorage.getItem(getDraftStorageKey(scope));

  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as DraftStore;
  parsed.animations = parseStateToAnimation(parsed.animations);
  Object.values(parsed.entries).forEach((entry) => {
    entry.animations = normalizeStateAnimationConfig(entry.animations);
  });
  Object.values(parsed.deletedEntries ?? {}).forEach((entry) => {
    entry.animations = normalizeStateAnimationConfig(entry.animations);
  });
  return parsed;
};

export const saveDraftStore = (store: DraftStore, scope = "local") => {
  localStorage.setItem(getDraftStorageKey(scope), JSON.stringify(store));
};

export const clearDraftStore = (scope = "local") => {
  localStorage.removeItem(getDraftStorageKey(scope));
};
