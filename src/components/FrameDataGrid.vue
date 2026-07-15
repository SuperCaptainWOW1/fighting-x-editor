<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useProject } from "../composables/useProject";
import {
  getStateCategory,
  STATE_CATEGORIES,
  type StateCategoryId,
} from "../utils/stateCategory";
import ExportPanel from "./ExportPanel.vue";
import FrameDataCard from "./FrameDataCard.vue";
import ThemeToggle from "./ThemeToggle.vue";

const {
  state,
  entryList,
  deletedEntryList,
  profileStructureChanges,
  exportSelection,
  prepareExportSelection,
  toggleExportName,
  exportSelected,
  synchronizeAllEntries,
  returnToProfileSelection,
  createState,
  deleteState,
  restoreLastDeletedState,
} = useProject();
const router = useRouter();

const showExport = ref(false);
const showSyncConfirmation = ref(false);
const isSynchronizing = ref(false);
const synchronizationError = ref<string | null>(null);
const showCreateState = ref(false);
const newStateName = ref("");
const newStateCategory = ref<StateCategoryId>("movement");
const createStateError = ref<string | null>(null);
const isCreatingState = ref(false);
const stateToDelete = ref<string | null>(null);
const deleteStateError = ref<string | null>(null);
const isDeletingState = ref(false);
const isRestoringDeletedState = ref(false);
const restoreDeletedStateError = ref<string | null>(null);
const collapsedGroupIds = ref<string[]>([]);
const COLLAPSED_GROUPS_STORAGE_KEY = "framedata-editor-collapsed-categories";
const defaultClipByEntry = computed(() =>
  Object.fromEntries(
    entryList.value.map((entry) => [
      entry.name,
      entry.data.animations.left || entry.data.animations.right || "",
    ]),
  ),
);
const groupedEntries = computed(() =>
  STATE_CATEGORIES.map((category) => {
    const belongsToCategory = (entry: (typeof entryList.value)[number]) =>
      getStateCategory(entry.name, entry.data.category).id === category.id;
    return {
      ...category,
      entries: entryList.value.filter(belongsToCategory),
      deletedEntries: deletedEntryList.value.filter(belongsToCategory),
    };
  }).filter((group) => group.entries.length + group.deletedEntries.length > 0),
);
const hasProfileStructureChanges = computed(
  () =>
    profileStructureChanges.value.added.length > 0 ||
    profileStructureChanges.value.deleted.length > 0,
);
const maxDuration = computed(() =>
  Math.max(1, ...entryList.value.map((entry) => entry.data.duration)),
);

const toggleGroup = (groupId: string) => {
  collapsedGroupIds.value = collapsedGroupIds.value.includes(groupId)
    ? collapsedGroupIds.value.filter((id) => id !== groupId)
    : [...collapsedGroupIds.value, groupId];
  try {
    window.localStorage.setItem(
      COLLAPSED_GROUPS_STORAGE_KEY,
      JSON.stringify(collapsedGroupIds.value),
    );
  } catch {
    // The category toggles still work when browser storage is unavailable.
  }
};

const isTextEditingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true;
  return target instanceof HTMLInputElement &&
    ["text", "search", "email", "url", "tel", "password"].includes(
      target.type || "text",
    );
};

const handleDeletedStateUndo = async (event: KeyboardEvent) => {
  const isUndoShortcut =
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "z";

  if (
    !isUndoShortcut ||
    event.defaultPrevented ||
    event.repeat ||
    isTextEditingTarget(event.target) ||
    showExport.value ||
    showSyncConfirmation.value ||
    showCreateState.value ||
    Boolean(stateToDelete.value) ||
    isRestoringDeletedState.value ||
    deletedEntryList.value.length === 0
  ) {
    return;
  }

  event.preventDefault();
  restoreDeletedStateError.value = null;
  isRestoringDeletedState.value = true;
  try {
    await restoreLastDeletedState();
  } catch (error) {
    restoreDeletedStateError.value =
      error instanceof Error
        ? error.message
        : "Не удалось восстановить удалённое состояние";
  } finally {
    isRestoringDeletedState.value = false;
  }
};

