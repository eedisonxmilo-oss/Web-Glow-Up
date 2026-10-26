// The edit-mode UI: hover highlight, click to select, breadcrumb, inline text editing, style
// panel, hide/move/replace image, undo/redo, Before/After. Lives in the ShadowHost.

import { createHideOp, createMoveOp, createStyleOp, createTextOp } from '../model/ops';
import { describeOp, noteNumbers } from '../model/project';
import { BLOCK_ATTR, buildSelector, fingerprint } from '../model/selector';
import type { ElementFingerprint, Op } from '../model/types';
import type { GlowUp } from './controller';
import type { ShadowHost } from './host';
import { ExportPanel } from './export-panel';
import { FixLibrary } from './library';

type Tab = 'edit' | 'fixes' | 'notes' | 'export';

const NO_TEXT_EDIT = new Set(['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO', 'IFRAME', 'CANVAS', 'svg', 'SVG', 'PICTURE', 'HR', 'BR', 'OBJECT', 'EMBED']);
const BLOCKED_EVENTS = ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'submit', 'contextmenu'];
const UI_EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress', 'input', 'change', 'focusin', 'focusout', 'wheel', 'touchstart', 'touchend', 'contextmenu', 'paste', 'copy', 'cut'];

const FONT_STACKS: [string, string][] = [
  ['Arial', 'Arial, Helvetica, sans-serif'],
  ['Helvetica', '"Helvetica Neue", Helvetica, Arial, sans-serif'],
  ['System UI', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
  ['Verdana', 'Verdana, Geneva, sans-serif'],
  ['Tahoma', 'Tahoma, Geneva, sans-serif'],
  ['Trebuchet MS', '"Trebuchet MS", Helvetica, sans-serif'],
  ['Georgia', 'Georgia, "Times New Roman", serif'],
  ['Times New Roman', '"Times New Roman", Times, serif'],
  ['Palatino', '"Palatino Linotype", Palatino, "Book Antiqua", serif'],
  ['Garamond', 'Garamond, "EB Garamond", serif'],
  ['Courier New', '"Courier New", Courier, monospace'],
];

const PANEL_HTML = `
<div class="pins"></div>
<div class="hover-box"></div>
<div class="select-box"><span class="box-label"></span></div>
<div class="panel">
  <header class="bar">
    <span class="logo"><b>✦</b> Glow-Up</span>
    <div class="seg" title="Before / After">
      <button data-view="before">Before</button><button data-view="after" class="on">After</button>
    </div>
    <button class="icon" data-act="undo" title="Undo (Ctrl+Z)">↶</button>
    <button class="icon" data-act="redo" title="Redo (Ctrl+Shift+Z)">↷</button>
    <button class="icon" data-act="dock" title="Move panel to the other side">⇆</button>
    <button class="icon" data-act="min" title="Minimise panel">–</button>
    <button class="icon" data-act="close" title="Exit edit mode (edits stay)">✕</button>
  </header>
  <nav class="tabs" role="tablist">
    <button data-tab="edit" class="on" role="tab">Edit</button>
    <button data-tab="fixes" role="tab">Fix library</button>
    <button data-tab="notes" role="tab">Notes <span class="notes-n"></span></button>
    <button data-tab="export" role="tab">Export</button>
  </nav>
  <div class="body">
    <div class="notice before-notice hidden">Showing the original page. Switch to <b>After</b> to keep editing.</div>
    <div class="failed hidden">
      <b><span class="failed-n"></span> couldn't re-apply</b>
      <div class="hint">The page changed since these edits were made, or that part hasn't loaded.</div>
      <ul class="failed-list"></ul>
      <div class="row">
        <button class="btn small" data-act="retry">Try again</button>
        <button class="btn small" data-act="remove-failed">Remove them</button>
      </div>
    </div>
    <section class="tab tab-edit">
    <p class="hint empty">Hover the page and click any element to select it. Double-click text to edit it.</p>
    <div class="sel hidden">
      <nav class="crumbs" aria-label="Selected element and its parents"></nav>
      <div class="actions">
        <button class="btn" data-act="text" title="Edit text (Enter or double-click)">✎ Edit text</button>
        <button class="btn" data-act="hide">Hide</button>
        <button class="btn" data-act="parent" title="Select parent">↖ Parent</button>
        <button class="btn" data-act="up">↑ Move up</button>
        <button class="btn" data-act="down">↓ Move down</button>
        <button class="btn" data-act="image" title="Replace image from your computer">🖼 Image…</button>
        <button class="btn" data-act="note" title="Attach a numbered note to the latest change on this element">📝 Note</button>
      </div>
      <div class="group">
        <h4>Text</h4>
        <label class="field"><span>Color</span><div class="ctl"><input type="color" data-prop="color"></div></label>
        <label class="field"><span>Font size</span><div class="ctl"><input type="number" min="1" max="400" data-prop="font-size" data-unit="px"><span class="unit">px</span></div></label>
        <label class="field"><span>Weight</span><div class="ctl"><select data-prop="font-weight">
          <option value="100">100 Thin</option><option value="200">200</option><option value="300">300 Light</option>
          <option value="400">400 Regular</option><option value="500">500 Medium</option><option value="600">600 Semibold</option>
          <option value="700">700 Bold</option><option value="800">800</option><option value="900">900 Black</option>
        </select></div></label>
        <label class="field"><span>Font</span><div class="ctl"><select data-prop="font-family" class="font-select"></select></div></label>
        <div class="field"><span>Align</span><div class="ctl align">
          <button class="btn" data-align="left" title="Left">⯇</button>
          <button class="btn" data-align="center" title="Center">≡</button>
          <button class="btn" data-align="right" title="Right">⯈</button>
          <button class="btn" data-align="justify" title="Justify">☰</button>
        </div></div>
      </div>
      <div class="group">
        <h4>Box</h4>
        <label class="field"><span>Background</span><div class="ctl"><input type="color" data-prop="background-color"><button class="btn small" data-clear="background-color" title="Transparent background">None</button></div></label>
        <div class="field"><span>Padding</span><div class="ctl quad">
          <input type="number" min="0" data-prop="padding-top" data-unit="px" title="Top" placeholder="T">
          <input type="number" min="0" data-prop="padding-right" data-unit="px" title="Right" placeholder="R">
          <input type="number" min="0" data-prop="padding-bottom" data-unit="px" title="Bottom" placeholder="B">
          <input type="number" min="0" data-prop="padding-left" data-unit="px" title="Left" placeholder="L">
        </div></div>
        <div class="field"><span>Margin</span><div class="ctl quad">
          <input type="number" data-prop="margin-top" data-unit="px" title="Top" placeholder="T">
          <input type="number" data-prop="margin-right" data-unit="px" title="Right" placeholder="R">
          <input type="number" data-prop="margin-bottom" data-unit="px" title="Bottom" placeholder="B">
          <input type="number" data-prop="margin-left" data-unit="px" title="Left" placeholder="L">
        </div></div>
        <label class="field"><span>Corner radius</span><div class="ctl"><input type="number" min="0" data-prop="border-radius" data-unit="px"><span class="unit">px</span></div></label>
      </div>
    </div>
    <details class="changes"><summary>Changes (<span class="changes-n">0</span>)</summary><ol class="changes-list"></ol></details>
    </section>
    <section class="tab tab-fixes hidden"></section>
    <section class="tab tab-notes hidden">
      <label class="check"><input type="checkbox" class="pins-toggle" checked> Show numbered pins on the page</label>
      <p class="hint notes-empty">Attach a note to any change: select an element and click <b>📝 Note</b>, or use <b>+ note</b> in the change list on the Edit tab.</p>
      <ol class="notes-list"></ol>
    </section>
    <section class="tab tab-export hidden"></section>
  </div>
  <footer class="status"><span class="save-state">Edits save on this device only</span><span class="kbd">Esc deselects</span></footer>
  <input type="file" accept="image/*" class="file hidden">
</div>`;

interface TextEdit {
  el: HTMLElement;
  beforeHtml: string;
  target: { selector: string; fallback: ElementFingerprint };
}

export class EditorUI {
  private wrap!: HTMLElement;
  private q!: <T extends Element = HTMLElement>(sel: string) => T;
  private hovered: Element | null = null;
  private selected: Element | null = null;
  private textEdit: TextEdit | null = null;
  private gesture = 0;
  private raf = 0;
  private cleanups: (() => void)[] = [];
  private tab: Tab = 'edit';
  private library: FixLibrary | null = null;
  private exporter: ExportPanel | null = null;
  private showPins = true;
  private pins: { el: Element; pin: HTMLElement }[] = [];
  /** Note ids in list order, to rebuild the notes list only when it changes (keeps typing focus). */
  private notesSig = '';

  constructor(
    private app: GlowUp,
    private host: ShadowHost,
  ) {}

  private get doc(): Document {
    return this.host.el.ownerDocument;
  }

  mount(): void {
    this.wrap = this.doc.createElement('div');
    this.wrap.innerHTML = PANEL_HTML;
    this.host.root.appendChild(this.wrap);
    this.q = <T extends Element>(sel: string) => this.wrap.querySelector(sel) as T;
    this.fillFonts();
    this.bindPanel();
    this.bindPage();
    this.cleanups.push(this.app.session.onChange(() => this.refresh()));
    this.cleanups.push(this.app.onStatus(() => this.renderSaveState()));
    const loop = () => {
      this.positionBoxes();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.refresh();
  }

  destroy(): void {
    this.endTextEdit(true);
    cancelAnimationFrame(this.raf);
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.wrap.remove();
  }

  // ---------- page interaction ----------

  private bindPage(): void {
    const win = this.doc.defaultView!;
    const listen = (target: EventTarget, type: string, fn: (e: Event) => void, capture = true) => {
      target.addEventListener(type, fn, { capture, passive: false });
      this.cleanups.push(() => target.removeEventListener(type, fn, { capture }));
    };

    listen(win, 'mousemove', (e) => {
      const t = this.pageTarget(e);
      this.hovered = t && t !== this.selected && !this.isBefore() ? t : null;
    });
    listen(win, 'mouseout', (e) => {
      if (!(e as MouseEvent).relatedTarget) this.hovered = null;
    });

    for (const type of BLOCKED_EVENTS) {
      listen(win, type, (e) => {
        if (this.host.contains(e.target)) return;
        const inTextEdit = !!this.textEdit && e.target instanceof Node && this.textEdit.el.contains(e.target);
        // Let the user place the caret / select text inside the element being edited, but keep
        // the site's own handlers (menus, sliders, links) from firing.
        e.stopImmediatePropagation();
        if (inTextEdit) return;
        e.preventDefault();
        if (type === 'click') this.onPageClick(e as MouseEvent);
        if (type === 'dblclick') this.onPageDblClick(e as MouseEvent);
      });
    }

    listen(win, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));

    // Keep events that happen inside the editor from reaching the site's listeners.
    for (const type of UI_EVENTS) {
      listen(this.host.el, type, (e) => e.stopPropagation(), false);
    }
  }

  private isBefore(): boolean {
    return this.app.session.view === 'before';
  }

  private pageTarget(e: Event): Element | null {
    const t = e.target;
    if (!(t instanceof Element) || this.host.contains(t)) return null;
    if (t === this.doc.documentElement) return null;
    return t;
  }

  private onPageClick(e: MouseEvent): void {
    if (this.isBefore()) return;
    const t = this.pageTarget(e);
    if (this.textEdit) this.endTextEdit(true);
    if (t) this.select(t);
  }

  private onPageDblClick(e: MouseEvent): void {
    if (this.isBefore()) return;
    const t = this.pageTarget(e);
    if (!t) return;
    this.select(t);
    this.startTextEdit();
  }

  private onKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    const fromUi = this.host.contains(e.target);
    const typingInUi = fromUi && e.composedPath().some((n) => n instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName));

    if (this.textEdit) {
      e.stopImmediatePropagation(); // site shortcuts must not fire while typing
      if (e.key === 'Escape') {
        e.preventDefault();
        this.endTextEdit(false);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.endTextEdit(true);
      }
      return; // native undo/redo inside the text
    }
    if (typingInUi) return;

    const key = e.key.toLowerCase();
    let handled = true;
    if (mod && key === 'z' && !e.shiftKey) this.app.session.undo();
    else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) this.app.session.redo();
    else if (e.key === 'Escape') this.select(null);
    else if (e.key === 'Enter' && this.selected && !mod) this.startTextEdit();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  // ---------- selection ----------

  private select(el: Element | null): void {
    if (this.textEdit && el !== this.textEdit.el) this.endTextEdit(true);
    this.selected = el;
    this.hovered = null;
    this.gesture++;
    this.refresh();
  }

  private positionBoxes(): void {
    const place = (box: HTMLElement, el: Element | null) => {
      if (!el || !el.isConnected) {
        box.style.display = 'none';
        return;
      }
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) {
        box.style.display = 'none';
        return;
      }
      box.style.display = 'block';
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      box.classList.toggle('below', r.top < 24);
    };
    place(this.q('.hover-box'), this.hovered);
    place(this.q('.select-box'), this.isBefore() ? null : this.selected);
    for (const { el, pin } of this.pins) {
      const r = el.isConnected ? el.getBoundingClientRect() : null;
      if (!r || (!r.width && !r.height)) {
        pin.style.display = 'none';
        continue;
      }
      // Just inside the top-left corner: the selection label sits above the box, so they don't clash,
      // and full-width blocks don't push the pin under the panel.
      pin.style.display = 'flex';
      pin.style.left = `${Math.max(2, r.left + 4)}px`;
      pin.style.top = `${Math.max(2, r.top + 4)}px`;
    }
  }

  // ---------- inline text editing ----------

  private canEditText(el: Element): boolean {
    // Not around an inserted block: the text op would copy the block into the page's own markup.
    return !NO_TEXT_EDIT.has(el.tagName) && !(el instanceof SVGElement) && el !== this.doc.body && !el.querySelector(`[${BLOCK_ATTR}]`);
  }

  private startTextEdit(): void {
    const el = this.selected;
    if (!(el instanceof HTMLElement) || !this.canEditText(el) || this.isBefore()) return;
    if (this.textEdit?.el === el) return;
    this.endTextEdit(true);
    this.textEdit = {
      el,
      beforeHtml: el.innerHTML,
      target: { selector: buildSelector(el), fallback: fingerprint(el) },
    };
    this.app.guardPaused = true;
    el.setAttribute('contenteditable', supportsPlaintextOnly() ? 'plaintext-only' : 'true');
    el.focus({ preventScroll: true });
    this.refresh();
  }

  private endTextEdit(commit: boolean): void {
    const t = this.textEdit;
    if (!t) return;
    this.textEdit = null;
    this.app.guardPaused = false;
    t.el.removeAttribute('contenteditable');
    t.el.blur();
    if (!commit) {
      t.el.innerHTML = t.beforeHtml;
    } else if (t.el.innerHTML !== t.beforeHtml) {
      const op = createTextOp(t.el, t.beforeHtml, t.el.innerHTML, t.target);
      if (t.el.innerHTML !== op.after.html) t.el.innerHTML = op.after.html;
      this.app.commit(op, { alreadyApplied: true });
      this.app.session.bindElement(op.id, t.el);
    }
    this.refresh();
  }

  // ---------- panel ----------

  private bindPanel(): void {
    // Finish any text edit before another change, so ops stay in the order they were made.
    this.wrap.addEventListener('focusin', (e) => {
      if (this.textEdit && (e.target as Element).matches('input, select, textarea')) this.endTextEdit(true);
    });
    this.wrap.addEventListener('click', (e) => {
      if (this.textEdit && !(e.target as Element).closest('[data-act="text"]')) this.endTextEdit(true);
      const btn = (e.target as Element).closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act) this.onAction(act);
      if (btn.dataset.tab) this.setTab(btn.dataset.tab as Tab);
      if (btn.dataset.view) this.setView(btn.dataset.view as 'before' | 'after');
      if (btn.dataset.align) this.styleChange({ 'text-align': btn.dataset.align }, true);
      if (btn.dataset.clear) this.styleChange({ [btn.dataset.clear]: 'transparent' }, true);
    });

    for (const input of Array.from(this.wrap.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-prop]'))) {
      const apply = () => {
        const prop = input.dataset.prop!;
        if (input.value === '') return;
        const value = input.value + (input.dataset.unit ?? '');
        this.styleChange({ [prop]: value }, false);
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', () => {
        apply();
        this.gesture++;
      });
    }

    const pinsToggle = this.q<HTMLInputElement>('.pins-toggle');
    pinsToggle.addEventListener('change', () => {
      this.showPins = pinsToggle.checked;
      this.refresh();
    });

    const file = this.q<HTMLInputElement>('.file');
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      const target = this.imageTarget();
      if (!f || !target) return;
      try {
        await this.app.replaceImage(target.el, target.mode, f);
      } catch (err) {
        this.host.toast(`Couldn't use that image: ${(err as Error).message}`);
      }
    });
  }

  private onAction(act: string): void {
    const s = this.app.session;
    const el = this.selected;
    switch (act) {
      case 'undo':
        this.endTextEdit(true);
        s.undo();
        break;
      case 'redo':
        this.endTextEdit(true);
        s.redo();
        break;
      case 'close':
        this.app.closeEditor();
        break;
      case 'dock':
        this.q('.panel').classList.toggle('left');
        break;
      case 'min':
        this.q('.panel').classList.toggle('min');
        break;
      case 'retry': {
        const n = this.app.retryFailed();
        this.host.toast(n ? `Re-applied ${n} edit${n === 1 ? '' : 's'}.` : 'Still couldn’t find those elements.');
        break;
      }
      case 'remove-failed':
        this.app.removeFailed();
        break;
      case 'text':
        this.startTextEdit();
        break;
      case 'parent':
        if (el?.parentElement && el.parentElement !== this.doc.documentElement) this.select(el.parentElement);
        break;
      case 'hide':
        if (el && el !== this.doc.body) {
          this.endTextEdit(true);
          this.app.commit(createHideOp(el));
          this.select(null);
        }
        break;
      case 'up':
      case 'down': {
        if (!el || el === this.doc.body) break;
        this.endTextEdit(true);
        const op = createMoveOp(el, act);
        if (op) {
          this.app.commit(op);
          this.app.session.bindElement(op.id, el);
        }
        break;
      }
      case 'image':
        if (this.imageTarget()) this.q<HTMLInputElement>('.file').click();
        break;
      case 'note': {
        const op = el && this.latestOpOn(el);
        if (op) this.openNote(op);
        break;
      }
    }
    this.refresh();
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    for (const t of ['edit', 'fixes', 'notes', 'export'] as Tab[]) {
      this.q(`[data-tab="${t}"]`).classList.toggle('on', t === tab);
      this.q(`.tab-${t}`).classList.toggle('hidden', t !== tab);
    }
    if (tab === 'fixes' && !this.library) {
      this.library = new FixLibrary(this.app, this.host, this.q('.tab-fixes'), {
        selected: () => this.selected,
        applied: (op) => {
          const block = this.app.session.changedElement(op);
          if (block) this.select(block);
        },
      });
    }
    if (tab === 'export') {
      if (!this.exporter) this.exporter = new ExportPanel(this.app, this.host, this.q('.tab-export'));
      else void this.exporter.refresh();
    }
    this.refresh();
  }

  /** The newest applied change whose result is this element. */
  private latestOpOn(el: Element): Op | null {
    const ops = this.app.session.getOps();
    for (let i = ops.length - 1; i >= 0; i--) if (this.app.session.changedElement(ops[i]) === el) return ops[i];
    return null;
  }

  /** Show an op's note on the Notes tab, creating an empty one if it has none. */
  private openNote(op: Op): void {
    const noteId = op.noteId && this.app.getNote(op.noteId) ? op.noteId : this.app.addNote(op.id).id;
    this.setTab('notes');
    const ta = this.wrap.querySelector<HTMLTextAreaElement>(`textarea[data-note="${noteId}"]`);
    ta?.focus();
  }

  private setView(view: 'before' | 'after'): void {
    this.endTextEdit(true);
    if (view === 'before') this.app.session.showBefore();
    else this.app.session.showAfter();
    this.hovered = null;
  }

  private styleChange(changes: Record<string, string>, discrete: boolean): void {
    const el = this.selected;
    if (!el || this.isBefore()) return;
    const key = `${Object.keys(changes).join(',')}:${this.gesture}`;
    this.app.commit(createStyleOp(el, changes), discrete ? {} : { coalesceKey: key });
    if (discrete) this.gesture++;
  }

  private imageTarget(): { el: Element; mode: 'img' | 'bg' } | null {
    const el = this.selected;
    if (!el) return null;
    if (el.tagName === 'IMG') return { el, mode: 'img' };
    if (el.tagName === 'PICTURE') {
      const img = el.querySelector('img');
      if (img) return { el: img, mode: 'img' };
    }
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg.includes('url(')) return { el, mode: 'bg' };
    return null;
  }

  private fillFonts(): void {
    const sel = this.q<HTMLSelectElement>('.font-select');
    const add = (parent: HTMLElement, label: string, value: string) => {
      const o = this.doc.createElement('option');
      o.textContent = label;
      o.value = value;
      parent.appendChild(o);
    };
    // Fonts the page already loads look right without fetching anything.
    const pageFonts = new Set<string>();
    for (const s of ['body', 'h1', 'h2', 'h3', 'button', 'a']) {
      const el = this.doc.querySelector(s);
      if (el) pageFonts.add(getComputedStyle(el).fontFamily);
    }
    const g1 = this.doc.createElement('optgroup');
    g1.label = 'Used on this page';
    for (const f of pageFonts) if (f) add(g1, f.split(',')[0].replace(/["']/g, '').trim(), f);
    const g2 = this.doc.createElement('optgroup');
    g2.label = 'Common fonts';
    for (const [label, value] of FONT_STACKS) add(g2, label, value);
    sel.append(g1, g2);
  }

  // ---------- rendering ----------

  private refresh(): void {
    if (!this.wrap) return;
    const s = this.app.session;
    const before = this.isBefore();
    if (this.selected && !this.selected.isConnected) this.selected = null;

    this.q('[data-view="before"]').classList.toggle('on', before);
    this.q('[data-view="after"]').classList.toggle('on', !before);
    this.q<HTMLButtonElement>('[data-act="undo"]').disabled = !s.canUndo();
    this.q<HTMLButtonElement>('[data-act="redo"]').disabled = !s.canRedo();
    this.q('.before-notice').classList.toggle('hidden', !before);

    // couldn't re-apply
    const failed = s.failedOps();
    this.q('.failed').classList.toggle('hidden', !failed.length || before);
    this.q('.failed-n').textContent = String(failed.length);
    const fl = this.q('.failed-list');
    fl.replaceChildren(...failed.map((op) => this.li(describeOp(op))));

    // selection
    const sel = this.selected;
    this.q('.empty').classList.toggle('hidden', !!sel || before);
    this.q('.sel').classList.toggle('hidden', !sel || before);
    const box = this.q('.select-box');
    box.classList.toggle('editing', !!this.textEdit);
    if (sel) {
      this.q('.box-label').textContent = this.textEdit ? 'Editing text — Enter to finish, Esc to cancel' : label(sel);
      this.renderCrumbs(sel);
      this.renderControls(sel);
    }

    // change list
    const ops = s.getOps();
    const numbers = noteNumbers(ops.filter((o) => this.app.getNote(o.noteId)));
    this.q('.changes-n').textContent = String(ops.length);
    this.q('.changes-list').replaceChildren(
      ...ops.map((op) => {
        const failedOp = s.getStatus(op.id) === 'failed';
        const li = this.li(describeOp(op) + (failedOp ? ' — couldn’t re-apply' : ''));
        if (failedOp) li.className = 'failed-op';
        const n = op.noteId ? numbers.get(op.noteId) : undefined;
        const b = this.doc.createElement('button');
        b.className = n ? 'note-badge' : 'link';
        b.textContent = n ? String(n) : '+ note';
        b.title = n ? `Note ${n}` : 'Attach a numbered note to this change';
        b.addEventListener('click', () => this.openNote(op));
        li.append(' ', b);
        return li;
      }),
    );

    this.q('.notes-n').textContent = numbers.size ? String(numbers.size) : '';
    this.renderNotes(ops, numbers);
    this.renderPins(ops, numbers);
    if (sel) this.q<HTMLButtonElement>('[data-act="note"]').disabled = !this.latestOpOn(sel);
    if (this.tab === 'fixes') this.library?.refresh();
    if (this.tab === 'export') void this.exporter?.refresh();
    this.renderSaveState();
  }

  private renderNotes(ops: readonly Op[], numbers: Map<string, number>): void {
    const entries: { op: Op; n: number }[] = [];
    for (const op of ops) {
      const n = op.noteId ? numbers.get(op.noteId) : undefined;
      if (n && !entries.some((e) => e.op.noteId === op.noteId)) entries.push({ op, n });
    }
    this.q('.notes-empty').classList.toggle('hidden', entries.length > 0);
    const list = this.q('.notes-list');
    const sig = entries.map((e) => `${e.op.noteId}:${e.n}`).join(',');
    if (sig === this.notesSig) {
      // Same notes in the same order: only refresh what they're attached to.
      entries.forEach((e, i) => {
        const what = list.children[i]?.querySelector('.note-for');
        if (what) what.textContent = describeOp(e.op);
      });
      return;
    }
    this.notesSig = sig;
    list.replaceChildren(
      ...entries.map(({ op, n }) => {
        const note = this.app.getNote(op.noteId)!;
        const li = this.doc.createElement('li');
        li.className = 'note';
        const num = this.doc.createElement('span');
        num.className = 'num';
        num.textContent = String(n);
        const main = this.doc.createElement('div');
        main.className = 'note-main';
        const what = this.doc.createElement('div');
        what.className = 'note-for';
        what.textContent = describeOp(op);
        const ta = this.doc.createElement('textarea');
        ta.rows = 2;
        ta.value = note.text;
        ta.dataset.note = note.id;
        ta.placeholder = 'What this change does…';
        ta.addEventListener('input', () => this.app.updateNote(note.id, ta.value));
        const remove = this.doc.createElement('button');
        remove.className = 'link';
        remove.textContent = 'Remove note';
        remove.addEventListener('click', () => {
          this.app.removeNote(note.id);
          this.refresh();
        });
        main.append(what, ta, remove);
        li.append(num, main);
        return li;
      }),
    );
  }

  private renderPins(ops: readonly Op[], numbers: Map<string, number>): void {
    const layer = this.q('.pins');
    this.pins = [];
    const nodes: HTMLElement[] = [];
    if (this.showPins && !this.isBefore()) {
      const done = new Set<string>();
      for (const op of ops) {
        const n = op.noteId ? numbers.get(op.noteId) : undefined;
        if (!n || done.has(op.noteId!)) continue;
        done.add(op.noteId!);
        const el = this.app.session.changedElement(op);
        if (!el) continue;
        const pin = this.doc.createElement('button');
        pin.className = 'pin';
        pin.textContent = String(n);
        pin.title = this.app.getNote(op.noteId)?.text || `Note ${n}`;
        pin.addEventListener('click', () => this.openNote(op));
        this.pins.push({ el, pin });
        nodes.push(pin);
      }
    }
    layer.replaceChildren(...nodes);
  }

  private li(text: string): HTMLLIElement {
    const li = this.doc.createElement('li');
    li.textContent = text;
    return li;
  }

  private renderSaveState(): void {
    if (!this.wrap) return;
    const map = { idle: 'Edits save on this device only', saving: 'Saving…', saved: 'Saved on this device', error: 'Couldn’t save — check storage' };
    this.q('.save-state').textContent = map[this.app.saveState];
  }

  private renderCrumbs(sel: Element): void {
    const chain: Element[] = [];
    for (let e: Element | null = sel; e && e !== this.doc.documentElement; e = e.parentElement) chain.unshift(e);
    const shown = chain.length > 6 ? chain.slice(-6) : chain;
    const nodes: Node[] = [];
    if (chain.length > shown.length) {
      const more = this.doc.createElement('span');
      more.className = 'sep';
      more.textContent = '…';
      nodes.push(more);
    }
    shown.forEach((el, i) => {
      if (i > 0 || nodes.length) {
        const sep = this.doc.createElement('span');
        sep.className = 'sep';
        sep.textContent = '›';
        nodes.push(sep);
      }
      const b = this.doc.createElement('button');
      b.textContent = label(el);
      b.title = label(el);
      if (el === sel) b.className = 'cur';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(el);
      });
      nodes.push(b);
    });
    this.q('.crumbs').replaceChildren(...nodes);
  }

  private renderControls(el: Element): void {
    const cs = getComputedStyle(el);
    const isBody = el === this.doc.body;
    const set = (prop: string, value: string) => {
      const input = this.wrap.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-prop="${prop}"]`);
      if (input && this.host.root.activeElement !== input) input.value = value;
    };
    set('color', toHex(cs.color) ?? '#000000');
    set('background-color', toHex(cs.backgroundColor) ?? '#ffffff');
    set('font-size', String(Math.round(parseFloat(cs.fontSize) || 16)));
    set('font-weight', String(Math.round((parseInt(cs.fontWeight, 10) || 400) / 100) * 100));
    for (const side of ['top', 'right', 'bottom', 'left']) {
      set(`padding-${side}`, String(Math.round(parseFloat(cs.getPropertyValue(`padding-${side}`)) || 0)));
      set(`margin-${side}`, String(Math.round(parseFloat(cs.getPropertyValue(`margin-${side}`)) || 0)));
    }
    set('border-radius', String(Math.round(parseFloat(cs.borderTopLeftRadius) || 0)));

    const fontSel = this.q<HTMLSelectElement>('.font-select');
    if (!Array.from(fontSel.options).some((o) => o.value === cs.fontFamily)) {
      const o = this.doc.createElement('option');
      o.value = o.textContent = cs.fontFamily;
      fontSel.querySelector('optgroup')?.appendChild(o);
    }
    if (this.host.root.activeElement !== fontSel) fontSel.value = cs.fontFamily;

    const align = cs.textAlign === 'start' ? 'left' : cs.textAlign === 'end' ? 'right' : cs.textAlign;
    for (const b of Array.from(this.wrap.querySelectorAll<HTMLButtonElement>('[data-align]'))) b.classList.toggle('on', b.dataset.align === align);

    const disable = (act: string, off: boolean) => (this.q<HTMLButtonElement>(`[data-act="${act}"]`).disabled = off);
    const idx = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : -1;
    disable('text', !this.canEditText(el) || !!this.textEdit);
    disable('hide', isBody);
    disable('parent', !el.parentElement || el.parentElement === this.doc.documentElement);
    disable('up', isBody || idx <= 0);
    disable('down', isBody || !el.parentElement || idx >= el.parentElement.children.length - 1);
    disable('image', !this.imageTarget());
  }
}

function label(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id && id.length < 24) return `${tag}#${id}`;
  const cls = Array.from(el.classList).find((c) => c.length < 24 && !/\d{3,}/.test(c));
  return cls ? `${tag}.${cls}` : tag;
}

function toHex(color: string): string | null {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return '#' + [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('');
}

let plaintextOnly: boolean | null = null;
function supportsPlaintextOnly(): boolean {
  if (plaintextOnly === null) {
    try {
      const d = document.createElement('div');
      d.contentEditable = 'plaintext-only';
      plaintextOnly = d.contentEditable === 'plaintext-only';
    } catch {
      plaintextOnly = false;
    }
  }
  return plaintextOnly;
}
