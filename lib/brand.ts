// Brand capture (SPEC.md Phase 2): read the page's computed styles to find its main colors,
// heading/body fonts and button style. Used only to style fix library presets. It describes the
// site's look; it never judges it.

import { BLOCK_ATTR, EDITOR_ATTR } from './model/selector';
import type { BrandCapture, ButtonStyle } from './model/types';

const MAX_ELEMENTS = 3000;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG', 'IFRAME', 'HEAD', 'META', 'LINK']);
const BUTTONISH = /(^|[\s_-])(btn|button|cta)([\s_-]|$)/i;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseColor(css: string): (Rgb & { a: number }) | null {
  const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?\s*\)/);
  if (m) {
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[5] === '%') a /= 100;
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  const h = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (h) {
    const s = h[1].length === 3 ? h[1].replace(/./g, '$&$&') : h[1];
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: 1 };
  }
  return null;
}

export function toHex(c: Rgb): string {
  return '#' + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function hsl(c: Rgb): { s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(c: Rgb): number {
  const ch = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** Readable text color on top of `bg`. */
export function onColor(bg: string): string {
  const c = parseColor(bg);
  if (!c) return '#ffffff';
  const l = luminance(c);
  // Pick whichever of white / #111 (luminance 0.0056) has the higher contrast ratio.
  return 1.05 / (l + 0.05) >= (l + 0.05) / (0.0056 + 0.05) ? '#ffffff' : '#111111';
}

/** Mix `a` toward `b` by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

function isColorful(c: Rgb): boolean {
  const { s, l } = hsl(c);
  return s > 0.25 && l > 0.12 && l < 0.88;
}

function distance(a: Rgb, b: Rgb): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/** Weighted tally of colors; near-identical shades are merged. */
class Tally {
  private items: { c: Rgb; w: number }[] = [];
  add(css: string, weight: number): void {
    const c = parseColor(css);
    if (!c || c.a < 0.5 || weight <= 0) return;
    const hit = this.items.find((i) => distance(i.c, c) < 24);
    if (hit) hit.w += weight;
    else this.items.push({ c, w: weight });
  }
  ranked(): { c: Rgb; w: number }[] {
    return [...this.items].sort((a, b) => b.w - a.w);
  }
  top(): string | undefined {
    const t = this.ranked()[0];
    return t && toHex(t.c);
  }
}

class WordTally {
  private m = new Map<string, number>();
  add(v: string, w: number): void {
    if (v && w > 0) this.m.set(v, (this.m.get(v) ?? 0) + w);
  }
  top(): string | undefined {
    let best: string | undefined;
    let bw = 0;
    for (const [k, w] of this.m) if (w > bw) [best, bw] = [k, w];
    return best;
  }
}

function ownTextLength(el: Element): number {
  let n = 0;
  for (const node of Array.from(el.childNodes)) if (node.nodeType === 3) n += (node.textContent ?? '').trim().length;
  return n;
}

function looksLikeButton(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'BUTTON') return true;
  if (tag === 'INPUT') return /^(submit|button)$/i.test(el.getAttribute('type') ?? '');
  if (el.getAttribute('role') === 'button') return true;
  if (tag === 'A') return BUTTONISH.test(el.getAttribute('class') ?? '');
  return false;
}

/** Read the page's look. Skips the editor and blocks inserted by Glow-Up. */
export function captureBrand(doc: Document = document): BrandCapture {
  const win = doc.defaultView!;
  const body = doc.body;
  const bgs = new Tally();
  const texts = new Tally();
  const accents = new Tally();
  const buttons: { bg: string; color: string; radius: string; w: number }[] = [];
  const headingFonts = new WordTally();
  const bodyFonts = new WordTally();
  // Without layout (tests, hidden tabs) every rect is empty; then weigh every element equally.
  const noLayout = !body || (body.getBoundingClientRect().width === 0 && body.getBoundingClientRect().height === 0);
  const viewArea = Math.max(1, win.innerWidth * win.innerHeight);

  let seen = 0;
  const walk = (el: Element) => {
    if (seen++ > MAX_ELEMENTS) return;
    if (SKIP_TAGS.has(el.tagName) || el.hasAttribute(EDITOR_ATTR) || el.hasAttribute(BLOCK_ATTR)) return;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
    const rect = el.getBoundingClientRect();
    const area = noLayout ? 1 : rect.width * rect.height;
    if (!noLayout && area === 0 && cs.display !== 'contents') {
      // Zero-size wrappers can still have visible (overflowing / positioned) children.
      for (const child of Array.from(el.children)) walk(child);
      return;
    }
    // Share of the first screen, so a page-wide wrapper doesn't drown everything else out.
    const share = noLayout ? 0.1 : Math.min(area, viewArea) / viewArea;

    const bg = cs.backgroundColor;
    const bgc = parseColor(bg);
    const textLen = ownTextLength(el);

    if (looksLikeButton(el) && bgc && bgc.a >= 0.5) {
      const radius = cs.borderTopLeftRadius || cs.borderRadius.split(/\s+/)[0] || '0px';
      buttons.push({ bg, color: cs.color, radius, w: 1 + textLen / 20 });
      accents.add(bg, 6);
    } else {
      bgs.add(bg, share * 100);
      if (bgc && isColorful(bgc)) accents.add(bg, share * 40);
    }
    if (textLen) {
      texts.add(cs.color, textLen);
      const col = parseColor(cs.color);
      if (el.tagName === 'A' && col && isColorful(col)) accents.add(cs.color, 2 + textLen / 30);
      const isHeading = /^H[1-3]$/.test(el.tagName);
      if (isHeading && col && isColorful(col)) accents.add(cs.color, 1 + textLen / 40);
      (isHeading ? headingFonts : bodyFonts).add(cs.fontFamily, textLen);
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  if (body) {
    // The page canvas: body's background, else <html>'s, else the browser's white. Counts as one full screen.
    const bcs = win.getComputedStyle(body);
    const canvas = [bcs.backgroundColor, win.getComputedStyle(doc.documentElement).backgroundColor].find((c) => (parseColor(c)?.a ?? 0) >= 0.5) ?? '#ffffff';
    bgs.add(canvas, 100);
    bodyFonts.add(bcs.fontFamily, 1);
    for (const child of Array.from(body.children)) walk(child);
  }

  const accentRanked = accents.ranked().filter((i) => isColorful(i.c));
  const accent = accentRanked[0] ? toHex(accentRanked[0].c) : undefined;
  const background = bgs.top() ?? '#ffffff';
  const text = texts.top() ?? '#111111';

  let button: ButtonStyle | undefined;
  if (buttons.length) {
    const tally = new Map<string, { b: (typeof buttons)[0]; w: number }>();
    for (const b of buttons) {
      const key = toHex(parseColor(b.bg)!);
      const cur = tally.get(key);
      if (cur) cur.w += b.w;
      else tally.set(key, { b, w: b.w });
    }
    const best = [...tally.values()].sort((a, b) => b.w - a.w)[0].b;
    const c = parseColor(best.color);
    button = { background: toHex(parseColor(best.bg)!), color: c ? toHex(c) : onColor(best.bg), radius: best.radius };
  }

  // Palette: accent first, then the other prominent colors, without near-duplicates.
  const palette: Rgb[] = [];
  const push = (c: Rgb | null | undefined) => {
    if (c && !palette.some((p) => distance(p, c) < 40) && palette.length < 6) palette.push(c);
  };
  for (const i of accentRanked) push(i.c);
  push(parseColor(background));
  push(parseColor(text));
  for (const i of bgs.ranked()) push(i.c);
  for (const i of texts.ranked()) push(i.c);

  const headingFont = headingFonts.top();
  const bodyFont = bodyFonts.top();
  return {
    colors: palette.map(toHex),
    ...(accent ? { accent } : {}),
    text,
    background,
    ...(headingFont ? { headingFont } : bodyFont ? { headingFont: bodyFont } : {}),
    ...(bodyFont ? { bodyFont } : {}),
    ...(button ? { button } : {}),
    capturedAt: Date.now(),
  };
}

/** First family name of a font stack, for display. */
export function fontName(stack: string | undefined): string {
  return (stack ?? '').split(',')[0].replace(/["']/g, '').trim() || 'Default';
}
