<script setup lang="ts">
import { computed } from "vue";
import type { FrameDataEntry } from "../types/framedata";

const props = defineProps<{
  entries: FrameDataEntry[];
  selectedNames: string[];
}>();

const emit = defineEmits<{
  close: [];
  toggle: [name: string, enabled: boolean];
  export: [];
}>();

const allSelected = computed(
  () =>
    props.entries.length > 0 &&
    props.entries.every((entry) => props.selectedNames.includes(entry.name)),
);

const toggleAll = (enabled: boolean) => {
  props.entries.forEach((entry) => emit("toggle", entry.name, enabled));
};
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal">
      <header>
        <h3>Сохранение</h3>
        <button class="button button--ghost" type="button" @click="emit('close')">
          ×
        </button>
      </header>

      <label class="export-all">
        <input
          type="checkbox"
          :checked="allSelected"
          @change="toggleAll(($event.target as HTMLInputElement).checked)"
        />
        Выбрать все
      </label>

      <ul class="export-list">
        <li v-for="entry in entries" :key="entry.name">
          <label>
            <input
              type="checkbox"
              :checked="selectedNames.includes(entry.name)"
              @change="
                emit(
                  'toggle',
                  entry.name,
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            <span>{{ entry.name }}</span>
          </label>
          <span
            class="export-list__status"
            :class="{ 'export-list__status--dirty': entry.isDirty }"
          >
            {{ entry.isDirty ? "изменено" : "на диске" }}
          </span>
        </li>
      </ul>

      <footer>
        <button class="button button--primary" type="button" @click="emit('export')">
          Сохранить
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.modal-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--overlay);
  backdrop-filter: blur(5px);
  z-index: 20;
}

.modal {
  width: min(520px, calc(100vw - 32px));
  display: grid;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  color: var(--text);

  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h3 {
    margin: 0;
  }
}

.export-all {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
}

.export-list {
  display: grid;
  gap: 8px;
  max-height: 360px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-soft);
    background: var(--surface-muted);
  }

  label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  &__status {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--success);

    &--dirty {
      color: var(--danger);
    }
  }
}
</style>
