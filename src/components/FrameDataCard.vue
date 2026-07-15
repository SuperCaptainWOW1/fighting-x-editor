<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { FrameDataEntry } from "../types/framedata";
import type { StateCategoryId } from "../utils/stateCategory";
import PreviewCanvas from "./PreviewCanvas.vue";

const {
  entry,
  clipName,
  category,
  maxDuration,
  isNew = false,
  isDeleted = false,
} = defineProps<{
  entry: FrameDataEntry;
  clipName: string;
  category: StateCategoryId;
  maxDuration: number;
  isNew?: boolean;
  isDeleted?: boolean;
}>();

const emit = defineEmits<{
  remove: [name: string];
}>();

const previewFrame = computed(() => 1);
</script>

<template>
  <component
    :is="isDeleted ? 'article' : RouterLink"
    class="frame-card"
    :class="[
      `frame-card--${category}`,
      { 'frame-card--new': isNew, 'frame-card--deleted': isDeleted },
    ]"
    :to="isDeleted ? undefined : { name: 'state', params: { stateName: entry.name } }"
  >
    <button
      v-if="!isDeleted"
      class="frame-card__delete"
      type="button"
      title="Удалить состояние"
      aria-label="Удалить состояние"
      @click.prevent.stop="emit('remove', entry.name)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
    </button>
    <div class="frame-card__preview">
      <span v-if="isNew" class="frame-card__badge">Новое</span>
      <PreviewCanvas
        v-if="!isDeleted"
        :state="entry.data"
        :clip-name="clipName"
        :frame="previewFrame"
        autoplay
        deferred
      />
      <div v-else class="frame-card__deleted-placeholder" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
        <span>Удалено</span>
      </div>
    </div>

    <div class="frame-card__body">
      <div class="frame-card__header">
        <h2>{{ entry.name }}</h2>
      </div>

      <div class="frame-card__meta-row">
        <p class="frame-card__meta">{{ entry.data.duration }} кадров</p>
        <div class="frame-card__duration" aria-hidden="true"><i :style="{ width: `${(entry.data.duration / maxDuration) * 100}%` }" /></div>
        <span
          class="frame-card__status"
          :class="{ 'frame-card__status--dirty': entry.isDirty || isNew || isDeleted }"
        >
          {{ isDeleted ? "будет удалено" : isNew ? "новое" : entry.isDirty ? "не сохранено" : "сохранено" }}
        </span>
      </div>
    </div>
  </component>
</template>

<style scoped lang="scss">
.frame-card {
  --category: #279d8b;
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(48px, auto);
  gap: 0;
  min-width: 0;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--category) 28%, var(--border));
  border-top: 3px solid var(--category);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  color: inherit;
  cursor: pointer;
  text-decoration: none;
  transition: border-color .15s ease, transform .15s ease;

  &--attack { --category: #ef5e4d; }
  &--damage { --category: var(--category-damage); }
  &--block { --category: #3d7fda; }

  &--new {
    border-color: color-mix(in srgb, var(--category) 68%, var(--border));
    background: color-mix(in srgb, var(--category) 9%, var(--surface));
  }

  &--deleted {
    opacity: .42;
    border-style: dashed;
    border-color: color-mix(in srgb, var(--category) 54%, var(--border));
    background: color-mix(in srgb, var(--surface-muted) 72%, transparent);
    cursor: default;
    filter: saturate(.55);
  }

  &--deleted:hover {
    border-color: color-mix(in srgb, var(--category) 54%, var(--border));
    transform: none;
  }

  &:hover {
    border-color: var(--category);
    transform: translateY(-1px);
  }

  &__preview {
    position: relative;
    min-width: 0;
    width: 100%;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    border: 1px solid var(--border-soft);
    border-radius: 5px;
    background: var(--viewport-bg);
  }

  &__badge { position: absolute; z-index: 3; top: 8px; left: 8px; padding: 4px 7px; border: 1px solid color-mix(in srgb, var(--category) 60%, var(--border)); border-radius: 4px; background: color-mix(in srgb, var(--category) 18%, var(--surface)); color: var(--category); font-size: 8px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }

  &__deleted-placeholder { display: grid; height: 100%; place-content: center; justify-items: center; gap: 8px; background: repeating-linear-gradient(-45deg, transparent 0 8px, color-mix(in srgb, var(--border-soft) 55%, transparent) 8px 9px); color: var(--text-muted); }
  &__deleted-placeholder svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.35; }
  &__deleted-placeholder span { font-size: 9px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }

  &__delete { position: absolute; z-index: 4; top: 13px; right: 13px; display: grid; width: 30px; height: 30px; padding: 6px; place-items: center; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-glass); color: var(--text-muted); cursor: pointer; backdrop-filter: blur(6px); }
  &__delete:hover { border-color: color-mix(in srgb, var(--danger) 58%, var(--border)); background: var(--danger-soft); color: var(--danger); }
  &__delete svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }

  &__body { display: grid; align-content: center; min-width: 0; padding: 9px 3px 2px; }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    margin: 0;
    overflow: hidden;
    color: var(--text);
    font-size: 13px;
    font-weight: 750;
    letter-spacing: .01em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    margin: 0;
    color: var(--text-secondary);
    font-size: 10px;
  }

  &__meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
    white-space: nowrap;
  }

  &__status {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--success);

    &--dirty {
      color: var(--danger);
    }
  }

  &__duration { display: none; height: 5px; overflow: hidden; border-radius: 3px; background: var(--border-soft); }
  &__duration i { display: block; height: 100%; border-radius: inherit; background: var(--category); }

}

@media (max-width: 720px) {
  .frame-card__preview { aspect-ratio: 16 / 9; }
}
</style>
