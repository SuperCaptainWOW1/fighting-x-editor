import { computed, reactive, ref } from "vue";
import {
  clearDraftStore,
  loadDraftStore,
  saveDraftStore,
  type DraftEntryPayload,
  type DraftStore,
  type LoadedProject,
} from "../services/projectFiles";
import {
  projectStorage,
  type ProjectProfile,
} from "../services/projectStorage";
import type {
  EditorBoxBase,
  EditorStateData,
  FrameDataEntry,
  StateCategoryId,
  StateAnimationConfig,
  StateToAnimationData,
} from "../types/framedata";
import {
  createBoxId,
  createSnapshot,
  deserializeStateData,
  resetBoxIdCounter,
  serializeStateData,
} from "../utils/framedata";

const EMPTY_ANIMATIONS: StateAnimationConfig = { left: "", right: "" };

const createEntry = (
  name: string,
  data: EditorStateData,
): FrameDataEntry => {
  const snapshot = createSnapshot(data);

  return {
    name,
    data,
    savedSnapshot: snapshot,
    isDirty: false,
  };
};

const markDirty = (entry: FrameDataEntry) => {
  const snapshot = createSnapshot(entry.data);
  entry.isDirty =
    state.addedStateNames.includes(entry.name) ||
    snapshot !== entry.savedSnapshot;
};

const state = reactive({
  entries: {} as Record<string, FrameDataEntry>,
  animations: {} as StateToAnimationData,
  currentName: null as string | null,
  activeProfileName: null as string | null,
  profiles: [] as ProjectProfile[],
  addedStateNames: [] as string[],
  deletedEntries: {} as Record<string, FrameDataEntry>,
  isProjectOpen: false,
  isBootstrapped: false,
  storageMode: projectStorage.mode,
  hasSavedConnection: false,
  initError: null as string | null,
  emptyDirectoryMessage: null as string | null,
});

const MAX_HISTORY_LENGTH = 100;

interface EntryHistory {
  undo: EditorStateData[];
  redo: EditorStateData[];
}

interface HistoryTransaction {
  entryName: string;
  before: EditorStateData;
}

const histories = new Map<string, EntryHistory>();
let activeHistoryTransaction: HistoryTransaction | null = null;

// Editor state is persisted as JSON. Serializing it before cloning also unwraps
// nested Vue proxies, which `toRaw()` does not do recursively.
const cloneEditorState = (data: EditorStateData): EditorStateData =>
  JSON.parse(JSON.stringify(data)) as EditorStateData;
const editorStatesEqual = (left: EditorStateData, right: EditorStateData) =>
  JSON.stringify(left) === JSON.stringify(right);

const getEntryHistory = (entryName: string) => {
  let history = histories.get(entryName);

  if (!history) {
    history = { undo: [], redo: [] };
    histories.set(entryName, history);
  }

  return history;
};

const pushHistorySnapshot = (
  stack: EditorStateData[],
  snapshot: EditorStateData,
) => {
  stack.push(snapshot);
  if (stack.length > MAX_HISTORY_LENGTH) stack.shift();
};

const applyEntryData = (entry: FrameDataEntry, data: EditorStateData) => {
  entry.data = cloneEditorState(data);
  markDirty(entry);
  state.animations[entry.name] = entry.data.animations;
  persistDrafts();
};

const commitHistoryTransaction = () => {
  const transaction = activeHistoryTransaction;
  activeHistoryTransaction = null;
  if (!transaction) return;

  const entry = state.entries[transaction.entryName];
  if (!entry || editorStatesEqual(transaction.before, entry.data)) return;

  const history = getEntryHistory(transaction.entryName);
  pushHistorySnapshot(history.undo, transaction.before);
  history.redo = [];
};

const clearHistory = (entryName?: string) => {
  if (entryName) {
    histories.delete(entryName);
    if (activeHistoryTransaction?.entryName === entryName) {
      activeHistoryTransaction = null;
    }
    return;
  }

  histories.clear();
  activeHistoryTransaction = null;
};

const getDraftScope = () => {
  if (state.storageMode === "local") return "local";
  return state.activeProfileName
    ? `profile:${state.activeProfileName}`
    : null;
};

