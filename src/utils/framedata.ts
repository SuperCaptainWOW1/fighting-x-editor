import type {
  EditorBoxBase,
  EditorStateData,
  FrameWindow,
  HurtboxPresetName,
  SerializedHitboxWindow,
  SerializedHurtboxWindow,
  SerializedStateData,
  StateAnimationConfig,
  StateToAnimationData,
} from "../types/framedata";

const PRESET_DATA: Record<
  HurtboxPresetName,
  Pick<EditorBoxBase, "size" | "position" | "type">
> = {
  head: {
    size: [0.3, 0.3, 0],
    position: [0.1, 1.675, 0],
    type: "head",
  },
  body: {
    size: [0.6, 0.5, 0],
    position: [0.1, 1.25, 0],
    type: "body",
  },
  legsTop: {
    size: [0.7, 0.3, 0],
    position: [0.1, 0.85, 0],
    type: "legs",
  },
  legsBottom: {
    size: [0.95, 0.7, 0],
    position: [0.1, 0.35, 0],
    type: "legs",
  },
  headCrouching: {
    size: [0.3, 0.3, 0],
    position: [0.05, 1.325, 0],
    type: "head",
  },
  bodyCrouching: {
    size: [0.8, 0.5, 0],
    position: [0, 0.95, 0],
    type: "body",
  },
};

export const HURTBOX_PRESET_OPTIONS = Object.keys(PRESET_DATA) as HurtboxPresetName[];

export const getPresetData = (preset: HurtboxPresetName) => PRESET_DATA[preset];

let boxIdCounter = 0;

export const createBoxId = () => `box-${++boxIdCounter}`;

export const resetBoxIdCounter = () => {
  boxIdCounter = 0;
};

const serializeHurtbox = (
  box: EditorBoxBase,
  index: number,
): SerializedHurtboxWindow => {
  const name = box.name || `Hurtbox_${index + 1}`;

  if (box.preset) {
    return { name, preset: box.preset, frames: box.frames };
  }

  return {
    name,
    frames: box.frames,
    size: box.size,
    position: box.position,
    ...(box.type ? { type: box.type } : {}),
  };
};

const serializeHitbox = (
  box: EditorBoxBase,
  index: number,
): SerializedHitboxWindow => ({
  name: box.name || `Hitbox_${index + 1}`,
  frames: box.frames,
  size: box.size,
  position: box.position,
  ...(box.damage !== undefined ? { damage: box.damage } : {}),
});

export const serializeStateData = (state: EditorStateData): SerializedStateData => {
  const hurtboxes = state.boxes
    .filter((box) => box.kind === "hurtbox")
    .map(serializeHurtbox);
  const hitboxes = state.boxes
    .filter((box) => box.kind === "hitbox")
    .map(serializeHitbox);

  return {
    ...(state.category ? { category: state.category } : {}),
    duration: state.duration,
    hurtboxes,
    hitboxes,
    ...(state.castFireballFrames
      ? { castFireballFrames: state.castFireballFrames }
      : {}),
    blendFramesNumber: state.blendFramesNumber,
    ...(state.cancelWindow ? { cancelWindow: state.cancelWindow } : {}),
    ...(state.loop !== undefined ? { loop: state.loop } : {}),
    ...(state.lockWhenFinished ? { lockWhenFinished: true } : {}),
  };
};

const hurtboxToEditorBox = (
  window: SerializedHurtboxWindow,
  index: number,
): EditorBoxBase => {
  const name = window.name || `Hurtbox_${index + 1}`;
  if (window.preset) {
    const preset = getPresetData(window.preset);

    return {
      id: createBoxId(),
      name,
      kind: "hurtbox",
      frames: window.frames,
      preset: window.preset,
      size: [...preset.size] as [number, number, number],
      position: [...preset.position] as [number, number, number],
      type: preset.type,
    };
  }

  return {
    id: createBoxId(),
    name,
    kind: "hurtbox",
    frames: window.frames,
    size: window.size ?? [0.5, 0.5, 0],
    position: window.position ?? [0, 1, 0],
    type: window.type,
  };
};

const hitboxToEditorBox = (
  window: SerializedHitboxWindow,
  index: number,
): EditorBoxBase => ({
  id: createBoxId(),
  name: window.name || `Hitbox_${index + 1}`,
  kind: "hitbox",
  frames: window.frames,
  size: [...window.size] as [number, number, number],
  position: [...window.position] as [number, number, number],
  damage: window.damage,
});

export const deserializeStateData = (
  data: SerializedStateData,
  animations: StateAnimationConfig,
): EditorStateData => ({
  category: data.category,
  duration: data.duration,
  boxes: [
    ...data.hurtboxes.map((window, index) => hurtboxToEditorBox(window, index)),
    ...data.hitboxes.map((window, index) => hitboxToEditorBox(window, index)),
  ].map((box) => ({
    ...box,
    frames: fitFrameWindow(box.frames, data.duration),
  })),
  castFireballFrames: data.castFireballFrames,
  blendFramesNumber: data.blendFramesNumber,
  cancelWindow: data.cancelWindow,
  loop: data.loop,
  lockWhenFinished: data.lockWhenFinished,
  animations,
});

export const createSnapshot = (state: EditorStateData) =>
  JSON.stringify({
    data: serializeStateData(state),
    animations: state.animations,
  });

export const isFrameInsideWindow = (frame: number, window: FrameWindow) =>
  frame >= window[0] && frame <= window[1];

export const fitFrameWindow = (
  window: FrameWindow,
  duration: number,
): FrameWindow => {
  const safeDuration = Math.max(1, duration);
  const frameCount = Math.max(1, window[1] - window[0] + 1);

  // Диапазон длиннее самой анимации невозможно вместить без изменения его
  // длительности. В таком случае сохраняем длину и прижимаем начало к 1.
  if (frameCount > safeDuration) {
    return [1, frameCount];
  }

  const maxStart = safeDuration - frameCount + 1;
  const start = Math.min(maxStart, Math.max(1, window[0]));
  return [start, start + frameCount - 1];
};

export const getActiveBoxes = (state: EditorStateData, frame: number) =>
  state.boxes.filter((box) => isFrameInsideWindow(frame, box.frames));

const normalizeAnimationName = (value: unknown) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === "string") ?? "";
  }
  return "";
};

export const normalizeStateAnimationConfig = (
  raw: unknown,
): StateAnimationConfig => {
  const value = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  return {
    left: normalizeAnimationName(value.left),
    right: normalizeAnimationName(value.right),
  };
};

export const parseStateToAnimation = (raw: unknown): StateToAnimationData => {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([state, config]) => [
      state,
      normalizeStateAnimationConfig(config),
    ]),
  );
};
