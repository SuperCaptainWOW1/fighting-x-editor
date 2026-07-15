<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EditorBoxBase, EditorStateData } from "../types/framedata";
import type { ViewportEditMode } from "../types/viewport";
import { SharedPreviewRenderer } from "../three/SharedPreviewRenderer";

const queuedPreviewRenders = new Map<HTMLCanvasElement, () => void>();
let previewQueueFrame: number | null = null;

const flushNextPreviewRender = () => {
  previewQueueFrame = null;
  const next = queuedPreviewRenders.entries().next();

  if (next.done) return;

  const [canvas, renderJob] = next.value;
  queuedPreviewRenders.delete(canvas);
  renderJob();

  if (queuedPreviewRenders.size > 0) {
    previewQueueFrame = window.requestAnimationFrame(flushNextPreviewRender);
  }
};

const queuePreviewRender = (
  canvas: HTMLCanvasElement,
  renderJob: () => void,
) => {
  queuedPreviewRenders.set(canvas, renderJob);

  if (previewQueueFrame === null) {
    previewQueueFrame = window.requestAnimationFrame(flushNextPreviewRender);
  }
};

const props = withDefaults(defineProps<{
  state: EditorStateData;
  clipName: string;
  frame: number;
  selectedBoxIds?: string[];
  isRotated?: boolean;
  autoplay?: boolean;
  deferred?: boolean;
  editMode?: ViewportEditMode;
  layoutKey?: string;
  zoom?: number;
}>(), { selectedBoxIds: () => [], zoom: 1 });

const canvasRef = ref<HTMLCanvasElement | null>(null);
const preview = SharedPreviewRenderer.getInstance();
let hoverTimer: number | null = null;
let hoverFrame = 1;
let resizeObserver: ResizeObserver | null = null;
let visibilityObserver: IntersectionObserver | null = null;
let isVisibleForDeferredRender = !props.deferred;
const marquee = ref<{ left: number; top: number; width: number; height: number } | null>(null);
const panOffset = ref({ x: 0, y: 0 });
const isPanning = ref(false);
const isPointerOverCollider = ref(false);
const boxSelectCursor = ref<{ x: number; y: number } | null>(null);
let stopSelectionInteraction: (() => void) | null = null;

const emit = defineEmits<{
  transformStart: [];
  transformEnd: [];
  selectBoxes: [boxIds: string[], additive: boolean];
  boxSelectComplete: [];
  updateBox: [boxId: string, patch: Partial<EditorBoxBase>];
}>();

const handleTransformUpdate = (
  boxId: string,
  patch: Partial<EditorBoxBase>,
) => {
  emit("updateBox", boxId, patch);
};

const render = (frame: number) => {
  const canvas = canvasRef.value;

  if (
    !canvas ||
    (props.deferred && !isVisibleForDeferredRender)
  ) {
    return;
  }

  const renderJob = () => {
    if (canvasRef.value !== canvas) return;

    preview.renderFrame(
      canvas,
      props.state,
      frame,
      props.clipName,
      props.selectedBoxIds,
      props.isRotated ?? false,
      props.zoom,
      [panOffset.value.x, panOffset.value.y],
      props.editMode
          ? {
            mode: props.editMode,
            onUpdate: handleTransformUpdate,
            onInteractionStart: () => {
              emit("transformStart");
            },
            onInteractionEnd: () => emit("transformEnd"),
          }
        : undefined,
    );
  };

  if (props.deferred) {
    queuePreviewRender(canvas, renderJob);
  } else {
    renderJob();
  }
};

const renderAfterResize = () => {
  render(props.frame);
};

const renderAfterThemeChange = () => {
  render(props.autoplay ? hoverFrame : props.frame);
};

const startHoverPlayback = () => {
  stopHoverPlayback();
  hoverFrame = 1;

  hoverTimer = window.setInterval(() => {
    hoverFrame = hoverFrame >= props.state.duration ? 1 : hoverFrame + 1;
    render(hoverFrame);
  }, 50);
};

const stopHoverPlayback = () => {
  if (hoverTimer !== null) {
    window.clearInterval(hoverTimer);
    hoverTimer = null;
  }
};

