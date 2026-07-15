<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type {
  BoxPropertyUpdate,
  EditorBoxBase,
  HurtboxPresetName,
} from "../types/framedata";
import { HURTBOX_PRESET_OPTIONS } from "../utils/framedata";

const props = withDefaults(
  defineProps<{
    boxes: EditorBoxBase[];
    title?: string;
    duration: number;
    changedFields?: Record<string, boolean>;
  }>(),
  { changedFields: () => ({}) },
);

const emit = defineEmits<{
  historyStart: [];
  historyEnd: [];
  update: [update: BoxPropertyUpdate];
  rename: [name: string];
  remove: [event: MouseEvent];
}>();

const primaryBox = computed(() => props.boxes[props.boxes.length - 1] ?? null);
const isMultiple = computed(() => props.boxes.length > 1);
const allHurtboxes = computed(
  () => props.boxes.length > 0 && props.boxes.every((box) => box.kind === "hurtbox"),
);
const allHitboxes = computed(
  () => props.boxes.length > 0 && props.boxes.every((box) => box.kind === "hitbox"),
);
const canEditTransform = computed(
  () => props.boxes.length > 0 && props.boxes.every((box) => !box.preset),
);
const isRenaming = ref(false);
const editingName = ref("");
const nameInputRef = ref<HTMLInputElement | null>(null);

const beginRename = async () => {
  if (!primaryBox.value || isMultiple.value) return;
  editingName.value = primaryBox.value.name || props.title || "";
  isRenaming.value = true;
  await nextTick();
  nameInputRef.value?.focus();
  nameInputRef.value?.select();
};

const commitRename = () => {
  if (!isRenaming.value) return;
  const name = editingName.value.trim();
  isRenaming.value = false;
  if (name && name !== primaryBox.value?.name) emit("rename", name);
};

watch(() => primaryBox.value?.id, () => {
  isRenaming.value = false;
});

const commonValue = <T>(getter: (box: EditorBoxBase) => T) => {
  const [first, ...rest] = props.boxes;
  if (!first) return "";
  const value = getter(first);
  return rest.every((box) => Object.is(getter(box), value)) ? value : "";
};

const commonFrameStart = computed(() => commonValue((box) => box.frames[0]));
const commonFrameEnd = computed(() => commonValue((box) => box.frames[1]));
const commonPreset = computed(() => {
  const value = commonValue((box) => box.preset);
  return value === "" && props.boxes.some((box) => box.preset !== props.boxes[0]?.preset)
    ? "__mixed__"
    : value ?? "";
});
const commonType = computed(() => commonValue((box) => box.type) || "__mixed__");
const commonDamage = computed(() => commonValue((box) => box.damage ?? 0));
const commonVectorValue = (field: "size" | "position", axis: 0 | 1 | 2) =>
  commonValue((box) => box[field][axis]);

const updateFrame = (edge: 0 | 1, value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  emit("update", {
    property: edge === 0 ? "frameStart" : "frameEnd",
    value: parsed,
  });
};

const applyPreset = (value: string) => {
  if (value === "__mixed__") return;
  emit("update", {
    property: "preset",
    value: value ? (value as HurtboxPresetName) : undefined,
  });
};

const updateNumber = (
  field: "size" | "position",
  axis: 0 | 1 | 2,
  value: string,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  emit("update", { property: field, axis, value: parsed });
};

</script>