onMounted(() => {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY) ?? "[]",
    );
    if (Array.isArray(stored)) {
      collapsedGroupIds.value = stored.filter(
        (value): value is string => typeof value === "string",
      );
    }
  } catch {
    collapsedGroupIds.value = [];
  }
  window.addEventListener("keydown", handleDeletedStateUndo, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleDeletedStateUndo, true);
});

const openExport = () => {
  prepareExportSelection(entryList.value.map((entry) => entry.name));
  showExport.value = true;
};

const handleExport = async () => {
  await exportSelected(exportSelection.value, true);
  showExport.value = false;
};

const openSynchronizationConfirmation = () => {
  synchronizationError.value = null;
  showSyncConfirmation.value = true;
};

const confirmSynchronization = async () => {
  isSynchronizing.value = true;
  synchronizationError.value = null;

  try {
    await synchronizeAllEntries();
    showSyncConfirmation.value = false;
  } catch (error) {
    synchronizationError.value =
      error instanceof Error
        ? error.message
        : "Не удалось синхронизировать состояния";
  } finally {
    isSynchronizing.value = false;
  }
};

const openCreateState = () => {
  newStateName.value = "";
  newStateCategory.value = "movement";
  createStateError.value = null;
  showCreateState.value = true;
};

const confirmCreateState = async () => {
  isCreatingState.value = true;
  createStateError.value = null;
  try {
    const stateName = await createState(newStateName.value, newStateCategory.value);
    showCreateState.value = false;
    await router.push({ name: "state", params: { stateName } });
  } catch (error) {
    createStateError.value =
      error instanceof Error ? error.message : "Не удалось создать состояние";
  } finally {
    isCreatingState.value = false;
  }
};

const requestStateDeletion = (name: string) => {
  deleteStateError.value = null;
  stateToDelete.value = name;
};

const confirmStateDeletion = async () => {
  const name = stateToDelete.value;
  if (!name) return;
  isDeletingState.value = true;
  deleteStateError.value = null;
  try {
    await deleteState(name);
    stateToDelete.value = null;
  } catch (error) {
    deleteStateError.value =
      error instanceof Error ? error.message : "Не удалось удалить состояние";
  } finally {
    isDeletingState.value = false;
  }
};
</script>

