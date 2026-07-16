<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useProject } from "../composables/useProject";
import type {
  BoxPropertyUpdate,
  EditorBoxBase,
  EditorStateData,
  SerializedStateData,
  StateAnimationConfig,
} from "../types/framedata";
import type { ViewportEditMode } from "../types/viewport";
import { SharedPreviewRenderer } from "../three/SharedPreviewRenderer";
import {
  fitFrameWindow,
  getPresetData,
  normalizeStateAnimationConfig,
  serializeStateData,
} from "../utils/framedata";
import { getStateCategory } from "../utils/stateCategory";
import { handleDialogKeyboardShortcut } from "../utils/dialogKeyboard";
import BoxInspector from "./BoxInspector.vue";
import ExportPanel from "./ExportPanel.vue";
import PreviewCanvas from "./PreviewCanvas.vue";
import StateSettings from "./StateSettings.vue";
import ThemeToggle from "./ThemeToggle.vue";
import Timeline from "./Timeline.vue";

const {
  state,
  currentEntry,
  entryList,
  closeEntry,
  beginHistoryTransaction,
  endHistoryTransaction,
  undo,
  redo,
  updateCurrentEntry,
  updateBox,
  addBox,
  deleteState,
  synchronizeCurrentEntry,
  exportSelected,
  exportSelection,
  prepareExportSelection,
  toggleExportName,
} = useProject();
const router = useRouter();

const currentFrame = ref(1);
const selectedBoxIds = ref<string[]>([]);
const previewSide = ref<"left" | "right">("left");
const isPlaying = ref(false);
const showExport = ref(false);
const isExporting = ref(false);
const showSyncConfirmation = ref(false);
const isSynchronizing = ref(false);
const synchronizationError = ref<string | null>(null);
const showStateDeleteConfirmation = ref(false);
const isDeletingState = ref(false);
const stateDeleteError = ref<string | null>(null);
const deleteConfirmation = ref<{
  boxIds: string[];
  x: number;
  y: number;
} | null>(null);
const leftPanelCollapsed = ref(false);
const rightPanelCollapsed = ref(false);
const timelineCollapsed = ref(false);
const editorScreenRef = ref<HTMLElement | null>(null);
const leftPanelWidth = ref(276);
const rightPanelWidth = ref(292);
const timelineHeight = ref(300);
const fps = ref(10);
const viewportEditMode = ref<ViewportEditMode>("translate");
let viewportModeBeforeBoxSelect: Exclude<ViewportEditMode, "box-select"> = "translate";
const suppressViewportToolHover = ref(false);
const viewportZoom = ref(100);
const VIEWPORT_BASE_ZOOM = 1.2;
const clipNames = ref<string[]>([]);
let playTimer: number | null = null;
const FPS_STORAGE_KEY = "framedata-editor-fps";

type ResizablePanel = "left" | "right" | "timeline";

const COLLAPSED_SIDE_WIDTH = 36;
const COLLAPSED_TIMELINE_HEIGHT = 38;
const SIDE_PANEL_COLLAPSE_THRESHOLD = 82;
const TIMELINE_COLLAPSE_THRESHOLD = 62;
const SIDE_PANEL_MAX_WIDTH = 520;
const MIN_VIEWPORT_WIDTH = 320;
const MIN_VIEWPORT_HEIGHT = 150;
let activePanelResize: { panel: ResizablePanel; pointerId: number } | null = null;
let previousBodyCursor = "";
let previousBodyUserSelect = "";

const editorLayoutStyle = computed(() => ({
  "--left-panel-width": `${leftPanelCollapsed.value ? COLLAPSED_SIDE_WIDTH : leftPanelWidth.value}px`,
  "--right-panel-width": `${rightPanelCollapsed.value ? COLLAPSED_SIDE_WIDTH : rightPanelWidth.value}px`,
  "--timeline-panel-height": `${timelineCollapsed.value ? COLLAPSED_TIMELINE_HEIGHT : timelineHeight.value}px`,
}));

const getSidePanelMaxWidth = (
  panel: "left" | "right",
  rect: DOMRect,
) => {
  const otherWidth = panel === "left"
    ? (rightPanelCollapsed.value ? COLLAPSED_SIDE_WIDTH : rightPanelWidth.value)
    : (leftPanelCollapsed.value ? COLLAPSED_SIDE_WIDTH : leftPanelWidth.value);
  return Math.max(
    SIDE_PANEL_COLLAPSE_THRESHOLD,
    Math.min(SIDE_PANEL_MAX_WIDTH, rect.width - otherWidth - MIN_VIEWPORT_WIDTH),
  );
};

const getTimelineMaxHeight = (rect: DOMRect) =>
  Math.max(
    TIMELINE_COLLAPSE_THRESHOLD,
    rect.height - MIN_VIEWPORT_HEIGHT - 64,
  );

const updatePanelResize = (event: PointerEvent) => {
  const active = activePanelResize;
  const root = editorScreenRef.value;
  if (!active || !root || event.pointerId !== active.pointerId) return;

  const rect = root.getBoundingClientRect();
  if (active.panel === "left") {
    leftPanelWidth.value = Math.round(Math.min(
      getSidePanelMaxWidth("left", rect),
      Math.max(COLLAPSED_SIDE_WIDTH, event.clientX - rect.left),
    ));
  } else if (active.panel === "right") {
    rightPanelWidth.value = Math.round(Math.min(
      getSidePanelMaxWidth("right", rect),
      Math.max(COLLAPSED_SIDE_WIDTH, rect.right - event.clientX),
    ));
  } else {
    timelineHeight.value = Math.round(Math.min(
      getTimelineMaxHeight(rect),
      Math.max(COLLAPSED_TIMELINE_HEIGHT, rect.bottom - event.clientY),
    ));
  }
};

const finishPanelResize = (event?: PointerEvent) => {
  const active = activePanelResize;
  if (!active || (event && event.pointerId !== active.pointerId)) return;

  window.removeEventListener("pointermove", updatePanelResize);
  window.removeEventListener("pointerup", finishPanelResize);
  window.removeEventListener("pointercancel", finishPanelResize);
  document.body.style.cursor = previousBodyCursor;
  document.body.style.userSelect = previousBodyUserSelect;
  activePanelResize = null;

  if (active.panel === "left" && leftPanelWidth.value <= SIDE_PANEL_COLLAPSE_THRESHOLD) {
    leftPanelCollapsed.value = true;
  } else if (active.panel === "right" && rightPanelWidth.value <= SIDE_PANEL_COLLAPSE_THRESHOLD) {
    rightPanelCollapsed.value = true;
  } else if (active.panel === "timeline" && timelineHeight.value <= TIMELINE_COLLAPSE_THRESHOLD) {
    timelineCollapsed.value = true;
  }
};

const beginPanelResize = (event: PointerEvent, panel: ResizablePanel) => {
  if (event.button !== 0) return;
  event.preventDefault();
  finishPanelResize();
  activePanelResize = { panel, pointerId: event.pointerId };
  previousBodyCursor = document.body.style.cursor;
  previousBodyUserSelect = document.body.style.userSelect;
  document.body.style.cursor = panel === "timeline" ? "row-resize" : "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", updatePanelResize);
  window.addEventListener("pointerup", finishPanelResize);
  window.addEventListener("pointercancel", finishPanelResize);
};

const expandPanel = (panel: ResizablePanel) => {
  if (panel === "left") {
    leftPanelWidth.value = Math.max(220, leftPanelWidth.value);
    leftPanelCollapsed.value = false;
  } else if (panel === "right") {
    rightPanelWidth.value = Math.max(220, rightPanelWidth.value);
    rightPanelCollapsed.value = false;
  } else {
    timelineHeight.value = Math.max(180, timelineHeight.value);
    timelineCollapsed.value = false;
  }
  window.requestAnimationFrame(clampPanelSizes);
};

const clampPanelSizes = () => {
  const root = editorScreenRef.value;
  if (!root) return;
  const rect = root.getBoundingClientRect();
  leftPanelWidth.value = Math.min(leftPanelWidth.value, getSidePanelMaxWidth("left", rect));
  rightPanelWidth.value = Math.min(rightPanelWidth.value, getSidePanelMaxWidth("right", rect));
  timelineHeight.value = Math.min(timelineHeight.value, getTimelineMaxHeight(rect));
};

const activeClipName = computed(() => {
  const entry = currentEntry.value;
  if (!entry) return "";
  return entry.data.animations[previewSide.value] || "";
});
const currentStateCategory = computed(() =>
  getStateCategory(
    currentEntry.value?.name ?? "",
    currentEntry.value?.data.category,
  ),
);

const selectedBoxes = computed(() => {
  const boxes = currentEntry.value?.data.boxes ?? [];
  return selectedBoxIds.value
    .map((id) => boxes.find((box) => box.id === id))
    .filter((box): box is EditorBoxBase => Boolean(box));
});
const selectedBox = computed(
  () => selectedBoxes.value[selectedBoxes.value.length - 1] ?? null,
);

interface SavedSnapshotPayload {
  data: SerializedStateData;
  animations?: StateAnimationConfig;
}