const updateBoxSelectCursor = (event: PointerEvent) => {
  const canvas = canvasRef.value;
  if (!canvas || props.editMode !== "box-select") return;
  const rect = canvas.getBoundingClientRect();
  boxSelectCursor.value = {
    x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
    y: Math.min(rect.height, Math.max(0, event.clientY - rect.top)),
  };
};

const updatePointerFeedback = (event: PointerEvent) => {
  const canvas = canvasRef.value;
  if (!canvas || props.autoplay) return;

  if (props.editMode === "box-select") {
    isPointerOverCollider.value = false;
    updateBoxSelectCursor(event);
    return;
  }

  boxSelectCursor.value = null;
  isPointerOverCollider.value = Boolean(preview.pickCollider(
    canvas,
    props.state,
    props.frame,
    event.clientX,
    event.clientY,
    props.isRotated ?? false,
  ));
};

const clearPointerFeedback = () => {
  isPointerOverCollider.value = false;
  boxSelectCursor.value = null;
};

const beginSelection = (event: PointerEvent) => {
  if (event.button !== 0 || !props.editMode || props.autoplay) return;
  const canvas = canvasRef.value;
  if (!canvas) return;

  event.preventDefault();
  stopSelectionInteraction?.();
  const canvasRect = canvas.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const startPan = { ...panOffset.value };
  const pickedAtStart = props.editMode === "box-select"
    ? null
    : preview.pickCollider(
      canvas,
      props.state,
      props.frame,
      startX,
      startY,
      props.isRotated ?? false,
    );
  let hasDragged = false;

  const move = (moveEvent: PointerEvent) => {
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    if (!hasDragged && Math.hypot(deltaX, deltaY) < 4) return;
    hasDragged = true;

    if (props.editMode === "box-select") {
      updateBoxSelectCursor(moveEvent);
      const currentX = Math.min(canvasRect.right, Math.max(canvasRect.left, moveEvent.clientX));
      const currentY = Math.min(canvasRect.bottom, Math.max(canvasRect.top, moveEvent.clientY));
      marquee.value = {
        left: Math.min(startX, currentX) - canvasRect.left,
        top: Math.min(startY, currentY) - canvasRect.top,
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      };
      return;
    }

    // Dragging from empty space grabs the viewport. Starting on a collider is
    // left to TransformControls in G/S modes.
    if (!pickedAtStart && !preview.isTransformingOnCanvas(canvas)) {
      const worldPerPixel = 3.15 / (Math.max(1, canvasRect.height) * props.zoom);
      isPanning.value = true;
      panOffset.value = {
        x: startPan.x - deltaX * worldPerPixel,
        y: startPan.y + deltaY * worldPerPixel,
      };
      render(props.frame);
    }
  };

  const end = (endEvent: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
    stopSelectionInteraction = null;

    if (hasDragged && props.editMode === "box-select" && marquee.value) {
      emit(
        "selectBoxes",
        preview.pickCollidersInRect(
          canvas,
          props.state,
          props.frame,
          {
            left: canvasRect.left + marquee.value.left,
            right: canvasRect.left + marquee.value.left + marquee.value.width,
            top: canvasRect.top + marquee.value.top,
            bottom: canvasRect.top + marquee.value.top + marquee.value.height,
          },
          props.isRotated ?? false,
        ),
        endEvent.shiftKey,
      );
    } else if (!hasDragged) {
      const pickedId = preview.pickCollider(
        canvas,
        props.state,
        props.frame,
        endEvent.clientX,
        endEvent.clientY,
        props.isRotated ?? false,
      );
      emit("selectBoxes", pickedId ? [pickedId] : [], endEvent.shiftKey);
    }

    marquee.value = null;
    isPanning.value = false;
    if (props.editMode === "box-select") emit("boxSelectComplete");
  };

  const cancel = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
    stopSelectionInteraction = null;
    marquee.value = null;
    isPanning.value = false;
    if (props.editMode === "box-select") emit("boxSelectComplete");
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", cancel);
  stopSelectionInteraction = cancel;
};