<template>
  <aside v-if="primaryBox" class="box-inspector">
    <header class="box-inspector__header">
      <span class="box-inspector__type" :class="allHitboxes ? 'box-inspector__type--hitbox' : allHurtboxes ? 'box-inspector__type--hurtbox' : 'box-inspector__type--mixed'">
        {{ primaryBox.kind }}
      </span>
      <div class="box-inspector__title">
        <input
          v-if="isRenaming"
          ref="nameInputRef"
          v-model="editingName"
          class="box-inspector__name-input"
          @keydown.enter.prevent="commitRename"
          @keydown.escape.prevent="isRenaming = false"
          @blur="commitRename"
        />
        <template v-else>
          <h2>{{ title }}</h2>
          <button v-if="!isMultiple" class="box-inspector__edit-name" type="button" title="Редактировать название" @click="beginRename">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.3-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.3 16 4 20ZM14.7 6.6l3 3" /></svg>
          </button>
        </template>
      </div>
      <button class="icon-button" type="button" :title="isMultiple ? 'Удалить выбранные коллайдеры' : 'Удалить коллайдер'" @click="emit('remove', $event)">
        ×
      </button>
    </header>

    <section class="inspector-section">
      <h3>Диапазон кадров<sup v-if="isMultiple">*</sup></h3>
      <div class="vector-field vector-field--two">
        <label :class="{ 'vector-field__changed': changedFields.frameStart }"><span>Начало<sup v-if="isMultiple">*</sup></span><input type="number" min="1" :max="duration" :value="commonFrameStart" placeholder="—" @focus="emit('historyStart')" @blur="emit('historyEnd')" @input="updateFrame(0, ($event.target as HTMLInputElement).value)" /></label>
        <label :class="{ 'vector-field__changed': changedFields.frameEnd }"><span>Конец<sup v-if="isMultiple">*</sup></span><input type="number" min="1" :max="duration" :value="commonFrameEnd" placeholder="—" @focus="emit('historyStart')" @blur="emit('historyEnd')" @input="updateFrame(1, ($event.target as HTMLInputElement).value)" /></label>
      </div>
    </section>

    <section v-if="allHurtboxes" class="inspector-section">
      <h3>Форма коллайдера<sup v-if="isMultiple">*</sup></h3>
      <label class="field" :class="{ 'field--changed': changedFields.preset }">
        <span>Пресет<sup v-if="isMultiple">*</sup></span>
        <select :value="commonPreset" @change="applyPreset(($event.target as HTMLSelectElement).value)">
          <option v-if="commonPreset === '__mixed__'" value="__mixed__" disabled>— разные —</option>
          <option value="">Пользовательский</option>
          <option v-for="presetName in HURTBOX_PRESET_OPTIONS" :key="presetName" :value="presetName">{{ presetName }}</option>
        </select>
      </label>
      <label v-if="canEditTransform" class="field" :class="{ 'field--changed': changedFields.type }">
        <span>Тип зоны<sup v-if="isMultiple">*</sup></span>
        <select :value="commonType" @change="emit('update', { property: 'type', value: ($event.target as HTMLSelectElement).value })">
          <option v-if="commonType === '__mixed__'" value="__mixed__" disabled>— разные —</option>
          <option value="head">Голова</option>
          <option value="body">Корпус</option>
          <option value="legs">Ноги</option>
        </select>
      </label>
    </section>

    <section v-if="canEditTransform" class="inspector-section">
      <h3>Трансформация<sup v-if="isMultiple">*</sup></h3>
      <p class="inspector-label">Размер<sup v-if="isMultiple">*</sup></p>
      <div class="vector-field">
        <label v-for="(axis, index) in ['X', 'Y', 'Z']" :key="`size-${axis}`" :class="{ 'vector-field__changed': changedFields[`size${index}`] }"><span>{{ axis }}<sup v-if="isMultiple">*</sup></span><input type="number" step="0.01" :value="commonVectorValue('size', index as 0 | 1 | 2)" placeholder="—" @focus="emit('historyStart')" @blur="emit('historyEnd')" @input="updateNumber('size', index as 0 | 1 | 2, ($event.target as HTMLInputElement).value)" /></label>
      </div>
      <p class="inspector-label">Позиция<sup v-if="isMultiple">*</sup></p>
      <div class="vector-field">
        <label v-for="(axis, index) in ['X', 'Y', 'Z']" :key="`position-${axis}`" :class="{ 'vector-field__changed': changedFields[`position${index}`] }"><span>{{ axis }}<sup v-if="isMultiple">*</sup></span><input type="number" step="0.01" :value="commonVectorValue('position', index as 0 | 1 | 2)" placeholder="—" @focus="emit('historyStart')" @blur="emit('historyEnd')" @input="updateNumber('position', index as 0 | 1 | 2, ($event.target as HTMLInputElement).value)" /></label>
      </div>
    </section>

    <section v-if="allHitboxes" class="inspector-section">
      <h3>Атака<sup v-if="isMultiple">*</sup></h3>
      <label class="field" :class="{ 'field--changed': changedFields.damage }">
        <span>Урон<sup v-if="isMultiple">*</sup></span>
        <input type="number" min="0" :value="commonDamage" placeholder="—" @focus="emit('historyStart')" @blur="emit('historyEnd')" @input="emit('update', { property: 'damage', value: Number(($event.target as HTMLInputElement).value) })" />
      </label>
    </section>

    <footer v-if="isMultiple" class="box-inspector__multiple-note"><sup>*</sup> редактирование всех выбранных коллайдеров</footer>
  </aside>

  <aside v-else class="box-inspector box-inspector--empty">
    <div class="box-inspector__empty-icon">◇</div>
    <strong>Коллайдер не выбран</strong>
    <p>Выберите рамку в окне просмотра или дорожку на таймлайне.</p>
  </aside>
</template>

