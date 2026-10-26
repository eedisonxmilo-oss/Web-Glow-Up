// On-canvas helpers drawn inside the editor's Shadow DOM (SPEC.md 6A): hover and selection boxes
// (several at once), spacing bands with values, measuring lines, equal-spacing gaps, smart guides,
// resize handles with a live size, find highlights and motion badges.
//
// Everything is redrawn once per animation frame from a plain "scene" object. Elements are reused
// between frames, moved with transform only, and resized only when their size changes, so the
// overlay costs no layout in the page and stays at 60fps.

import { measure, spacingBands, SIDES, type Box, type Guide, type Seg, type Side } from './geometry';

export type Handle = 'e' | 's' | 'se';

export interface Scene {
  clean: boolean;
  hover: Element | null;
  hoverLabel: string | null;
  /** Show the hovered element's spacing (Alt+Shift held). */
  hoverSpacing: boolean;
  selection: Element[];
  primaryLabel: string;
  editingText: boolean;
  /** Show the primary element's margin / padding bands with values. */
  spacing: boolean;
  /** Spacing bands can be dragged (Spacing mode, or Alt held). */
  spacingDrag: boolean;
  handles: boolean;
  sizeLabel: string | null;
  measure: Seg[];
  gaps: { segs: Seg[]; equal: boolean };
  guides: Guide[];
  find: Element[];
  badges: Element[];
}

export interface OverlayHandlers {
  handleDown(handle: Handle, e: PointerEvent): void;
  bandDown(kind: 'margin' | 'padding', side: Side, e: PointerEvent): void;
}

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