onMounted(async () => {
  await preview.init();
  window.addEventListener("editor-theme-change", renderAfterThemeChange);

  if (canvasRef.value) {
    resizeObserver = new ResizeObserver(renderAfterResize);
    resizeObserver.observe(canvasRef.value);

    if (props.deferred && "IntersectionObserver" in window) {
      visibilityObserver = new IntersectionObserver(
        ([entry]) => {
          isVisibleForDeferredRender = entry?.isIntersecting ?? false;

          if (isVisibleForDeferredRender) {
            render(props.frame);
          } else {
            stopHoverPlayback();
          }
        },
        { rootMargin: "160px 0px" },
      );
      visibilityObserver.observe(canvasRef.value);
    } else {
      isVisibleForDeferredRender = true;
      render(props.frame);
    }
  }

});

onBeforeUnmount(() => {
  stopHoverPlayback();
  stopSelectionInteraction?.();
  window.removeEventListener("editor-theme-change", renderAfterThemeChange);
  resizeObserver?.disconnect();
  visibilityObserver?.disconnect();

  if (canvasRef.value) {
    preview.clearTransformControls(canvasRef.value);
    queuedPreviewRenders.delete(canvasRef.value);
  }

});

watch(
  () => [props.frame, props.clipName, props.state, props.selectedBoxIds, props.isRotated, props.editMode, props.layoutKey, props.zoom] as const,
  () => {
    if (!props.autoplay) {
      render(props.frame);
    }
  },
  { deep: true, flush: "post" },
);
</script>

<template>
  <div class="preview-surface">
    <canvas
      ref="canvasRef"
      class="preview-canvas"
      :class="[
        editMode ? `preview-canvas--${editMode}` : undefined,
        {
          'preview-canvas--over-collider': isPointerOverCollider,
          'preview-canvas--panning': isPanning,
        },
      ]"
      @mouseenter="autoplay ? startHoverPlayback() : undefined"
      @mouseleave="autoplay ? (stopHoverPlayback(), render(frame)) : clearPointerFeedback()"
      @pointermove="updatePointerFeedback"
      @pointerdown="beginSelection"
    />
    <template v-if="editMode === 'box-select' && boxSelectCursor">
      <i class="box-select-guide box-select-guide--vertical" :style="{ left: `${boxSelectCursor.x}px` }" />
      <i class="box-select-guide box-select-guide--horizontal" :style="{ top: `${boxSelectCursor.y}px` }" />
    </template>
    <div
      v-if="marquee"
      class="selection-marquee"
      :style="{
        left: `${marquee.left}px`,
        top: `${marquee.top}px`,
        width: `${marquee.width}px`,
        height: `${marquee.height}px`,
      }"
    />
  </div>
</template>

<style scoped lang="scss">
.preview-surface { position: relative; width: 100%; height: 100%; overflow: hidden; }
.preview-canvas {
  width: 100%;
  height: 100%;
  display: block;
  background-color: var(--viewport-bg);
  background-image:
    linear-gradient(var(--viewport-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--viewport-grid) 1px, transparent 1px),
    radial-gradient(circle at 50% 43%, var(--viewport-center) 0, var(--viewport-middle) 48%, var(--viewport-edge) 82%);
  background-position: center;
  background-size: 32px 32px, 32px 32px, 100% 100%;

  &--select, &--translate, &--scale { cursor: grab; }
  &--box-select { cursor: crosshair; }
  &--over-collider { cursor: pointer; }
  &--box-select.preview-canvas--over-collider { cursor: crosshair; }
  &--panning { cursor: grabbing; }
}

.box-select-guide {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  opacity: .72;

  &--vertical {
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1px dashed var(--state-accent, #ef5e4d);
  }

  &--horizontal {
    right: 0;
    left: 0;
    height: 0;
    border-top: 1px dashed var(--state-accent, #ef5e4d);
  }
}

.selection-marquee {
  position: absolute;
  z-index: 5;
  border: 1px solid var(--state-accent, #ef5e4d);
  background: color-mix(in srgb, var(--state-accent, #ef5e4d) 14%, transparent);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .38);
  pointer-events: none;
}
</style>
