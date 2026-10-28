/**
 * A 3D model drawn for a MilkDrop look (docs/now-playing.md, "Your media"): three.js, in a canvas of its own with a
 * transparent background, which `media-feed.ts` paints into Butterchurn's frame like a clip on a background taken
 * out, so the preset's motion streams trails off it. It plays the model's animation (`model-motion.ts`: a dance while
 * the music's going, a jump or a wave on a big kick), turns, punches in on the kicks, and is lit in the cover's
 * colours; chrome reflects the look itself, neon is its wireframe in the cover's accent, and an object can come as a
 * ring of them. Loaded the first time a model's shown (three.js is big): `import("./model-stage")`.
 */
import * as THREE from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { AlbumPalette } from "@shared/palette";
import { BURST_GAP, type ModelLook, planClips, shouldBurst } from "./model-motion";

/** How a model's shown: its look, its animations' names, the moment (0..1) and the cover's colours. */
export interface ModelShow {
  look: ModelLook;
  energy: number;
  palette: AlbumPalette;
}

/** The field of view (degrees, up and down) and how far the camera stands. */
const FOV = 30;
const DISTANCE = 6;
/** Copies in a ring (an object's `ring` style). */
const RING = 6;
/** Models kept loaded, the last few shown (cycling through a set comes back to them). */
const KEPT = 6;
/** How fast a burst comes in and goes (seconds). */
const BURST_IN = 0.15;
const BURST_OUT = 0.3;
/** Every this many frames, the look's frame copied for chrome to reflect. */
const REFLECT_EVERY = 3;

interface Burst {
  action: THREE.AnimationAction;
  weight: number;
  ending: boolean;
}

export class ModelStage {
  readonly canvas = document.createElement("canvas");
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  /** What turns and punches: the model (or its ring) inside, centred and sized. */
  private readonly pivot = new THREE.Group();
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly loaded = new Map<string, Promise<GLTF>>();
  private readonly lights: { hemi: THREE.HemisphereLight; key: THREE.DirectionalLight; rimA: THREE.DirectionalLight; rimB: THREE.DirectionalLight };
  /** The room the models' own materials reflect (they're made to be lit by one), and the look's frame for chrome. */
  private readonly room: THREE.Texture;
  private readonly reflection = document.createElement("canvas");
  private readonly reflected: THREE.CanvasTexture;
  /** The look's frame made into light to reflect, again every few frames (three makes one of a picture only once). */
  private readonly pmrem: THREE.PMREMGenerator;
  private reflectTarget: THREE.WebGLRenderTarget | null = null;
  private readonly made: { dispose(): void }[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private base: THREE.AnimationAction | null = null;
  private bursts: THREE.AnimationClip[] = [];
  private burst: Burst | null = null;
  private sinceBurst = 0;
  private show: ModelShow | null = null;
  private shown: string | null = null;
  private scale = 1;
  private time = 0;
  private turn = 0;
  private kickTurn = 0;
  private frames = 0;
  private disposed = false;
  /** The latest asked for (one still loading when another is asked for isn't put up). */
  private asked = 0;

  constructor(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.camera = new THREE.PerspectiveCamera(FOV, width / height, 0.05, 100);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.room = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.reflection.width = 256;
    this.reflection.height = 128;
    this.reflected = new THREE.CanvasTexture(this.reflection);
    this.reflected.mapping = THREE.EquirectangularReflectionMapping;
    this.reflected.colorSpace = THREE.SRGBColorSpace;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x101020, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 4, 5);
    const rimA = new THREE.DirectionalLight(0xffffff, 3.5);
    rimA.position.set(-4, 2, -3);
    const rimB = new THREE.DirectionalLight(0xffffff, 3);
    rimB.position.set(4, -1, -3);
    this.lights = { hemi, key, rimA, rimB };
    this.scene.add(hemi, key, rimA, rimB, this.pivot);
  }

  /** Whether a model is up and drawn. */
  get ready(): boolean {
    return this.shown !== null;
  }

  /** Show the model at `src`, as `show` says (loaded, or taken from those kept). Throws if it can't be read. */
  async load(src: string, animations: readonly string[], show: ModelShow): Promise<void> {
    const ticket = ++this.asked;
    let pending = this.loaded.get(src);
    if (!pending) {
      pending = this.loader.loadAsync(src);
      this.loaded.set(src, pending);
      pending.catch(() => this.loaded.delete(src));
      while (this.loaded.size > KEPT) {
        const [oldest, gone] = this.loaded.entries().next().value!;
        this.loaded.delete(oldest);
        void gone.then((gltf) => free(gltf.scene), () => {});
      }
    } else {
      // (Kept: the newest again.)
      this.loaded.delete(src);
      this.loaded.set(src, pending);
    }
    const gltf = await pending;
    if (this.disposed || ticket !== this.asked) return;
    this.stage(gltf, animations, show);
    this.shown = src;
  }

