<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { useProject } from "./composables/useProject";
import SetupScreen from "./components/SetupScreen.vue";

const {
  state,
  hasProject,
  currentEntry,
  initialize,
  openEntry,
  closeEntry,
} = useProject();
const route = useRoute();
const router = useRouter();

const clearNonEditableFocus = (event: FocusEvent) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const keepsFocus =
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    (target instanceof HTMLInputElement &&
      !["button", "checkbox", "radio", "range", "reset", "submit"].includes(target.type));

  if (!keepsFocus) target.blur();
};

const clearFinishedControlFocus = (event: Event) => {
  const target = event.target;
  if (
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement &&
      ["checkbox", "radio", "range"].includes(target.type))
  ) {
    target.blur();
  }
};

const finishEditingOnOutsidePointer = (event: PointerEvent) => {
  const activeElement = document.activeElement;
  const target = event.target;
  if (!(activeElement instanceof HTMLElement) || !(target instanceof Node)) return;
  if (activeElement === document.body || activeElement.contains(target)) return;

  if (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement.isContentEditable
  ) {
    activeElement.blur();
  }
};

watch(
  [
    () => state.isBootstrapped,
    () => hasProject.value,
    () => route.name,
    () => route.params.stateName,
  ],
  async () => {
    if (!state.isBootstrapped || !hasProject.value) return;

    if (route.name !== "state") {
      if (currentEntry.value) closeEntry();
      return;
    }

    const routeParam = route.params.stateName;
    const stateName = Array.isArray(routeParam) ? routeParam[0] : routeParam;

    if (!stateName || !state.entries[stateName]) {
      closeEntry();
      await router.replace({ name: "home" });
      return;
    }

    if (currentEntry.value?.name !== stateName) openEntry(stateName);
  },
  { immediate: true },
);

onMounted(() => {
  document.addEventListener("focusin", clearNonEditableFocus);
  document.addEventListener("change", clearFinishedControlFocus, true);
  document.addEventListener("pointerdown", finishEditingOnOutsidePointer, true);
  void initialize();
});

onBeforeUnmount(() => {
  document.removeEventListener("focusin", clearNonEditableFocus);
  document.removeEventListener("change", clearFinishedControlFocus, true);
  document.removeEventListener("pointerdown", finishEditingOnOutsidePointer, true);
});
</script>

<template>
  <div v-if="!state.isBootstrapped" class="app-loading">Загрузка...</div>
  <SetupScreen v-else-if="!hasProject" />
  <RouterView v-else v-slot="{ Component }">
    <component :is="Component" :key="route.fullPath" />
  </RouterView>
</template>

<style scoped lang="scss">
.app-loading {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}
</style>
