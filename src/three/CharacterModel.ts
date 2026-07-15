import {
  AnimationClip,
  AnimationMixer,
  Group,
  LoopOnce,
  Material,
  Mesh,
  SkinnedMesh,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { projectStorageConfig } from "../config/projectStorage";

const floorToFixed = (value: number, fractionDigits: number) => {
  const factor = 10 ** fractionDigits;
  return Math.floor(value * factor) / factor;
};

export class CharacterModel {
  private mixer: AnimationMixer;
  private root: Group | null = null;
  private clips = new Map<string, AnimationClip>();
  private currentAction: ReturnType<AnimationMixer["clipAction"]> | null = null;
  private materials: Material[] = [];

  constructor(private readonly parent: Group) {
    this.mixer = new AnimationMixer(new Group());
  }

  async load() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(projectStorageConfig.assets.dracoDecoderPath);

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    const gltf = await loader.loadAsync(projectStorageConfig.assets.characterModelUrl);
    this.root = gltf.scene;
    this.root.rotation.y = Math.PI / 2;
    this.parent.add(this.root);

    this.root.traverse((object) => {
      if (!(object instanceof Mesh) && !(object instanceof SkinnedMesh)) {
        return;
      }

      const material = Array.isArray(object.material)
        ? object.material[0]
        : object.material;

      if (!material) {
        return;
      }

      material.transparent = true;
      material.opacity = 0.45;
      material.depthWrite = false;
      this.materials.push(material);
    });

    gltf.animations.forEach((clip) => {
      this.clips.set(clip.name, clip);
    });

    this.mixer = new AnimationMixer(this.root);
  }

  getClipNames() {
    return [...this.clips.keys()].sort();
  }

  applyClipFrame(
    clipName: string,
    frame: number,
    duration: number,
    isRotated = false,
    lockWhenFinished = false,
  ) {
    const clip = this.clips.get(clipName);

    if (!this.root) return;

    this.root.rotation.y = isRotated
      ? Math.PI + Math.PI / 2
      : Math.PI / 2;

    if (!clip) {
      this.currentAction?.stop();
      this.currentAction = null;
      this.mixer.stopAllAction();
      this.mixer.update(0);
      return;
    }

    if (!this.currentAction || this.currentAction.getClip().name !== clip.name) {
      this.currentAction?.stop();
      this.currentAction = this.mixer.clipAction(clip);
      this.currentAction.setLoop(LoopOnce, 1);
      this.currentAction.clampWhenFinished = true;
      this.currentAction.play();
    }

    const totalFrames = Math.max(1, duration);
    const currentFrame = Math.min(Math.max(frame, 1), totalFrames);
    const timePerFrame = floorToFixed(clip.duration / totalFrames, 3);
    const clipDuration = floorToFixed(clip.duration, 3);
    const time = lockWhenFinished && currentFrame >= totalFrames
      ? clipDuration
      : Math.min(
          floorToFixed(currentFrame * timePerFrame, 6),
          clipDuration,
        );

    // LoopOnce переводит action в paused на последнем кадре. Возвращаем его в
    // активное состояние перед каждым ручным seek, чтобы скраббинг назад и
    // последующие изменения продолжали обновлять позу.
    this.currentAction.enabled = true;
    this.currentAction.paused = false;
    this.mixer.setTime(time);
  }

  dispose() {
    this.materials.forEach((material) => material.dispose());
    this.root?.removeFromParent();
  }
}