function boxOf(el: Element): Box | null {
  if (!el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function sides(cs: CSSStyleDeclaration, prop: 'margin' | 'padding' | 'border'): Record<Side, number> {
  const out = {} as Record<Side, number>;
  for (const s of SIDES) out[s] = parseFloat(cs.getPropertyValue(prop === 'border' ? `border-${s}-width` : `${prop}-${s}`)) || 0;
  return out;
}

export function boxSpacing(el: Element): ReturnType<typeof spacingBands> {
  const b = boxOf(el);
  if (!b) return [];
  const cs = getComputedStyle(el);
  return spacingBands(b, sides(cs, 'margin'), sides(cs, 'padding'), sides(cs, 'border'));
}

/** Reuses a fixed set of children of `parent`, adding or removing to match `n`. */
function pool(parent: HTMLElement, n: number, make: () => HTMLElement): HTMLElement[] {
  while (parent.children.length < n) parent.appendChild(make());
  while (parent.children.length > n) parent.lastElementChild!.remove();
  return Array.from(parent.children) as HTMLElement[];
}

function place(el: HTMLElement, b: Box): void {
  el.style.transform = `translate(${px(b.left)}, ${px(b.top)})`;
  const w = px(b.width);
  const h = px(b.height);
  if (el.style.width !== w) el.style.width = w;
  if (el.style.height !== h) el.style.height = h;
}

export class Overlays {
  readonly layer: HTMLElement;
  private parts: Record<string, HTMLElement> = {};
  private primaryLabel!: HTMLElement;

  constructor(
    private doc: Document,
    private on: OverlayHandlers,
  ) {
    this.layer = doc.createElement('div');
    this.layer.className = 'ov';
    for (const name of ['find', 'badges', 'bands', 'hover', 'sel', 'lines', 'labels', 'guides', 'handles']) {
      const d = doc.createElement('div');
      d.className = `ov-${name}`;
      this.layer.appendChild(d);
      this.parts[name] = d;
    }
    this.primaryLabel = doc.createElement('span');
    this.primaryLabel.className = 'box-label';
  }

  private div(cls: string): () => HTMLElement {
    return () => {
      const d = this.doc.createElement('div');
      d.className = cls;
      return d;
    };
  }

  draw(s: Scene): void {
    this.layer.classList.toggle('hidden', s.clean);
    if (s.clean) return;
    this.drawFind(s.find);
    this.drawBadges(s.badges);
    this.drawHover(s);
    this.drawSelection(s);
    this.drawBands(s);
    this.drawLines(s);
    this.drawGuides(s.guides);
    this.drawHandles(s);
  }

  private drawFind(els: Element[]): void {
    const boxes = els.map(boxOf).filter((b): b is Box => !!b);
    pool(this.parts.find, boxes.length, this.div('ov-find-box')).forEach((d, i) => place(d, boxes[i]));
  }

  private drawBadges(els: Element[]): void {
    const boxes = els.map(boxOf).filter((b): b is Box => !!b);
    pool(this.parts.badges, boxes.length, () => {
      const d = this.doc.createElement('div');
      d.className = 'ov-badge';
      d.textContent = '✦ motion';
      return d;
    }).forEach((d, i) => {
      const b = boxes[i];
      d.style.transform = `translate(${px(Math.max(2, b.left + b.width - 64))}, ${px(Math.max(2, b.top + 4))})`;
    });
  }

  private drawHover(s: Scene): void {
    const b = s.hover && !s.selection.includes(s.hover) ? boxOf(s.hover) : null;
    const [box] = pool(this.parts.hover, b ? 1 : 0, () => {
      const d = this.doc.createElement('div');
      d.className = 'hover-box';
      d.appendChild(this.doc.createElement('span')).className = 'box-label hover-label';
      return d;
    });
    if (!b || !box) return;
    place(box, b);
    const lab = box.firstElementChild as HTMLElement;
    lab.textContent = s.hoverLabel ?? '';
    lab.classList.toggle('hidden', !s.hoverLabel);
    box.classList.toggle('below', b.top < 24);
  }

  private drawSelection(s: Scene): void {
    const items = s.selection.map((el) => ({ el, b: boxOf(el) })).filter((x): x is { el: Element; b: Box } => !!x.b);
    const boxes = pool(this.parts.sel, items.length, this.div('select-box'));
    const primary = s.selection[s.selection.length - 1];
    boxes.forEach((d, i) => {
      const { el, b } = items[i];
      place(d, b);
      const isPrimary = el === primary;
      d.classList.toggle('secondary', !isPrimary);
      d.classList.toggle('editing', isPrimary && s.editingText);
      d.classList.toggle('below', b.top < 24);
      if (isPrimary) {
        if (this.primaryLabel.parentElement !== d) d.appendChild(this.primaryLabel);
        this.primaryLabel.textContent = s.primaryLabel;
      }
    });
    if (!items.some((x) => x.el === primary)) this.primaryLabel.remove();
  }

  private drawBands(s: Scene): void {
    const primary = s.selection[s.selection.length - 1];
    // Only the selected element's bands can be dragged; hovered ones are for looking.
    const bands = [
      ...(s.spacing && primary && s.selection.length === 1 ? boxSpacing(primary).map((b) => ({ ...b, drag: s.spacingDrag })) : []),
      ...(s.hoverSpacing && s.hover ? boxSpacing(s.hover).map((b) => ({ ...b, drag: false })) : []),
    ];
    pool(this.parts.bands, bands.length, () => {
      const d = this.doc.createElement('div');
      d.appendChild(this.doc.createElement('span'));
      d.addEventListener('pointerdown', (e) => {
        if (!d.classList.contains('drag')) return;
        e.preventDefault();
        this.on.bandDown(d.dataset.kind as 'margin' | 'padding', d.dataset.side as Side, e);
      });
      return d;
    }).forEach((d, i) => {
      const band = bands[i];
      place(d, band.box);
      d.className = `ov-band ${band.kind} ${band.side}${band.drag ? ' drag' : ''}`;
      d.dataset.kind = band.kind;
      d.dataset.side = band.side;
      const label = d.firstElementChild as HTMLElement;
      label.textContent = String(Math.round(band.value));
      label.classList.toggle('hidden', band.box.width < 14 && band.box.height < 14 && band.value < 4);
    });
  }

  private drawLines(s: Scene): void {
    const segs = [...s.measure.map((x) => ({ ...x, cls: 'measure' })), ...s.gaps.segs.map((x) => ({ ...x, cls: s.gaps.equal ? 'gap equal' : 'gap' }))];
    const lines = pool(this.parts.lines, segs.length, this.div('ov-line'));
    const labels = pool(this.parts.labels, segs.length, this.div('ov-num'));
    segs.forEach((g, i) => {
      const horizontal = g.y1 === g.y2;
      const d = lines[i];
      d.className = `ov-line ${g.cls}`;
      place(d, horizontal ? { left: Math.min(g.x1, g.x2), top: g.y1, width: Math.abs(g.x2 - g.x1), height: 1 } : { left: g.x1, top: Math.min(g.y1, g.y2), width: 1, height: Math.abs(g.y2 - g.y1) });
      const l = labels[i];
      l.className = `ov-num ${g.cls}`;
      l.textContent = g.cls.includes('equal') ? `${g.label} =` : g.label;
      l.style.transform = `translate(${px((g.x1 + g.x2) / 2)}, ${px((g.y1 + g.y2) / 2)}) translate(-50%, -50%)`;
    });
  }

  private drawGuides(guides: Guide[]): void {
    pool(this.parts.guides, guides.length, this.div('ov-guide')).forEach((d, i) => {
      const g = guides[i];
      place(d, g.axis === 'x' ? { left: g.at, top: g.from, width: 1, height: g.to - g.from } : { left: g.from, top: g.at, width: g.to - g.from, height: 1 });
    });
  }

  private drawHandles(s: Scene): void {
    const primary = s.selection[s.selection.length - 1];
    const b = s.handles && primary ? boxOf(primary) : null;
    const hs = pool(this.parts.handles, b ? 4 : 0, () => {
      const d = this.doc.createElement('div');
      d.addEventListener('pointerdown', (e) => {
        if (!d.dataset.h) return;
        e.preventDefault();
        this.on.handleDown(d.dataset.h as Handle, e);
      });
      return d;
    });
    if (!b) return;
    const spots: [Handle | 'size', number, number][] = [
      ['e', b.left + b.width, b.top + b.height / 2],
      ['s', b.left + b.width / 2, b.top + b.height],
      ['se', b.left + b.width, b.top + b.height],
      ['size', b.left + b.width, b.top + b.height + 10],
    ];
    hs.forEach((d, i) => {
      const [h, x, y] = spots[i];
      if (h === 'size') {
        d.className = 'ov-size';
        d.textContent = s.sizeLabel ?? `${Math.round(b.width)} × ${Math.round(b.height)}`;
        d.classList.toggle('hidden', !s.sizeLabel);
        delete d.dataset.h;
        d.style.transform = `translate(${px(x)}, ${px(y)}) translate(-100%, 0)`;
        return;
      }
      d.className = `ov-handle h-${h}`;
      d.dataset.h = h;
      d.style.transform = `translate(${px(x)}, ${px(y)}) translate(-50%, -50%)`;
    });
  }
}

export { boxOf, measure };
export type { Box };
