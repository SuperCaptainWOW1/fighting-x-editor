import { projectStorageConfig } from "../config/projectStorage";
import type {
  SerializedStateData,
  StateToAnimationData,
} from "../types/framedata";
import {
  exportProjectFiles,
  loadProjectFromDirectory,
  pickProjectDirectory,
  type LoadedProject,
} from "./projectFiles";
import {
  loadDirectoryHandle,
  queryDirectoryPermission,
  requestDirectoryPermission,
  saveDirectoryHandle,
} from "./directoryStorage";
import { parseStateToAnimation } from "../utils/framedata";

export interface ProjectSavePayload {
  framedata: Record<string, SerializedStateData>;
  animations: StateToAnimationData;
  selectedNames: string[];
  deletedNames?: string[];
}

export interface ProjectStorageInitialization {
  project: LoadedProject | null;
  hasSavedConnection: boolean;
  profiles: ProjectProfile[];
  activeProfileName: string | null;
}

export interface ProjectProfile {
  name: string;
  project: LoadedProject;
}

export interface ProjectStorageAdapter {
  readonly mode: "local" | "remote";
  initialize(): Promise<ProjectStorageInitialization>;
  connect(): Promise<LoadedProject>;
  reconnect(): Promise<LoadedProject>;
  listProfiles(): Promise<ProjectProfile[]>;
  selectProfile(name: string): Promise<LoadedProject>;
  createProfile(name: string, project: LoadedProject): Promise<LoadedProject>;
  load(): Promise<LoadedProject>;
  save(payload: ProjectSavePayload): Promise<void>;
  deleteState(name: string): Promise<void>;
}

class LocalFolderProjectStorage implements ProjectStorageAdapter {
  readonly mode = "local" as const;
  private directoryHandle: FileSystemDirectoryHandle | null = null;

  async initialize(): Promise<ProjectStorageInitialization> {
    const savedHandle = await loadDirectoryHandle();
    this.directoryHandle = savedHandle;

    return {
      hasSavedConnection: Boolean(savedHandle),
      project: savedHandle && await queryDirectoryPermission(savedHandle)
        ? await loadProjectFromDirectory(savedHandle)
        : null,
      profiles: [],
      activeProfileName: null,
    };
  }

  async connect() {
    const handle = await pickProjectDirectory();
    if (!(await requestDirectoryPermission(handle))) {
      throw new Error("Нет доступа к выбранной папке");
    }
    await saveDirectoryHandle(handle);
    this.directoryHandle = handle;
    return loadProjectFromDirectory(handle);
  }

  async reconnect() {
    const savedHandle = this.directoryHandle ?? await loadDirectoryHandle();
    if (!savedHandle) return this.connect();
    if (!(await requestDirectoryPermission(savedHandle))) {
      throw new Error("Нет доступа к сохранённой папке. Выберите папку заново.");
    }
    this.directoryHandle = savedHandle;
    return loadProjectFromDirectory(savedHandle);
  }

  async listProfiles() {
    return [];
  }

  async selectProfile(_name: string): Promise<LoadedProject> {
    throw new Error("Профили доступны только в удалённом режиме");
  }

  async createProfile(
    _name: string,
    _project: LoadedProject,
  ): Promise<LoadedProject> {
    throw new Error("Профили доступны только в удалённом режиме");
  }

  async load() {
    const handle = await this.ensureDirectoryAccess();
    return loadProjectFromDirectory(handle);
  }

  async save(payload: ProjectSavePayload) {
    const handle = await this.ensureDirectoryAccess();
    for (const name of payload.deletedNames ?? []) {
      try {
        await handle.removeEntry(`${name}.json`);
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "NotFoundError") {
          throw error;
        }
      }
    }
    await exportProjectFiles(
      handle,
      payload.framedata,
      payload.animations,
      payload.selectedNames,
    );
  }

  async deleteState(name: string) {
    const handle = await this.ensureDirectoryAccess();
    try {
      await handle.removeEntry(`${name}.json`);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") {
        throw error;
      }
    }

    const project = await loadProjectFromDirectory(handle);
    delete project.animations[name];
    await exportProjectFiles(handle, {}, project.animations, []);
  }

  private async ensureDirectoryAccess() {
    const savedHandle = this.directoryHandle ?? await loadDirectoryHandle();
    if (savedHandle) {
      try {
        if (await requestDirectoryPermission(savedHandle)) {
          this.directoryHandle = savedHandle;
          return savedHandle;
        }
      } catch {
        // A stale handle is replaced through the directory picker below.
      }
    }

    const handle = await pickProjectDirectory();
    if (!(await requestDirectoryPermission(handle))) {
      throw new Error("Нет доступа к выбранной папке");
    }
    await saveDirectoryHandle(handle);
    this.directoryHandle = handle;
    return handle;
  }
}

const cloneProject = (project: LoadedProject): LoadedProject =>
  JSON.parse(JSON.stringify(project)) as LoadedProject;

const ACTIVE_PROFILE_STORAGE_KEY = "fighting-collider-editor.active-profile";

const loadStoredProfileName = () =>
  window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY)?.trim() || null;

const storeActiveProfileName = (name: string) => {
  window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, name);
};

const clearStoredProfileName = () => {
  window.localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseProfileProject = (value: unknown, profileName: string): LoadedProject => {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new Error(`Профиль «${profileName}» содержит некорректный JSON`);
    }
  }

  if (!isRecord(parsed) || !isRecord(parsed.framedata)) {
    throw new Error(
      `Профиль «${profileName}» должен содержать объект framedata`,
    );
  }

  return {
    framedata: parsed.framedata as Record<string, SerializedStateData>,
    animations: parseStateToAnimation(parsed.animations),
  };
};