const savedSnapshotPayload = computed<SavedSnapshotPayload | null>(() => {
  const entry = currentEntry.value;
  if (!entry) return null;

  try {
    const parsed = JSON.parse(entry.savedSnapshot) as
      | SavedSnapshotPayload
      | SerializedStateData;

    if ("data" in parsed) {
      return {
        ...parsed,
        animations: parsed.animations
          ? normalizeStateAnimationConfig(parsed.animations)
          : undefined,
      };
    }
    return { data: parsed };
  } catch {
    return null;
  }
});

const stateSettingsChanges = computed<Record<string, boolean>>(() => {
  const current = currentEntry.value?.data;
  const saved = savedSnapshotPayload.value;
  if (!current || !saved) return {} as Record<string, boolean>;

  return {
    duration: current.duration !== saved.data.duration,
    blendFramesNumber:
      current.blendFramesNumber !== saved.data.blendFramesNumber,
    loop: Boolean(current.loop) !== Boolean(saved.data.loop),
    lockWhenFinished:
      Boolean(current.lockWhenFinished) !==
      Boolean(saved.data.lockWhenFinished),
    cancelWindow:
      JSON.stringify(current.cancelWindow) !==
      JSON.stringify(saved.data.cancelWindow),
    animations: saved.animations
      ? JSON.stringify(current.animations[previewSide.value]) !==
        JSON.stringify(saved.animations[previewSide.value])
      : false,
  };
});

interface ColliderMatch {
  currentIndex: number | null;
  savedIndex: number | null;
}

const getColliderMatches = (
  currentBoxes: object[],
  savedBoxes: object[],
): ColliderMatch[] => {
  const matches: ColliderMatch[] = [];
  const unmatchedCurrent = new Set(currentBoxes.map((_, index) => index));
  const unmatchedSaved = new Set(savedBoxes.map((_, index) => index));
  const getName = (box: object) => (box as { name?: string }).name;

  // Names are persisted and are the stable identity for normal edits and
  // deletions. Match them before looking at array positions.
  savedBoxes.forEach((savedBox, savedIndex) => {
    const savedName = getName(savedBox);
    if (!savedName) return;
    const currentIndex = [...unmatchedCurrent].find(
      (index) => getName(currentBoxes[index]!) === savedName,
    );
    if (currentIndex === undefined) return;
    matches.push({ currentIndex, savedIndex });
    unmatchedCurrent.delete(currentIndex);
    unmatchedSaved.delete(savedIndex);
  });

  // A renamed collider no longer has a matching name. Pair the remaining
  // candidates by their unchanged properties so a rename is still shown as a
  // field edit instead of an add + delete operation.
  const identityFields = [
    "frames", "preset", "size", "position", "type", "damage",
  ];
  const candidates = [...unmatchedCurrent].flatMap((currentIndex) =>
    [...unmatchedSaved].map((savedIndex) => {
      const current = currentBoxes[currentIndex] as Record<string, unknown>;
      const saved = savedBoxes[savedIndex] as Record<string, unknown>;
      const equalFields = identityFields.reduce(
        (score, field) => score + (valuesDiffer(current[field], saved[field]) ? 0 : 1),
        0,
      );
      return {
        currentIndex,
        savedIndex,
        score: equalFields - Math.abs(currentIndex - savedIndex) / 100,
      };
    }),
  ).sort((left, right) => right.score - left.score);

  candidates.forEach(({ currentIndex, savedIndex }) => {
    if (!unmatchedCurrent.has(currentIndex) || !unmatchedSaved.has(savedIndex)) return;
    matches.push({ currentIndex, savedIndex });
    unmatchedCurrent.delete(currentIndex);
    unmatchedSaved.delete(savedIndex);
  });

  unmatchedSaved.forEach((savedIndex) => {
    matches.push({ currentIndex: null, savedIndex });
  });
  unmatchedCurrent.forEach((currentIndex) => {
    matches.push({ currentIndex, savedIndex: null });
  });

  return matches.sort((left, right) => {
    const leftOrder = left.savedIndex ?? savedBoxes.length + (left.currentIndex ?? 0);
    const rightOrder = right.savedIndex ?? savedBoxes.length + (right.currentIndex ?? 0);
    return leftOrder - rightOrder;
  });
};

const getSavedBox = (current: EditorBoxBase): EditorBoxBase | null => {
  const entry = currentEntry.value;
  const saved = savedSnapshotPayload.value?.data;
  if (!entry || !saved) return null;

  const kindIndex = entry.data.boxes
    .filter((box) => box.kind === current.kind)
    .findIndex((box) => box.id === current.id);
  if (kindIndex < 0) return null;

  const currentBoxes = serializeStateData(entry.data)[
    current.kind === "hurtbox" ? "hurtboxes" : "hitboxes"
  ];
  const savedBoxes = saved[
    current.kind === "hurtbox" ? "hurtboxes" : "hitboxes"
  ];
  const savedIndex = getColliderMatches(currentBoxes, savedBoxes)
    .find((match) => match.currentIndex === kindIndex)?.savedIndex;
  if (savedIndex === null || savedIndex === undefined) return null;

  if (current.kind === "hurtbox") {
    const window = saved.hurtboxes[savedIndex];
    if (!window) return null;
    const preset = window.preset ? getPresetData(window.preset) : null;
    return {
      id: "saved-box",
      name: window.name,
      kind: "hurtbox",
      frames: [...window.frames],
      preset: window.preset,
      size: preset
        ? [...preset.size]
        : [...(window.size ?? [0.5, 0.5, 0])],
      position: preset
        ? [...preset.position]
        : [...(window.position ?? [0, 1, 0])],
      type: preset?.type ?? window.type,
    };
  }

  const window = saved.hitboxes[savedIndex];
  if (!window) return null;
  return {
    id: "saved-box",
    name: window.name,
    kind: "hitbox",
    frames: [...window.frames],
    size: [...window.size],
    position: [...window.position],
    damage: window.damage,
  };
};

const boxInspectorChanges = computed<Record<string, boolean>>(() => {
  const changes: Record<string, boolean> = {};
  selectedBoxes.value.forEach((current) => {
    const saved = getSavedBox(current);
    const mark = (field: string, changed: boolean) => {
      changes[field] = Boolean(changes[field] || changed);
    };

    if (!saved) {
      [
        "frameStart", "frameEnd", "preset", "type", "size0", "size1",
        "size2", "position0", "position1", "position2", "damage",
      ].forEach((field) => mark(field, true));
      return;
    }

    mark("frameStart", current.frames[0] !== saved.frames[0]);
    mark("frameEnd", current.frames[1] !== saved.frames[1]);
    mark("preset", current.preset !== saved.preset);
    mark("type", current.type !== saved.type);
    [0, 1, 2].forEach((axis) => {
      mark(`size${axis}`, current.size[axis as 0 | 1 | 2] !== saved.size[axis as 0 | 1 | 2]);
      mark(`position${axis}`, current.position[axis as 0 | 1 | 2] !== saved.position[axis as 0 | 1 | 2]);
    });
    mark("damage", (current.damage ?? 0) !== (saved.damage ?? 0));
  });
  return changes;
});

const valuesDiffer = (left: unknown, right: unknown) =>
  JSON.stringify(left) !== JSON.stringify(right);

interface DirtyTooltipItem {
  label: string;
  before: string;
  after: string;
}

const formatDirtyValue = (value: unknown, field?: string) => {
  if (field === "preset" && value === undefined) return "Пользовательский";
  if (value === undefined || value === null) return "не задано";
  if (typeof value === "boolean") return value ? "включено" : "выключено";

  if (Array.isArray(value)) {
    if (value.length === 0) return "пусто";
    return value.every((item) => typeof item === "string")
      ? value.join(", ")
      : `[${value.join(", ")}]`;
  }

  return String(value);
};

const formatColliderValue = (box: object) => {
  const value = box as Record<string, unknown>;
  const parts = [
    value.name ? `название ${formatDirtyValue(value.name)}` : null,
    value.frames ? `кадры ${formatDirtyValue(value.frames)}` : null,
    value.preset !== undefined
      ? `пресет ${formatDirtyValue(value.preset, "preset")}`
      : null,
    value.size ? `размер ${formatDirtyValue(value.size)}` : null,
    value.position ? `позиция ${formatDirtyValue(value.position)}` : null,
    value.damage !== undefined
      ? `урон ${formatDirtyValue(value.damage)}`
      : null,
  ].filter(Boolean);

  return parts.join("; ");
};