<template>
  <section class="grid-screen">
    <header class="grid-screen__header">
      <div class="grid-screen__title">
        <div class="grid-screen__title-copy">
          <h1>Frame Data</h1>
          <p>{{ entryList.length }} состояний</p>
        </div>
        <div v-if="state.activeProfileName" class="profile-control">
            <div class="profile-control__identity" :title="`Активный профиль: ${state.activeProfileName}`">
              <span class="profile-control__text">
                <small>Профиль</small>
                <strong>{{ state.activeProfileName }}</strong>
              </span>
              <div
                v-if="hasProfileStructureChanges"
                class="profile-control__changes"
                tabindex="0"
                aria-label="Есть несохранённые изменения состава профиля"
              >
                <i />
                <div class="profile-control__tooltip" role="tooltip">
                  <strong>Несохранённые изменения профиля</strong>
                  <section v-if="profileStructureChanges.added.length">
                    <span>Добавлено</span>
                    <ul><li v-for="name in profileStructureChanges.added" :key="`added-${name}`">{{ name }}</li></ul>
                  </section>
                  <section v-if="profileStructureChanges.deleted.length">
                    <span>Удалено</span>
                    <ul><li v-for="name in profileStructureChanges.deleted" :key="`deleted-${name}`">{{ name }}</li></ul>
                  </section>
                  <small>Применится после сохранения профиля</small>
                </div>
              </div>
            </div>
            <button
              class="profile-control__switch"
              type="button"
              title="Выбрать другой профиль или создать новый"
              @click="returnToProfileSelection"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3 3m-3-3 3-3" /></svg>
              <span>Сменить</span>
            </button>
        </div>
      </div>
      <div class="grid-screen__actions">
        <button class="button grid-screen__sync-button" type="button" @click="openSynchronizationConfirmation">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 15 6.7L21 16" />
            <path d="M21 21v-5h-5" />
          </svg>
          <span>Синхронизировать все</span>
        </button>
        <button class="button button--primary" type="button" @click="openExport">
          Сохранить все
        </button>
        <div class="topbar-theme-control">
          <ThemeToggle />
        </div>
      </div>
      <button class="grid-screen__add-state" type="button" title="Добавить состояние" aria-label="Добавить состояние" @click="openCreateState">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Добавить состояние
      </button>
    </header>

    <div class="state-groups">
      <section
        v-for="group in groupedEntries"
        :key="group.id"
        class="state-group"
        :class="[
          `state-group--${group.id}`,
          { 'state-group--collapsed': collapsedGroupIds.includes(group.id) },
        ]"
      >
        <header class="state-group__header">
          <div class="state-group__identity"><i /><h2>{{ group.label }}</h2></div>
          <div class="state-group__actions">
            <span>{{ group.entries.length }}</span>
            <button
              type="button"
              :title="collapsedGroupIds.includes(group.id) ? 'Развернуть категорию' : 'Свернуть категорию'"
              :aria-expanded="!collapsedGroupIds.includes(group.id)"
              @click="toggleGroup(group.id)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path :d="collapsedGroupIds.includes(group.id) ? 'm5 9 7 7 7-7' : 'm5 15 7-7 7 7'" />
              </svg>
            </button>
          </div>
        </header>
        <div v-if="!collapsedGroupIds.includes(group.id)" class="state-group__entries">
          <FrameDataCard
            v-for="entry in group.entries"
            :key="entry.name"
            :entry="entry"
            :clip-name="defaultClipByEntry[entry.name] ?? ''"
            :category="group.id"
            :max-duration="maxDuration"
            :is-new="state.addedStateNames.includes(entry.name)"
            @remove="requestStateDeletion"
          />
          <FrameDataCard
            v-for="entry in group.deletedEntries"
            :key="`deleted-${entry.name}`"
            :entry="entry"
            clip-name=""
            :category="group.id"
            :max-duration="maxDuration"
            is-deleted
          />
        </div>
      </section>
    </div>

    <div v-if="restoreDeletedStateError" class="grid-screen__restore-error" role="alert">
      {{ restoreDeletedStateError }}
    </div>

    <ExportPanel
      v-if="showExport"
      :entries="entryList"
      :selected-names="exportSelection"
      @close="showExport = false"
      @toggle="toggleExportName"
      @export="handleExport"
    />

    <div v-if="showSyncConfirmation" class="grid-sync" @click.self="!isSynchronizing && (showSyncConfirmation = false)">
      <section class="grid-sync__dialog" role="dialog" aria-modal="true" aria-labelledby="grid-sync-title">
        <span class="grid-sync__icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 15 6.7L21 16" />
            <path d="M21 21v-5h-5" />
          </svg>
        </span>
        <h2 id="grid-sync-title">Синхронизировать все состояния?</h2>
        <p>
          Все несохранённые изменения будут заменены актуальными данными из
          выбранного профиля.
        </p>
        <p v-if="synchronizationError" class="grid-sync__error">{{ synchronizationError }}</p>
        <div class="grid-sync__actions">
          <button class="button" type="button" :disabled="isSynchronizing" @click="showSyncConfirmation = false">Отмена</button>
          <button class="button button--primary" type="button" :disabled="isSynchronizing" @click="confirmSynchronization">
            {{ isSynchronizing ? "Синхронизация…" : "Синхронизировать все" }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="showCreateState" class="state-modal" @click.self="!isCreatingState && (showCreateState = false)">
      <section class="state-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="create-state-title">
        <header>
          <div>
            <span class="state-modal__icon state-modal__icon--add">+</span>
            <div><h2 id="create-state-title">Новое состояние</h2><p>Без коллайдеров и анимаций, длительность 10 кадров.</p></div>
          </div>
          <button type="button" title="Закрыть" :disabled="isCreatingState" @click="showCreateState = false">×</button>
        </header>
        <label class="state-modal__field">
          <span>Название</span>
          <input v-model="newStateName" type="text" autocomplete="off" placeholder="NEW_STATE" @keydown.enter="confirmCreateState" />
        </label>
        <label class="state-modal__field">
          <span>Тип состояния</span>
          <select v-model="newStateCategory">
            <option v-for="category in STATE_CATEGORIES" :key="category.id" :value="category.id">{{ category.label }}</option>
          </select>
        </label>
        <p v-if="createStateError" class="state-modal__error">{{ createStateError }}</p>
        <footer>
          <button class="button" type="button" :disabled="isCreatingState" @click="showCreateState = false">Отмена</button>
          <button class="button button--primary" type="button" :disabled="isCreatingState || !newStateName.trim()" @click="confirmCreateState">
            {{ isCreatingState ? "Создаём…" : "Создать" }}
          </button>
        </footer>
      </section>
    </div>

    <div v-if="stateToDelete" class="state-modal" @click.self="!isDeletingState && (stateToDelete = null)">
      <section class="state-modal__dialog state-modal__dialog--delete" role="dialog" aria-modal="true" aria-labelledby="delete-state-title">
        <span class="state-modal__icon state-modal__icon--delete">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>
        </span>
        <h2 id="delete-state-title">Удалить {{ stateToDelete }}?</h2>
        <p>Состояние будет помечено на удаление. Изменение применится после сохранения профиля.</p>
        <p v-if="deleteStateError" class="state-modal__error">{{ deleteStateError }}</p>
        <footer>
          <button class="button" type="button" :disabled="isDeletingState" @click="stateToDelete = null">Отмена</button>
          <button class="button state-modal__danger" type="button" :disabled="isDeletingState" @click="confirmStateDeletion">
            {{ isDeletingState ? "Удаляем…" : "Удалить" }}
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped lang="scss">
.grid-screen {
  min-height: 100vh;
  padding: 0 24px 32px;
  background: var(--app-bg);
  color: var(--text);

  &__header {
    position: sticky;
    z-index: 12;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: var(--topbar-height);
    margin: 0 -24px 22px;
    padding: var(--topbar-padding);
    border-bottom: 1px solid var(--border);
    background: var(--surface-translucent);
    backdrop-filter: blur(12px);

    h1 {
      margin: 0;
      font-size: 18px;
      letter-spacing: -.025em;
    }

    p {
      margin: 2px 0 0;
      color: var(--text-muted);
      font-size: 9px;
    }
  }

  &__title { align-self: stretch; display: flex; align-items: center; gap: 14px; min-width: 0; }
  &__title-copy { flex: 0 0 auto; }

  &__actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__add-state { position: absolute; top: 50%; left: 50%; display: flex; align-items: center; gap: 7px; height: 36px; padding: 0 13px; border: 1px solid color-mix(in srgb, #ef5e4d 52%, var(--border)); border-radius: 6px; background: color-mix(in srgb, #ef5e4d 10%, var(--surface)); color: color-mix(in srgb, #ef5e4d 82%, var(--text)); font-size: 11px; font-weight: 700; cursor: pointer; transform: translate(-50%, -50%); }
  &__add-state:hover { border-color: #ef5e4d; background: color-mix(in srgb, #ef5e4d 16%, var(--surface)); }
  &__add-state svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 2; }

  &__restore-error { position: fixed; z-index: 60; right: 18px; bottom: 18px; max-width: min(360px, calc(100vw - 36px)); padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--danger) 48%, var(--border)); border-radius: 7px; background: var(--danger-soft); color: var(--danger); font-size: 11px; line-height: 1.4; }

  &__sync-button svg { display: none; width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }

}

.profile-control {
  position: relative;
  display: flex;
  align-items: stretch;
  align-self: stretch;
  min-height: 48px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: visible;

  &__identity { position: relative; display: flex; align-items: center; gap: 9px; min-width: 0; padding: 7px 14px; border-radius: 7px 0 0 7px; background: var(--surface); }
  &__text { display: grid; min-width: 0; line-height: 1.05; }
  &__text small { color: var(--text-muted); font-size: 8px; font-weight: 750; letter-spacing: .075em; text-transform: uppercase; }
  &__text strong { max-width: 180px; margin-top: 3px; overflow: hidden; color: var(--text); font-size: 13px; font-weight: 740; text-overflow: ellipsis; white-space: nowrap; }

  &__switch { display: flex; align-items: center; gap: 6px; padding: 0 13px; border: 0; border-left: 1px solid var(--border); border-radius: 0 7px 7px 0; background: var(--surface-muted); color: var(--text-secondary); font-size: 10px; font-weight: 680; cursor: pointer; }
  &__switch svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
  &__switch:hover { background: color-mix(in srgb, #ef5e4d 10%, var(--surface)); color: #ef5e4d; }

  &__changes { position: relative; display: grid; width: 18px; height: 18px; flex: 0 0 auto; place-items: center; border: 1px solid color-mix(in srgb, var(--danger) 52%, var(--border)); border-radius: 50%; outline: 0; background: var(--danger-soft); cursor: help; }
  &__changes > i { width: 6px; height: 6px; border-radius: 50%; background: var(--danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 13%, transparent); }
  &__tooltip { position: absolute; z-index: 80; top: calc(100% + 11px); left: 50%; width: min(300px, calc(100vw - 32px)); padding: 12px; border: 1px solid color-mix(in srgb, var(--danger) 32%, var(--border)); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow-lg); color: var(--text); opacity: 0; pointer-events: none; transform: translate(-50%, -4px); transition: opacity .14s ease, transform .14s ease; visibility: hidden; }
  &__tooltip::before { position: absolute; top: -5px; left: calc(50% - 5px); width: 9px; height: 9px; border-top: 1px solid color-mix(in srgb, var(--danger) 32%, var(--border)); border-left: 1px solid color-mix(in srgb, var(--danger) 32%, var(--border)); background: var(--surface); content: ""; transform: rotate(45deg); }
  &__changes:hover &__tooltip, &__changes:focus-visible &__tooltip { opacity: 1; transform: translate(-50%, 0); visibility: visible; }
  &__tooltip > strong { display: block; margin-bottom: 9px; font-size: 11px; }
  &__tooltip section { display: grid; grid-template-columns: 68px 1fr; gap: 7px; padding: 7px 0; border-top: 1px solid var(--border-soft); }
  &__tooltip section > span { color: var(--text-muted); font-size: 8px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
  &__tooltip ul { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
  &__tooltip li { padding: 2px 5px; border-radius: 3px; background: var(--surface-muted); color: var(--text-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; }
  &__tooltip small { display: block; margin-top: 8px; color: var(--text-muted); font-size: 9px; }
}

.state-groups { display: grid; gap: 14px; }
.state-group {
  --category: #279d8b;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--category) 20%, var(--border));
  border-radius: 9px;
  background: color-mix(in srgb, var(--category) 3%, transparent);

  &--attack { --category: #ef5e4d; }
  &--damage { --category: var(--category-damage); }
  &--block { --category: #3d7fda; }
}
.state-group__header { display: flex; align-items: center; justify-content: space-between; min-height: 40px; padding: 0 8px 0 0; border-bottom: 1px solid var(--border-soft); background: var(--surface-muted); color: var(--text); }
.state-group--collapsed .state-group__header { border-bottom: 0; }
.state-group__header > div { display: flex; align-items: center; gap: 8px; }
.state-group__identity { align-self: stretch; min-width: 168px; padding: 8px 14px 8px 12px; background: var(--category); color: #fff; }
.state-group__header i { width: 7px; height: 7px; border: 2px solid rgba(255,255,255,.72); border-radius: 50%; }
.state-group__header h2 { margin: 0; font-size: 12px; font-weight: 750; letter-spacing: .055em; text-transform: uppercase; }
.state-group__header span { display: grid; min-width: 23px; height: 23px; padding: 0 6px; place-items: center; border-radius: 12px; background: color-mix(in srgb, var(--category) 12%, var(--surface)); color: var(--category); font-size: 11px; font-weight: 800; }
.state-group__actions { display: flex; align-items: center; gap: 7px; }
.state-group__actions button { display: grid; width: 27px; height: 27px; padding: 0; place-items: center; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text-secondary); cursor: pointer; }
.state-group__actions button:hover { border-color: color-mix(in srgb, var(--category) 52%, var(--border)); background: color-mix(in srgb, var(--category) 9%, var(--surface)); color: var(--category); }
.state-group__actions svg { display: block; width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.state-group__entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); gap: 12px; padding: 13px; }

.grid-sync { position: fixed; z-index: 40; inset: 0; display: grid; padding: 24px; place-items: center; background: var(--overlay); backdrop-filter: blur(5px); }
.grid-sync__dialog { display: grid; justify-items: center; width: min(440px, 100%); padding: 26px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); box-shadow: var(--shadow-lg); text-align: center; }
.grid-sync__icon { display: grid; width: 42px; height: 42px; margin-bottom: 12px; place-items: center; border: 1px solid color-mix(in srgb, #ef5e4d 55%, var(--border)); border-radius: 50%; background: color-mix(in srgb, #ef5e4d 14%, var(--surface)); color: #ef5e4d; font-size: 24px; }
.grid-sync__icon svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
.grid-sync h2 { margin: 0; color: var(--text); font-size: 18px; }
.grid-sync p { margin: 10px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.grid-sync__error { width: 100%; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--danger) 55%, var(--border)); border-radius: 5px; background: var(--danger-soft); color: var(--danger) !important; }
.grid-sync__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-top: 20px; }

.state-modal { position: fixed; z-index: 50; inset: 0; display: grid; padding: 24px; place-items: center; background: var(--overlay); backdrop-filter: blur(5px); }
.state-modal__dialog { width: min(440px, 100%); padding: 20px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); box-shadow: var(--shadow-lg); color: var(--text); }
.state-modal__dialog > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 18px; }
.state-modal__dialog > header > div { display: flex; align-items: center; gap: 11px; }
.state-modal__dialog > header button { width: 28px; height: 28px; padding: 0; border: 0; background: transparent; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.state-modal h2 { margin: 0; font-size: 17px; }
.state-modal p { margin: 5px 0 0; color: var(--text-secondary); font-size: 11px; line-height: 1.45; }
.state-modal__icon { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 8px; font-size: 22px; }
.state-modal__icon--add { border: 1px solid color-mix(in srgb, #ef5e4d 45%, var(--border)); background: color-mix(in srgb, #ef5e4d 12%, var(--surface)); color: #ef5e4d; }
.state-modal__icon--delete { margin: 0 auto 12px; border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border)); background: var(--danger-soft); color: var(--danger); }
.state-modal__icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.state-modal__field { display: grid; gap: 6px; margin-top: 12px; color: var(--text-secondary); font-size: 11px; }
.state-modal__field input, .state-modal__field select { width: 100%; height: 36px; padding: 6px 9px; border: 1px solid var(--border); border-radius: 6px; outline: 0; background: var(--input-bg); color: var(--text); }
.state-modal__field input { text-transform: uppercase; }
.state-modal__field input:focus, .state-modal__field select:focus { border-color: #ef5e4d; box-shadow: 0 0 0 2px color-mix(in srgb, #ef5e4d 13%, transparent); }
.state-modal__error { padding: 7px 9px; border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border)); border-radius: 5px; background: var(--danger-soft); color: var(--danger) !important; }
.state-modal footer { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 20px; }
.state-modal__dialog--delete { text-align: center; }
.state-modal__dialog--delete > p { max-width: 330px; margin: 8px auto 0; }
.state-modal__danger { border-color: color-mix(in srgb, var(--danger) 72%, var(--border)); background: var(--danger); color: #fff; }
.state-modal__danger:hover:not(:disabled) { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 88%, #000); }

@media (max-width: 800px) {
  .grid-screen__add-state { width: 36px; padding: 0; justify-content: center; font-size: 0; }
  .profile-control__text strong { max-width: 96px; }
  .profile-control__switch { padding-inline: 8px; }
  .profile-control__switch span { display: none; }
}

@media (max-width: 640px) {
  .grid-screen__title p { display: none; }
}

@media (max-width: 520px) {
  .grid-screen__actions .button { min-width: 34px; padding-inline: 7px; font-size: 0; }
  .grid-screen__sync-button svg { display: block; }
  .grid-screen__actions .button:nth-of-type(2)::after { content: "✓"; font-size: 13px; }
}
</style>
