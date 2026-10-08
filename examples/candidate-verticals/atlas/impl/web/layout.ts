// Layout geometry helpers. This is the ONE file where Math.min/Math.max may
// appear (17 §T10). All values here are presentation geometry, never
// operational values. Operational values are copied verbatim from the frame.
import type { Rect } from '../src/experience/types.js';

/** Center a label within a rect. Returns {x, y} for text placement. */
export function centerIn(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Clamp a value into [lo, hi] for keeping tokens inside their container. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Evenly space n tokens across a rect's width. Returns x offsets. */
export function spreadX(rect: Rect, n: number, pad: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [rect.x + rect.w / 2];
  const step = (rect.w - pad * 2) / (n - 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rect.x + pad + step * i);
  return out;
}

/** Stack n tokens vertically within a rect. Returns y offsets. */
export function stackY(rect: Rect, n: number, rowH: number, topPad: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rect.y + topPad + i * rowH);
  return out;
}
