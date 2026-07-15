import type { StateCategoryId } from "../types/framedata";
export type { StateCategoryId } from "../types/framedata";

export interface StateCategory {
  id: StateCategoryId;
  label: string;
}

export const STATE_CATEGORIES: StateCategory[] = [
  { id: "movement", label: "Передвижение" },
  { id: "attack", label: "Удары" },
  { id: "damage", label: "Получение урона" },
  { id: "block", label: "Блок" },
];

export const getStateCategory = (
  stateName: string,
  explicitCategory?: StateCategoryId,
): StateCategory => {
  if (explicitCategory) {
    return STATE_CATEGORIES.find((category) => category.id === explicitCategory)
      ?? STATE_CATEGORIES[0]!;
  }
  if (stateName.startsWith("BLOCK")) {
    return STATE_CATEGORIES[3]!;
  }

  if (stateName.startsWith("HIT_") || stateName.startsWith("DEATH")) {
    return STATE_CATEGORIES[2]!;
  }

  if (
    stateName.startsWith("PUNCH") ||
    stateName.startsWith("KICK") ||
    stateName.startsWith("ULTIMATE") ||
    stateName === "UPPERCUT" ||
    stateName === "CAST_FIREBALL"
  ) {
    return STATE_CATEGORIES[1]!;
  }

  return STATE_CATEGORIES[0]!;
};
