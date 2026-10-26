// Pure layout math for the editor's on-canvas helpers (SPEC.md 6A): spacing boxes, measuring
// between elements, equal-spacing checks, smart guides and text contrast. No DOM access here, so
// it can be tested on its own.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Text shown at the middle of the line, e.g. "24". */
  label: string;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

const right = (b: Box) => b.left + b.width;
const bottom = (b: Box) => b.top + b.height;
const r1 = (n: number) => String(Math.round(n));

export interface SpacingBand {
  kind: 'margin' | 'padding';
  side: Side;
  box: Box;
  value: number;
}

/**
 * The margin bands outside the border box and the padding bands inside it, Webflow style.
 * `border` is the border width per side (padding sits inside the border).
 */
export function spacingBands(b: Box, margin: Record<Side, number>, padding: Record<Side, number>, border: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 }): SpacingBand[] {
  const out: SpacingBand[] = [];
  const m = margin;
  if (m.top) out.push({ kind: 'margin', side: 'top', value: m.top, box: { left: b.left, top: b.top - m.top, width: b.width, height: m.top } });
  if (m.bottom) out.push({ kind: 'margin', side: 'bottom', value: m.bottom, box: { left: b.left, top: bottom(b), width: b.width, height: m.bottom } });
  if (m.left) out.push({ kind: 'margin', side: 'left', value: m.left, box: { left: b.left - m.left, top: b.top, width: m.left, height: b.height } });
  if (m.right) out.push({ kind: 'margin', side: 'right', value: m.right, box: { left: right(b), top: b.top, width: m.right, height: b.height } });
  const inner = { left: b.left + border.left, top: b.top + border.top, width: b.width - border.left - border.right, height: b.height - border.top - border.bottom };
  const p = padding;
  if (p.top) out.push({ kind: 'padding', side: 'top', value: p.top, box: { left: inner.left, top: inner.top, width: inner.width, height: p.top } });
  if (p.bottom) out.push({ kind: 'padding', side: 'bottom', value: p.bottom, box: { left: inner.left, top: bottom(inner) - p.bottom, width: inner.width, height: p.bottom } });
  if (p.left) out.push({ kind: 'padding', side: 'left', value: p.left, box: { left: inner.left, top: inner.top + p.top, width: p.left, height: inner.height - p.top - p.bottom } });
  if (p.right) out.push({ kind: 'padding', side: 'right', value: p.right, box: { left: right(inner) - p.right, top: inner.top + p.top, width: p.right, height: inner.height - p.top - p.bottom } });
  return out;
}

/**
 * Distances between two elements (VisBug-style measuring). Separate boxes: the gap on each axis
 * where they don't overlap. One inside the other: the distance from each inner edge to the outer.
 */
export function measure(a: Box, b: Box): Seg[] {
  const segs: Seg[] = [];
  const inside = (i: Box, o: Box) => i.left >= o.left && i.top >= o.top && right(i) <= right(o) && bottom(i) <= bottom(o);
  if (inside(a, b) || inside(b, a)) {
    const [i, o] = inside(a, b) ? [a, b] : [b, a];
    const cx = i.left + i.width / 2;
    const cy = i.top + i.height / 2;
    if (i.top - o.top > 0) segs.push({ x1: cx, y1: o.top, x2: cx, y2: i.top, label: r1(i.top - o.top) });
    if (bottom(o) - bottom(i) > 0) segs.push({ x1: cx, y1: bottom(i), x2: cx, y2: bottom(o), label: r1(bottom(o) - bottom(i)) });
    if (i.left - o.left > 0) segs.push({ x1: o.left, y1: cy, x2: i.left, y2: cy, label: r1(i.left - o.left) });
    if (right(o) - right(i) > 0) segs.push({ x1: right(i), y1: cy, x2: right(o), y2: cy, label: r1(right(o) - right(i)) });
    return segs;
  }
  // Horizontal gap
  const hGap = a.left >= right(b) ? [right(b), a.left] : b.left >= right(a) ? [right(a), b.left] : null;
  // Vertical gap
  const vGap = a.top >= bottom(b) ? [bottom(b), a.top] : b.top >= bottom(a) ? [bottom(a), b.top] : null;
  if (hGap) {
    const top = Math.max(a.top, b.top);
    const bot = Math.min(bottom(a), bottom(b));
    const y = top < bot ? (top + bot) / 2 : a.top + a.height / 2;
    segs.push({ x1: hGap[0], y1: y, x2: hGap[1], y2: y, label: r1(hGap[1] - hGap[0]) });
  }
  if (vGap) {
    const l = Math.max(a.left, b.left);
    const rr = Math.min(right(a), right(b));
    const x = l < rr ? (l + rr) / 2 : a.left + a.width / 2;
    segs.push({ x1: x, y1: vGap[0], x2: x, y2: vGap[1], label: r1(vGap[1] - vGap[0]) });
  }
  return segs;
}

