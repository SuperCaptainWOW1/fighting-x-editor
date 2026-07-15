<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { ComponentPublicInstance } from "vue";
import type { EditorBoxBase, EditorStateData } from "../types/framedata";
import { fitFrameWindow } from "../utils/framedata";

const props = defineProps<{
  state: EditorStateData;
  currentFrame: number;
  selectedBoxIds: string[];
}>();

const emit = defineEmits<{
  interactionStart: [];
  interactionEnd: [];
  "update:currentFrame": [frame: number];
  selectBox: [boxId: string, additive: boolean, preserveGroup?: boolean];
  updateBoxes: [updates: Array<{ boxId: string; patch: Partial<EditorBoxBase> }>];
  renameBox: [boxId: string, name: string];
  requestRemove: [boxIds: string[], point: { x: number; y: number }];
  addBox: [kind: "hurtbox" | "hitbox"];
}>();

const editingId = ref<string | null>(null);
const editingName = ref("");
const nameInputRef = ref<HTMLInputElement | null>(null);
const rulerRef = ref<HTMLElement | null>(null);
const rulerWidth = ref(0);
let rulerResizeObserver: ResizeObserver | null = null;

const setNameInputRef = (
  element: Element | ComponentPublicInstance | null,
) => {
  nameInputRef.value = element instanceof HTMLInputElement ? element : null;
};

const MIN_TICK_SPACING = 24;

const tickStep = computed(() => {
  const maxIntervals = Math.max(
    1,
    Math.floor(rulerWidth.value / MIN_TICK_SPACING),
  );
  const rawStep = Math.max(1, props.state.duration / maxIntervals);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
});

const marks = computed(() => {
  const values = new Set<number>([1, props.state.duration]);
  for (let frame = 1; frame <= props.state.duration; frame += tickStep.value) {
    values.add(frame);
  }
  return [...values].sort((a, b) => a - b);
});

const isMajorMark = (frame: number) =>
  (frame - 1) % (tickStep.value * 5) === 0;

const selectedBoxes = computed(() =>
  props.selectedBoxIds
    .map((id) => props.state.boxes.find((box) => box.id === id))
    .filter((box): box is EditorBoxBase => Boolean(box)),
);

const getDefaultName = (box: EditorBoxBase) => {
  const index = props.state.boxes
    .filter((candidate) => candidate.kind === box.kind)
    .findIndex((candidate) => candidate.id === box.id);
  const prefix = box.kind === "hitbox" ? "Hitbox" : "Hurtbox";
  return `${prefix}_${index + 1}`;
};

const getName = (box: EditorBoxBase) => box.name || getDefaultName(box);
const boundaryPercent = (frame: number, edge: "start" | "end") =>
  (((edge === "start" ? frame - 1 : frame) / props.state.duration) * 100);
const frameStartPercent = (frame: number) =>
  boundaryPercent(frame, "start");

const getBarStyle = (box: EditorBoxBase) => ({
  left: `${boundaryPercent(box.frames[0], "start")}%`,
  width: `${((box.frames[1] - box.frames[0] + 1) / props.state.duration) * 100}%`,
});

const frameFromClientX = (clientX: number, rect: DOMRect) => {
  const ratio = Math.min(0.99999, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.floor(ratio * props.state.duration) + 1;
};

let stopPointerInteraction: (() => void) | null = null;

const beginScrub = (event: PointerEvent) => {
  if (event.button !== 0) return;
  event.preventDefault();

  stopPointerInteraction?.();
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();

  const update = (clientX: number) => {
    emit("update:currentFrame", frameFromClientX(clientX, rect));
  };

  const move = (moveEvent: PointerEvent) => update(moveEvent.clientX);
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    stopPointerInteraction = null;
  };

  update(event.clientX);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  stopPointerInteraction = end;
};

const beginRename = async (box: EditorBoxBase) => {
  editingId.value = box.id;
  editingName.value = getName(box);
  await nextTick();
  nameInputRef.value?.focus();
  nameInputRef.value?.select();
};

const commitRename = (box: EditorBoxBase) => {
  if (editingId.value !== box.id) return;
  emit("renameBox", box.id, editingName.value.trim() || getDefaultName(box));
  editingId.value = null;
};

const finishRenameOnOutsidePointer = (event: PointerEvent) => {
  const editedBoxId = editingId.value;
  if (!editedBoxId) return;

  const target = event.target;
  if (target instanceof Node && nameInputRef.value?.contains(target)) return;

  const box = props.state.boxes.find((candidate) => candidate.id === editedBoxId);
  if (box) commitRename(box);
  else editingId.value = null;
};