const dirtyTooltipItems = computed<DirtyTooltipItem[]>(() => {
  const entry = currentEntry.value;
  const saved = savedSnapshotPayload.value;
  if (!entry || !saved) return [];

  const current = serializeStateData(entry.data);
  const items: DirtyTooltipItem[] = [];
  const generalFields: Array<[
    keyof SerializedStateData,
    string,
  ]> = [
    ["duration", "Длительность"],
    ["blendFramesNumber", "Длительность бленда"],
    ["loop", "Цикличное состояние"],
    ["lockWhenFinished", "Фиксировать в конце"],
    ["castFireballFrames", "Кадры запуска снаряда"],
    ["cancelWindow", "Окно комбо"],
  ];

  generalFields.forEach(([field, label]) => {
    if (valuesDiffer(current[field], saved.data[field])) {
      items.push({
        label,
        before: formatDirtyValue(saved.data[field], field),
        after: formatDirtyValue(current[field], field),
      });
    }
  });

  if (saved.animations) {
    if (
      valuesDiffer(entry.data.animations.left, saved.animations.left)
    ) {
      items.push({
        label: "Анимации левой стороны",
        before: formatDirtyValue(saved.animations.left),
        after: formatDirtyValue(entry.data.animations.left),
      });
    }
    if (
      valuesDiffer(entry.data.animations.right, saved.animations.right)
    ) {
      items.push({
        label: "Анимации правой стороны",
        before: formatDirtyValue(saved.animations.right),
        after: formatDirtyValue(entry.data.animations.right),
      });
    }
  }

  const collectColliderChanges = (
    kind: "hurtbox" | "hitbox",
    currentBoxes: object[],
    savedBoxes: object[],
  ) => {
    const prefix = kind === "hitbox" ? "Hitbox" : "Hurtbox";
    const fieldLabels: Record<string, string> = {
      name: "название",
      frames: "кадры",
      preset: "пресет",
      size: "размер",
      position: "позиция",
      type: "тип зоны",
      damage: "урон",
    };
    const matches = getColliderMatches(currentBoxes, savedBoxes);

    matches.forEach(({ currentIndex, savedIndex }) => {
      const currentBox = currentIndex === null ? undefined : currentBoxes[currentIndex];
      const savedBox = savedIndex === null ? undefined : savedBoxes[savedIndex];
      const currentName = currentBox
        ? (currentBox as { name?: string }).name
        : undefined;
      const savedName = savedBox
        ? (savedBox as { name?: string }).name
        : undefined;
      const fallbackIndex = currentIndex ?? savedIndex ?? 0;
      const name = currentName || savedName || `${prefix}_${fallbackIndex + 1}`;

      if (!savedBox && currentBox) {
        items.push({
          label: name,
          before: "отсутствовал",
          after: formatColliderValue(currentBox),
        });
        return;
      }
      if (savedBox && !currentBox) {
        items.push({
          label: name,
          before: formatColliderValue(savedBox),
          after: "удалён",
        });
        return;
      }
      if (!currentBox || !savedBox) return;

      Object.keys(fieldLabels).forEach((field) => {
        const currentValue = (currentBox as Record<string, unknown>)[field];
        const savedValue = (savedBox as Record<string, unknown>)[field];
        if (!valuesDiffer(currentValue, savedValue)) return;

        items.push({
          label: `${name} · ${fieldLabels[field]}`,
          before: formatDirtyValue(savedValue, field),
          after: formatDirtyValue(currentValue, field),
        });
      });
    });
  };

  collectColliderChanges(
    "hurtbox",
    current.hurtboxes,
    saved.data.hurtboxes,
  );
  collectColliderChanges(
    "hitbox",
    current.hitboxes,
    saved.data.hitboxes,
  );

  return items;
});

const getBoxName = (box: EditorBoxBase | null) => {
  if (!box || !currentEntry.value) return "";
  if (box.name) return box.name;
  const index = currentEntry.value.data.boxes
    .filter((candidate) => candidate.kind === box.kind)
    .findIndex((candidate) => candidate.id === box.id);
  return `${box.kind === "hitbox" ? "Hitbox" : "Hurtbox"}_${index + 1}`;
};

const selectedBoxName = computed(() => getBoxName(selectedBox.value));
const getColliderNoun = (count: number) => {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "коллайдеров";
  if (mod10 === 1) return "коллайдер";
  if (mod10 >= 2 && mod10 <= 4) return "коллайдера";
  return "коллайдеров";
};
const selectedBoxesTitle = computed(() => {
  const count = selectedBoxes.value.length;
  if (count <= 1) return selectedBoxName.value;
  return `${count} ${getColliderNoun(count)}`;
});
let lastPointerPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

const handlePointerPosition = (event: PointerEvent) => {
  lastPointerPosition = { x: event.clientX, y: event.clientY };
  suppressViewportToolHover.value = false;
};

const selectBoxes = (boxIds: string[], additive = false) => {
  const availableIds = new Set(
    currentEntry.value?.data.boxes.map((box) => box.id) ?? [],
  );
  const validIds = boxIds.filter((id) => availableIds.has(id));

  if (!additive) {
    selectedBoxIds.value = [...new Set(validIds)];
    return;
  }

  selectedBoxIds.value = [
    ...selectedBoxIds.value,
    ...validIds.filter((id) => !selectedBoxIds.value.includes(id)),
  ];
};

const selectTimelineBox = (
  boxId: string,
  additive: boolean,
  preserveGroup = false,
) => {
  if (preserveGroup && selectedBoxIds.value.includes(boxId)) return;
  selectBoxes([boxId], additive);
};

const requestBoxRemoval = (
  boxIds = selectedBoxIds.value,
  point = lastPointerPosition,
) => {
  const validIds = boxIds.filter((id) =>
    currentEntry.value?.data.boxes.some((box) => box.id === id),
  );
  if (validIds.length === 0) return;
  deleteConfirmation.value = {
    boxIds: [...new Set(validIds)],
    x: Math.min(window.innerWidth - 150, Math.max(50, point.x)),
    y: Math.min(window.innerHeight - 45, Math.max(70, point.y)),
  };
};

const confirmBoxRemoval = () => {
  const confirmation = deleteConfirmation.value;
  if (!confirmation) return;
  const ids = new Set(confirmation.boxIds);
  updateCurrentEntry((data) => {
    data.boxes = data.boxes.filter((box) => !ids.has(box.id));
  });
  selectedBoxIds.value = selectedBoxIds.value.filter((id) => !ids.has(id));
  deleteConfirmation.value = null;
};

const stopPlayback = () => {
  if (playTimer !== null) window.clearInterval(playTimer);
  playTimer = null;
  isPlaying.value = false;
};

const startPlayback = () => {
  if (playTimer !== null) return;
  isPlaying.value = true;
  playTimer = window.setInterval(() => {
    const entry = currentEntry.value;
    if (!entry) return stopPlayback();
    if (currentFrame.value >= entry.data.duration) {
      if (entry.data.loop) currentFrame.value = 1;
      else stopPlayback();
    } else currentFrame.value += 1;
  }, 1000 / fps.value);
};

const togglePlayback = () => {
  if (isPlaying.value) return stopPlayback();
  startPlayback();
};

const stepFrame = (direction: -1 | 1) => {
  stopPlayback();
  const duration = currentEntry.value?.data.duration ?? 1;
  currentFrame.value = Math.min(
    duration,
    Math.max(1, currentFrame.value + direction),
  );
};

const goToStart = () => {
  stopPlayback();
  currentFrame.value = 1;
};

const setViewportZoom = (value: number) => {
  viewportZoom.value = Math.min(250, Math.max(25, Math.round(value / 5) * 5));
};

const changeViewportZoom = (step: number) => {
  setViewportZoom(viewportZoom.value + step);
};

const handleViewportWheel = (event: WheelEvent) => {
  changeViewportZoom(event.deltaY < 0 ? 5 : -5);
};

const activateBoxSelect = () => {
  if (viewportEditMode.value !== "box-select") {
    viewportModeBeforeBoxSelect = viewportEditMode.value;
  }
  viewportEditMode.value = "box-select";
};

const finishBoxSelect = () => {
  if (viewportEditMode.value === "box-select") {
    viewportEditMode.value = viewportModeBeforeBoxSelect;
  }
};

const isTextEditingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const editable = target.closest<HTMLElement>(
    'input, textarea, [contenteditable]:not([contenteditable="false"])',
  );
  if (!editable) return false;
  if (editable instanceof HTMLTextAreaElement || editable.isContentEditable) return true;
  if (!(editable instanceof HTMLInputElement)) return false;
  return ["text", "search", "email", "url", "tel", "password"].includes(
    editable.type || "text",
  );
};

const releaseControlFocus = () => {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLElement &&
    activeElement !== document.body
  ) {
    activeElement.blur();
  }
};

const runHistoryAction = (action: () => boolean) => {
  stopPlayback();
  action();

  const entry = currentEntry.value;
  if (entry) {
    currentFrame.value = Math.min(currentFrame.value, entry.data.duration);
    const existingIds = new Set(entry.data.boxes.map((box) => box.id));
    selectedBoxIds.value = selectedBoxIds.value.filter((id) => existingIds.has(id));
  }

};

