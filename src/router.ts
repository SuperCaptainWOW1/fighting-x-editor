import { createRouter, createWebHistory } from "vue-router";
import EditorScreen from "./components/EditorScreen.vue";
import FrameDataGrid from "./components/FrameDataGrid.vue";

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "home",
      component: FrameDataGrid,
    },
    {
      path: "/states/:stateName",
      name: "state",
      component: EditorScreen,
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: { name: "home" },
    },
  ],
});
