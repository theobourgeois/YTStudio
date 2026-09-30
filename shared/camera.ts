/**
 * 3D, like After Effects' 3D layers and camera. A clip with Motion's 3D Layer
 * switch on is a flat card in space: its position gets a depth (Position Z)
 * and it turns about X and Y as well as Z. It's seen through the camera: the
 * topmost Camera clip under the playhead (a clip carrying the Camera effect),
 * or without one a default camera that shows depth 0 exactly as a 2D layer.
 *
 * Space is canvas px with y down and z going away from the viewer (After
 * Effects' axes). A 3D layer's picture lands on the canvas by a projective
 * map (a homography: `Projective`), which the compositor draws with true
 * perspective. Depths and px distances are in px of the video at 1080p, like
 * the Position values, so a move looks the same at any export size.
 */
import type { Projective } from "./compositor.ts";
import { CAMERA, type Motion, findEffect, isCameraClip, valuesAt } from "./effects.ts";
import { clipEnd, perClipList, sourceTime, videoTracks } from "./timeline.ts";
import type { Placement, Size } from "./transform.ts";
import type { Clip, Project, Vec2 } from "./types.ts";

export type Vec3 = [number, number, number];

/** A camera in canvas px: where it is, what it looks at, its vertical angle of view and its roll. */
export interface Camera3D {
  position: Vec3;
  target: Vec3;
  /** Vertical angle of view, degrees. */
  fov: number;
  /** Degrees, clockwise. */
  roll: number;
  /** Depth of field: how far in front the picture is sharp (px), and how blurred it gets away from there (0: off). */
  focus: number;
  aperture: number;
}

/** A camera's settings (the Camera effect's values). */
export interface CameraSettings {
  angleOfView: number;
  pointOfInterest: Vec2;
  interestZ: number;
  /** 1 = the default distance (depth 0 shows at 100%). */
  distance: number;
  orbitX: number;
  orbitY: number;
  roll: number;
  depthOfField: boolean;
  /** 1 = focused at the point of interest. */
  focusDistance: number;
  /** Blur of something twice as far as the focus, as a fraction of the canvas height. */
  aperture: number;
}

export const DEFAULT_ANGLE_OF_VIEW = 40;

const RAD = Math.PI / 180;

/** px of the video at 1080p -> canvas px. */
export const pxUnit = (canvas: Size) => Math.min(canvas.width, canvas.height) / 1080;

/** How far the camera must be for depth 0 to show at 100% with this angle of view (canvas px). */
export const focalLength = (canvas: Size, fov: number) => canvas.height / 2 / Math.tan((Math.max(1, Math.min(170, fov)) * RAD) / 2);

/** The camera a composition without one is seen through (After Effects' default): depth 0 shows as in 2D. */
export function defaultCamera(canvas: Size): Camera3D {
  const f = focalLength(canvas, DEFAULT_ANGLE_OF_VIEW);
  return {
    position: [canvas.width / 2, canvas.height / 2, -f],
    target: [canvas.width / 2, canvas.height / 2, 0],
    fov: DEFAULT_ANGLE_OF_VIEW,
    roll: 0,
    focus: f,
    aperture: 0,
  };
}