const handleKeyboardShortcut = (event: KeyboardEvent) => {
  const primaryModifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const isSaveShortcut =
    primaryModifier && !event.altKey && !event.shiftKey && key === "s";

  if (isSaveShortcut) {
    event.preventDefault();
    if (
      event.repeat ||
      showExport.value ||
      deleteConfirmation.value ||
      showSyncConfirmation.value ||
      showStateDeleteConfirmation.value
    ) {
      return;
    }
    releaseControlFocus();
    openExport();
    return;
  }

  if (deleteConfirmation.value) {
    handleDialogKeyboardShortcut(event, {
      confirm: confirmBoxRemoval,
      cancel: () => { deleteConfirmation.value = null; },
    });
    return;
  }

  if (showStateDeleteConfirmation.value) {
    handleDialogKeyboardShortcut(event, {
      confirm: confirmStateDeletion,
      cancel: () => { showStateDeleteConfirmation.value = false; },
      disabled: isDeletingState.value,
    });
    return;
  }

  if (showSyncConfirmation.value) {
    handleDialogKeyboardShortcut(event, {
      confirm: confirmSynchronization,
      cancel: () => { showSyncConfirmation.value = false; },
      disabled: isSynchronizing.value,
    });
    return;
  }

  if (showExport.value) {
    handleDialogKeyboardShortcut(event, {
      confirm: handleExport,
      cancel: () => { showExport.value = false; },
      disabled: isExporting.value,
    });
    return;
  }

  if (event.key === "Escape" && viewportEditMode.value === "box-select") {
    event.preventDefault();
    finishBoxSelect();
    return;
  }

  const isUndoShortcut = primaryModifier && !event.altKey && key === "z";
  const isRedoShortcut =
    primaryModifier &&
    !event.altKey &&
    (key === "y" || (key === "z" && event.shiftKey));

  if (
    !event.defaultPrevented &&
    !showExport.value &&
    !showSyncConfirmation.value &&
    (isUndoShortcut || isRedoShortcut)
  ) {
    event.preventDefault();
    releaseControlFocus();
    runHistoryAction(isRedoShortcut ? redo : undo);
    return;
  }

  if (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    showExport.value ||
    showSyncConfirmation.value
  ) {
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    releaseControlFocus();
    if (!event.repeat) {
      if (event.shiftKey) goToStart();
      else togglePlayback();
    }
    return;
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (isTextEditingTarget(event.target)) return;
    event.preventDefault();
    releaseControlFocus();
    stepFrame(event.key === "ArrowLeft" ? -1 : 1);
    return;
  }

  if (isTextEditingTarget(event.target)) return;

  if (event.code === "KeyX" && selectedBoxIds.value.length > 0) {
    event.preventDefault();
    releaseControlFocus();
    if (!event.repeat) requestBoxRemoval();
    return;
  }

  const viewportModeByKey: Partial<Record<string, ViewportEditMode>> = {
    KeyG: "translate",
    KeyS: "scale",
  };

  if (event.code === "KeyB") {
    event.preventDefault();
    releaseControlFocus();
    if (!event.repeat) activateBoxSelect();
    return;
  }
  const nextViewportMode = viewportModeByKey[event.code];

  if (nextViewportMode) {
    event.preventDefault();
    releaseControlFocus();
    if (!event.repeat) {
      suppressViewportToolHover.value = true;
      viewportEditMode.value = nextViewportMode;
    }
    return;
  }

};

const setFps = (nextFps: number) => {
  if (nextFps === fps.value) return;
  const shouldResume = isPlaying.value;
  stopPlayback();
  fps.value = nextFps;
  try {
    window.localStorage.setItem(FPS_STORAGE_KEY, String(nextFps));
  } catch {
    // The editor remains usable when browser storage is unavailable.
  }
  if (shouldResume) startPlayback();
};

const handleFpsInput = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value) || value < 1) return;
  setFps(Math.min(120, Math.max(1, Math.round(value))));
};

const handleFpsChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const nextFps = Math.min(120, Math.max(1, Math.round(Number(input.value) || 1)));
  setFps(nextFps);
  input.value = String(nextFps);
};

const handleLoopUpdate = (value: boolean) => {
  updateCurrentEntry((data: EditorStateData) => {
    data.loop = value;
    if (value) data.lockWhenFinished = false;
  });
};

const handleDurationUpdate = (value: number) => {
  updateCurrentEntry((data: EditorStateData) => {
    const previousDuration = data.duration;
    const nextDuration = Math.max(1, value);

    data.duration = nextDuration;
    if (data.cancelWindow) {
      data.cancelWindow = fitFrameWindow(data.cancelWindow, nextDuration);
    }
    data.boxes.forEach((box) => {
      const spansEntireAnimation =
        box.frames[0] === 1 && box.frames[1] === previousDuration;

      if (spansEntireAnimation) {
        box.frames = [1, nextDuration];
      } else {
        box.frames = fitFrameWindow(box.frames, nextDuration);
      }
    });
  });
};

const handleLockWhenFinishedUpdate = (value: boolean) => {
  updateCurrentEntry((data: EditorStateData) => {
    data.lockWhenFinished = value;
    if (value) data.loop = false;
  });
};

const handleAddBox = (kind: "hurtbox" | "hitbox") => {
  const prefix = kind === "hitbox" ? "Hitbox" : "Hurtbox";
  const nextNumber = (currentEntry.value?.data.boxes ?? [])
    .filter((box) => box.kind === kind)
    .reduce((highest, box) => {
      const match = box.name?.match(new RegExp(`^${prefix}_(\\d+)$`, "i"));
      return Math.max(highest, match ? Number(match[1]) : 0);
    }, 0) + 1;
  const id = addBox({
    name: `${prefix}_${nextNumber}`,
    kind,
    frames: [currentFrame.value, currentFrame.value],
    size: kind === "hitbox" ? [0.5, 0.3, 0] : [0.3, 0.3, 0],
    position: [0.7, 1.4, 0],
    damage: kind === "hitbox" ? 5 : undefined,
    type: kind === "hurtbox" ? "body" : undefined,
  });
  selectedBoxIds.value = [id];
};

const handleBoxUpdate = (boxId: string, patch: Partial<EditorBoxBase>) => {
  updateBox(boxId, (box) => Object.assign(box, patch));
};

const handleBoxesUpdate = (
  updates: Array<{ boxId: string; patch: Partial<EditorBoxBase> }>,
) => {
  const patchById = new Map(updates.map((update) => [update.boxId, update.patch]));
  updateCurrentEntry((data) => {
    data.boxes.forEach((box) => {
      const patch = patchById.get(box.id);
      if (patch) Object.assign(box, patch);
    });
  });
};

const handleSelectedBoxPropertyUpdate = (update: BoxPropertyUpdate) => {
  const selectedIds = new Set(selectedBoxIds.value);
  updateCurrentEntry((data) => {
    data.boxes.forEach((box) => {
      if (!selectedIds.has(box.id)) return;

      if (update.property === "frameStart") {
        const value = Math.min(
          box.frames[1],
          Math.max(1, Math.round(Number(update.value))),
        );
        box.frames = [value, box.frames[1]];
        return;
      }
      if (update.property === "frameEnd") {
        const value = Math.max(
          box.frames[0],
          Math.min(data.duration, Math.round(Number(update.value))),
        );
        box.frames = [box.frames[0], value];
        return;
      }
      if (update.property === "preset") {
        const presetName = update.value as EditorBoxBase["preset"];
        box.preset = presetName;
        if (presetName) {
          const preset = getPresetData(presetName);
          box.size = [...preset.size];
          box.position = [...preset.position];
          box.type = preset.type;
        }
        return;
      }
      if (update.property === "type") {
        box.type = update.value as EditorBoxBase["type"];
        return;
      }
      if (update.property === "damage") {
        box.damage = Math.max(0, Number(update.value));
        return;
      }
      if (
        (update.property === "size" || update.property === "position") &&
        update.axis !== undefined
      ) {
        const next = [...box[update.property]] as [number, number, number];
        next[update.axis] = update.property === "size"
          ? Math.max(0.01, Number(update.value))
          : Number(update.value);
        box[update.property] = next;
      }
    });
  });
};

const handleViewportBoxUpdate = (
  boxId: string,
  patch: Partial<EditorBoxBase>,
) => {
  const source = currentEntry.value?.data.boxes.find((box) => box.id === boxId);
  if (!source) return;
  const groupIds = selectedBoxIds.value.includes(boxId)
    ? new Set(selectedBoxIds.value)
    : new Set([boxId]);
  const positionDelta = patch.position
    ? patch.position.map((value, axis) => value - source.position[axis as 0 | 1 | 2])
    : null;
  const sizeDelta = patch.size
    ? patch.size.map((value, axis) => value - source.size[axis as 0 | 1 | 2])
    : null;

  updateCurrentEntry((data) => {
    data.boxes.forEach((box) => {
      if (!groupIds.has(box.id)) return;
      if (positionDelta) {
        box.position = box.position.map((value, axis) =>
          Number((value + positionDelta[axis]!).toFixed(2)),
        ) as [number, number, number];
      }
      if (sizeDelta) {
        box.size = box.size.map((value, axis) =>
          Number(Math.max(0.01, value + sizeDelta[axis]!).toFixed(2)),
        ) as [number, number, number];
      }
      if ((positionDelta || sizeDelta) && box.preset) box.preset = undefined;
    });
  });
};

