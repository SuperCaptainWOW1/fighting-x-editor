import {
  AmbientLight,
  DirectionalLight,
  Group,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { EditorBoxBase, EditorStateData } from "../types/framedata";
import type { ViewportEditMode } from "../types/viewport";
import { getActiveBoxes } from "../utils/framedata";
import { CharacterModel } from "./CharacterModel";
import {
  ColliderVisualizer,
  type ColliderColors,
} from "./ColliderVisualizer";

const SIDE_CAMERA_POSITION = new Vector3(0, 1.2, 6);
const LOOK_TARGET = new Vector3(0, 1, 0);
const MIN_COLLIDER_SIZE = 0.01;
const TRANSFORM_STEP = 0.01;

export interface PreviewTransformOptions {
  mode: ViewportEditMode;
  onUpdate: (boxId: string, patch: Partial<EditorBoxBase>) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

const roundTransformValue = (value: number) =>
  Number(
    (Math.round(value / TRANSFORM_STEP) * TRANSFORM_STEP).toFixed(2),
  );

export class SharedPreviewRenderer {
  private static instance: SharedPreviewRenderer | null = null;

  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(35, 1, 0.1, 100);
  private readonly root = new Group();
  private readonly character: CharacterModel;
  private readonly colliders: ColliderVisualizer;
  private transformControls: TransformControls | null = null;
  private transformCanvas: HTMLCanvasElement | null = null;
  private transformObject: Object3D | null = null;
  private transformBox: EditorBoxBase | null = null;
  private transformIsRotated = false;
  private transformOnUpdate: PreviewTransformOptions["onUpdate"] | null = null;
  private transformOnInteractionStart:
    | PreviewTransformOptions["onInteractionStart"]
    | null = null;
  private transformOnInteractionEnd:
    | PreviewTransformOptions["onInteractionEnd"]
    | null = null;
  private isTransformInteracting = false;
  private isReady = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera.position.copy(SIDE_CAMERA_POSITION);
    this.camera.lookAt(LOOK_TARGET);

    const ambient = new AmbientLight(0xffffff, 1.4);
    const keyLight = new DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(2, 4, 5);

    this.scene.add(ambient, keyLight, this.root);

    this.character = new CharacterModel(this.root);
    this.colliders = new ColliderVisualizer(this.root);
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new SharedPreviewRenderer();
    }

    return this.instance;
  }

  async init() {
    if (this.isReady) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.character.load().then(() => {
        this.isReady = true;
      });
    }

    await this.initPromise;
  }

  renderFrame(
    targetCanvas: HTMLCanvasElement,
    state: EditorStateData,
    frame: number,
    clipName: string,
    selectedBoxIds: readonly string[],
    isRotated = false,
    zoom = 1,
    pan: readonly [number, number] = [0, 0],
    transformOptions?: PreviewTransformOptions,
  ) {
    const width = targetCanvas.clientWidth || 240;
    const height = targetCanvas.clientHeight || 160;

    if (targetCanvas.width !== width || targetCanvas.height !== height) {
      targetCanvas.width = width;
      targetCanvas.height = height;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.zoom = zoom;
    this.camera.position.set(
      SIDE_CAMERA_POSITION.x + pan[0],
      SIDE_CAMERA_POSITION.y + pan[1],
      SIDE_CAMERA_POSITION.z,
    );
    this.camera.lookAt(
      LOOK_TARGET.x + pan[0],
      LOOK_TARGET.y + pan[1],
      LOOK_TARGET.z,
    );
    this.camera.updateProjectionMatrix();

    this.character.applyClipFrame(
      clipName,
      frame,
      state.duration,
      isRotated,
      state.lockWhenFinished ?? false,
    );
    const activeBoxes = getActiveBoxes(state, frame);
    this.colliders.sync(
      activeBoxes,
      selectedBoxIds,
      isRotated,
      this.getColliderColors(),
    );
    this.syncTransformControls(
      targetCanvas,
      activeBoxes,
      selectedBoxIds[selectedBoxIds.length - 1] ?? null,
      isRotated,
      transformOptions,
    );

    this.drawSceneToCanvas(targetCanvas);
  }

  clearTransformControls(targetCanvas: HTMLCanvasElement) {
    if (this.transformCanvas !== targetCanvas) return;
    this.disposeTransformControls();
  }

  isTransformingOnCanvas(targetCanvas: HTMLCanvasElement) {
    return this.transformCanvas === targetCanvas && this.isTransformInteracting;
  }

  private drawSceneToCanvas(targetCanvas: HTMLCanvasElement) {
    const width = targetCanvas.clientWidth || 240;
    const height = targetCanvas.clientHeight || 160;

    this.renderer.render(this.scene, this.camera);

    const context = targetCanvas.getContext("2d");

    if (!context) {
      return;
    }

    context.clearRect(0, 0, width, height);
    context.drawImage(this.renderer.domElement, 0, 0, width, height);
  }

  private syncTransformControls(
    targetCanvas: HTMLCanvasElement,
    activeBoxes: EditorBoxBase[],
    selectedBoxId: string | null,
    isRotated: boolean,
    options?: PreviewTransformOptions,
  ) {
    if (!options) {
      if (this.transformCanvas === targetCanvas) {
        this.disposeTransformControls();
      }
      return;
    }

    this.ensureTransformControls(targetCanvas);
    this.applyTransformControlColors();
    this.transformOnUpdate = options.onUpdate;
    this.transformOnInteractionStart = options.onInteractionStart ?? null;
    this.transformOnInteractionEnd = options.onInteractionEnd ?? null;
    this.transformIsRotated = isRotated;

    const selectedBox = selectedBoxId
      ? activeBoxes.find((box) => box.id === selectedBoxId) ?? null
      : null;
    const selectedObject = selectedBoxId
      ? this.colliders.getObject(selectedBoxId)
      : null;
    const helper = this.transformControls!.getHelper();

    if (
      options.mode === "select" ||
      options.mode === "box-select" ||
      !selectedBox ||
      !selectedObject
    ) {
      this.transformControls!.detach();
      this.transformObject = null;
      this.transformBox = null;
      helper.visible = false;
      return;
    }

    this.transformBox = selectedBox;
    this.transformControls!.setMode(options.mode);
    this.transformControls!.showX = true;
    this.transformControls!.showY = true;
    this.transformControls!.showZ = false;
    helper.visible = true;

    if (this.transformObject !== selectedObject) {
      this.transformControls!.attach(selectedObject);
      this.transformObject = selectedObject;
    }
  }

  private ensureTransformControls(targetCanvas: HTMLCanvasElement) {
    if (this.transformControls && this.transformCanvas === targetCanvas) {
      return;
    }

    this.disposeTransformControls();

    const controls = new TransformControls(this.camera, targetCanvas);
    controls.setSpace("world");
    controls.setSize(0.72);
    controls.setTranslationSnap(TRANSFORM_STEP);
    controls.setScaleSnap(TRANSFORM_STEP);
    controls.showZ = false;
    controls.addEventListener("change", this.handleTransformChange);
    controls.addEventListener("objectChange", this.handleTransformObjectChange);
    controls.addEventListener("mouseDown", this.handleTransformMouseDown);
    controls.addEventListener("mouseUp", this.handleTransformMouseUp);

    const helper = controls.getHelper();
    helper.visible = false;
    this.scene.add(helper);

    this.transformControls = controls;
    this.transformCanvas = targetCanvas;
  }

  private applyTransformControlColors() {
    if (!this.transformControls) return;
    const styles = getComputedStyle(document.documentElement);
    const readColor = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;

    this.transformControls.setColors(
      readColor("--transform-axis-x", "#f01435"),
      readColor("--transform-axis-y", "#009e57"),
      readColor("--transform-axis-z", "#0b5fff"),
      readColor("--transform-axis-active", "#a600ff"),
    );
  }

  private readonly handleTransformChange = () => {
    if (!this.transformCanvas) return;
    this.drawSceneToCanvas(this.transformCanvas);
  };

  private readonly handleTransformMouseDown = () => {
    this.isTransformInteracting = true;
    this.transformOnInteractionStart?.();
  };

  private readonly handleTransformMouseUp = () => {
    if (!this.isTransformInteracting) return;
    this.isTransformInteracting = false;
    this.transformOnInteractionEnd?.();
  };

  private readonly handleTransformObjectChange = () => {
    const controls = this.transformControls;
    const object = this.transformObject;
    const box = this.transformBox;

    if (!controls || !object || !box || !this.transformOnUpdate) return;

    const presetPatch = box.preset ? { preset: undefined } : {};

    if (controls.getMode() === "translate") {
      this.transformOnUpdate(box.id, {
        ...presetPatch,
        position: [
          roundTransformValue(
            this.transformIsRotated ? -object.position.x : object.position.x,
          ),
          roundTransformValue(object.position.y),
          box.position[2],
        ],
      });
      return;
    }

    this.transformOnUpdate(box.id, {
      ...presetPatch,
      size: [
        roundTransformValue(
          Math.max(MIN_COLLIDER_SIZE, Math.abs(object.scale.x)),
        ),
        roundTransformValue(
          Math.max(MIN_COLLIDER_SIZE, Math.abs(object.scale.y)),
        ),
        box.size[2],
      ],
    });
  };

  private disposeTransformControls() {
    if (!this.transformControls) return;

    this.transformControls.removeEventListener(
      "change",
      this.handleTransformChange,
    );
    this.transformControls.removeEventListener(
      "objectChange",
      this.handleTransformObjectChange,
    );
    this.transformControls.removeEventListener(
      "mouseDown",
      this.handleTransformMouseDown,
    );
    this.transformControls.removeEventListener(
      "mouseUp",
      this.handleTransformMouseUp,
    );
    if (this.isTransformInteracting) {
      this.isTransformInteracting = false;
      this.transformOnInteractionEnd?.();
    }
    this.transformControls.detach();
    this.transformControls.getHelper().removeFromParent();
    this.transformControls.dispose();
    this.transformControls = null;
    this.transformCanvas = null;
    this.transformObject = null;
    this.transformBox = null;
    this.transformOnUpdate = null;
    this.transformOnInteractionStart = null;
    this.transformOnInteractionEnd = null;
  }

  pickCollider(
    targetCanvas: HTMLCanvasElement,
    state: EditorStateData,
    frame: number,
    clientX: number,
    clientY: number,
    isRotated = false,
  ) {
    const rect = targetCanvas.getBoundingClientRect();
    const activeBoxes = getActiveBoxes(state, frame);

    for (const box of [...activeBoxes].reverse()) {
      const halfWidth = box.size[0] / 2;
      const halfHeight = box.size[1] / 2;
      const positionX = isRotated ? -box.position[0] : box.position[0];
      const topLeft = new Vector3(
        positionX - halfWidth,
        box.position[1] + halfHeight,
        box.position[2],
      ).project(this.camera);
      const bottomRight = new Vector3(
        positionX + halfWidth,
        box.position[1] - halfHeight,
        box.position[2],
      ).project(this.camera);
      const left = rect.left + ((topLeft.x + 1) / 2) * rect.width;
      const right = rect.left + ((bottomRight.x + 1) / 2) * rect.width;
      const top = rect.top + ((1 - topLeft.y) / 2) * rect.height;
      const bottom = rect.top + ((1 - bottomRight.y) / 2) * rect.height;

      if (
        clientX >= Math.min(left, right) - 6 &&
        clientX <= Math.max(left, right) + 6 &&
        clientY >= Math.min(top, bottom) - 6 &&
        clientY <= Math.max(top, bottom) + 6
      ) {
        return box.id;
      }
    }

    return null;
  }

  pickCollidersInRect(
    targetCanvas: HTMLCanvasElement,
    state: EditorStateData,
    frame: number,
    selectionRect: { left: number; right: number; top: number; bottom: number },
    isRotated = false,
  ) {
    const canvasRect = targetCanvas.getBoundingClientRect();
    const activeBoxes = getActiveBoxes(state, frame);

    return activeBoxes
      .filter((box) => {
        const bounds = this.getColliderScreenBounds(box, canvasRect, isRotated);
        return !(
          bounds.right < selectionRect.left ||
          bounds.left > selectionRect.right ||
          bounds.bottom < selectionRect.top ||
          bounds.top > selectionRect.bottom
        );
      })
      .map((box) => box.id);
  }

  private getColliderScreenBounds(
    box: EditorBoxBase,
    canvasRect: DOMRect,
    isRotated: boolean,
  ) {
    const halfWidth = box.size[0] / 2;
    const halfHeight = box.size[1] / 2;
    const positionX = isRotated ? -box.position[0] : box.position[0];
    const topLeft = new Vector3(
      positionX - halfWidth,
      box.position[1] + halfHeight,
      box.position[2],
    ).project(this.camera);
    const bottomRight = new Vector3(
      positionX + halfWidth,
      box.position[1] - halfHeight,
      box.position[2],
    ).project(this.camera);
    const x1 = canvasRect.left + ((topLeft.x + 1) / 2) * canvasRect.width;
    const x2 = canvasRect.left + ((bottomRight.x + 1) / 2) * canvasRect.width;
    const y1 = canvasRect.top + ((1 - topLeft.y) / 2) * canvasRect.height;
    const y2 = canvasRect.top + ((1 - bottomRight.y) / 2) * canvasRect.height;

    return {
      left: Math.min(x1, x2),
      right: Math.max(x1, x2),
      top: Math.min(y1, y2),
      bottom: Math.max(y1, y2),
    };
  }

  getClipNames() {
    return this.character.getClipNames();
  }

  private getColliderColors(): ColliderColors {
    const styles = getComputedStyle(document.documentElement);
    const readColor = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;

    return {
      hurtbox: readColor("--collider-hurtbox", "#236fc4"),
      hitbox: readColor("--collider-hitbox", "#d83a2e"),
      selected: readColor("--collider-selected", "#00a63f"),
    };
  }

  dispose() {
    this.disposeTransformControls();
    this.renderer.dispose();
    this.character.dispose();
    this.colliders.dispose();
    SharedPreviewRenderer.instance = null;
  }
}

export const renderBoxesOnly = (
  boxes: EditorBoxBase[],
  selectedBoxId: string | null,
  root: Group,
) => {
  const visualizer = new ColliderVisualizer(root);
  visualizer.sync(boxes, selectedBoxId ? [selectedBoxId] : []);
  return visualizer;
};