/** A camera from its settings: an orbit around the point of interest at a distance. */
export function cameraFrom(settings: CameraSettings, canvas: Size): Camera3D {
  const unit = pxUnit(canvas);
  const f = focalLength(canvas, settings.angleOfView);
  const target: Vec3 = [settings.pointOfInterest[0] * canvas.width, settings.pointOfInterest[1] * canvas.height, settings.interestZ * unit];
  // Straight back from the target, then turned around it: tilted about X, swung about Y.
  const d = f * Math.max(0.01, settings.distance);
  const tilt = settings.orbitX * RAD;
  const swing = settings.orbitY * RAD;
  const back: Vec3 = [0, -Math.sin(tilt), -Math.cos(tilt)];
  const dir: Vec3 = [back[0] * Math.cos(swing) - back[2] * Math.sin(swing), back[1], back[0] * Math.sin(swing) + back[2] * Math.cos(swing)];
  return {
    position: [target[0] + dir[0] * d, target[1] + dir[1] * d, target[2] + dir[2] * d],
    target,
    fov: settings.angleOfView,
    roll: settings.roll,
    focus: d * Math.max(0.01, settings.focusDistance),
    aperture: settings.depthOfField ? settings.aperture * canvas.height : 0,
  };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The camera's axes (right, down, forward) and focal length in px. */
function cameraBasis(camera: Camera3D, canvas: Size) {
  const forward = norm(sub(camera.target, camera.position));
  // Right is across "down" (world +y) and forward; looking straight up or down, pick any right.
  let right = cross([0, 1, 0], forward);
  if (Math.hypot(...right) < 1e-6) right = [1, 0, 0];
  right = norm(right);
  let down = cross(forward, right);
  if (camera.roll) {
    const c = Math.cos(camera.roll * RAD);
    const s = Math.sin(camera.roll * RAD);
    [right, down] = [
      [right[0] * c + down[0] * s, right[1] * c + down[1] * s, right[2] * c + down[2] * s],
      [down[0] * c - right[0] * s, down[1] * c - right[1] * s, down[2] * c - right[2] * s],
    ];
  }
  return { right, down, forward, f: focalLength(canvas, camera.fov) };
}

/** A 3D layer's frame in space: the corner at its (0, 0) and the steps along its width and height (canvas px). */
function layerInSpace(p: Placement, motion: Motion, canvas: Size): { origin: Vec3; u: Vec3; v: Vec3 } {
  const [ax, ay, az] = [(motion.rotationX ?? 0) * RAD, (motion.rotationY ?? 0) * RAD, motion.rotation * RAD];
  // Rz · Ry · Rx, applied to (x, y, 0): X first, like After Effects.
  const rot = (x: number, y: number): Vec3 => {
    // X: y and z turn.
    let y1 = y * Math.cos(ax);
    let z1 = y * Math.sin(ax);
    // Y: x and z turn.
    const x2 = x * Math.cos(ay) + z1 * Math.sin(ay);
    z1 = -x * Math.sin(ay) + z1 * Math.cos(ay);
    // Z: as in 2D (clockwise with y down).
    const x3 = x2 * Math.cos(az) - y1 * Math.sin(az);
    y1 = x2 * Math.sin(az) + y1 * Math.cos(az);
    return [x3, y1, z1];
  };
  const centre: Vec3 = [p.x, p.y, (motion.z ?? 0) * pxUnit(canvas)];
  const corner = rot(-p.scaleX * p.anchorX, -p.scaleY * p.anchorY);
  const along = rot(p.scaleX * p.width, 0);
  const down = rot(0, p.scaleY * p.height);
  return { origin: [centre[0] + corner[0], centre[1] + corner[1], centre[2] + corner[2]], u: along, v: down };
}

/**
 * Where a 3D layer lands: the projective map from its frame (fractions, y down)
 * to the canvas (fractions), and how deep its middle is in front of the camera
 * (for drawing far layers first, and depth of field).
 */
export function projectLayer(p: Placement, motion: Motion, canvas: Size, camera: Camera3D): { matrix: Projective; depth: number } {
  const { right, down, forward, f } = cameraBasis(camera, canvas);
  const { origin, u, v } = layerInSpace(p, motion, canvas);
  const toCam = (w: Vec3, point: boolean): Vec3 => {
    const d = point ? sub(w, camera.position) : w;
    return [dot(d, right), dot(d, down), dot(d, forward)];
  };
  const O = toCam(origin, true);
  const U = toCam(u, false);
  const V = toCam(v, false);
  // Canvas fractions: x = 0.5 + (f / W) · X / Z, y = 0.5 + (f / H) · Y / Z.
  const kx = f / canvas.width;
  const ky = f / canvas.height;
  const row = (i: 0 | 1, k: number): [number, number, number] => [k * U[i] + 0.5 * U[2], k * V[i] + 0.5 * V[2], k * O[i] + 0.5 * O[2]];
  const matrix: Projective = [...row(0, kx), ...row(1, ky), U[2], V[2], O[2]];
  const middle: Vec3 = [O[0] + (U[0] + V[0]) / 2, O[1] + (U[1] + V[1]) / 2, O[2] + (U[2] + V[2]) / 2];
  return { matrix, depth: middle[2] };
}

/** How blurred (fraction of the canvas height) something `depth` px in front of the camera is. */
export function defocus(camera: Camera3D, depth: number, canvas: Size): number {
  if (!(camera.aperture > 0) || !(depth > 0)) return 0;
  return (camera.aperture * Math.abs(1 - camera.focus / depth)) / canvas.height;
}

/** Every camera clip on a video track, top track first (cached per clip list). */
const cameraClips = perClipList((project) => {
  const order = new Map(videoTracks(project).map((t, i) => [t.id, i]));
  return project.clips
    .filter((c) => isCameraClip(c) && order.has(c.trackId))
    .sort((a, b) => order.get(a.trackId)! - order.get(b.trackId)!);
});

/** A camera clip's settings at source time `time`. */
export function cameraSettingsAt(clip: Clip, time: number): CameraSettings {
  return valuesAt(CAMERA, findEffect(clip, CAMERA.type), time) as unknown as CameraSettings;
}

/** The camera 3D layers are seen through at timeline time `t`: the topmost Camera clip there, or the default. */
export function cameraAt(project: Project | null, t: number, canvas: Size): Camera3D {
  const clip = project && cameraClips(project).find((c) => t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6);
  return clip ? cameraFrom(cameraSettingsAt(clip, sourceTime(clip, t)), canvas) : defaultCamera(canvas);
}