const serializeDraftEntry = (entry: FrameDataEntry): DraftEntryPayload => ({
  data: serializeStateData(entry.data),
  animations: entry.data.animations,
  savedSnapshot: entry.savedSnapshot,
  boxNames: [
    ...entry.data.boxes.filter((box) => box.kind === "hurtbox"),
    ...entry.data.boxes.filter((box) => box.kind === "hitbox"),
  ].map((box) => box.name),
});

const deserializeDraftEntry = (
  name: string,
  payload: DraftEntryPayload,
) => {
  const editorData = deserializeStateData(payload.data, payload.animations);
  payload.boxNames?.forEach((boxName, index) => {
    if (boxName && editorData.boxes[index]) {
      editorData.boxes[index].name = boxName;
    }
  });
  const entry = createEntry(name, editorData);
  entry.savedSnapshot = payload.savedSnapshot ?? entry.savedSnapshot;
  return entry;
};

const persistDrafts = () => {
  const scope = getDraftScope();
  if (!scope || !state.isProjectOpen) return;

  const draft: DraftStore = {
    animations: state.animations,
    entries: Object.fromEntries(
      Object.entries(state.entries).map(([name, entry]) => [
        name,
        serializeDraftEntry(entry),
      ]),
    ),
    addedStateNames: [...state.addedStateNames],
    deletedEntries: Object.fromEntries(
      Object.entries(state.deletedEntries).map(([name, entry]) => [
        name,
        serializeDraftEntry(entry),
      ]),
    ),
  };

  saveDraftStore(draft, scope);
};

const applyLoadedProject = (
  framedata: Record<string, import("../types/framedata").SerializedStateData>,
  animations: StateToAnimationData,
) => {
  clearHistory();
  resetBoxIdCounter();
  state.animations = animations;
  state.entries = {};
  state.addedStateNames = [];
  state.deletedEntries = {};

  Object.entries(framedata).forEach(([name, serialized]) => {
    const animationConfig = animations[name] ?? EMPTY_ANIMATIONS;
    const editorData = deserializeStateData(serialized, animationConfig);
    state.entries[name] = createEntry(name, editorData);
  });
};

const restoreDraftsIfPresent = () => {
  const scope = getDraftScope();
  if (!scope) return false;
  const drafts = loadDraftStore(scope);

  if (!drafts) {
    return false;
  }

  const hasLoadedDiskProject = Object.keys(state.entries).length > 0;
  const addedStateNames = new Set(drafts.addedStateNames ?? []);

  Object.entries(drafts.deletedEntries ?? {}).forEach(([name, payload]) => {
    const diskEntry = state.entries[name];
    if (
      !diskEntry ||
      !payload.savedSnapshot ||
      payload.savedSnapshot !== diskEntry.savedSnapshot
    ) {
      return;
    }

    const deletedEntry = deserializeDraftEntry(name, payload);
    deletedEntry.savedSnapshot = diskEntry.savedSnapshot;
    deletedEntry.isDirty = true;
    state.deletedEntries[name] = deletedEntry;
    delete state.entries[name];
    delete state.animations[name];
  });

  if (!hasLoadedDiskProject) {
    resetBoxIdCounter();
  }

  if (!hasLoadedDiskProject) {
    state.animations = {
      ...state.animations,
      ...drafts.animations,
    };
  }

  Object.entries(drafts.entries).forEach(([name, payload]) => {
    const diskEntry = state.entries[name];
    const isAddedState = addedStateNames.has(name);

    if (isAddedState) {
      if (diskEntry) return;
    } else {
      // State files can be renamed or split outside the editor. Never resurrect
      // removed states or apply a draft created from an older disk baseline to a
      // newly migrated state with the same name.
      if (
        hasLoadedDiskProject &&
        (!diskEntry ||
          !payload.savedSnapshot ||
          payload.savedSnapshot !== diskEntry.savedSnapshot)
      ) {
        return;
      }
    }

    const restoredEntry = deserializeDraftEntry(name, payload);
    restoredEntry.savedSnapshot =
      diskEntry?.savedSnapshot ??
      payload.savedSnapshot ??
      restoredEntry.savedSnapshot;
    if (isAddedState) state.addedStateNames.push(name);
    markDirty(restoredEntry);
    state.entries[name] = restoredEntry;
    state.animations[name] = restoredEntry.data.animations;
  });

  return true;
};

