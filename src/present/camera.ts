// Camera math for the 3D overview. Slides are laid out in a 3D scene (CSS pixels): column and
// row on the x/y plane, layers stepping back along -z. A camera looks at a point in that scene
// from a pitch/yaw angle, at a scale; `sceneTransform` turns it into a CSS transform.
import type { Bounds } from '../model/grid';
import type { Pos } from '../model/types';

export const TILE_W = 320;
export const TILE_H = 180;
export const GAP = 48;
export const LAYER_GAP = 320;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Camera {
  /** Scene point at the middle of the screen. */
  target: Vec3;
  scale: number;
  /** Degrees. Positive pitch tips the top of the scene away; positive yaw turns it to the left. */
  pitch: number;
  yaw: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Scene position of a slide tile's top-left corner. `layerGap` is the distance between layers. */
export function tileOrigin(p: Pos, layerGap = LAYER_GAP): Vec3 {
  return { x: p.x * (TILE_W + GAP), y: p.y * (TILE_H + GAP), z: p.z ? -p.z * layerGap : 0 };
}

export function tileCenter(p: Pos, layerGap = LAYER_GAP): Vec3 {
  const o = tileOrigin(p, layerGap);
  return { x: o.x + TILE_W / 2, y: o.y + TILE_H / 2, z: o.z };
}

/** Looking straight at one slide, sized like present mode shows it (fit inside the screen). */
export function focusCamera(p: Pos, vp: Viewport): Camera {
  return {
    target: tileCenter(p),
    scale: Math.min(vp.width / TILE_W, vp.height / TILE_H),
    pitch: 0,
    yaw: 0,
  };
}

/** Default view angles: a tilt that shows the deck is 3D, more side-on when there are layers. */
export function defaultAngles(layers: number): { pitch: number; yaw: number } {
  return layers > 1 ? { pitch: 20, yaw: -26 } : { pitch: 28, yaw: -14 };
}

const MAX_OVERVIEW_SCALE = 1.4;

/** Whole deck in view from the given angles, centred and scaled to fit with a margin. */
export function overviewCamera(
  b: Bounds,
  vp: Viewport,
  angles: { pitch: number; yaw: number },
  layerGap = LAYER_GAP,
): Camera {
  const a = tileOrigin({ x: b.minX, y: b.minY, z: b.minZ }, layerGap);
  const c = tileOrigin({ x: b.maxX, y: b.maxY, z: b.maxZ }, layerGap);
  const w = c.x - a.x + TILE_W;
  const h = c.y - a.y + TILE_H;
  const d = a.z - c.z;
  const rad = (deg: number) => (Math.abs(deg) * Math.PI) / 180;
  // Rough projected size after turning the box by yaw, then pitch.
  const projW = w * Math.cos(rad(angles.yaw)) + d * Math.sin(rad(angles.yaw));
  const projH =
    h * Math.cos(rad(angles.pitch)) +
    (d + w * Math.sin(rad(angles.yaw))) * Math.sin(rad(angles.pitch));
  const scale = Math.min(
    MAX_OVERVIEW_SCALE,
    (vp.width * 0.82) / Math.max(projW, 1),
    (vp.height * 0.78) / Math.max(projH, 1),
  );
  return {
    target: { x: a.x + w / 2, y: a.y + h / 2, z: (a.z + c.z) / 2 },
    scale,
    ...angles,
  };
}

const r = (v: number) => +v.toFixed(3);

/**
 * CSS transform for the scene element (positioned at the screen's top-left, inside a parent with
 * `perspective`): move the target to the origin, turn, scale (in 3D, so layer spacing scales
 * too), then move the origin to the middle of the screen.
 */
export function sceneTransform(cam: Camera, vp: Viewport): string {
  const t = cam.target;
  return (
    `translate3d(${r(vp.width / 2)}px, ${r(vp.height / 2)}px, 0) ` +
    `scale3d(${r(cam.scale)}, ${r(cam.scale)}, ${r(cam.scale)}) ` +
    `rotateX(${r(cam.pitch)}deg) rotateY(${r(cam.yaw)}deg) ` +
    `translate3d(${r(-t.x)}px, ${r(-t.y)}px, ${r(-t.z)}px)`
  );
}

/** Orbit by a pointer drag, keeping the scene from flipping over. */
export function orbit(cam: Camera, dx: number, dy: number): Camera {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    ...cam,
    yaw: clamp(cam.yaw - dx * 0.25, -80, 80),
    pitch: clamp(cam.pitch + dy * 0.25, -70, 80),
  };
}
