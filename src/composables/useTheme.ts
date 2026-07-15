import { computed, ref } from "vue";

type Theme = "light" | "dark";

const STORAGE_KEY = "framedata-editor-theme";
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const storedTheme = window.localStorage.getItem(STORAGE_KEY);
const hasStoredTheme = storedTheme === "light" || storedTheme === "dark";
const theme = ref<Theme>(
  hasStoredTheme
    ? storedTheme as Theme
    : systemThemeQuery.matches
      ? "dark"
      : "light",
);
const followsSystem = ref(!hasStoredTheme);

const applyTheme = () => {
  if (followsSystem.value) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme.value;
  }
};

const notifyThemeChange = () => {
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent("editor-theme-change"));
  });
};

applyTheme();

systemThemeQuery.addEventListener("change", (event) => {
  if (!followsSystem.value) return;
  theme.value = event.matches ? "dark" : "light";
  notifyThemeChange();
});

export const useTheme = () => {
  const isDark = computed(() => theme.value === "dark");

  const toggleTheme = () => {
    theme.value = isDark.value ? "light" : "dark";
    followsSystem.value = false;
    window.localStorage.setItem(STORAGE_KEY, theme.value);
    applyTheme();
    notifyThemeChange();
  };

  return { isDark, toggleTheme };
};
