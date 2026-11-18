import { describe, expect, it } from 'vitest';
import { pos } from '../model/grid';
import {
  focusCamera,
  GAP,
  LAYER_GAP,
  orbit,
  overviewCamera,
  sceneTransform,
  TILE_H,
  TILE_W,
  tileCenter,
} from './camera';

const vp = { width: 1600, height: 900 };

describe('camera', () => {
  it('lays tiles out by column and row, layers stepping back', () => {
    expect(tileCenter(pos(0, 0, 0))).toEqual({ x: TILE_W / 2, y: TILE_H / 2, z: 0 });
    expect(tileCenter(pos(2, 1, 3))).toEqual({
      x: 2 * (TILE_W + GAP) + TILE_W / 2,
      y: TILE_H + GAP + TILE_H / 2,
      z: -3 * LAYER_GAP,
    });
  });

  it('focus fits the slide on screen, straight on, at its own depth', () => {
    const cam = focusCamera(pos(1, 0, 2), vp);
    expect(cam.scale).toBe(5); // 1600/320 = 5, 900/180 = 5
    expect(cam.pitch).toBe(0);
    expect(cam.target.z).toBe(-2 * LAYER_GAP);
  });

  it('overview centres the deck and shrinks to fit big decks', () => {
    const small = overviewCamera({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0, maxZ: 0 }, vp, {
      pitch: 0,
      yaw: 0,
    });
    expect(small.target.x).toBeCloseTo((2 * TILE_W + GAP) / 2);
    const big = overviewCamera({ minX: 0, minY: 0, minZ: 0, maxX: 261, maxY: 0, maxZ: 0 }, vp, {
      pitch: 0,
      yaw: 0,
    });
    expect(big.scale).toBeLessThan(small.scale);
    // Fits the width with a margin.
    expect(262 * (TILE_W + GAP) * big.scale).toBeLessThan(vp.width);
  });

  it('builds a CSS transform that puts the target in the middle of the screen', () => {
    const t = sceneTransform(focusCamera(pos(0, 0, 0), vp), vp);
    expect(t).toBe(
      'translate3d(800px, 450px, 0) scale3d(5, 5, 5) rotateX(0deg) rotateY(0deg) ' +
        `translate3d(${-TILE_W / 2}px, ${-TILE_H / 2}px, 0px)`,
    );
  });

  it('orbiting is clamped so the deck never flips over', () => {
    const cam = orbit(focusCamera(pos(0, 0, 0), vp), -10000, 10000);
    expect(cam.yaw).toBe(80);
    expect(cam.pitch).toBe(80);
  });
});
