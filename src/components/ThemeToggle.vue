<script setup lang="ts">
import { useTheme } from "../composables/useTheme";

const { isDark, toggleTheme } = useTheme();
</script>

<template>
  <button
    class="theme-toggle"
    type="button"
    :title="isDark ? 'Включить светлую тему' : 'Включить тёмную тему'"
    :aria-label="isDark ? 'Включить светлую тему' : 'Включить тёмную тему'"
    @click="toggleTheme"
  >
    <svg v-if="isDark" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 15.2A8 8 0 0 1 8.8 4 8.3 8.3 0 1 0 20 15.2Z" />
    </svg>
  </button>
</template>

<style scoped lang="scss">
.theme-toggle {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  padding: 7px;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;

  &:hover {
    border-color: var(--border-strong);
    background: var(--surface-hover);
    color: var(--text);
  }

  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }
}
</style>
