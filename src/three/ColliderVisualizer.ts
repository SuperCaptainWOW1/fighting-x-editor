import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Object3D,
  Vector3,
} from "three";
import type { EditorBoxBase } from "../types/framedata";

export interface ColliderColors {
  hurtbox: string;
  hitbox: string;
  selected: string;
}

const DEFAULT_COLORS: ColliderColors = {
  hurtbox: "#236fc4",
  hitbox: "#d83a2e",
  selected: "#d45f00",
};

const reusablePosition = new Vector3();
const reusableSize = new Vector3();

class ColliderMesh {
  readonly object = new LineSegments(
    new EdgesGeometry(new BoxGeometry(1, 1, 1)),
    new LineBasicMaterial({
      color: DEFAULT_COLORS.hurtbox,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    }),
  );

  constructor() {
    this.object.renderOrder = 1000;
  }

  update(
    box: EditorBoxBase,
    isSelected: boolean,
    isRotated: boolean,
    colors: ColliderColors,
  ) {
    // Colliders ignore the depth buffer so their render order determines which
    // outline stays visible where several boxes overlap.
    this.object.renderOrder = isSelected ? 1001 : 1000;

    reusableSize.set(box.size[0], box.size[1], Math.max(box.size[2], 0.02));
    reusablePosition.set(
      isRotated ? -box.position[0] : box.position[0],
      box.position[1],
      box.position[2],
    );

    this.object.position.copy(reusablePosition);
    this.object.scale.copy(reusableSize);

    const material = this.object.material as LineBasicMaterial;
    material.color.set(
      isSelected
        ? colors.selected
        : box.kind === "hurtbox"
          ? colors.hurtbox
          : colors.hitbox,
    );
  }

  dispose() {
    this.object.geometry.dispose();
    (this.object.material as LineBasicMaterial).dispose();
  }
}

export class ColliderVisualizer {
  private readonly pool: ColliderMesh[] = [];
  private readonly objectsById = new Map<string, Object3D>();
  private readonly root: Group;

  constructor(parent: Group) {
    this.root = new Group();
    parent.add(this.root);
  }

  sync(
    boxes: EditorBoxBase[],
    selectedBoxIds: readonly string[],
    isRotated = false,
    colors: ColliderColors = DEFAULT_COLORS,
  ) {
    this.objectsById.clear();
    const selectedIds = new Set(selectedBoxIds);

    while (this.pool.length < boxes.length) {
      const mesh = new ColliderMesh();
      this.pool.push(mesh);
      this.root.add(mesh.object);
    }

    boxes.forEach((box, index) => {
      const mesh = this.pool[index]!;
      mesh.object.visible = true;
      mesh.update(box, selectedIds.has(box.id), isRotated, colors);
      this.objectsById.set(box.id, mesh.object);
    });

    for (let index = boxes.length; index < this.pool.length; index += 1) {
      this.pool[index]!.object.visible = false;
    }
  }

  getObject(boxId: string) {
    return this.objectsById.get(boxId) ?? null;
  }

  dispose() {
    this.pool.forEach((mesh) => mesh.dispose());
    this.root.removeFromParent();
  }
}