const applyProject = (project: LoadedProject, allowEmpty = false) => {
  applyLoadedProject(project.framedata, project.animations);

  if (Object.keys(state.entries).length === 0) {
    state.emptyDirectoryMessage = allowEmpty
      ? null
      : "В выбранной папке не найдено JSON-фреймдат. Выберите папку framedata из проекта fighting.";
    state.isProjectOpen = allowEmpty;
  } else {
    state.emptyDirectoryMessage = null;
    state.isProjectOpen = true;
  }
};

export const useProject = () => {
  const exportSelection = ref<string[]>([]);

  const entryList = computed(() =>
    Object.values(state.entries).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  );

  const deletedEntryList = computed(() =>
    Object.values(state.deletedEntries).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  );

  const profileStructureChanges = computed(() => ({
    added: [...state.addedStateNames].sort((left, right) => left.localeCompare(right)),
    deleted: Object.keys(state.deletedEntries).sort((left, right) => left.localeCompare(right)),
  }));

  const hasProject = computed(() => state.isProjectOpen);

  const currentEntry = computed(() =>
    state.currentName ? state.entries[state.currentName] ?? null : null,
  );

  const initialize = async () => {
    state.initError = null;

    try {
      const initialization = await projectStorage.initialize();
      state.hasSavedConnection = initialization.hasSavedConnection;
      state.profiles = initialization.profiles;
      state.activeProfileName = initialization.activeProfileName;
      if (initialization.project) {
        applyProject(
          initialization.project,
          state.storageMode === "remote",
        );
        restoreDraftsIfPresent();
      }

    } catch (error) {
      state.initError =
        error instanceof Error
          ? error.message
          : "Не удалось загрузить сохранённый проект";
    } finally {
      state.isBootstrapped = true;
    }
  };

  const connectProjectSource = async () => {
    state.initError = null;
    state.emptyDirectoryMessage = null;

    const project = await projectStorage.connect();
    state.hasSavedConnection = true;
    applyProject(project);
    persistDrafts();

    if (!hasProject.value) {
      throw new Error(
        state.emptyDirectoryMessage ??
          "Источник не вернул JSON-фреймдату",
      );
    }
  };

  const selectProjectProfile = async (name: string) => {
    state.initError = null;
    state.emptyDirectoryMessage = null;

    const project = await projectStorage.selectProfile(name);
    state.activeProfileName = name;
    applyProject(project, true);
    restoreDraftsIfPresent();
  };

  const createProjectProfile = async (
    name: string,
    sourceProfileName: string | null,
    selectedStateNames: string[],
  ) => {
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error("Введите название профиля");

    const sourceProfile = sourceProfileName
      ? state.profiles.find((profile) => profile.name === sourceProfileName)
      : null;
    if (sourceProfileName && !sourceProfile) {
      throw new Error(`Профиль «${sourceProfileName}» не найден`);
    }

    const selectedNames = new Set(selectedStateNames);
    const project: LoadedProject = sourceProfile
      ? {
          framedata: Object.fromEntries(
            Object.entries(sourceProfile.project.framedata)
              .filter(([stateName]) => selectedNames.has(stateName)),
          ),
          animations: Object.fromEntries(
            Object.entries(sourceProfile.project.animations)
              .filter(([stateName]) => selectedNames.has(stateName)),
          ),
        }
      : { framedata: {}, animations: {} };

    const createdProject = await projectStorage.createProfile(
      normalizedName,
      project,
    );
    state.profiles = [
      ...state.profiles,
      { name: normalizedName, project: createdProject },
    ].sort((left, right) => left.name.localeCompare(right.name));
    state.activeProfileName = normalizedName;
    applyProject(createdProject, true);
  };

  const returnToProfileSelection = async () => {
    if (state.storageMode !== "remote") return;

    commitHistoryTransaction();
    persistDrafts();
    state.initError = null;

    clearHistory();
    state.currentName = null;
    state.entries = {};
    state.animations = {};
    state.isProjectOpen = false;

    try {
      state.profiles = await projectStorage.listProfiles();
    } catch (error) {
      state.initError =
        error instanceof Error
          ? error.message
          : "Не удалось обновить список профилей";
    }
  };

  const reconnectProjectSource = async () => {
    state.initError = null;
    state.emptyDirectoryMessage = null;

    const project = await projectStorage.reconnect();
    state.hasSavedConnection = true;
    applyProject(project);
    persistDrafts();

    if (!hasProject.value) {
      throw new Error(
        state.emptyDirectoryMessage ??
          "Источник не вернул JSON-фреймдату",
      );
    }
  };

  const openEntry = (name: string) => {
    commitHistoryTransaction();
    state.currentName = name;
    exportSelection.value = [name];
  };

  const closeEntry = () => {
    commitHistoryTransaction();
    state.currentName = null;
  };

  const beginHistoryTransaction = () => {
    const entry = currentEntry.value;
    if (!entry) return;

    if (activeHistoryTransaction?.entryName === entry.name) return;
    commitHistoryTransaction();
    activeHistoryTransaction = {
      entryName: entry.name,
      before: cloneEditorState(entry.data),
    };
  };

  const endHistoryTransaction = () => {
    commitHistoryTransaction();
  };

  const createState = async (name: string, category: StateCategoryId) => {
    const normalizedName = name.trim().toUpperCase().replace(/\s+/g, "_");
    if (!normalizedName) throw new Error("Введите название состояния");
    if (!/^[A-Z0-9_]+$/.test(normalizedName)) {
      throw new Error("Название может содержать только латинские буквы, цифры и _");
    }

    const duplicate = Object.keys(state.entries).find(
      (entryName) => entryName.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
    );
    if (duplicate) throw new Error(`Состояние «${duplicate}» уже существует`);
    if (state.deletedEntries[normalizedName]) {
      throw new Error(
        `Состояние «${normalizedName}» помечено на удаление. Сначала сохраните или синхронизируйте профиль`,
      );
    }

    const data: EditorStateData = {
      category,
      duration: 10,
      boxes: [],
      blendFramesNumber: 0,
      animations: { left: "", right: "" },
    };
    state.addedStateNames.push(normalizedName);
    state.entries[normalizedName] = createEntry(normalizedName, data);
    state.animations[normalizedName] = data.animations;
    markDirty(state.entries[normalizedName]);
    persistDrafts();
    return normalizedName;
  };

  const deleteState = async (name: string) => {
    const entry = state.entries[name];
    if (!entry) throw new Error(`Состояние «${name}» не найдено`);

    if (state.addedStateNames.includes(name)) {
      state.addedStateNames = state.addedStateNames.filter(
        (stateName) => stateName !== name,
      );
    } else {
      entry.isDirty = true;
      state.deletedEntries[name] = entry;
    }
    delete state.entries[name];
    delete state.animations[name];
    clearHistory(name);
    if (state.currentName === name) state.currentName = null;
    exportSelection.value = exportSelection.value.filter((item) => item !== name);
    persistDrafts();
  };

  const restoreLastDeletedState = async () => {
    const deletedNames = Object.keys(state.deletedEntries);
    const name = deletedNames[deletedNames.length - 1];
    if (!name) return null;

    const project = await projectStorage.load();
    const serialized = project.framedata[name];
    if (!serialized) {
      throw new Error(
        `Состояние «${name}» больше не найдено в выбранном профиле`,
      );
    }

    const animationConfig = project.animations[name] ?? EMPTY_ANIMATIONS;
    const editorData = deserializeStateData(serialized, animationConfig);
    state.entries[name] = createEntry(name, editorData);
    state.animations[name] = editorData.animations;
    delete state.deletedEntries[name];
    clearHistory(name);
    persistDrafts();
    return name;
  };

  const updateCurrentEntry = (updater: (data: EditorStateData) => void) => {
    const entry = currentEntry.value;

    if (!entry) {
      return;
    }

    if (
      activeHistoryTransaction &&
      activeHistoryTransaction.entryName !== entry.name
    ) {
      commitHistoryTransaction();
    }

    const isInTransaction =
      activeHistoryTransaction?.entryName === entry.name;
    const before = isInTransaction ? null : cloneEditorState(entry.data);

    updater(entry.data);
    if (before && editorStatesEqual(before, entry.data)) return;

    if (before) {
      const history = getEntryHistory(entry.name);
      pushHistorySnapshot(history.undo, before);
      history.redo = [];
    }

    markDirty(entry);
    state.animations[entry.name] = entry.data.animations;
    persistDrafts();
  };

  const undo = () => {
    commitHistoryTransaction();
    const entry = currentEntry.value;
    if (!entry) return false;

    const history = getEntryHistory(entry.name);
    const previous = history.undo.pop();
    if (!previous) return false;

    pushHistorySnapshot(history.redo, cloneEditorState(entry.data));
    applyEntryData(entry, previous);
    return true;
  };

  const redo = () => {
    commitHistoryTransaction();
    const entry = currentEntry.value;
    if (!entry) return false;

    const history = getEntryHistory(entry.name);
    const next = history.redo.pop();
    if (!next) return false;

    pushHistorySnapshot(history.undo, cloneEditorState(entry.data));
    applyEntryData(entry, next);
    return true;
  };

  const addBox = (box: Omit<EditorBoxBase, "id">) => {
    const id = createBoxId();
    updateCurrentEntry((data) => {
      data.boxes.push({ ...box, id });
    });
    return id;
  };

  const updateBox = (boxId: string, updater: (box: EditorBoxBase) => void) => {
    updateCurrentEntry((data) => {
      const box = data.boxes.find((item) => item.id === boxId);

      if (!box) {
        return;
      }

      updater(box);
    });
  };

  const removeBox = (boxId: string) => {
    updateCurrentEntry((data) => {
      data.boxes = data.boxes.filter((box) => box.id !== boxId);
    });
  };

  const synchronizeCurrentEntry = async () => {
    const entry = currentEntry.value;

    if (!entry) {
      throw new Error("Состояние не выбрано");
    }

    const project = await projectStorage.load();
    const serialized = project.framedata[entry.name];

    if (!serialized) {
      throw new Error(`В выбранной папке не найден файл ${entry.name}.json`);
    }

    const animationConfig = project.animations[entry.name] ?? {
      left: "",
      right: "",
    };
    const editorData = deserializeStateData(serialized, animationConfig);

    state.entries[entry.name] = createEntry(entry.name, editorData);
    state.animations[entry.name] = editorData.animations;
    clearHistory(entry.name);
    persistDrafts();
  };

  const synchronizeAllEntries = async () => {
    const project = await projectStorage.load();
    applyLoadedProject(project.framedata, project.animations);
    state.currentName = null;
    persistDrafts();
  };

  const exportSelected = async (
    names: string[],
    includeDeletedStates = false,
  ) => {
    const framedata = Object.fromEntries(
      names
        .map((name) => state.entries[name])
        .filter((entry): entry is FrameDataEntry => Boolean(entry))
        .map((entry) => [entry.name, serializeStateData(entry.data)]),
    );

    await projectStorage.save({
      framedata,
      animations: state.animations,
      selectedNames: names,
      deletedNames: includeDeletedStates
        ? Object.keys(state.deletedEntries)
        : [],
    });

    names.forEach((name) => {
      const entry = state.entries[name];

      if (!entry) {
        return;
      }

      entry.savedSnapshot = createSnapshot(entry.data);
      entry.isDirty = false;
    });

    state.addedStateNames = state.addedStateNames.filter(
      (name) => !names.includes(name),
    );
    if (includeDeletedStates) state.deletedEntries = {};

    const draftScope = getDraftScope();
    if (draftScope) clearDraftStore(draftScope);
    persistDrafts();
  };

  const prepareExportSelection = (defaultNames: string[]) => {
    exportSelection.value = [...defaultNames];
  };

  const toggleExportName = (name: string, enabled: boolean) => {
    if (enabled) {
      if (!exportSelection.value.includes(name)) {
        exportSelection.value.push(name);
      }
      return;
    }

    exportSelection.value = exportSelection.value.filter((item) => item !== name);
  };

  return {
    state,
    entryList,
    deletedEntryList,
    profileStructureChanges,
    hasProject,
    currentEntry,
    exportSelection,
    initialize,
    connectProjectSource,
    reconnectProjectSource,
    selectProjectProfile,
    createProjectProfile,
    returnToProfileSelection,
    openEntry,
    closeEntry,
    beginHistoryTransaction,
    endHistoryTransaction,
    createState,
    deleteState,
    restoreLastDeletedState,
    undo,
    redo,
    updateCurrentEntry,
    addBox,
    updateBox,
    removeBox,
    synchronizeCurrentEntry,
    synchronizeAllEntries,
    exportSelected,
    prepareExportSelection,
    toggleExportName,
  };
};