const beginMove = (event: PointerEvent, box: EditorBoxBase) => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const isAlreadySelected = props.selectedBoxIds.includes(box.id);
  emit("selectBox", box.id, event.shiftKey, true);
  stopPointerInteraction?.();

  const lane = (event.currentTarget as HTMLElement).closest(
    ".timeline__lane",
  ) as HTMLElement;
  const rect = lane.getBoundingClientRect();
  const startX = event.clientX;
  const movingBoxes = isAlreadySelected
    ? selectedBoxes.value
    : event.shiftKey
      ? [...selectedBoxes.value, box]
      : [box];
  const initial = new Map(
    movingBoxes.map((candidate) => [candidate.id, [...candidate.frames] as [number, number]]),
  );
  emit("interactionStart");

  const move = (moveEvent: PointerEvent) => {
    const frameDelta = Math.round(
      ((moveEvent.clientX - startX) / rect.width) * props.state.duration,
    );
    emit(
      "updateBoxes",
      movingBoxes.map((candidate) => {
        const frames = initial.get(candidate.id)!;
        return {
          boxId: candidate.id,
          patch: {
            frames: fitFrameWindow(
              [frames[0] + frameDelta, frames[1] + frameDelta],
              props.state.duration,
            ),
          },
        };

      }),
    );
  };

  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    stopPointerInteraction = null;
    emit("interactionEnd");
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  stopPointerInteraction = end;
};

const beginResize = (event: PointerEvent, box: EditorBoxBase, edge: 0 | 1) => {
  event.preventDefault();
  event.stopPropagation();
  const isAlreadySelected = props.selectedBoxIds.includes(box.id);
  emit("selectBox", box.id, event.shiftKey, true);
  stopPointerInteraction?.();

  const lane = (event.currentTarget as HTMLElement).closest(".timeline__lane") as HTMLElement;
  const rect = lane.getBoundingClientRect();
  const startX = event.clientX;
  const candidates = isAlreadySelected ? selectedBoxes.value : [box];
  const sharedBoundary = candidates.every(
    (candidate) => candidate.frames[edge] === box.frames[edge],
  );
  const resizingBoxes = sharedBoundary ? candidates : [box];
  const initial = new Map(
    resizingBoxes.map((candidate) => [candidate.id, [...candidate.frames] as [number, number]]),
  );
  emit("interactionStart");

  const move = (moveEvent: PointerEvent) => {
    const frameDelta = Math.round(((moveEvent.clientX - startX) / rect.width) * props.state.duration);
    emit(
      "updateBoxes",
      resizingBoxes.map((candidate) => {
        const frames = initial.get(candidate.id)!;
        const next = [...frames] as [number, number];
        if (edge === 0) {
          next[0] = Math.min(frames[1], Math.max(1, frames[0] + frameDelta));
        } else {
          next[1] = Math.max(frames[0], Math.min(props.state.duration, frames[1] + frameDelta));
        }
        return { boxId: candidate.id, patch: { frames: next } };
      }),
    );
  };

  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    stopPointerInteraction = null;
    emit("interactionEnd");
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  stopPointerInteraction = end;
};

onMounted(() => {
  document.addEventListener("pointerdown", finishRenameOnOutsidePointer, true);
  if (!rulerRef.value) return;
  rulerResizeObserver = new ResizeObserver(([entry]) => {
    rulerWidth.value = entry?.contentRect.width ?? 0;
  });
  rulerResizeObserver.observe(rulerRef.value);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", finishRenameOnOutsidePointer, true);
  stopPointerInteraction?.();
  rulerResizeObserver?.disconnect();
});
</script>

