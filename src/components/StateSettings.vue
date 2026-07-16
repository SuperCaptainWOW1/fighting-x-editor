<script setup lang="ts">
import { computed } from "vue";
import type { EditorStateData, FrameWindow } from "../types/framedata";

const props = withDefaults(
  defineProps<{
    state: EditorStateData;
    clipNames: string[];
    previewSide: "left" | "right";
    isAttack: boolean;
    changedFields?: Record<string, boolean>;
  }>(),
  { changedFields: () => ({}) },
);

const emit = defineEmits<{
  historyStart: [];
  historyEnd: [];
  "update:duration": [value: number];
  "update:loop": [value: boolean];
  "update:lockWhenFinished": [value: boolean];
  "update:blendFramesNumber": [value: number];
  "update:cancelWindow": [value: FrameWindow | undefined];
  "update:previewSide": [value: "left" | "right"];
  "update:animations": [side: "left" | "right", value: string];
}>();

const currentAnimation = computed(() => props.state.animations[props.previewSide]);
const visibleClipNames = computed(() => {
  const sidePrefix = props.previewSide === "left" ? "A_StanceA" : "A_StanceB";

  return props.clipNames.filter(
    (clipName) =>
      clipName.startsWith(sidePrefix) && !clipName.toLowerCase().endsWith("empty"),
  );
});
const hasExclusiveFieldsConflict = computed(
  () => Boolean(props.state.loop && props.state.lockWhenFinished),
);
const EXCLUSIVE_FIELDS_WARNING =
  "Эти два поля не могу существовать вместе. Выберите одно. Иначе иметь значение будет только Фиксировать в конце";

const addCancelWindow = () => {
  emit("update:cancelWindow", [1, props.state.duration]);
};

const updateCancelWindowFrame = (edge: 0 | 1, event: Event) => {
  const rawValue = (event.target as HTMLInputElement).value;
  if (rawValue === "") return;

  const value = Math.min(
    props.state.duration,
    Math.max(1, Math.round(Number(rawValue) || 1)),
  );
  const next = [
    ...(props.state.cancelWindow ?? [1, props.state.duration]),
  ] as FrameWindow;

  if (edge === 0) next[0] = Math.min(value, next[1]);
  else next[1] = Math.max(value, next[0]);

  emit("update:cancelWindow", next);
};

</script>

<template>
  <section class="state-settings">
    <div class="section-title-row">
      <h3 class="panel-title">Общие настройки</h3>
      <span
        v-if="hasExclusiveFieldsConflict"
        class="settings-warning"
        tabindex="0"
        role="img"
        :aria-label="EXCLUSIVE_FIELDS_WARNING"
        :data-tooltip="EXCLUSIVE_FIELDS_WARNING"
      >!</span>
    </div>

    <label class="field" :class="{ 'field--changed': changedFields.duration }">
      <span>Длительность</span>
      <input
        type="number"
        min="1"
        :value="state.duration"
        @focus="emit('historyStart')"
        @blur="emit('historyEnd')"
        @input="
          emit(
            'update:duration',
            Number(($event.target as HTMLInputElement).value),
          )
        "
      />
    </label>

    <label class="field" :class="{ 'field--changed': changedFields.blendFramesNumber }">
      <span>Длительность бленда</span>
      <input
        type="number"
        min="0"
        :value="state.blendFramesNumber"
        @focus="emit('historyStart')"
        @blur="emit('historyEnd')"
        @input="
          emit(
            'update:blendFramesNumber',
            Number(($event.target as HTMLInputElement).value),
          )
        "
      />
    </label>

    <label class="toggle-field" :class="{ 'toggle-field--changed': changedFields.loop }">
      <span>Цикличное состояние</span>
      <input
        type="checkbox"
        :checked="state.loop ?? false"
        @change="emit('update:loop', ($event.target as HTMLInputElement).checked)"
      />
      <i aria-hidden="true" />
    </label>

    <label class="toggle-field" :class="{ 'toggle-field--changed': changedFields.lockWhenFinished }">
      <span>Фиксировать в конце</span>
      <input
        type="checkbox"
        :checked="state.lockWhenFinished ?? false"
        @change="
          emit(
            'update:lockWhenFinished',
            ($event.target as HTMLInputElement).checked,
          )
        "
      />
      <i aria-hidden="true" />
    </label>

    <div
      v-if="isAttack"
      class="cancel-window"
      :class="{ 'cancel-window--changed': changedFields.cancelWindow }"
    >
      <div class="cancel-window__heading">
        <span>Окно комбо</span>
        <button
          v-if="state.cancelWindow"
          type="button"
          title="Удалить окно комбо"
          @click="emit('update:cancelWindow', undefined)"
        >
          Удалить
        </button>
      </div>

      <button
        v-if="!state.cancelWindow"
        class="cancel-window__add"
        type="button"
        @click="addCancelWindow"
      >
        <b>+</b> Добавить окно
      </button>

      <div v-else class="cancel-window__fields">
        <label class="field">
          <span>Начало</span>
          <input
            type="number"
            min="1"
            :max="state.cancelWindow[1]"
            :value="state.cancelWindow[0]"
            @focus="emit('historyStart')"
            @blur="emit('historyEnd')"
            @input="updateCancelWindowFrame(0, $event)"
          />
        </label>
        <label class="field">
          <span>Конец</span>
          <input
            type="number"
            :min="state.cancelWindow[0]"
            :max="state.duration"
            :value="state.cancelWindow[1]"
            @focus="emit('historyStart')"
            @blur="emit('historyEnd')"
            @input="updateCancelWindowFrame(1, $event)"
          />
        </label>
      </div>
    </div>

    <div class="state-settings__divider" />
    <h3 class="panel-title">Анимация</h3>

    <div class="field">
      <span>Сторона</span>
      <div class="field__row">
        <button
          class="button"
          :class="{ 'button--active': previewSide === 'left' }"
          type="button"
          @click="emit('update:previewSide', 'left')"
        >
          Левая
        </button>
        <button
          class="button"
          :class="{ 'button--active': previewSide === 'right' }"
          type="button"
          @click="emit('update:previewSide', 'right')"
        >
          Правая
        </button>
      </div>
    </div>

    <label class="field" :class="{ 'field--changed': changedFields.animations }">
      <span>Клип</span>
      <div class="select-control" :class="{ 'select-control--changed': changedFields.animations }">
        <select
          :value="currentAnimation"
          @change="emit('update:animations', previewSide, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">Не выбран</option>
          <option v-for="clipName in visibleClipNames" :key="clipName" :value="clipName">
            {{ clipName }}
          </option>
        </select>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </div>
    </label>
  </section>
