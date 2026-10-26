// The "Fix library" tab: the captured brand (editable) and the preset list. Picking a preset
// opens its fields; "Add to page" places it against the selected element (or as the preset says).

import { fontName } from '../brand';
import type { BlockPosition, BrandCapture, Op } from '../model/types';
import { defaultValues, PRESETS, type Preset } from '../presets';
import type { GlowUp } from './controller';
import type { ShadowHost } from './host';

const HTML = `
<div class="brand-box">
  <div class="brand-head"><h4>Site brand</h4><button class="btn small" data-lib="recapture" title="Read the page's colors and fonts again">Re-read</button></div>
  <label class="field"><span>Accent</span><div class="ctl"><input type="color" data-brand="accent"><span class="dots"></span></div></label>
  <label class="field"><span>Text</span><div class="ctl"><input type="color" data-brand="text"></div></label>
  <label class="field"><span>Background</span><div class="ctl"><input type="color" data-brand="background"></div></label>
  <div class="hint fonts"></div>
  <div class="hint">Read from this page and used to style new fixes. Change any of them if you like.</div>
</div>
<div class="presets"></div>`;

const POSITIONS: [BlockPosition | 'top', string][] = [
  ['beforebegin', 'Above the selected element'],
  ['afterend', 'Below the selected element'],
  ['afterbegin', 'Inside it, at the top'],
  ['beforeend', 'Inside it, at the end'],
  ['top', 'Top of the page'],
];

export interface LibraryHooks {
  selected(): Element | null;
  /** Called after a preset was added, with its op. */
  applied(op: Op): void;
}

export class FixLibrary {
  private open: string | null = null;
  private values = new Map<string, Record<string, string>>();
  private noteOn = new Map<string, boolean>();
  private noteText = new Map<string, string>();
  private position = new Map<string, BlockPosition | 'top'>();
  private q: <T extends Element = HTMLElement>(sel: string) => T;

  constructor(
    private app: GlowUp,
    private host: ShadowHost,
    private root: HTMLElement,
    private hooks: LibraryHooks,
  ) {
    root.innerHTML = HTML;
    this.q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    this.bind();
    this.renderBrand();
    this.renderPresets();
  }

  private get doc(): Document {
    return this.root.ownerDocument;
  }

  private bind(): void {
    for (const input of Array.from(this.root.querySelectorAll<HTMLInputElement>('[data-brand]'))) {
      input.addEventListener('change', () => {
        this.app.setBrand({ [input.dataset.brand!]: input.value } as Partial<BrandCapture>);
        this.renderBrand();
      });
    }
    this.q('[data-lib="recapture"]').addEventListener('click', () => {
      this.app.recaptureBrand();
      this.renderBrand();
      this.host.toast('Read the page’s colors and fonts again.');
    });
  }

  // ---------- brand ----------