const openExport = () => {
  if (!currentEntry.value) return;
  prepareExportSelection([currentEntry.value.name]);
  showExport.value = true;
};

const handleExport = async () => {
  if (isExporting.value) return;
  isExporting.value = true;
  try {
    await exportSelected(exportSelection.value);
    showExport.value = false;
  } finally {
    isExporting.value = false;
  }
};

const openSynchronizationConfirmation = () => {
  synchronizationError.value = null;
  showSyncConfirmation.value = true;
};

const confirmSynchronization = async () => {
  isSynchronizing.value = true;
  synchronizationError.value = null;

  try {
    await synchronizeCurrentEntry();
    selectedBoxIds.value = [];
    currentFrame.value = Math.min(
      currentFrame.value,
      currentEntry.value?.data.duration ?? 1,
    );
    showSyncConfirmation.value = false;
  } catch (error) {
    synchronizationError.value =
      error instanceof Error ? error.message : "Не удалось синхронизировать состояние";
  } finally {
    isSynchronizing.value = false;
  }
};

const openStateDeleteConfirmation = () => {
  stateDeleteError.value = null;
  showStateDeleteConfirmation.value = true;
};

const confirmStateDeletion = async () => {
  const name = currentEntry.value?.name;
  if (!name) return;
  isDeletingState.value = true;
  stateDeleteError.value = null;
  try {
    await deleteState(name);
    showStateDeleteConfirmation.value = false;
    await router.replace({ name: "home" });
  } catch (error) {
    stateDeleteError.value =
      error instanceof Error ? error.message : "Не удалось удалить состояние";
  } finally {
    isDeletingState.value = false;
  }
};

onMounted(async () => {
  try {
    const storedFps = Number(window.localStorage.getItem(FPS_STORAGE_KEY));
    if (Number.isFinite(storedFps) && storedFps >= 1) {
      fps.value = Math.min(120, Math.max(1, Math.round(storedFps)));
    }
  } catch {
    // Keep the default FPS when browser storage is unavailable.
  }
  window.addEventListener("keydown", handleKeyboardShortcut, true);
  window.addEventListener("pointermove", handlePointerPosition, { passive: true });
  window.addEventListener("resize", clampPanelSizes, { passive: true });
  const compactLayout = window.matchMedia("(max-width: 1100px)").matches;
  leftPanelCollapsed.value = compactLayout;
  rightPanelCollapsed.value = compactLayout;
  clampPanelSizes();
  const preview = SharedPreviewRenderer.getInstance();
  await preview.init();
  clipNames.value = preview.getClipNames();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeyboardShortcut, true);
  window.removeEventListener("pointermove", handlePointerPosition);
  window.removeEventListener("resize", clampPanelSizes);
  finishPanelResize();
  endHistoryTransaction();
  stopPlayback();
});

watch(
  () => currentEntry.value?.data.duration,
  (duration) => {
    if (duration) currentFrame.value = Math.min(currentFrame.value, duration);
  },
);
</script>

