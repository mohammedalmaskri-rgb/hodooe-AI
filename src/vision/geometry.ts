import type { Box } from './types';

/**
 * Maps a box from video pixels to on-screen pixels for a <video> rendered with
 * object-fit: cover (fills the view, crops the overflow, never stretches).
 */
export function mapCover(box: Box, videoW: number, videoH: number, viewW: number, viewH: number): Box {
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const offX = (viewW - videoW * scale) / 2;
  const offY = (viewH - videoH * scale) / 2;
  return { x: box.x * scale + offX, y: box.y * scale + offY, w: box.w * scale, h: box.h * scale };
}

/**
 * Maps a box for a <video> rendered with object-fit: contain: the WHOLE analysed frame is
 * visible (letterboxed), so every box the detector reports is on screen.
 */
export function mapContain(box: Box, videoW: number, videoH: number, viewW: number, viewH: number): Box {
  const scale = Math.min(viewW / videoW, viewH / videoH);
  const offX = (viewW - videoW * scale) / 2;
  const offY = (viewH - videoH * scale) / 2;
  return { x: box.x * scale + offX, y: box.y * scale + offY, w: box.w * scale, h: box.h * scale };
}