/**
 * Gaps between several elements, in reading order along the axis they're spread on, and whether
 * they're all equal (within 1px).
 */
export function gaps(boxes: Box[]): { segs: Seg[]; equal: boolean } {
  if (boxes.length < 2) return { segs: [], equal: false };
  const spreadX = Math.max(...boxes.map((b) => b.left)) - Math.min(...boxes.map((b) => b.left));
  const spreadY = Math.max(...boxes.map((b) => b.top)) - Math.min(...boxes.map((b) => b.top));
  const horizontal = spreadX > spreadY;
  const sorted = [...boxes].sort((a, b) => (horizontal ? a.left - b.left : a.top - b.top));
  const segs: Seg[] = [];
  const values: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const [p, c] = [sorted[i - 1], sorted[i]];
    if (horizontal) {
      const x1 = right(p);
      const x2 = c.left;
      const y = (Math.max(p.top, c.top) + Math.min(bottom(p), bottom(c))) / 2;
      values.push(x2 - x1);
      segs.push({ x1, y1: y, x2, y2: y, label: r1(x2 - x1) });
    } else {
      const y1 = bottom(p);
      const y2 = c.top;
      const x = (Math.max(p.left, c.left) + Math.min(right(p), right(c))) / 2;
      values.push(y2 - y1);
      segs.push({ x1: x, y1, x2: x, y2, label: r1(y2 - y1) });
    }
  }
  const equal = values.every((v) => Math.abs(v - values[0]) <= 1);
  return { segs, equal };
}

export interface Guide {
  axis: 'x' | 'y';
  /** Position of the line. */
  at: number;
  /** Extent of the line along the other axis. */
  from: number;
  to: number;
}

/**
 * Smart guides: where the moving box's edges or centre line up with another box's edges or
 * centre. Returns the lines to draw and, when within `threshold`, how far to snap on each axis.
 */
export function smartGuides(moving: Box, others: Box[], threshold = 4): { guides: Guide[]; snapX: number; snapY: number } {
  const xs = (b: Box) => [b.left, b.left + b.width / 2, right(b)];
  const ys = (b: Box) => [b.top, b.top + b.height / 2, bottom(b)];
  let bestX: { d: number; at: number; o: Box } | null = null;
  let bestY: { d: number; at: number; o: Box } | null = null;
  for (const o of others) {
    for (const mx of xs(moving)) for (const ox of xs(o)) {
      const d = ox - mx;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: ox, o };
    }
    for (const my of ys(moving)) for (const oy of ys(o)) {
      const d = oy - my;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: oy, o };
    }
  }
  const guides: Guide[] = [];
  if (bestX) guides.push({ axis: 'x', at: bestX.at, from: Math.min(moving.top, bestX.o.top), to: Math.max(bottom(moving), bottom(bestX.o)) });
  if (bestY) guides.push({ axis: 'y', at: bestY.at, from: Math.min(moving.left, bestY.o.left), to: Math.max(right(moving), right(bestY.o)) });
  return { guides, snapX: bestX?.d ?? 0, snapY: bestY?.d ?? 0 };
}

// ---------- contrast ----------

function lum(rgb: [number, number, number]): number {
  const ch = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
}

/** WCAG contrast ratio between two opaque colors (1 to 21). */
export function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** WCAG level for normal-size text (large text needs less). */
export function contrastLevel(ratio: number, large = false): 'AAA' | 'AA' | 'Low' {
  if (ratio >= (large ? 4.5 : 7)) return 'AAA';
  if (ratio >= (large ? 3 : 4.5)) return 'AA';
  return 'Low';
}
