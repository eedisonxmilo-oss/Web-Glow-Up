// Lays out exports on a canvas (SPEC.md Phase 3): agency logo and name, prospect URL, date,
// Before / After screenshots, numbered pins on the After view and a numbered notes legend.
// Used for the PNG (both views on one image) and for each PDF page (one view per page).

import { onColor } from '../brand';
import type { AgencySettings } from '../settings';

export interface Shot {
  /** PNG of the visible area, in device pixels. */
  dataUrl: string;
  /** Viewport size in CSS pixels when it was taken (pins are in this space). */
  viewW: number;
  viewH: number;
  /** Centres of numbered pins, CSS pixels. */
  pins: { n: number; x: number; y: number }[];
}

export interface ComposeOptions {
  views: { label: string; shot: Shot; pins: boolean }[];
  arrange: 'row' | 'column';
  agency: AgencySettings;
  url: string;
  date: string;
  /** Numbered notes to list under the views; empty for none. */
  legend: { n: number; text: string }[];
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const INK = '#1f2330';
const MUTED = '#6b7184';
const LINE = '#d9dbe3';
const BEFORE_CHIP = '#4b5163';
/** Widest a single view is drawn, in output pixels. */
const MAX_VIEW_W = 1200;
const MAX_CANVAS_SIDE = 16000;

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',', 2);
  const mime = head.match(/^data:([^;,]+)/)?.[1] ?? 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Decode without an <img>, so the page's Content-Security-Policy can't block it. */
async function bitmap(dataUrl: string): Promise<ImageBitmap> {
  return createImageBitmap(dataUrlToBlob(dataUrl));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= width || !line) line = test;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > width) s = s.slice(0, -1);
  return s + '…';
}