<template>
  <section
    v-if="currentEntry"
    ref="editorScreenRef"
    class="editor-screen"
    :style="editorLayoutStyle"
    :class="{
      'editor-screen--left-panel-collapsed': leftPanelCollapsed,
      'editor-screen--right-panel-collapsed': rightPanelCollapsed,
      'editor-screen--timeline-collapsed': timelineCollapsed,
      [`editor-screen--category-${currentStateCategory.id}`]: true,
    }"
  >
    <header class="editor-screen__topbar">
      <div class="state-identity">
        <RouterLink class="icon-button" :to="{ name: 'home' }" title="К списку состояний" @click="closeEntry">←</RouterLink>
        <div class="state-identity__copy">
          <div class="state-identity__eyebrow">
            <span>Состояния</span><i>/</i><strong>{{ currentStateCategory.label }}</strong>
          </div>
          <div class="state-identity__row">
            <h1>{{ currentEntry.name }}</h1>
            <div
              class="state-header__status"
              :class="{ 'state-header__status--dirty': currentEntry.isDirty }"
              :tabindex="currentEntry.isDirty ? 0 : undefined"
            >
              <i />
              <span>{{ currentEntry.isDirty ? "Есть несохранённые изменения" : "Сохранено" }}</span>
              <div v-if="currentEntry.isDirty" class="dirty-tooltip" role="tooltip">
                <strong>Отличается от сохранённой версии</strong>
                <ul>
                  <li v-for="(item, index) in dirtyTooltipItems" :key="`${item.label}-${index}`">
                    <span class="dirty-tooltip__label">{{ item.label }}</span>
                    <span class="dirty-tooltip__values">
                      <code>{{ item.before }}</code>
                      <i aria-hidden="true">→</i>
                      <code>{{ item.after }}</code>
                    </span>
                  </li>
                  <li v-if="dirtyTooltipItems.length === 0">Данные состояния</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="editor-screen__transport">
        <button class="transport-button" type="button" aria-label="Перейти к первому кадру — Shift плюс Пробел" data-tooltip="В начало · Shift + Пробел" @click="goToStart">⏮</button>
        <button class="transport-button" type="button" aria-label="Назад на один кадр — стрелка влево" data-tooltip="Предыдущий кадр · ←" @click="stepFrame(-1)">|◀</button>
        <button class="transport-button transport-button--primary" type="button" :aria-label="`${isPlaying ? 'Пауза' : 'Воспроизвести'} — Пробел`" :data-tooltip="`${isPlaying ? 'Пауза' : 'Воспроизвести'} · Пробел`" @click="togglePlayback">
          {{ isPlaying ? "Ⅱ" : "▶" }}
        </button>
        <button class="transport-button" type="button" aria-label="Вперёд на один кадр — стрелка вправо" data-tooltip="Следующий кадр · →" @click="stepFrame(1)">▶|</button>
        <div class="frame-counter"><strong>{{ currentFrame }}</strong><span>/ {{ currentEntry.data.duration }}</span></div>
        <label class="fps-control" title="Частота воспроизведения">
          <input type="number" min="1" max="120" :value="fps" @input="handleFpsInput" @change="handleFpsChange" />
          <span>FPS</span>
        </label>
      </div>

      <div class="editor-screen__top-actions">
        <button class="top-action-button" type="button" aria-label="Синхронизировать" data-tooltip="Синхронизировать" @click="openSynchronizationConfirmation">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 15 6.7L21 16" />
            <path d="M21 21v-5h-5" />
          </svg>
        </button>
        <button class="top-action-button top-action-button--primary" type="button" aria-label="Сохранить" data-tooltip="Сохранить · Ctrl/⌘ + S" @click="openExport">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5V4Zm3 0v6h8V4M8 20v-6h8v6" /></svg>
        </button>
        <button class="top-action-button top-action-button--danger" type="button" aria-label="Удалить состояние" data-tooltip="Удалить состояние" @click="openStateDeleteConfirmation">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
        </button>
        <div class="topbar-theme-control">
          <ThemeToggle />
        </div>
      </div>
    </header>

    <aside class="editor-screen__left-panel">
      <button
        v-if="!leftPanelCollapsed"
        class="side-panel-tab side-panel-tab--left"
        type="button"
        title="Свернуть левую панель"
        @click="leftPanelCollapsed = true"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
      </button>
      <template v-if="!leftPanelCollapsed">
        <div class="editor-screen__left-content">
          <StateSettings
            :state="currentEntry.data"
            :changed-fields="stateSettingsChanges"
            :clip-names="clipNames"
            :preview-side="previewSide"
            :is-attack="currentStateCategory.id === 'attack'"
            @history-start="beginHistoryTransaction"
            @history-end="endHistoryTransaction"
            @update:duration="handleDurationUpdate"
            @update:loop="handleLoopUpdate"
            @update:lock-when-finished="handleLockWhenFinishedUpdate"
            @update:blend-frames-number="updateCurrentEntry((data: EditorStateData) => { data.blendFramesNumber = Math.max(0, $event) })"
            @update:cancel-window="updateCurrentEntry((data: EditorStateData) => { data.cancelWindow = $event })"
            @update:preview-side="previewSide = $event"
            @update:animations="(side, value) => updateCurrentEntry((data: EditorStateData) => { data.animations[side] = value })"
          />
        </div>
      </template>
      <div
        v-if="!leftPanelCollapsed"
        class="panel-resizer panel-resizer--left"
        role="separator"
        aria-label="Изменить ширину левой панели"
        aria-orientation="vertical"
        @pointerdown="beginPanelResize($event, 'left')"
      />
      <button v-else class="panel-rail-button" type="button" title="Развернуть левую панель" @click="expandPanel('left')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
    </aside>

    <main class="editor-screen__viewport" @wheel.prevent="handleViewportWheel">
      <PreviewCanvas
        :state="currentEntry.data"
        :clip-name="activeClipName"
        :frame="currentFrame"
        :selected-box-ids="selectedBoxIds"
        :is-rotated="previewSide === 'right'"
        :edit-mode="viewportEditMode"
        :zoom="(viewportZoom / 100) * VIEWPORT_BASE_ZOOM"
        :layout-key="`${leftPanelCollapsed}-${rightPanelCollapsed}-${timelineCollapsed}`"
        @transform-start="beginHistoryTransaction"
        @transform-end="endHistoryTransaction"
        @select-boxes="selectBoxes"
        @box-select-complete="finishBoxSelect"
        @update-box="handleViewportBoxUpdate"
      />

      <div class="viewport-tools" :class="{ 'viewport-tools--suppress-hover': suppressViewportToolHover }" role="toolbar" aria-label="Режим редактирования коллайдера">
        <button
          class="viewport-tool"
          :class="{ 'viewport-tool--active': viewportEditMode === 'translate' }"
          type="button"
          aria-label="Режим изменения позиции — G"
          :aria-pressed="viewportEditMode === 'translate'"
          data-tooltip="Позиция · G"
          @click="viewportEditMode = 'translate'"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v18M3 12h18M12 3 9 6m3-3 3 3m6 6-3-3m3 3-3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3" />
            <circle cx="12" cy="12" r="1.6" />
          </svg>
        </button>
        <button
          class="viewport-tool"
          :class="{ 'viewport-tool--active': viewportEditMode === 'scale' }"
          type="button"
          aria-label="Режим изменения размера — S"
          :aria-pressed="viewportEditMode === 'scale'"
          data-tooltip="Размер · S"
          @click="viewportEditMode = 'scale'"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="1" />
            <path d="m9 15 6-6m0 0h-4m4 0v4M9 15h4m-4 0v-4" />
            <rect class="viewport-tool__fill" x="3" y="3" width="4" height="4" rx=".6" />
            <rect class="viewport-tool__fill" x="17" y="17" width="4" height="4" rx=".6" />
          </svg>
        </button>
      </div>

      <div class="viewport-zoom" aria-label="Масштаб окна просмотра">
        <button type="button" title="Уменьшить масштаб" @click="changeViewportZoom(-10)">−</button>
        <button class="viewport-zoom__value" type="button" title="Сбросить масштаб" @click="setViewportZoom(100)">{{ viewportZoom }}%</button>
        <button type="button" title="Увеличить масштаб" @click="changeViewportZoom(10)">+</button>
      </div>
      <div class="viewport-hint">
        <span><kbd>ЛКМ</kbd><i>—</i>Выбор коллайдера</span>
        <span><kbd>Shift + ЛКМ</kbd><i>—</i>Выбор нескольких коллайдеров</span>
        <span><kbd>B</kbd><i>—</i>Выбор через Box select</span>
        <span><kbd>X</kbd><i>—</i>Удалить</span>
      </div>
    </main>

    <aside class="editor-screen__right-panel">
      <button
        v-if="!rightPanelCollapsed"
        class="side-panel-tab side-panel-tab--right"
        type="button"
        title="Свернуть правую панель"
        @click="rightPanelCollapsed = true"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
      <BoxInspector
        v-if="!rightPanelCollapsed"
        :boxes="selectedBoxes"
        :title="selectedBoxesTitle"
        :duration="currentEntry.data.duration"
        :changed-fields="boxInspectorChanges"
        @history-start="beginHistoryTransaction"
        @history-end="endHistoryTransaction"
        @update="handleSelectedBoxPropertyUpdate"
        @rename="selectedBox && handleBoxUpdate(selectedBox.id, { name: $event })"
        @remove="requestBoxRemoval(selectedBoxIds, { x: $event.clientX, y: $event.clientY })"
      />
      <div
        v-if="!rightPanelCollapsed"
        class="panel-resizer panel-resizer--right"
        role="separator"
        aria-label="Изменить ширину правой панели"
        aria-orientation="vertical"
        @pointerdown="beginPanelResize($event, 'right')"
      />
      <button v-else class="panel-rail-button panel-rail-button--right" type="button" title="Развернуть правую панель" @click="expandPanel('right')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
      </button>
    </aside>

    <section class="editor-screen__timeline-panel">
      <div
        v-if="!timelineCollapsed"
        class="panel-resizer panel-resizer--timeline"
        role="separator"
        aria-label="Изменить высоту таймлайна"
        aria-orientation="horizontal"
        @pointerdown="beginPanelResize($event, 'timeline')"
      />
      <Timeline
        v-if="!timelineCollapsed"
        :state="currentEntry.data"
        :current-frame="currentFrame"
        :selected-box-ids="selectedBoxIds"
        :show-cancel-window="currentStateCategory.id === 'attack'"
        @interaction-start="beginHistoryTransaction"
        @interaction-end="endHistoryTransaction"
        @clear-selection="selectedBoxIds = []"
        @update:current-frame="currentFrame = $event"
        @select-box="selectTimelineBox"
        @update-boxes="handleBoxesUpdate"
        @update:cancel-window="updateCurrentEntry((data: EditorStateData) => { data.cancelWindow = $event })"
        @rename-box="(id, name) => handleBoxUpdate(id, { name })"
        @request-remove="requestBoxRemoval"
        @add-box="handleAddBox"
      />
      <div v-else class="timeline-collapsed-bar" />
      <button
        class="timeline-collapse"
        :class="{ 'timeline-collapse--rail': timelineCollapsed }"
        type="button"
        :title="timelineCollapsed ? 'Развернуть таймлайн' : 'Свернуть таймлайн'"
        @click="timelineCollapsed ? expandPanel('timeline') : (timelineCollapsed = true)"
      >
        <svg v-if="timelineCollapsed" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 7-7 7 7" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 7 7 7-7" /></svg>
      </button>
    </section>

    <ExportPanel v-if="showExport" :entries="entryList" :selected-names="exportSelection" :is-saving="isExporting" @close="showExport = false" @toggle="toggleExportName" @export="handleExport" />

    <div v-if="showSyncConfirmation" class="sync-confirmation" @click.self="!isSynchronizing && (showSyncConfirmation = false)">
      <section class="sync-confirmation__dialog" role="dialog" aria-modal="true" aria-labelledby="sync-confirmation-title">
        <span class="sync-confirmation__icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 15 6.7L21 16" />
            <path d="M21 21v-5h-5" />
          </svg>
        </span>
        <h2 id="sync-confirmation-title">Синхронизировать состояние?</h2>
        <p>
          Все локальные изменения состояния <strong>{{ currentEntry.name }}</strong>
          будут заменены данными из {{ state.storageMode === "remote" ? "выбранного профиля" : "выбранной папки проекта" }}.
        </p>
        <p v-if="synchronizationError" class="sync-confirmation__error">{{ synchronizationError }}</p>
        <div class="sync-confirmation__actions">
          <button class="button dialog-shortcut" type="button" title="Отмена · Esc" data-tooltip="Отмена · Esc" :disabled="isSynchronizing" @click="showSyncConfirmation = false">Отмена</button>
          <button class="button button--primary dialog-shortcut" type="button" title="Подтвердить · Enter" data-tooltip="Подтвердить · Enter" :disabled="isSynchronizing" @click="confirmSynchronization">
            {{ isSynchronizing ? "Синхронизация…" : "Синхронизировать" }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="showStateDeleteConfirmation" class="sync-confirmation" @click.self="!isDeletingState && (showStateDeleteConfirmation = false)">
      <section class="sync-confirmation__dialog state-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="state-delete-title">
        <span class="state-delete-dialog__icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>
        </span>
        <h2 id="state-delete-title">Удалить {{ currentEntry.name }}?</h2>
        <p>Состояние будет помечено на удаление. Изменение применится после сохранения профиля.</p>
        <p v-if="stateDeleteError" class="sync-confirmation__error">{{ stateDeleteError }}</p>
        <div class="sync-confirmation__actions">
          <button class="button dialog-shortcut" type="button" title="Отмена · Esc" data-tooltip="Отмена · Esc" :disabled="isDeletingState" @click="showStateDeleteConfirmation = false">Отмена</button>
          <button class="button state-delete-dialog__confirm dialog-shortcut" type="button" title="Удалить · Enter" data-tooltip="Удалить · Enter" :disabled="isDeletingState" @click="confirmStateDeletion">
            {{ isDeletingState ? "Удаляем…" : "Удалить" }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="deleteConfirmation" class="delete-confirmation" @pointerdown.self="deleteConfirmation = null">
      <section
        class="delete-confirmation__dialog"
        role="dialog"
        aria-modal="true"
        :style="{ left: `${deleteConfirmation.x}px`, top: `${deleteConfirmation.y}px` }"
      >
        <p>Удалить {{ deleteConfirmation.boxIds.length }} {{ getColliderNoun(deleteConfirmation.boxIds.length) }}?</p>
        <button class="delete-confirmation__yes dialog-shortcut dialog-shortcut--below" type="button" title="Подтвердить · Enter" data-tooltip="Подтвердить · Enter" autofocus @click="confirmBoxRemoval">Да</button>
        <button class="dialog-shortcut dialog-shortcut--below" type="button" title="Отмена · Esc" data-tooltip="Отмена · Esc" @click="deleteConfirmation = null">Нет</button>
      </section>
    </div>
  </section>
</template>

<style scoped lang="scss">
.editor-screen {
  --left-panel-width: 276px;
  --right-panel-width: 292px;
  --state-accent: #279d8b;
  --state-accent-soft: color-mix(in srgb, var(--state-accent) 14%, var(--surface));
  display: grid;
  grid-template-columns: var(--left-panel-width) minmax(0, 1fr) var(--right-panel-width);
  grid-template-rows: var(--topbar-height) minmax(0, 1fr) var(--timeline-panel-height);
  grid-template-areas: "topbar topbar topbar" "left viewport right" "timeline timeline timeline";
  width: 100vw;
  height: 100dvh;
  min-width: 0;
  background: var(--app-bg);
  color: var(--text);
  overflow: hidden;

  &--category-attack { --state-accent: #ef5e4d; }
  &--category-damage { --state-accent: var(--category-damage); }
  &--category-block { --state-accent: #3d7fda; }
  &__topbar { position: relative; z-index: 20; grid-area: topbar; display: grid; grid-template-columns: minmax(300px, 1fr) auto minmax(260px, 1fr); align-items: center; gap: 18px; height: var(--topbar-height); min-width: 0; padding: var(--topbar-padding); border-bottom: 1px solid var(--border); background: var(--surface-translucent); }
  &__left-panel { position: relative; grid-area: left; min-width: 0; min-height: 0; border-right: 1px solid var(--border); background: var(--surface); z-index: 10; }
  &__right-panel { position: relative; grid-area: right; min-width: 0; min-height: 0; border-left: 1px solid var(--border); background: var(--surface); z-index: 3; }
  &__left-panel, &__right-panel { display: flex; flex-direction: column; }
  &__left-content { min-height: 0; flex: 1; overflow: auto; }
  &__right-panel :deep(.box-inspector) { min-height: 0; flex: 1; overflow: auto; }

  &__viewport { position: relative; grid-area: viewport; min-width: 0; min-height: 0; overflow: hidden; background: var(--viewport-bg); }
  &__viewport::after { position: absolute; inset: 0; border: 1px solid color-mix(in srgb, var(--border) 42%, transparent); pointer-events: none; content: ""; }

  &__transport { position: relative; z-index: 5; display: flex; align-items: center; justify-self: center; gap: 6px; }
  &__transport strong { color: var(--text); font-size: 18px; }
  &__top-actions { display: flex; justify-content: flex-end; gap: 7px; }

  &__timeline-panel { position: relative; z-index: 4; grid-area: timeline; min-width: 0; min-height: 0; border-top: 1px solid var(--border); }
}

.state-identity { display: flex; align-items: center; gap: 9px; min-width: 0; }
.state-identity__copy { min-width: 0; }
.state-identity__eyebrow { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; color: var(--text-muted); font-size: 8px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.state-identity__eyebrow i { color: var(--border-strong); font-style: normal; }
.state-identity__eyebrow strong { color: var(--state-accent); font-weight: 800; }
.state-identity__row { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.state-identity h1 { margin: 0; overflow: hidden; color: var(--text-strong); font-size: 17px; font-weight: 750; letter-spacing: .01em; text-overflow: ellipsis; white-space: nowrap; }
.state-header__status { position: relative; display: flex; align-items: center; align-self: baseline; width: max-content; max-width: 100%; flex: 0 0 auto; gap: 5px; color: var(--success); font-size: 9px; line-height: 1; outline: 0; }
.state-header__status > i { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: currentColor; }
.state-header__status > span { overflow: hidden; color: inherit; font-size: 9px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.state-header__status--dirty { color: var(--danger); cursor: help; }

.dirty-tooltip { position: absolute; z-index: 30; top: calc(100% + 9px); left: -36px; width: min(370px, calc(100vw - 32px)); max-height: 360px; padding: 11px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); box-shadow: var(--shadow-md); color: var(--text-secondary); opacity: 0; overflow-y: auto; pointer-events: none; transform: translateY(-3px); transition: 120ms ease; }
.dirty-tooltip::before { position: absolute; top: -5px; left: 39px; width: 8px; height: 8px; border-top: 1px solid var(--border); border-left: 1px solid var(--border); background: var(--surface); content: ""; transform: rotate(45deg); }
.dirty-tooltip strong { display: block; margin-bottom: 7px; color: var(--text); font-size: 10px; font-weight: 750; }
.dirty-tooltip ul { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
.dirty-tooltip li { min-width: 0; color: var(--text-secondary); font-size: 10px; line-height: 1.35; }
.dirty-tooltip__label { display: block; margin-bottom: 3px; color: var(--danger); font-weight: 700; }
.dirty-tooltip__values { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: start; gap: 6px; }
.dirty-tooltip__values code { min-width: 0; padding: 3px 5px; border-radius: 3px; background: var(--surface-subtle); color: var(--text-secondary); font-family: inherit; font-size: 9px; overflow-wrap: anywhere; white-space: normal; }
.dirty-tooltip__values code:last-child { background: var(--danger-soft); color: var(--danger); }
.dirty-tooltip__values i { padding-top: 3px; color: var(--text-muted); font-style: normal; }
.state-header__status--dirty:hover .dirty-tooltip,
.state-header__status--dirty:focus .dirty-tooltip,
.state-header__status--dirty:focus-within .dirty-tooltip { opacity: 1; pointer-events: auto; transform: translateY(0); }

.icon-button { display: grid; width: 28px; height: 28px; padding: 0; place-items: center; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text-secondary); cursor: pointer; text-decoration: none; &:hover { border-color: var(--state-accent); background: var(--state-accent-soft); color: var(--state-accent); } }
.top-action-button { position: relative; display: grid; width: 34px; height: 34px; padding: 7px; place-items: center; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-muted); color: var(--text-secondary); cursor: pointer; }
.top-action-button:hover { border-color: var(--state-accent); background: var(--state-accent-soft); color: var(--state-accent); }
.top-action-button--primary { border-color: var(--state-accent); background: var(--state-accent); color: #fff; }
.top-action-button--primary:hover { background: color-mix(in srgb, var(--state-accent) 88%, #000); color: #fff; }
.top-action-button--danger:hover { border-color: color-mix(in srgb, var(--danger) 62%, var(--border)); background: var(--danger-soft); color: var(--danger); }
.top-action-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
.top-action-button::before { position: absolute; z-index: 30; top: calc(100% + 9px); left: 50%; padding: 6px 8px; border: 1px solid var(--tooltip-border); border-radius: 3px; background: var(--tooltip-bg); color: var(--tooltip-text); content: attr(data-tooltip); font-size: 10px; font-weight: 500; line-height: 1; opacity: 0; pointer-events: none; transform: translate(-50%, -3px); transition: 100ms ease; white-space: nowrap; }
.top-action-button:hover::before, .top-action-button:focus-visible::before { opacity: 1; transform: translate(-50%, 0); }
.panel-rail-button,
.side-panel-tab,
.timeline-collapse { display: grid; padding: 0; place-items: center; border-color: var(--border); background: var(--panel-rail); color: var(--text-muted); cursor: pointer; transition: background 100ms ease, color 100ms ease, opacity 100ms ease; }
.panel-rail-button:hover,
.side-panel-tab:hover,
.timeline-collapse:hover,
.panel-rail-button:focus-visible,
.side-panel-tab:focus-visible,
.timeline-collapse:focus-visible { background: var(--surface-muted); color: var(--text-secondary); }
.panel-rail-button svg,
.side-panel-tab svg,
.timeline-collapse svg { display: block; width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.panel-rail-button { width: 100%; height: 100%; border: 0; }
.side-panel-tab { position: absolute; z-index: 8; top: 50%; width: 28px; height: 42px; border-style: solid; border-width: 1px; opacity: .72; transform: translateY(-50%); }
.side-panel-tab:hover, .side-panel-tab:focus-visible { opacity: 1; }
.side-panel-tab--left { right: -28px; border-left: 0; border-radius: 0 5px 5px 0; }
.side-panel-tab--right { left: -28px; border-right: 0; border-radius: 5px 0 0 5px; }

.panel-resizer { position: absolute; z-index: 7; touch-action: none; }
.panel-resizer::after { position: absolute; background: var(--state-accent); content: ""; opacity: 0; transition: opacity 100ms ease; }
.panel-resizer:hover::after, .panel-resizer:active::after { opacity: .55; }
.panel-resizer--left { top: 0; right: -5px; bottom: 0; width: 10px; cursor: col-resize; }
.panel-resizer--left::after { top: 0; right: 4px; bottom: 0; width: 1px; }
.panel-resizer--right { top: 0; bottom: 0; left: -5px; width: 10px; cursor: col-resize; }
.panel-resizer--right::after { top: 0; bottom: 0; left: 4px; width: 1px; }
.panel-resizer--timeline { top: -5px; right: 0; left: 0; height: 10px; cursor: row-resize; }
.panel-resizer--timeline::after { right: 0; bottom: 4px; left: 0; height: 1px; }

.transport-button { position: relative; display: grid; width: 32px; height: 32px; padding: 0; place-items: center; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-muted); color: var(--text-secondary); font-size: 10px; cursor: pointer; &:hover { border-color: var(--state-accent); background: var(--state-accent-soft); color: var(--state-accent); } &--primary { width: 36px; height: 36px; border-color: var(--state-accent); background: var(--state-accent); color: #fff; font-size: 12px; &:hover { background: color-mix(in srgb, var(--state-accent) 88%, #000); color: #fff; } } }
.transport-button::before { position: absolute; z-index: 20; top: calc(100% + 9px); left: 50%; padding: 6px 8px; border: 1px solid #181a1d; border-radius: 3px; background: #111315; box-shadow: 0 5px 16px rgba(0,0,0,.42); color: #d9dbdd; content: attr(data-tooltip); font-size: 10px; font-weight: 500; line-height: 1; opacity: 0; pointer-events: none; transform: translate(-50%, -3px); transition: 100ms ease; white-space: nowrap; }
.transport-button::after { position: absolute; z-index: 21; top: calc(100% + 5px); left: 50%; width: 7px; height: 7px; border-top: 1px solid #181a1d; border-left: 1px solid #181a1d; background: #111315; content: ""; opacity: 0; pointer-events: none; transform: translateX(-50%) rotate(45deg); transition: 100ms ease; }
.transport-button:hover::before,
.transport-button:focus-visible::before { opacity: 1; transform: translate(-50%, 0); }
.transport-button:hover::after,
.transport-button:focus-visible::after { opacity: 1; }
.viewport-tools { position: absolute; z-index: 6; top: 12px; left: 12px; display: grid; gap: 3px; padding: 4px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-glass); backdrop-filter: blur(8px); }
.viewport-tool { position: relative; display: grid; width: 29px; height: 29px; padding: 5px; place-items: center; border: 1px solid transparent; border-radius: 4px; outline: 0; background: transparent; color: var(--text-secondary); cursor: pointer; transition: 100ms ease; }
.viewport-tool:hover,
.viewport-tool:focus-visible { border-color: var(--state-accent); background: var(--state-accent-soft); color: var(--state-accent); }
.viewport-tools--suppress-hover .viewport-tool:not(.viewport-tool--active):hover { border-color: transparent; background: transparent; color: var(--text-secondary); }
.viewport-tool--active { border-color: var(--state-accent); background: var(--state-accent); color: #fff; box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
.viewport-tool--active:hover,
.viewport-tool--active:focus-visible { border-color: var(--state-accent); background: color-mix(in srgb, var(--state-accent) 88%, #000); }
.viewport-tool svg { width: 18px; height: 18px; overflow: visible; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.65; }
.viewport-tool svg .viewport-tool__fill { fill: currentColor; stroke: currentColor; }
.viewport-tool::before { position: absolute; z-index: 20; top: 50%; left: calc(100% + 10px); padding: 6px 8px; border: 1px solid #181a1d; border-radius: 3px; background: #111315; box-shadow: 0 5px 16px rgba(0,0,0,.42); color: #d9dbdd; content: attr(data-tooltip); font-size: 10px; font-weight: 500; line-height: 1; opacity: 0; pointer-events: none; transform: translate(3px, -50%); transition: 100ms ease; white-space: nowrap; }
.viewport-tool::after { position: absolute; z-index: 21; top: 50%; left: calc(100% + 6px); width: 7px; height: 7px; border-bottom: 1px solid #181a1d; border-left: 1px solid #181a1d; background: #111315; content: ""; opacity: 0; pointer-events: none; transform: translateY(-50%) rotate(45deg); transition: 100ms ease; }
.viewport-tool:hover::before,
.viewport-tool:focus-visible::before { opacity: 1; transform: translate(0, -50%); }
.viewport-tool:hover::after,
.viewport-tool:focus-visible::after { opacity: 1; }
.frame-counter { display: flex; align-items: baseline; gap: 4px; min-width: 70px; margin-left: 5px; color: var(--text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.fps-control { display: flex; align-items: center; gap: 4px; height: 30px; padding-left: 9px; border-left: 1px solid var(--border); color: var(--text-muted); font-size: 9px; }
.fps-control input { width: 42px; height: 27px; padding: 2px 4px; border: 1px solid var(--border); border-radius: 4px; outline: 0; background: var(--input-bg); color: var(--text); font-size: 11px; text-align: right; &:focus { border-color: var(--state-accent); } }

.viewport-zoom { position: absolute; z-index: 6; right: 12px; bottom: 12px; display: grid; grid-template-columns: 27px 50px 27px; height: 28px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-glass); backdrop-filter: blur(8px); overflow: hidden; }
.viewport-zoom button { display: grid; min-width: 0; padding: 0; place-items: center; border: 0; background: transparent; color: var(--text-secondary); font-size: 15px; line-height: 1; cursor: pointer; }
.viewport-zoom button:hover { background: var(--state-accent-soft); color: var(--state-accent); }
.viewport-zoom .viewport-zoom__value { border-inline: 1px solid var(--border); color: var(--text); font-size: 10px; font-variant-numeric: tabular-nums; }

.viewport-hint { position: absolute; z-index: 4; top: 12px; right: 12px; display: grid; gap: 4px; color: var(--text-muted); font-size: 9px; line-height: 1.35; pointer-events: none; }
.viewport-hint span { display: grid; grid-template-columns: max-content 8px auto; align-items: center; }
.viewport-hint i { color: var(--text-muted); font-style: normal; text-align: center; }
.viewport-hint kbd { padding: 2px 4px; border: 1px solid var(--border); border-radius: 3px; background: var(--surface-glass); color: var(--text-secondary); font: inherit; text-align: center; }

.timeline-collapse { position: absolute; z-index: 8; top: -28px; right: 50%; width: 42px; height: 28px; border-style: solid; border-width: 1px; border-bottom: 0; border-radius: 5px 5px 0 0; opacity: .72; transform: translateX(50%); }
.timeline-collapse:hover, .timeline-collapse:focus-visible { opacity: 1; }
.timeline-collapse--rail { inset: 0; width: 100%; height: 100%; border: 0; border-radius: 0; box-shadow: none; opacity: 1; transform: none; }
.timeline-collapsed-bar { height: 100%; background: var(--panel-rail); }

.sync-confirmation { position: fixed; z-index: 40; inset: 0; display: grid; padding: 24px; place-items: center; background: var(--overlay); backdrop-filter: blur(4px); }
.sync-confirmation__dialog { display: grid; justify-items: center; width: min(420px, 100%); padding: 26px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow-lg); text-align: center; }
.sync-confirmation__icon { display: grid; width: 42px; height: 42px; margin-bottom: 12px; place-items: center; border: 1px solid var(--state-accent); border-radius: 50%; background: var(--state-accent-soft); color: var(--state-accent); font-size: 24px; }
.sync-confirmation__icon svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
.sync-confirmation h2 { margin: 0; color: var(--text); font-size: 18px; }
.sync-confirmation p { margin: 10px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.sync-confirmation p strong { color: var(--text-strong); }
.sync-confirmation__error { width: 100%; padding: 8px 10px; border: 1px solid #7d3d35; border-radius: 4px; background: rgba(143,57,45,.18); color: #ef9a8d !important; }
.sync-confirmation__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-top: 20px; }
.state-delete-dialog__icon { display: grid; width: 42px; height: 42px; margin-bottom: 12px; place-items: center; border: 1px solid color-mix(in srgb, var(--danger) 55%, var(--border)); border-radius: 8px; background: var(--danger-soft); color: var(--danger); }
.state-delete-dialog__icon svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.state-delete-dialog__confirm { border-color: color-mix(in srgb, var(--danger) 72%, var(--border)); background: var(--danger); color: #fff; }
.state-delete-dialog__confirm:hover:not(:disabled) { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 88%, #000); }

.delete-confirmation { position: fixed; z-index: 60; inset: 0; }
.delete-confirmation__dialog { position: fixed; display: grid; grid-template-columns: 72px 72px; gap: 4px; padding: 4px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); box-shadow: var(--shadow-md); transform: translate(-40px, -20px); }
.delete-confirmation__dialog p { position: absolute; bottom: calc(100% + 5px); left: 0; width: max-content; max-width: 230px; margin: 0; padding: 6px 9px; border: 1px solid var(--border-strong); border-radius: 5px; background: var(--surface); box-shadow: var(--shadow-sm); color: var(--text-secondary); font-size: 11px; }
.delete-confirmation__dialog button { height: 32px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-muted); color: var(--text-secondary); cursor: pointer; }
.delete-confirmation__dialog button:hover { background: var(--surface-subtle); }
.delete-confirmation__dialog .delete-confirmation__yes { border-color: #d84f3f; background: #ef5e4d; color: #fff; }
.delete-confirmation__dialog .delete-confirmation__yes:hover { background: #dc5142; }

@media (max-width: 850px) {
  .editor-screen__topbar { grid-template-columns: minmax(150px, 1fr) auto auto; gap: 7px; padding-inline: 8px; }
  .state-identity__eyebrow { display: none; }
  .state-header__status > span { display: none; }
}
</style>