</template>

<style scoped lang="scss">
.state-settings {
  display: grid;
  gap: 12px;
  padding: 14px;
  color: var(--text);

  &__divider {
    height: 1px;
    margin: 4px -14px 0;
    background: var(--border-soft);
  }
}

.field .select-control {
  position: relative;
  min-width: 0;

  select {
    width: 100%;
    height: 34px;
    padding: 5px 34px 5px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    outline: 0;
    appearance: none;
    background: var(--input-bg);
    color: var(--text);
    cursor: pointer;
    text-overflow: ellipsis;

    &:hover { border-color: var(--border-strong); }
    &:focus { border-color: var(--state-accent); box-shadow: 0 0 0 2px var(--state-accent-soft); }
  }

  svg {
    position: absolute;
    top: 50%;
    right: 10px;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--text-muted);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
    pointer-events: none;
    transform: translateY(-50%);
  }

  &--changed select {
    border-color: color-mix(in srgb, var(--state-accent) 68%, var(--border));
    background: var(--state-accent-soft);
    box-shadow: inset 3px 0 0 var(--state-accent);
  }
}

.field {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);

  &__row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;

    .button--active {
      border-color: var(--state-accent);
      background: var(--state-accent-soft);
      color: color-mix(in srgb, var(--state-accent) 78%, var(--text));
    }
  }

  input,
  select {
    width: 100%;
    height: 30px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    outline: 0;
    background: var(--input-bg);
    color: var(--text);

    &:focus {
      border-color: var(--state-accent);
      box-shadow: 0 0 0 2px var(--state-accent-soft);
    }
  }

  &--changed {
    > span {
      color: var(--state-accent);
      font-weight: 650;
    }

    > input,
    > select {
      border-color: color-mix(in srgb, var(--state-accent) 68%, var(--border));
      background: var(--state-accent-soft);
      box-shadow: inset 3px 0 0 var(--state-accent);
    }
  }
}

.cancel-window {
  display: grid;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--surface-muted);

  &__heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 12px;

    button {
      padding: 2px 5px;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      font-size: 10px;
      cursor: pointer;

      &:hover { color: var(--danger); }
    }
  }

  &__fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  &__add {
    height: 30px;
    border: 1px dashed color-mix(in srgb, var(--state-accent) 48%, var(--border));
    border-radius: 5px;
    background: color-mix(in srgb, var(--state-accent) 7%, var(--surface));
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;

    b { margin-right: 3px; color: var(--state-accent); font-size: 14px; }
    &:hover { background: var(--state-accent-soft); color: var(--state-accent); }
  }

  &--changed {
    border-color: color-mix(in srgb, var(--state-accent) 62%, var(--border));
    background: color-mix(in srgb, var(--state-accent) 8%, var(--surface-muted));
    box-shadow: inset 3px 0 0 var(--state-accent);

    .cancel-window__heading > span {
      color: var(--state-accent);
      font-weight: 650;
    }
  }
}

.panel-title {
  margin: 0;
  color: var(--text);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.settings-warning {
  position: relative;
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid #d34f3f;
  border-radius: 50%;
  background: #ef5e4d;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  cursor: help;

  &::after {
    position: absolute;
    z-index: 20;
    top: calc(100% + 8px);
    left: 0;
    width: 232px;
    padding: 8px 10px;
    border: 1px solid #17191b;
    border-radius: 4px;
    background: #111315;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    color: #e5e6e7;
    content: attr(data-tooltip);
    font-size: 10px;
    font-weight: 400;
    line-height: 1.45;
    opacity: 0;
    pointer-events: none;
    text-align: left;
    transform: translateY(-3px);
    transition: 120ms ease;
  }

  &:hover::after,
  &:focus::after {
    opacity: 1;
    transform: translateY(0);
  }
}

.toggle-field {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 30px;
  align-items: center;
  min-height: 24px;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;

  input {
    position: absolute;
    opacity: 0;
  }

  i {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: 10px;
    background: var(--surface-subtle);
    box-shadow: inset 0 0 0 1px var(--border-strong);

    &::after {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--text-muted);
      content: "";
      transition: 120ms ease;
    }
  }

  input:checked + i {
    background: var(--state-accent);

    &::after {
      left: 15px;
      background: #fff;
    }
  }

  &--changed {
    > span {
      color: var(--state-accent);
      font-weight: 650;
    }

    i {
      box-shadow:
        inset 0 0 0 1px var(--state-accent),
        0 0 0 1px var(--state-accent-soft);
    }
  }
}
</style>