  private renderBrand(): void {
    const b = this.app.getBrand();
    const set = (k: 'accent' | 'text' | 'background', v: string | undefined) => {
      const input = this.q<HTMLInputElement>(`[data-brand="${k}"]`);
      if (/^#[0-9a-f]{6}$/i.test(v ?? '')) input.value = v!;
    };
    set('accent', b.accent ?? b.button?.background ?? '#2563eb');
    set('text', b.text);
    set('background', b.background);
    this.q('.dots').replaceChildren(
      ...b.colors.map((c) => {
        const d = this.doc.createElement('button');
        d.className = 'dot';
        d.style.background = c;
        d.title = `Use ${c} as the accent`;
        d.addEventListener('click', (e) => {
          e.preventDefault();
          this.app.setBrand({ accent: c });
          this.renderBrand();
        });
        return d;
      }),
    );
    const btn = b.button ? ` · Buttons: ${Math.round(parseFloat(b.button.radius) || 0)}px corners` : '';
    this.q('.fonts').textContent = `Headings: ${fontName(b.headingFont)} · Body: ${fontName(b.bodyFont)}${btn}`;
  }

  // ---------- presets ----------

  private renderPresets(): void {
    const groups = ['General', 'Ecommerce'] as const;
    const nodes: Node[] = [];
    for (const g of groups) {
      const h = this.doc.createElement('h4');
      h.textContent = g === 'General' ? 'Fixes' : 'Ecommerce';
      nodes.push(h);
      for (const p of PRESETS.filter((x) => x.group === g)) nodes.push(this.card(p));
    }
    this.q('.presets').replaceChildren(...nodes);
    this.refresh();
  }

  private card(p: Preset): HTMLElement {
    const card = this.doc.createElement('div');
    card.className = 'preset';
    card.dataset.id = p.id;

    const head = this.doc.createElement('button');
    head.className = 'preset-head';
    const name = this.doc.createElement('span');
    name.className = 'pname';
    name.textContent = p.name;
    const sum = this.doc.createElement('span');
    sum.className = 'psum';
    sum.textContent = p.summary;
    head.append(name, sum);
    head.addEventListener('click', () => {
      this.open = this.open === p.id ? null : p.id;
      this.renderPresets();
    });
    card.append(head);
    if (this.open !== p.id) return card;

    card.classList.add('open');
    const form = this.doc.createElement('div');
    form.className = 'preset-form';
    const values = this.values.get(p.id) ?? defaultValues(p);
    this.values.set(p.id, values);

    for (const f of p.fields) {
      const label = this.doc.createElement('label');
      label.className = 'stack';
      const span = this.doc.createElement('span');
      span.textContent = f.label;
      const input = this.doc.createElement('input');
      input.type = 'text';
      input.value = values[f.key] ?? '';
      if (f.placeholder) input.placeholder = f.placeholder;
      input.addEventListener('input', () => (values[f.key] = input.value));
      label.append(span, input);
      form.append(label);
    }

    if (p.placement === 'relative') {
      const label = this.doc.createElement('label');
      label.className = 'stack';
      const span = this.doc.createElement('span');
      span.textContent = 'Where';
      const sel = this.doc.createElement('select');
      sel.className = 'place-select';
      for (const [v, text] of POSITIONS) {
        const o = this.doc.createElement('option');
        o.value = v;
        o.textContent = text;
        sel.append(o);
      }
      sel.addEventListener('change', () => this.position.set(p.id, sel.value as BlockPosition | 'top'));
      label.append(span, sel);
      form.append(label);
    }
    const where = this.doc.createElement('p');
    where.className = 'hint place-hint';
    form.append(where);

    // Optional note, worded as what the fix does (SPEC section 3).
    const noteLabel = this.doc.createElement('label');
    noteLabel.className = 'check';
    const noteBox = this.doc.createElement('input');
    noteBox.type = 'checkbox';
    noteBox.checked = this.noteOn.get(p.id) ?? true;
    noteLabel.append(noteBox, ' Add a numbered note');
    const noteTa = this.doc.createElement('textarea');
    noteTa.rows = 2;
    noteTa.value = this.noteText.get(p.id) ?? p.note;
    noteTa.classList.toggle('hidden', !noteBox.checked);
    noteBox.addEventListener('change', () => {
      this.noteOn.set(p.id, noteBox.checked);
      noteTa.classList.toggle('hidden', !noteBox.checked);
    });
    noteTa.addEventListener('input', () => this.noteText.set(p.id, noteTa.value));
    form.append(noteLabel, noteTa);

    const add = this.doc.createElement('button');
    add.className = 'btn primary add';
    add.textContent = p.placement === 'style' ? 'Apply to selected' : 'Add to page';
    add.addEventListener('click', () => this.add(p, values, noteBox.checked ? noteTa.value : ''));
    form.append(add);

    card.append(form);
    return card;
  }

  /** Open one preset's form (used by the command palette). */
  openPreset(id: string): void {
    this.open = id;
    this.renderPresets();
    this.root.querySelector('.preset.open')?.scrollIntoView({ block: 'nearest' });
  }

  /** Where the open preset would go, given the current selection. */
  private target(p: Preset): { el: Element; position: BlockPosition } | null {
    const sel = this.hooks.selected();
    if (p.placement === 'fixed') return null;
    if (p.placement === 'style') return sel ? { el: sel, position: 'beforeend' } : null;
    const pos = this.position.get(p.id) ?? (sel ? (p.defaultPosition ?? 'afterend') : 'top');
    if (!sel || pos === 'top') return null;
    const body = this.doc.body;
    if (sel === body && (pos === 'beforebegin' || pos === 'afterend')) return { el: body, position: pos === 'beforebegin' ? 'afterbegin' : 'beforeend' };
    return { el: sel, position: pos };
  }

  private add(p: Preset, values: Record<string, string>, note: string): void {
    try {
      const op = this.app.applyPreset(p, { ...values }, this.target(p), note);
      this.host.toast(`Added ${p.name}. Ctrl+Z undoes it.`);
      this.hooks.applied(op);
    } catch (e) {
      this.host.toast((e as Error).message);
    }
  }

  /** Update placement controls for the current selection. Called on every editor refresh. */
  refresh(): void {
    const card = this.root.querySelector<HTMLElement>('.preset.open');
    if (!card) return;
    const p = PRESETS.find((x) => x.id === card.dataset.id)!;
    const sel = this.hooks.selected();
    const before = this.app.session.view === 'before';
    const select = card.querySelector<HTMLSelectElement>('.place-select');
    if (select) {
      const pos = this.position.get(p.id) ?? (sel ? (p.defaultPosition ?? 'afterend') : 'top');
      for (const o of Array.from(select.options)) o.disabled = o.value !== 'top' && !sel;
      if (this.host.root.activeElement !== select) select.value = sel ? pos : 'top';
    }
    const hint = card.querySelector<HTMLElement>('.place-hint')!;
    const add = card.querySelector<HTMLButtonElement>('.add')!;
    add.disabled = before || (p.placement === 'style' && !sel);
    if (before) hint.textContent = 'Switch to After to add fixes.';
    else if (p.placement === 'fixed') hint.textContent = 'Floats in the bottom-right corner of the screen on every screen size.';
    else if (p.placement === 'style') hint.textContent = sel ? `Restyles ${describe(sel)}.` : 'Click the Add to cart button on the page to select it first.';
    else if (!sel || select?.value === 'top') hint.textContent = 'Click an element on the page to place it next to that element.';
    else hint.textContent = `Selected: ${describe(sel)}`;
  }
}

function describe(el: Element): string {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const t = text ? ` “${text.length > 28 ? text.slice(0, 28) + '…' : text}”` : '';
  return `<${el.tagName.toLowerCase()}>${t}`;
}