  /** The cover's colours, for the lights (a song changing while it's up). */
  setPalette(palette: AlbumPalette): void {
    if (this.show) this.show = { ...this.show, palette };
    this.light(palette);
  }

  /**
   * A frame: its animation on by `seconds` (the picture's), turned, punched in `hit` into a kick (0..1); `frame`, the
   * look's own picture, reflected in chrome.
   */
  render(seconds: number, hit: number, frame: HTMLCanvasElement | null): void {
    if (!this.show || this.disposed) return;
    const { look } = this.show;
    this.time += seconds;
    this.sinceBurst += seconds;
    // A big kick: a jump, a wave, a punch, now and then (a character); a kick of a spin (an object).
    if (this.mixer && this.base && this.bursts.length && !this.burst && shouldBurst(hit, this.sinceBurst, Math.random)) {
      const clip = this.bursts[Math.floor(Math.random() * this.bursts.length)];
      const action = this.mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setEffectiveWeight(0).play();
      this.burst = { action, weight: 0, ending: false };
      this.sinceBurst = 0;
    } else if (!this.mixer && hit > 0.85 && this.sinceBurst > BURST_GAP / 2) {
      this.kickTurn += Math.sign(look.spin || 1) * Math.PI * 0.35;
      this.sinceBurst = 0;
    }
    this.blendBurst(seconds);
    this.mixer?.update(seconds);
    // Turning, and a kick's spin worked off.
    const kickStep = this.kickTurn * Math.min(1, seconds * 6);
    this.kickTurn -= kickStep;
    this.turn += look.spin * Math.PI * 2 * seconds + kickStep;
    this.pivot.rotation.y = this.turn;
    this.pivot.rotation.z = Math.sin(this.time * 0.7) * 0.05;
    const punch = 1 + 0.09 * Math.max(0, Math.min(1, hit));
    this.pivot.scale.setScalar(this.scale * punch);
    this.pivot.position.y = Math.sin(this.time * 1.3) * 0.06;
    // The camera drifts up and down a little, looking at it.
    const tilt = look.tilt + Math.sin(this.time * 0.31) * 0.06;
    this.camera.position.set(Math.sin(this.time * 0.17) * 0.4, Math.sin(tilt) * DISTANCE, Math.cos(tilt) * DISTANCE);
    this.camera.lookAt(0, 0, 0);
    // The light flashes on the kick.
    this.lights.key.intensity = 2.2 + 2.2 * hit;
    this.lights.rimA.intensity = 3.5 + 3 * hit;
    if (look.style === "chrome" && frame && this.frames % REFLECT_EVERY === 0) {
      const ctx = this.reflection.getContext("2d");
      if (ctx) {
        ctx.drawImage(frame, 0, 0, this.reflection.width, this.reflection.height);
        this.reflected.needsUpdate = true;
        this.reflectTarget = this.pmrem.fromEquirectangular(this.reflected, this.reflectTarget);
        this.scene.environment = this.reflectTarget.texture;
      }
    }
    this.frames++;
    this.renderer.render(this.scene, this.camera);
  }

  /** A burst's weight in, then out as it ends, the loop under it the rest. */
  private blendBurst(seconds: number): void {
    const burst = this.burst;
    if (!burst || !this.base) return;
    const clip = burst.action.getClip();
    if (!burst.ending && burst.action.time >= clip.duration - BURST_OUT) burst.ending = true;
    burst.weight = burst.ending ? Math.max(0, burst.weight - seconds / BURST_OUT) : Math.min(1, burst.weight + seconds / BURST_IN);
    burst.action.setEffectiveWeight(burst.weight);
    this.base.setEffectiveWeight(1 - burst.weight);
    if (burst.ending && burst.weight <= 0) {
      burst.action.stop();
      this.base.setEffectiveWeight(1);
      this.burst = null;
    }
  }