<template>
  <section class="timeline">
    <div class="timeline__ruler-row">
      <div class="timeline__corner">
        <button class="tool-button tool-button--hurt" type="button" title="Добавить hurtbox" @click="emit('addBox', 'hurtbox')"><b>+</b> HURTBOX</button>
        <button class="tool-button tool-button--hit" type="button" title="Добавить hitbox" @click="emit('addBox', 'hitbox')"><b>+</b> HITBOX</button>
      </div>
      <div ref="rulerRef" class="timeline__ruler" @pointerdown="beginScrub">
        <button v-for="mark in marks" :key="mark" class="timeline__tick" type="button" :style="{ left: `${frameStartPercent(mark)}%` }" @click.stop="emit('update:currentFrame', mark)">
          <span>{{ mark }}</span>
        </button>
      </div>
    </div>

    <div class="timeline__track-list">
      <div v-for="box in state.boxes" :key="box.id" class="timeline__track" :class="{ 'timeline__track--selected': selectedBoxIds.includes(box.id) }">
        <div class="timeline__track-label" @click="emit('selectBox', box.id, $event.shiftKey, false)" @dblclick="beginRename(box)">
          <i :class="`timeline__kind timeline__kind--${box.kind}`" />
          <div class="timeline__track-meta">
            <input v-if="editingId === box.id" :ref="setNameInputRef" v-model="editingName" class="timeline__name-input" @click.stop @dblclick.stop @keydown.enter="commitRename(box)" @keydown.escape="editingId = null" @blur="commitRename(box)" />
            <template v-else>
              <strong :title="`${getName(box)} — двойной клик для переименования`">{{ getName(box) }}</strong>
              <span>{{ box.kind }}</span>
            </template>
          </div>
          <div class="timeline__track-actions">
            <button v-if="editingId !== box.id" class="timeline__track-action timeline__edit-name" type="button" title="Редактировать название" @click.stop="beginRename(box)" @dblclick.stop>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.3-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.3 16 4 20ZM14.7 6.6l3 3" /></svg>
            </button>
            <button class="timeline__track-action timeline__delete" type="button" :title="selectedBoxIds.includes(box.id) && selectedBoxIds.length > 1 ? 'Удалить выбранные коллайдеры' : 'Удалить коллайдер'" @click.stop="emit('requestRemove', selectedBoxIds.includes(box.id) ? selectedBoxIds : [box.id], { x: $event.clientX, y: $event.clientY })" @dblclick.stop>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
            </button>
          </div>
        </div>

        <div class="timeline__lane" @pointerdown="beginScrub">
          <div v-for="mark in marks" :key="`grid-${mark}`" class="timeline__grid-line" :class="{ 'timeline__grid-line--major': isMajorMark(mark) }" :style="{ left: `${frameStartPercent(mark)}%` }" />
          <button class="timeline__bar" type="button" :class="[`timeline__bar--${box.kind}`, { 'timeline__bar--selected': selectedBoxIds.includes(box.id) }]" :style="getBarStyle(box)" @pointerdown="beginMove($event, box)" @click.stop>
            <span class="timeline__bar-label">{{ box.frames[1] - box.frames[0] + 1 }}</span>
            <i class="timeline__handle timeline__handle--start" @pointerdown="beginResize($event, box, 0)" />
            <i class="timeline__handle timeline__handle--end" @pointerdown="beginResize($event, box, 1)" />
          </button>
        </div>
      </div>

      <div v-if="state.boxes.length === 0" class="timeline__empty">
        <span>Нет коллайдеров</span>
        <button type="button" @click="emit('addBox', 'hurtbox')">Добавить первый</button>
      </div>
    </div>

    <template v-for="box in selectedBoxes" :key="`boundaries-${box.id}`">
      <div class="timeline__boundary" :style="{ left: `calc(208px + (100% - 208px) * ${boundaryPercent(box.frames[0], 'start') / 100})` }">
        <span>{{ box.frames[0] }}</span>
      </div>
      <div class="timeline__boundary" :style="{ left: `calc(208px + (100% - 208px) * ${boundaryPercent(box.frames[1], 'end') / 100})` }">
        <span>{{ box.frames[1] }}</span>
      </div>
    </template>

    <div class="timeline__playhead" :style="{ left: `calc(208px + (100% - 208px) * ${frameStartPercent(currentFrame) / 100})` }">
      <span>{{ currentFrame }}</span>
    </div>
  </section>
</template>

