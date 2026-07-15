<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useProject } from "../composables/useProject";

const {
  state,
  connectProjectSource,
  reconnectProjectSource,
  selectProjectProfile,
  createProjectProfile,
} = useProject();

const isRemote = state.storageMode === "remote";
const errorMessage = ref("");
const isLoading = ref(false);
const isCreatingProfile = ref(false);
const selectedProfileName = ref(
  state.activeProfileName ?? state.profiles[0]?.name ?? "",
);
const newProfileName = ref("");
const sourceProfileName = ref("");
const selectedStateNames = ref<string[]>([]);

const sourceProfile = computed(() =>
  state.profiles.find((profile) => profile.name === sourceProfileName.value) ?? null,
);
const sourceStateNames = computed(() =>
  Object.keys(sourceProfile.value?.project.framedata ?? {}).sort((left, right) =>
    left.localeCompare(right),
  ),
);
const returnProfileName = computed(() => {
  const activeName = state.activeProfileName;
  return activeName && state.profiles.some((profile) => profile.name === activeName)
    ? activeName
    : null;
});

watch(
  () => state.profiles,
  (profiles) => {
    if (!profiles.some((profile) => profile.name === selectedProfileName.value)) {
      selectedProfileName.value = profiles[0]?.name ?? "";
    }
  },
  { deep: true },
);

watch(sourceProfileName, () => {
  selectedStateNames.value = [...sourceStateNames.value];
});

const runAction = async (action: () => Promise<void>) => {
  errorMessage.value = "";
  isLoading.value = true;

  try {
    await action();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Не удалось загрузить проект";
  } finally {
    isLoading.value = false;
  }
};

const openSelectedProfile = () => {
  if (!selectedProfileName.value) {
    errorMessage.value = "Выберите профиль";
    return;
  }
  void runAction(() => selectProjectProfile(selectedProfileName.value));
};

const returnToActiveProfile = () => {
  if (!returnProfileName.value) return;
  void runAction(() => selectProjectProfile(returnProfileName.value!));
};

const createProfile = () => {
  void runAction(() =>
    createProjectProfile(
      newProfileName.value,
      sourceProfileName.value || null,
      selectedStateNames.value,
    ),
  );
};

const toggleState = (stateName: string, enabled: boolean) => {
  selectedStateNames.value = enabled
    ? [...selectedStateNames.value, stateName]
    : selectedStateNames.value.filter((name) => name !== stateName);
};

const closeCreation = () => {
  isCreatingProfile.value = false;
  newProfileName.value = "";
  sourceProfileName.value = "";
  selectedStateNames.value = [];
  errorMessage.value = "";
};
</script>

<template>
  <section class="setup-screen">
    <div class="setup-screen__card" :class="{ 'setup-screen__card--profiles': isRemote }">
      <template v-if="isRemote">
        <template v-if="!isCreatingProfile">
          <button
            v-if="returnProfileName"
            class="setup-screen__return"
            type="button"
            :disabled="isLoading"
            :title="`Вернуться в профиль «${returnProfileName}»`"
            @click="returnToActiveProfile"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
            Назад
          </button>
          <div class="setup-screen__eyebrow">Frame Data Editor</div>
          <h1>Выберите профиль</h1>
          <p>Все стейты, анимации и коллайдеры загружаются из выбранного профиля.</p>

          <label v-if="state.profiles.length > 0" class="setup-field">
            <span>Профиль</span>
            <select v-model="selectedProfileName">
              <option v-for="profile in state.profiles" :key="profile.name" :value="profile.name">
                {{ profile.name }} · {{ Object.keys(profile.project.framedata).length }} стейтов
              </option>
            </select>
          </label>
          <div v-else class="setup-screen__empty">
            Профилей пока нет. Создайте первый пустой профиль.
          </div>

          <div class="setup-screen__actions setup-screen__actions--row">
            <button
              class="button button--primary"
              type="button"
              :disabled="isLoading || !selectedProfileName"
              @click="openSelectedProfile"
            >
              {{ isLoading ? "Загружаем..." : "Открыть профиль" }}
            </button>
            <button class="button" type="button" :disabled="isLoading" @click="isCreatingProfile = true">
              Создать профиль
            </button>
          </div>
        </template>

        <template v-else>
          <button class="setup-screen__back" type="button" :disabled="isLoading" @click="closeCreation">← Назад</button>
          <h1>Новый профиль</h1>
          <p>Создайте пустой профиль или скопируйте в него выбранные стейты.</p>

          <label class="setup-field">
            <span>Название профиля</span>
            <input v-model.trim="newProfileName" type="text" autocomplete="off" placeholder="Например, Vladimir" @keydown.enter="createProfile" />
          </label>

          <label class="setup-field">
            <span>Основа</span>
            <select v-model="sourceProfileName">
              <option value="">Пустой профиль</option>
              <option v-for="profile in state.profiles" :key="profile.name" :value="profile.name">
                Копировать из «{{ profile.name }}»
              </option>
            </select>
          </label>

          <section v-if="sourceProfile" class="copy-states">
            <header>
              <div>
                <strong>Стейты для копирования</strong>
                <span>{{ selectedStateNames.length }} из {{ sourceStateNames.length }}</span>
              </div>
              <div>
                <button type="button" @click="selectedStateNames = [...sourceStateNames]">Все</button>
                <button type="button" @click="selectedStateNames = []">Ни одного</button>
              </div>
            </header>
            <div v-if="sourceStateNames.length > 0" class="copy-states__list">
              <label v-for="stateName in sourceStateNames" :key="stateName">
                <input
                  type="checkbox"
                  :checked="selectedStateNames.includes(stateName)"
                  @change="toggleState(stateName, ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ stateName }}</span>
              </label>
            </div>
            <p v-else>В выбранном профиле нет стейтов.</p>
          </section>

          <button class="button button--primary setup-screen__create" type="button" :disabled="isLoading || !newProfileName" @click="createProfile">
            {{ isLoading ? "Создаём..." : "Создать и открыть" }}
          </button>
        </template>

        <p v-if="state.initError" class="setup-screen__error">{{ state.initError }}</p>
        <p v-if="errorMessage" class="setup-screen__error">{{ errorMessage }}</p>
      </template>

      <template v-else>
        <h1>Frame Data Editor</h1>
        <p>
          Выберите папку с JSON-фреймдатой и <code>stateToAnimation.json</code> из
          проекта fighting.
        </p>

        <p v-if="state.initError" class="setup-screen__hint setup-screen__hint--error">
          {{ state.initError }}
        </p>
        <p v-else-if="state.emptyDirectoryMessage" class="setup-screen__hint setup-screen__hint--warning">
          {{ state.emptyDirectoryMessage }}
        </p>

        <div class="setup-screen__actions">
          <button v-if="state.hasSavedConnection" class="button button--primary" type="button" :disabled="isLoading" @click="runAction(reconnectProjectSource)">
            {{ isLoading ? "Загружаем..." : "Переподключить сохранённую папку" }}
          </button>
          <button class="button" :class="{ 'button--primary': !state.hasSavedConnection }" type="button" :disabled="isLoading" @click="runAction(connectProjectSource)">
            {{ isLoading ? "Загружаем..." : "Выбрать папку framedata" }}
          </button>
        </div>
        <p v-if="errorMessage" class="setup-screen__error">{{ errorMessage }}</p>
      </template>
    </div>
  </section>