  /** The model put up: centred, sized to the frame, its animation playing, in its style. */
  private stage(gltf: GLTF, animations: readonly string[], show: ModelShow): void {
    this.clear();
    this.show = show;
    const { look } = show;
    const plan = planClips(gltf.animations.length ? gltf.animations.map((a) => a.name) : animations, show.energy, Math.random);
    const moving = plan.base !== null && gltf.animations.length > 0;
    const ring = look.style === "ring" && !moving;
    const model = gltf.scene;
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.setScalar(1);
    model.updateMatrixWorld(true);
    // Centred on its middle, its size in the frame's (at the camera's distance, what's seen up and down and across).
    const box = new THREE.Box3().setFromObject(model);
    const middle = box.getCenter(new THREE.Vector3());
    const extent = box.getSize(new THREE.Vector3());
    const across = Math.max(extent.x, extent.z, 1e-6);
    const high = Math.max(extent.y, 1e-6);
    const seenHigh = 2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const seenAcross = seenHigh * this.camera.aspect;
    const holder = new THREE.Group();
    if (ring) {
      // A ring of them, turning, each spinning its own way.
      const radius = 1.1;
      const each = Math.min(((radius * 2 * Math.PI) / RING) * 0.75 / Math.max(across, high), 1.1 / Math.max(across, high));
      for (let i = 0; i < RING; i++) {
        const copy = model.clone(true);
        copy.position.copy(middle).multiplyScalar(-each);
        copy.scale.setScalar(each);
        const seat = new THREE.Group();
        const angle = (i / RING) * Math.PI * 2;
        seat.position.set(Math.cos(angle) * radius, Math.sin(i * 2.1) * 0.25, Math.sin(angle) * radius);
        seat.rotation.set(i * 0.7, i * 1.3, i * 0.4);
        seat.add(copy);
        holder.add(seat);
      }
      this.scale = Math.min((look.size * seenHigh) / 2.8, (0.9 * seenAcross) / 2.8);
    } else {
      model.position.copy(middle).multiplyScalar(-1);
      holder.add(model);
      this.scale = Math.min((look.size * seenHigh) / high, (0.8 * seenAcross) / across);
    }
    this.pivot.add(holder);
    this.dress(holder, look.style, show.palette);
    this.light(show.palette);
    this.turn = Math.random() * Math.PI * 2;
    this.time = Math.random() * 10;
    if (moving) {
      this.mixer = new THREE.AnimationMixer(model);
      this.base = this.mixer.clipAction(gltf.animations[plan.base!]).play();
      this.bursts = plan.bursts.map((i) => gltf.animations[i]).filter((clip) => clip && clip.duration > BURST_IN + BURST_OUT);
      // (Not every one starting at its start.)
      this.mixer.update(Math.random() * this.base.getClip().duration);
    }
  }

  /** The model's materials for its style: its own (lit by the room and the cover's lights), chrome, or neon. */
  private dress(holder: THREE.Object3D, style: ModelLook["style"], palette: AlbumPalette): void {
    this.scene.environment = style === "chrome" && this.reflectTarget ? this.reflectTarget.texture : this.room;
    this.scene.environmentIntensity = style === "chrome" ? 1.6 : 0.55;
    if (style === "lit" || style === "ring") return;
    const material =
      style === "chrome"
        ? new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.light), metalness: 1, roughness: 0.12 })
        : new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.accent), wireframe: true });
    this.made.push(material);
    holder.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.userData.own ??= o.material;
        o.material = material;
      }
    });
  }

  private light(palette: AlbumPalette): void {
    this.lights.hemi.color.set(palette.light);
    this.lights.hemi.groundColor.set(palette.background);
    this.lights.key.color.set(palette.light);
    this.lights.rimA.color.set(palette.primary);
    this.lights.rimB.color.set(palette.accent);
  }

  /** The model taken down (kept loaded), its own materials given back. */
  private clear(): void {
    this.mixer?.stopAllAction();
    if (this.mixer) this.mixer.uncacheRoot(this.mixer.getRoot());
    this.mixer = null;
    this.base = null;
    this.burst = null;
    this.bursts = [];
    for (const child of [...this.pivot.children]) {
      child.traverse((o) => {
        if (o instanceof THREE.Mesh && o.userData.own) {
          o.material = o.userData.own;
          delete o.userData.own;
        }
      });
      this.pivot.remove(child);
    }
    for (const m of this.made.splice(0)) m.dispose();
    this.shown = null;
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    for (const pending of this.loaded.values()) void pending.then((gltf) => free(gltf.scene), () => {});
    this.loaded.clear();
    this.room.dispose();
    this.reflectTarget?.dispose();
    this.pmrem.dispose();
    this.reflected.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/** A model's GPU memory let go of. */
function free(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}