<style scoped lang="scss">
.timeline {
  --label-width: 208px;
  position: relative;
  min-height: 0;
  height: 100%;
  background: var(--surface);
  color: var(--text);
  overflow: hidden;
  user-select: none;

  &__ruler-row, &__track { display: grid; grid-template-columns: var(--label-width) minmax(0, 1fr); }

  &__ruler-row { position: relative; z-index: 2; height: 40px; border-bottom: 1px solid var(--border); background: var(--surface-subtle); }

  &__corner { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-right: 1px solid var(--border); }

  &__ruler { position: relative; min-width: 0; overflow: hidden; cursor: ew-resize; background: linear-gradient(to bottom, var(--surface-muted), var(--surface-subtle)); }

  &__tick {
    position: absolute; bottom: 0; width: 1px; height: 13px; padding: 0; border: 0; background: var(--text-muted); color: var(--text-secondary); cursor: pointer;
    &::after { position: absolute; bottom: 0; left: 0; width: 1px; height: 6px; background: var(--border-strong); content: ""; }
    span { position: absolute; top: -12px; left: 4px; font-size: 9px; font-variant-numeric: tabular-nums; }
  }

  &__track-list { height: calc(100% - 40px); overflow-y: auto; }

  &__track { height: 52px; border-bottom: 1px solid var(--border-soft); }
  &__track--selected { background: var(--state-accent-soft); }

  &__track-label { position: relative; z-index: 3; display: grid; grid-template-columns: 5px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-width: 0; padding: 6px 8px; border-right: 1px solid var(--border); background: var(--surface-muted); cursor: default; }
  &__track--selected &__track-label { border-left: 3px solid var(--state-accent); background: var(--state-accent-soft); padding-left: 5px; }

  &__kind { width: 5px; height: 34px; border-radius: 3px; &--hurtbox { background: var(--collider-hurtbox); } &--hitbox { background: var(--collider-hitbox); } }
  &__track-meta { display: grid; align-content: center; gap: 2px; min-width: 0; }
  &__track-meta strong { min-width: 0; overflow: hidden; color: var(--text); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  &__track-meta span { color: var(--text-muted); font-size: 8px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
  &__track-actions { display: flex; align-items: center; gap: 5px; }
  &__track-action { display: grid; width: 32px; height: 32px; flex: 0 0 auto; padding: 7px; place-items: center; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text-muted); cursor: pointer; }
  &__track-action svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
  &__edit-name:hover { border-color: color-mix(in srgb, var(--state-accent) 55%, var(--border)); background: var(--state-accent-soft); color: var(--state-accent); }
  &__name-input { min-width: 0; width: 100%; height: 28px; padding: 3px 6px; border: 1px solid var(--state-accent); border-radius: 4px; outline: 0; background: var(--input-bg); color: var(--text); font-size: 12px; }
  &__delete:hover { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); background: var(--danger-soft); color: var(--danger); }

  &__lane { position: relative; min-width: 0; overflow: hidden; background: color-mix(in srgb, var(--surface) 92%, var(--surface-subtle)); cursor: crosshair; }
  &__track:nth-child(even) &__lane { background: var(--surface-muted); }
  &__grid-line { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--border-soft); pointer-events: none; &--major { background: var(--border); } }

  &__bar { position: absolute; top: 0; height: 100%; min-width: 5px; padding: 0 10px; border: 1px solid color-mix(in srgb, #000 28%, transparent); border-radius: 4px; box-shadow: none; cursor: grab; overflow: visible; touch-action: none; &:active { cursor: grabbing; } }
  &__bar--hurtbox { background: var(--collider-hurtbox); color: var(--collider-hurtbox-text); }
  &__bar--hitbox { background: var(--collider-hitbox); color: var(--collider-hitbox-text); }
  &__bar--selected { border-color: var(--collider-selected); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--collider-selected) 48%, transparent); }
  &__bar-label { display: block; overflow: hidden; font-size: 18px; font-weight: 850; line-height: 50px; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
  &__handle { position: absolute; top: 0; bottom: 0; width: 10px; border: 0; border-inline: 1px solid color-mix(in srgb, currentColor 55%, transparent); background: color-mix(in srgb, currentColor 22%, transparent); cursor: ew-resize; opacity: 0; }
  &__bar--selected &__handle { opacity: 1; }
  &__handle--start { left: 0; border-radius: 3px 0 0 3px; }
  &__handle--end { right: 0; border-radius: 0 3px 3px 0; }

  &__empty { display: grid; height: 100%; place-content: center; justify-items: center; gap: 8px; color: var(--text-muted); font-size: 11px; button { padding: 5px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text-secondary); cursor: pointer; } }

  &__boundary, &__playhead { position: absolute; z-index: 4; top: 0; bottom: 0; width: 0; border-left: 1px dashed color-mix(in srgb, var(--state-accent) 78%, transparent); pointer-events: none; }
  &__boundary span { position: absolute; top: 2px; left: 3px; padding: 1px 3px; border-radius: 2px; background: var(--state-accent); color: #fff; font-size: 9px; font-variant-numeric: tabular-nums; }
  &__playhead { z-index: 5; border-left: 1px solid var(--state-accent); }
  &__playhead::before { position: absolute; top: 0; left: -4px; width: 7px; height: 7px; background: var(--state-accent); content: ""; transform: rotate(45deg); }
  &__playhead span { display: none; }
}

.tool-button { height: 29px; flex: 1; padding: 0 7px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text-secondary); font-size: 8px; font-weight: 800; letter-spacing: .03em; cursor: pointer; }
.tool-button b { margin-right: 2px; font-size: 14px; line-height: 1; }
.tool-button--hurt { border-color: color-mix(in srgb, var(--collider-hurtbox) 48%, var(--border)); background: color-mix(in srgb, var(--collider-hurtbox) 10%, var(--surface)); color: var(--collider-hurtbox); }
.tool-button--hit { border-color: color-mix(in srgb, var(--collider-hitbox) 48%, var(--border)); background: color-mix(in srgb, var(--collider-hitbox) 10%, var(--surface)); color: var(--collider-hitbox); }
.tool-button:hover { background: color-mix(in srgb, currentColor 14%, var(--surface)); }
</style>