class RemoteProjectStorage implements ProjectStorageAdapter {
  readonly mode = "remote" as const;
  private profiles = new Map<string, LoadedProject>();
  private activeProfileName: string | null = null;

  async initialize(): Promise<ProjectStorageInitialization> {
    const profiles = await this.listProfiles();
    const storedProfileName = loadStoredProfileName();
    const storedProfile = storedProfileName
      ? profiles.find((profile) => profile.name === storedProfileName)
      : null;

    if (!storedProfile) {
      if (storedProfileName) clearStoredProfileName();
      this.activeProfileName = null;
      return {
        hasSavedConnection: true,
        project: null,
        profiles,
        activeProfileName: null,
      };
    }

    this.activeProfileName = storedProfile.name;
    return {
      hasSavedConnection: true,
      project: cloneProject(storedProfile.project),
      profiles,
      activeProfileName: storedProfile.name,
    };
  }

  connect() {
    if (!this.activeProfileName) {
      return Promise.reject(new Error("Сначала выберите профиль"));
    }
    return this.load();
  }

  reconnect() {
    return this.connect();
  }

  async listProfiles(): Promise<ProjectProfile[]> {
    const { profilesUrl, credentials } = projectStorageConfig.remote;
    if (!profilesUrl) {
      throw new Error("Не задан VITE_FRAMEDATA_CDN_BASE_URL");
    }

    const response = await fetch(profilesUrl, {
      cache: "no-store",
      credentials,
    });
    if (!response.ok) {
      throw new Error(`Не удалось загрузить профили: ${response.status}`);
    }

    const raw = await response.json() as unknown;
    if (!isRecord(raw)) {
      throw new Error("Сервер профилей должен вернуть JSON-объект");
    }

    this.profiles.clear();
    Object.entries(raw).forEach(([name, value]) => {
      this.profiles.set(name, parseProfileProject(value, name));
    });

    return [...this.profiles.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, project]) => ({ name, project: cloneProject(project) }));
  }

  async selectProfile(name: string): Promise<LoadedProject> {
    if (!this.profiles.has(name)) await this.listProfiles();
    const project = this.profiles.get(name);
    if (!project) throw new Error(`Профиль «${name}» не найден`);

    this.activeProfileName = name;
    storeActiveProfileName(name);
    return cloneProject(project);
  }

  async createProfile(name: string, project: LoadedProject): Promise<LoadedProject> {
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error("Введите название профиля");

    await this.listProfiles();
    const duplicate = [...this.profiles.keys()].find(
      (profileName) => profileName.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
    );
    if (duplicate) throw new Error(`Профиль «${duplicate}» уже существует`);

    const normalizedProject = cloneProject(project);
    await this.writeProfile(normalizedName, normalizedProject);
    this.profiles.set(normalizedName, normalizedProject);
    this.activeProfileName = normalizedName;
    storeActiveProfileName(normalizedName);
    return cloneProject(normalizedProject);
  }

  async load(): Promise<LoadedProject> {
    const profileName = this.activeProfileName;
    if (!profileName) throw new Error("Профиль не выбран");

    await this.listProfiles();
    const project = this.profiles.get(profileName);
    if (!project) throw new Error(`Профиль «${profileName}» больше не существует`);
    return cloneProject(project);
  }

  async save(payload: ProjectSavePayload) {
    const profileName = this.activeProfileName;
    if (!profileName) throw new Error("Профиль не выбран");

    await this.listProfiles();
    const current = this.profiles.get(profileName);
    if (!current) throw new Error(`Профиль «${profileName}» больше не существует`);

    const next = cloneProject(current);
    (payload.deletedNames ?? []).forEach((name) => {
      delete next.framedata[name];
      delete next.animations[name];
    });
    payload.selectedNames.forEach((name) => {
      const framedata = payload.framedata[name];
      if (framedata) next.framedata[name] = framedata;

      const animation = payload.animations[name];
      if (animation) next.animations[name] = animation;
    });

    await this.writeProfile(profileName, next);
    this.profiles.set(profileName, next);
  }

  async deleteState(name: string) {
    const profileName = this.activeProfileName;
    if (!profileName) throw new Error("Профиль не выбран");

    await this.listProfiles();
    const current = this.profiles.get(profileName);
    if (!current) throw new Error(`Профиль «${profileName}» больше не существует`);

    const next = cloneProject(current);
    delete next.framedata[name];
    delete next.animations[name];
    await this.writeProfile(profileName, next);
    this.profiles.set(profileName, next);
  }

  private async writeProfile(name: string, project: LoadedProject) {
    const { saveUrl, slug, credentials } = projectStorageConfig.remote;
    if (!saveUrl) {
      throw new Error("Не задан VITE_FRAMEDATA_SAVE_URL для сохранения профиля");
    }

    const response = await fetch(saveUrl, {
      method: "POST",
      credentials,
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify({ value: project, key: name, slug }),
    });
    if (!response.ok) {
      throw new Error(`Сервер сохранения профиля вернул ${response.status}`);
    }
  }
}

export const projectStorage: ProjectStorageAdapter =
  projectStorageConfig.mode === "remote"
    ? new RemoteProjectStorage()
    : new LocalFolderProjectStorage();