</template>

<style scoped lang="scss">
.setup-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(circle at 50% 25%, rgba(239, 94, 77, .12), transparent 34%),
    var(--app-bg);

  &__card {
    width: min(520px, 100%);
    padding: 32px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-translucent);
    box-shadow: var(--shadow-lg);
    color: var(--text);

    &--profiles { width: min(620px, 100%); }
  }

  &__eyebrow { margin-bottom: 7px; color: #ef5e4d; font-size: 10px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
  h1 { margin: 0 0 10px; font-size: 27px; }
  p { margin: 0 0 20px; color: var(--text-secondary); line-height: 1.5; }
  code { color: var(--danger); }

  &__actions { display: grid; gap: 10px; }
  &__actions--row { grid-template-columns: 1fr 1fr; margin-top: 18px; }
  &__empty { padding: 18px; border: 1px dashed var(--border); border-radius: 7px; background: var(--surface-muted); color: var(--text-muted); font-size: 13px; text-align: center; }
  &__back { margin: -10px 0 18px; padding: 0; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; }
  &__back:hover { color: var(--text); }
  &__return { display: inline-flex; align-items: center; gap: 5px; margin: -12px 0 17px; padding: 4px 7px 4px 4px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-muted); color: var(--text-secondary); font-size: 11px; cursor: pointer; }
  &__return:hover:not(:disabled) { border-color: var(--border-strong); background: var(--surface-hover); color: var(--text); }
  &__return:disabled { opacity: .5; cursor: default; }
  &__return svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
  &__create { width: 100%; margin-top: 18px; }

  &__hint { margin-bottom: 16px; font-size: 14px; }
  &__hint--error, &__error { color: var(--danger); }
  &__hint--warning { color: var(--warning); }
  &__error { margin: 14px 0 0; font-size: 13px; }
}

.setup-field {
  display: grid;
  gap: 6px;
  margin-top: 14px;
  color: var(--text-secondary);
  font-size: 12px;

  input, select {
    width: 100%;
    height: 38px;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    outline: 0;
    background: var(--input-bg);
    color: var(--text);
  }

  input:focus, select:focus { border-color: #ef5e4d; box-shadow: 0 0 0 2px color-mix(in srgb, #ef5e4d 15%, transparent); }
}

.copy-states {
  margin-top: 16px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-muted);
  overflow: hidden;

  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border-soft); }
  header > div { display: flex; align-items: center; gap: 8px; }
  header strong { font-size: 12px; }
  header span { color: var(--text-muted); font-size: 10px; }
  header button { padding: 3px 6px; border: 0; background: transparent; color: #ef5e4d; font-size: 10px; cursor: pointer; }
  p { margin: 0; padding: 18px; font-size: 12px; text-align: center; }

  &__list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); max-height: 230px; padding: 6px; overflow: auto; }
  &__list label { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 6px; border-radius: 4px; color: var(--text-secondary); font-size: 11px; cursor: pointer; }
  &__list label:hover { background: var(--surface-hover); color: var(--text); }
  &__list input { flex: 0 0 auto; }
  &__list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}

@media (max-width: 540px) {
  .setup-screen { padding: 12px; }
  .setup-screen__card { padding: 22px; }
  .setup-screen__actions--row, .copy-states__list { grid-template-columns: 1fr; }
}
</style>