function pin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, accent: string): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = r * 0.5;
  ctx.shadowOffsetY = r * 0.12;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = onColor(accent);
  ctx.font = `700 ${Math.round(r * 1.05)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + r * 0.04);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export async function compose(o: ComposeOptions, doc: Document = document): Promise<HTMLCanvasElement> {
  const bitmaps = await Promise.all(o.views.map((v) => bitmap(v.shot.dataUrl)));
  const logo = o.agency.logo ? await bitmap(o.agency.logo).catch(() => null) : null;

  const W = Math.min(MAX_VIEW_W, Math.max(...bitmaps.map((b) => b.width)));
  const n = o.views.length;
  const row = o.arrange === 'row';
  // Text and chrome scale with the whole image, so side-by-side exports stay readable when the
  // image is shown at screen width. Pins scale with the screenshot they sit on.
  const k = (W / 1000) * (row && n > 1 ? 1.5 : 1);
  const pinR = Math.round((W / 1000) * 17);
  const P = Math.round(40 * k);
  const G = Math.round(32 * k);
  const imgH = bitmaps.map((b) => Math.round((W * b.height) / b.width));
  const width = row ? P * 2 + n * W + (n - 1) * G : P * 2 + W;

  const scratch = doc.createElement('canvas').getContext('2d')!;
  const accent = o.agency.accent;

  // ---- measure ----
  const barH = Math.round(8 * k);
  const headH = Math.round(104 * k);
  const chipH = Math.round(34 * k);
  const chipGap = Math.round(12 * k);
  const viewsH = row ? chipH + chipGap + Math.max(...imgH) : imgH.reduce((s, h) => s + chipH + chipGap + h, 0) + (n - 1) * G;
  const legendFont = Math.round(17 * k);
  const legendLine = Math.round(25 * k);
  const legendR = Math.round(14 * k);
  const legendTextW = width - P * 2 - legendR * 2 - Math.round(14 * k);
  scratch.font = `400 ${legendFont}px ${FONT}`;
  const legendLines = o.legend.map((l) => wrap(scratch, l.text || '(no text)', legendTextW));
  const legendTitleH = Math.round(44 * k);
  const legendH = o.legend.length ? legendTitleH + legendLines.reduce((s, ls) => s + Math.max(ls.length * legendLine, legendR * 2) + Math.round(12 * k), 0) : 0;
  const height = barH + headH + P + viewsH + (legendH ? G + legendH : 0) + P;

  const scale = Math.min(1, MAX_CANVAS_SIDE / Math.max(width, height));
  const canvas = doc.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.imageSmoothingQuality = 'high';

  // ---- background + header ----
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, width, barH);

  let y = barH;
  const midY = y + headH / 2;
  let x = P;
  if (logo) {
    const lh = Math.min(56 * k, logo.height);
    const lw = Math.min((logo.width * lh) / logo.height, 260 * k);
    const dh = (logo.height * lw) / logo.width;
    ctx.drawImage(logo, x, midY - dh / 2, lw, dh);
    x += lw + Math.round(16 * k);
  }
  const rightW = Math.round(width * 0.45);
  if (o.agency.name) {
    ctx.fillStyle = INK;
    ctx.font = `700 ${Math.round(26 * k)}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(fit(ctx, o.agency.name, width - x - rightW - P), x, midY);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = INK;
  ctx.font = `600 ${Math.round(20 * k)}px ${FONT}`;
  ctx.fillText(fit(ctx, o.url, rightW), width - P, midY - 4 * k);
  ctx.fillStyle = MUTED;
  ctx.font = `400 ${Math.round(16 * k)}px ${FONT}`;
  ctx.fillText(o.date, width - P, midY + 22 * k);
  ctx.textAlign = 'left';
  y += headH;
  ctx.fillStyle = LINE;
  ctx.fillRect(P, y, width - P * 2, Math.max(1, Math.round(k)));
  y += P;

  // ---- views ----
  const drawView = (i: number, vx: number, vy: number) => {
    const v = o.views[i];
    const isAfter = i > 0 || /after/i.test(v.label);
    const chipFill = isAfter ? accent : BEFORE_CHIP;
    ctx.font = `700 ${Math.round(15 * k)}px ${FONT}`;
    const label = v.label.toUpperCase();
    const chipW = ctx.measureText(label).width + 28 * k;
    ctx.fillStyle = chipFill;
    ctx.beginPath();
    ctx.roundRect(vx, vy, chipW, chipH, chipH / 2);
    ctx.fill();
    ctx.fillStyle = onColor(chipFill);
    ctx.textBaseline = 'middle';
    ctx.fillText(label, vx + 14 * k, vy + chipH / 2 + k);
    ctx.textBaseline = 'alphabetic';

    const iy = vy + chipH + chipGap;
    const h = imgH[i];
    ctx.save();
    ctx.shadowColor = 'rgba(15,18,30,0.18)';
    ctx.shadowBlur = 24 * k;
    ctx.shadowOffsetY = 6 * k;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(vx, iy, W, h);
    ctx.restore();
    ctx.drawImage(bitmaps[i], vx, iy, W, h);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = Math.max(1, k);
    ctx.strokeRect(vx, iy, W, h);

    if (v.pins) {
      const s = W / v.shot.viewW;
      const r = pinR;
      for (const p of v.shot.pins) pin(ctx, vx + Math.min(Math.max(p.x * s, r + 2), W - r - 2), iy + Math.min(Math.max(p.y * s, r + 2), h - r - 2), r, p.n, accent);
    }
    return chipH + chipGap + h;
  };
  if (row) {
    o.views.forEach((_, i) => drawView(i, P + i * (W + G), y));
    y += viewsH;
  } else {
    o.views.forEach((_, i) => {
      y += drawView(i, P, y) + (i < n - 1 ? G : 0);
    });
  }

  // ---- notes legend ----
  if (o.legend.length) {
    y += G;
    ctx.fillStyle = INK;
    ctx.font = `700 ${Math.round(20 * k)}px ${FONT}`;
    ctx.fillText('Notes', P, y + 22 * k);
    y += legendTitleH;
    o.legend.forEach((l, i) => {
      pin(ctx, P + legendR, y + legendR, legendR, l.n, accent);
      ctx.fillStyle = INK;
      ctx.font = `400 ${legendFont}px ${FONT}`;
      const lines = legendLines[i];
      lines.forEach((line, j) => ctx.fillText(line, P + legendR * 2 + 14 * k, y + legendR + 6 * k + j * legendLine));
      y += Math.max(lines.length * legendLine, legendR * 2) + Math.round(12 * k);
    });
  }
  for (const b of bitmaps) b.close();
  logo?.close();
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the image.'))), type, quality));
}