<style scoped lang="scss">
.box-inspector {
  min-height: 0;
  background: var(--surface);
  color: var(--text);
  overflow: auto;

  &--empty {
    display: grid;
    align-content: center;
    justify-items: center;
    padding: 28px;
    color: var(--text-muted);
    text-align: center;

    strong { color: var(--text); font-size: 13px; }
    p { max-width: 210px; margin: 8px 0 0; font-size: 11px; line-height: 1.45; }
  }

  &__empty-icon { margin-bottom: 8px; color: var(--state-accent); font-size: 34px; }

  &__header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-muted);

    h2 { margin: 0; overflow: hidden; color: var(--text); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
  }

  &__title { display: flex; align-items: center; gap: 4px; min-width: 0; }
  &__title h2 { min-width: 0; flex: 1; }
  &__edit-name { display: grid; width: 24px; height: 24px; flex: 0 0 auto; padding: 4px; place-items: center; border: 0; border-radius: 4px; background: transparent; color: var(--text-muted); cursor: pointer; }
  &__edit-name:hover { background: var(--surface-subtle); color: var(--state-accent); }
  &__edit-name svg { display: block; width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
  &__name-input { min-width: 0; width: 100%; height: 28px; padding: 4px 6px; border: 1px solid var(--state-accent); border-radius: 4px; outline: 0; background: var(--input-bg); color: var(--text); font-size: 12px; }

  &__type {
    width: 8px;
    height: 8px;
    overflow: hidden;
    border-radius: 50%;
    color: transparent;
    font-size: 0;
    &--hitbox { background: var(--collider-hitbox); }
    &--hurtbox { background: var(--collider-hurtbox); }
    &--mixed { background: linear-gradient(var(--collider-hurtbox) 0 50%, var(--collider-hitbox) 50%); }
  }

  &__multiple-note { padding: 11px 12px; color: var(--text-secondary); font-size: 10px; line-height: 1.4; }
  &__multiple-note sup { color: var(--state-accent); font-size: 12px; font-weight: 800; }
}

.inspector-section {
  display: grid;
  gap: 9px;
  padding: 13px 12px 15px;
  border-bottom: 1px solid var(--border-soft);

  h3 { margin: 0 0 2px; color: var(--text); font-size: 11px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
  sup { color: var(--state-accent); font-size: 10px; }
}

.inspector-label { margin: 2px 0 -3px; color: var(--text-secondary); font-size: 11px; }
.inspector-label sup, .field sup, .vector-field sup { color: var(--state-accent); font-size: 9px; font-weight: 800; }

.field {
  display: grid;
  grid-template-columns: minmax(70px, .9fr) minmax(0, 1.1fr);
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 11px;

  input, select { min-width: 0; width: 100%; height: 28px; padding: 4px 7px; border: 1px solid var(--border); border-radius: 5px; outline: 0; background: var(--input-bg); color: var(--text); }
  input:focus, select:focus { border-color: var(--state-accent); box-shadow: 0 0 0 2px var(--state-accent-soft); }

  &--changed {
    > span { color: var(--state-accent); font-weight: 650; }
    input, select { border-color: color-mix(in srgb, var(--state-accent) 68%, var(--border)); background: var(--state-accent-soft); box-shadow: inset 3px 0 0 var(--state-accent); }
  }
}

.vector-field {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;

  &--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  label { display: grid; grid-template-columns: auto 1fr; align-items: center; min-width: 0; border: 1px solid var(--border); border-radius: 5px; background: var(--input-bg); overflow: hidden; }
  span { padding-left: 6px; color: var(--text-muted); font-size: 10px; }
  input { min-width: 0; width: 100%; height: 27px; padding: 4px 5px; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 11px; }
  label:focus-within { border-color: var(--state-accent); box-shadow: 0 0 0 2px var(--state-accent-soft); }
  &__changed { border-color: color-mix(in srgb, var(--state-accent) 68%, var(--border)) !important; background: var(--state-accent-soft) !important; box-shadow: inset 3px 0 0 var(--state-accent); }
  &__changed span { color: var(--state-accent); font-weight: 650; }
}

.icon-button { display: grid; width: 26px; height: 26px; padding: 0; place-items: center; border: 0; border-radius: 4px; background: transparent; color: var(--text-muted); cursor: pointer; &:hover { background: var(--danger-soft); color: var(--danger); } }

.toggle-field {
  position: relative; display: grid; grid-template-columns: 1fr 30px; align-items: center; color: var(--text-secondary); font-size: 11px; cursor: pointer;
  input { position: absolute; opacity: 0; }
  i { position: relative; width: 28px; height: 16px; border-radius: 10px; background: var(--surface-subtle); box-shadow: inset 0 0 0 1px var(--border-strong); }
  i::after { position: absolute; top: 3px; left: 3px; width: 10px; height: 10px; border-radius: 50%; background: var(--text-muted); content: ""; transition: 120ms ease; }
  input:checked + i { background: var(--state-accent); }
  input:checked + i::after { left: 15px; background: #fff; }
  &--changed > span { color: var(--state-accent); font-weight: 650; }
  &--changed i { box-shadow: inset 0 0 0 1px var(--state-accent), 0 0 0 1px var(--state-accent-soft); }
}
</style>
