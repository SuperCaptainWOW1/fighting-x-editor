export type FrameWindow = [start: number, end: number];
export type StateCategoryId = "movement" | "attack" | "damage" | "block";

export type HurtboxPresetName =
  | "head"
  | "body"
  | "legsTop"
  | "legsBottom"
  | "headCrouching"
  | "bodyCrouching";

export type ColliderType = "head" | "body" | "legs";

export interface SerializedHurtboxWindow {
  name?: string;
  preset?: HurtboxPresetName;
  frames: FrameWindow;
  size?: [number, number, number];
  position?: [number, number, number];
  type?: ColliderType;
}

export interface SerializedHitboxWindow {
  name?: string;
  frames: FrameWindow;
  size: [number, number, number];
  position: [number, number, number];
  damage?: number;
}

export interface SerializedStateData {
  category?: StateCategoryId;
  duration: number;
  hurtboxes: SerializedHurtboxWindow[];
  hitboxes: SerializedHitboxWindow[];
  castFireballFrames?: FrameWindow;
  blendFramesNumber: number;
  cancelWindow?: FrameWindow;
  loop?: boolean;
  lockWhenFinished?: boolean;
}

export interface StateAnimationConfig {
  left: string;
  right: string;
}

export type StateToAnimationData = Record<string, StateAnimationConfig>;

export type ColliderKind = "hurtbox" | "hitbox";

export interface EditorBoxBase {
  id: string;
  name?: string;
  kind: ColliderKind;
  frames: FrameWindow;
  size: [number, number, number];
  position: [number, number, number];
  preset?: HurtboxPresetName;
  type?: ColliderType;
  damage?: number;
}

export type EditableBoxProperty =
  | "frameStart"
  | "frameEnd"
  | "preset"
  | "type"
  | "size"
  | "position"
  | "damage";

export interface BoxPropertyUpdate {
  property: EditableBoxProperty;
  value: number | string | undefined;
  axis?: 0 | 1 | 2;
}

export interface EditorStateData {
  category?: StateCategoryId;
  duration: number;
  boxes: EditorBoxBase[];
  castFireballFrames?: FrameWindow;
  blendFramesNumber: number;
  cancelWindow?: FrameWindow;
  loop?: boolean;
  lockWhenFinished?: boolean;
  animations: StateAnimationConfig;
}

export interface FrameDataEntry {
  name: string;
  data: EditorStateData;
  savedSnapshot: string;
  isDirty: boolean;
}
