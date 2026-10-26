// The edit-mode UI. Lives in the ShadowHost.
//
// Selection: click, Shift+click for several, keyboard tree navigation (Tab / Shift+Tab siblings,
// Enter first child, Shift+Enter parent), find by text or selector, "select all like this".
// Every tool works on the whole selection, and one gesture is one undo step (SPEC.md 6A).
// On-canvas helpers (overlays.ts), command palette and cheat sheet (palette.ts), Fixes, Motion,
// Notes and Export tabs live in their own modules.

import { contrastLevel, contrastRatio, gaps, smartGuides, type Box, type Guide, type Side } from './geometry';
import { createHideOp, createMoveOp, createStyleOp, createTextOp, readStyle } from '../model/ops';
import { describeOp, noteNumbers } from '../model/project';
import { BLOCK_ATTR, buildSelector, cssEscape, EDITOR_ATTR, fingerprint } from '../model/selector';
import type { ElementFingerprint, Op, StyleValue } from '../model/types';
import { parseColor } from '../brand';
import { PRESETS } from '../presets';
import type { GlowUp } from './controller';
import { ExportPanel } from './export-panel';
import type { ShadowHost } from './host';
import { FixLibrary } from './library';
import { MotionPanel } from './motion-panel';
import { boxOf, measure, Overlays, type Handle } from './overlays';
import { CheatSheet, CommandPalette, type Command } from './palette';

type Tab = 'edit' | 'fixes' | 'motion' | 'notes' | 'export';
const TABS: Tab[] = ['edit', 'fixes', 'motion', 'notes', 'export'];

const NO_TEXT_EDIT = new Set(['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO', 'IFRAME', 'CANVAS', 'svg', 'SVG', 'PICTURE', 'HR', 'BR', 'OBJECT', 'EMBED']);
const BLOCKED_EVENTS = ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'submit', 'contextmenu'];
const UI_EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'pointermove', 'keydown', 'keyup', 'keypress', 'input', 'change', 'focusin', 'focusout', 'wheel', 'touchstart', 'touchend', 'contextmenu', 'paste', 'copy', 'cut'];
/** Copy / paste style carries these. Margins are left out: they belong to where an element sits. */
const STYLE_PROPS = [
  'color', 'background-color', 'background-image', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-transform', 'text-align', 'text-decoration-line',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'box-shadow', 'opacity',
];
const SPACING_PRESETS = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80];
const MAX_MULTI = 300;
/** Arrow presses closer together than this are one nudge (one undo step). */
const NUDGE_GESTURE_MS = 1000;

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

const spacingSelect = (kind: string) =>
  `<select class="sp-preset" data-sp="${kind}" title="Set all four sides"><option value="">All</option>${SPACING_PRESETS.map((v) => `<option value="${v}">${v}</option>`).join('')}</select>`;

const PANEL_HTML = `
<div class="pins"></div>
<div class="panel">
  <header class="bar">
    <span class="logo"><b>✦</b> Glow-Up</span>
    <div class="seg" title="Before / After">
      <button data-view="before">Before</button><button data-view="after" class="on">After</button>
    </div>
    <button class="icon" data-act="undo" title="Undo (Ctrl+Z)">↶</button>
    <button class="icon" data-act="redo" title="Redo (Ctrl+Shift+Z)">↷</button>
    <button class="icon" data-act="palette" title="All actions (Ctrl+K)">⌘</button>
    <button class="icon" data-act="dock" title="Move panel to the other side">⇆</button>
    <button class="icon" data-act="min" title="Minimise panel">–</button>
    <button class="icon" data-act="close" title="Exit edit mode (edits stay)">✕</button>
  </header>
  <nav class="tabs" role="tablist">
    <button data-tab="edit" class="on" role="tab">Edit</button>
    <button data-tab="fixes" role="tab">Fixes</button>
    <button data-tab="motion" role="tab">Motion</button>
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
    <div class="find">
      <input type="search" class="find-input" placeholder="Find by text or selector   /" aria-label="Find elements">
      <span class="find-n"></span>
      <button class="btn small hidden" data-act="find-all" title="Select every match">Select all</button>
    </div>
    <p class="hint empty">Hover the page and click any element to select it. Shift+click to select several. Double-click text to edit it. <b>Ctrl+K</b> lists every action, <b>?</b> the shortcuts.</p>
    <div class="sel hidden">
      <nav class="crumbs" aria-label="Selected element and its parents"></nav>
      <p class="hint multi-note hidden"></p>
      <p class="notice frame-note hidden">This is an embedded frame from another site. You can hide, move or resize it, but not edit inside it.</p>
      <div class="actions">
        <button class="btn" data-act="text" title="Edit text (F2 or double-click)">✎ Edit text</button>
        <button class="btn" data-act="hide" title="Hide (Delete)">Hide</button>
        <button class="btn" data-act="parent" title="Select parent (Shift+Enter)">↖ Parent</button>
        <button class="btn" data-act="up">↑ Move up</button>
        <button class="btn" data-act="down">↓ Move down</button>
        <button class="btn" data-act="image" title="Replace image from your computer">🖼 Image…</button>
        <button class="btn" data-act="like" title="Select every element like this one (L)">≋ All like this</button>
        <button class="btn" data-act="copy-style" title="Copy style (Ctrl+Alt+C)">⧉ Copy style</button>
        <button class="btn" data-act="paste-style" title="Paste style (Ctrl+Alt+V)">⎘ Paste style</button>
        <button class="btn" data-act="note" title="Attach a numbered note to the latest change on this element">📝 Note</button>
        <button class="btn" data-act="spacing" title="Drag padding and margin on the page (S). Alt+drag also works.">⬚ Spacing</button>
      </div>
      <div class="group">
        <h4>Text</h4>
        <label class="field"><span>Color</span><div class="ctl"><input type="color" data-prop="color" data-colortools></div></label>
        <div class="contrast-row"><span class="contrast" title="Contrast of the text against the background behind it (WCAG)"></span></div>
        <label class="field"><span class="scrub" title="Drag to change">Font size</span><div class="ctl"><input type="number" min="1" max="400" data-prop="font-size" data-unit="px"><span class="unit">px</span></div></label>
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
        <label class="field"><span>Background</span><div class="ctl"><input type="color" data-prop="background-color" data-colortools><button class="btn small" data-clear="background-color" title="Transparent background">None</button></div></label>
        <div class="field"><span class="scrub" title="Drag to change all four sides">Padding</span><div class="ctl quad5">
          <input type="number" min="0" data-prop="padding-top" data-unit="px" title="Top" placeholder="T">
          <input type="number" min="0" data-prop="padding-right" data-unit="px" title="Right" placeholder="R">
          <input type="number" min="0" data-prop="padding-bottom" data-unit="px" title="Bottom" placeholder="B">
          <input type="number" min="0" data-prop="padding-left" data-unit="px" title="Left" placeholder="L">
          ${spacingSelect('padding')}
        </div></div>
        <div class="field"><span class="scrub" title="Drag to change all four sides">Margin</span><div class="ctl quad5">
          <input type="number" data-prop="margin-top" data-unit="px" title="Top" placeholder="T">
          <input type="number" data-prop="margin-right" data-unit="px" title="Right" placeholder="R">
          <input type="number" data-prop="margin-bottom" data-unit="px" title="Bottom" placeholder="B">
          <input type="number" data-prop="margin-left" data-unit="px" title="Left" placeholder="L">
          ${spacingSelect('margin')}
        </div></div>
        <label class="field"><span class="scrub" title="Drag to change">Corner radius</span><div class="ctl"><input type="number" min="0" data-prop="border-radius" data-unit="px"><span class="unit">px</span></div></label>
      </div>
    </div>
    <details class="changes"><summary>Changes (<span class="changes-n">0</span>)</summary><ol class="changes-list"></ol></details>
    </section>
    <section class="tab tab-fixes hidden"></section>
    <section class="tab tab-motion hidden"></section>
    <section class="tab tab-notes hidden">
      <label class="check"><input type="checkbox" class="pins-toggle" checked> Show numbered pins on the page</label>
      <p class="hint notes-empty">Attach a note to any change: select an element and click <b>📝 Note</b>, or use <b>+ note</b> in the change list on the Edit tab.</p>
      <ol class="notes-list"></ol>
    </section>
    <section class="tab tab-export hidden"></section>
  </div>
  <footer class="status"><span class="save-state">Edits save on this device only</span><span class="mode-state"></span><span class="kbd">? shortcuts</span></footer>
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
  private overlays!: Overlays;
  private palette!: CommandPalette;
  private cheats!: CheatSheet;
  private hovered: Element | null = null;
  private selection: Element[] = [];
  private textEdit: TextEdit | null = null;
  private gesture = 0;
  private raf = 0;
  private cleanups: (() => void)[] = [];
  private tab: Tab = 'edit';
  private library: FixLibrary | null = null;
  private motion: MotionPanel | null = null;
  private exporter: ExportPanel | null = null;
  private showPins = true;
  private pins: { el: Element; pin: HTMLElement }[] = [];
  /** Note ids in list order, to rebuild the notes list only when it changes (keeps typing focus). */
  private notesSig = '';
  // modes and transient on-canvas state
  private clean = false;
  private spacingMode = false;
  private altDown = false;
  private altShiftDown = false;
  private dragging = false;
  private sizeLabel: string | null = null;
  private guides: Guide[] = [];
  private guidesUntil = 0;
  private findMatches: Element[] = [];
  private findIndex = -1;
  private styleClip: Record<string, string> | null = null;
  private nudgeKey = '';
  private lastNudge = 0;

  constructor(
    private app: GlowUp,
    private host: ShadowHost,
  ) {}

  private get doc(): Document {
    return this.host.el.ownerDocument;
  }

  private get primary(): Element | null {
    return this.selection[this.selection.length - 1] ?? null;
  }

  mount(): void {
    this.wrap = this.doc.createElement('div');
    this.wrap.innerHTML = PANEL_HTML;
    this.host.root.appendChild(this.wrap);
    this.q = <T extends Element>(sel: string) => this.wrap.querySelector(sel) as T;
    this.overlays = new Overlays(this.doc, {
      handleDown: (h, e) => this.startResize(h, e),
      bandDown: (kind, side, e) => this.startSpacingDrag(kind, side, e),
    });
    this.wrap.prepend(this.overlays.layer);
    this.palette = new CommandPalette(this.doc, this.wrap, () => this.commands());
    this.cheats = new CheatSheet(this.doc, this.wrap, () => this.commands());
    this.fillFonts();
    this.addColorTools();
    this.bindPanel();
    this.bindScrub();
    this.bindPage();
    this.cleanups.push(this.app.session.onChange(() => this.refresh()));
    this.cleanups.push(this.app.onStatus(() => this.renderSaveState()));
    const loop = () => {
      this.drawFrame();
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
      if (this.dragging) return;
      const t = this.pageTarget(e);
      this.hovered = t && !this.isBefore() ? t : null;
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
    listen(win, 'keyup', (e) => this.trackModifiers(e as KeyboardEvent));
    listen(win, 'blur', () => {
      this.altDown = this.altShiftDown = false;
    });

    // Keep events that happen inside the editor from reaching the site's listeners.
    for (const type of UI_EVENTS) {
      listen(this.host.el, type, (e) => e.stopPropagation(), false);
    }
  }

  private trackModifiers(e: KeyboardEvent): void {
    this.altDown = e.altKey;
    this.altShiftDown = e.altKey && e.shiftKey;
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
    if (!t) return;
    if (e.shiftKey) this.toggleSelect(t);
    else this.select(t);
  }

  private onPageDblClick(e: MouseEvent): void {
    if (this.isBefore()) return;
    const t = this.pageTarget(e);
    if (!t) return;
    if (!this.selection.includes(t)) this.select(t);
    else this.makePrimary(t);
    this.startTextEdit();
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.trackModifiers(e);
    const mod = e.ctrlKey || e.metaKey;
    const fromUi = this.host.contains(e.target);
    // The shadow root is closed, so the event path seen here stops at the host; ask the root
    // what has focus instead.
    const focused = this.host.root.activeElement;
    const typingInUi = fromUi && !!focused && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName);

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
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.cheats.close();
      this.palette.toggle();
      return;
    }
    if (typingInUi) return;

    const key = e.key;
    const lower = key.toLowerCase();
    const sel = this.selection.length > 0;
    const plain = !mod && !e.altKey;
    let handled = true;
    if (key === 'Alt') {
      // Holding Alt shows / drags spacing; don't let Windows move focus to the browser menu.
    } else if (mod && lower === 'z' && !e.shiftKey) this.app.session.undo();
    else if (mod && ((lower === 'z' && e.shiftKey) || lower === 'y')) this.app.session.redo();
    else if (mod && e.altKey && lower === 'c') this.copyStyle();
    else if (mod && e.altKey && lower === 'v') this.pasteStyle();
    else if (key === 'Escape') {
      if (this.cheats.isOpen) this.cheats.close();
      else if (this.palette.isOpen) this.palette.close();
      else if (this.findMatches.length) this.clearFind();
      else this.select(null);
    } else if (key === '?' && !mod) this.cheats.toggle();
    else if (key === '/' && plain) this.focusFind();
    else if (key === '\\' && plain) this.toggleClean();
    else if (lower === 's' && plain && !e.shiftKey) this.toggleSpacingMode();
    else if (lower === 'l' && plain && sel) this.selectLikeThis();
    else if (key === 'Tab' && sel && !mod) this.selectSibling(e.shiftKey ? -1 : 1);
    else if (key === 'Enter' && sel && !mod && e.shiftKey) this.selectParent();
    else if (key === 'Enter' && sel && !mod) this.selectFirstChildOrEdit();
    else if (key === 'F2' && sel) this.startTextEdit();
    else if ((key === 'Delete' || key === 'Backspace') && sel && !mod) this.onAction('hide');
    else if (key.startsWith('Arrow') && sel && !mod && !e.altKey) {
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
      if (d) this.nudge(d[0], d[1]);
      else handled = false;
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.refresh();
    }
  }

  // ---------- selection ----------

  private select(el: Element | null): void {
    if (this.textEdit && el !== this.textEdit.el) this.endTextEdit(true);
    this.selection = el ? [el] : [];
    this.afterSelect();
  }

  private selectMany(els: Element[]): void {
    if (this.textEdit) this.endTextEdit(true);
    this.selection = els.filter((el) => el.isConnected && !this.host.contains(el)).slice(0, MAX_MULTI);
    this.afterSelect();
  }

  private toggleSelect(el: Element): void {
    if (this.selection.includes(el)) this.selection = this.selection.filter((x) => x !== el);
    else this.selection = [...this.selection, el].slice(-MAX_MULTI);
    this.afterSelect();
  }

  private makePrimary(el: Element): void {
    this.selection = [...this.selection.filter((x) => x !== el), el];
  }

  private afterSelect(): void {
    this.hovered = null;
    this.gesture++;
    this.nudgeKey = '';
    this.refresh();
  }

  private selectable(el: Element | null): el is Element {
    return !!el && el !== this.doc.documentElement && el !== this.doc.head && !el.hasAttribute(EDITOR_ATTR) && !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META'].includes(el.tagName);
  }

  private selectSibling(dir: 1 | -1): void {
    const el = this.primary;
    if (!el?.parentElement) return;
    const kids = Array.from(el.parentElement.children).filter((k) => this.selectable(k));
    if (kids.length < 2) return;
    const i = kids.indexOf(el);
    this.select(kids[(i + dir + kids.length) % kids.length]);
    this.scrollIntoViewIfNeeded(this.primary!);
  }

  private selectParent(): void {
    const p = this.primary?.parentElement;
    if (p && p !== this.doc.documentElement) this.select(p);
  }

  private selectFirstChildOrEdit(): void {
    const child = Array.from(this.primary?.children ?? []).find((k) => this.selectable(k));
    if (child) {
      this.select(child);
      this.scrollIntoViewIfNeeded(child);
    } else this.startTextEdit();
  }

  private scrollIntoViewIfNeeded(el: Element): void {
    const r = el.getBoundingClientRect();
    const win = this.doc.defaultView!;
    if (r.bottom < 0 || r.top > win.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** Every element with the same tag and classes as the selected one (siblings of the same tag if it has none). */
  private likeThis(el: Element): Element[] {
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).filter((c) => !c.startsWith('glowup'));
    let found: Element[];
    try {
      found = classes.length
        ? Array.from(this.doc.querySelectorAll(`${cssEscape(tag)}${classes.map((c) => '.' + cssEscape(c)).join('')}`))
        : Array.from(el.parentElement?.children ?? []).filter((k) => k.tagName === el.tagName);
    } catch {
      found = [el];
    }
    return found.filter((x) => !this.host.contains(x));
  }

  private selectLikeThis(): void {
    const el = this.primary;
    if (!el) return;
    const all = this.likeThis(el);
    this.selectMany([...all.filter((x) => x !== el), el]);
    this.host.toast(`Selected ${this.selection.length} element${this.selection.length === 1 ? '' : 's'} like this one. Changes now apply to all of them.`);
  }

  // ---------- find ----------

  private focusFind(): void {
    if (this.tab !== 'edit') this.setTab('edit');
    this.q('.panel').classList.remove('min');
    const input = this.q<HTMLInputElement>('.find-input');
    input.focus();
    input.select();
  }

  private clearFind(): void {
    this.q<HTMLInputElement>('.find-input').value = '';
    this.findMatches = [];
    this.findIndex = -1;
    this.renderFind();
  }

  /** Elements matching a CSS selector, then elements whose own text contains the query. */
  private runFind(query: string): Element[] {
    const q = query.trim();
    if (!q) return [];
    const out = new Set<Element>();
    const ok = (el: Element) => !this.host.contains(el) && this.selectable(el) && el !== this.doc.body;
    try {
      for (const el of Array.from(this.doc.body.querySelectorAll(q))) if (ok(el)) out.add(el);
    } catch {
      /* not a selector */
    }
    const needle = q.toLowerCase();
    const walker = this.doc.createTreeWalker(this.doc.body, NodeFilter.SHOW_TEXT);
    let n = 0;
    for (let t = walker.nextNode(); t && n < 20000 && out.size < 200; t = walker.nextNode(), n++) {
      const parent = t.parentElement;
      if (parent && ok(parent) && (t.textContent ?? '').toLowerCase().includes(needle)) out.add(parent);
    }
    return [...out].slice(0, 200);
  }

  private renderFind(): void {
    const n = this.findMatches.length;
    const q = this.q<HTMLInputElement>('.find-input').value.trim();
    this.q('.find-n').textContent = q ? (n ? `${this.findIndex >= 0 ? `${this.findIndex + 1}/` : ''}${n}` : 'none') : '';
    this.q('[data-act="find-all"]').classList.toggle('hidden', n < 2);
  }

  private stepFind(dir: 1 | -1): void {
    const n = this.findMatches.length;
    if (!n) return;
    this.findIndex = (this.findIndex + dir + n) % n;
    const el = this.findMatches[this.findIndex];
    this.select(el);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.renderFind();
  }

  // ---------- frame: overlays + pins ----------

  private drawFrame(): void {
    const before = this.isBefore();
    const sel = before ? [] : this.selection.filter((el) => el.isConnected);
    const primary = sel[sel.length - 1] ?? null;
    const hover = before ? null : this.hovered;
    let measureSegs: ReturnType<typeof measure> = [];
    if (primary && sel.length === 1 && hover && hover !== primary && !this.dragging) {
      const a = boxOf(primary);
      const b = boxOf(hover);
      if (a && b) measureSegs = measure(a, b);
    }
    const selBoxes = sel.length > 1 ? sel.map(boxOf).filter((b): b is Box => !!b) : [];
    if (this.guidesUntil && performance.now() > this.guidesUntil && !this.dragging) {
      this.guides = [];
      this.guidesUntil = 0;
    }
    this.overlays.draw({
      clean: this.clean,
      hover,
      hoverLabel: hover && isCrossOriginFrame(hover) ? 'Embedded frame: can’t edit inside it' : null,
      hoverSpacing: this.altShiftDown && !!hover,
      selection: sel,
      primaryLabel: this.textEdit ? 'Editing text — Enter to finish, Esc to cancel' : primary ? `${label(primary)}${sel.length > 1 ? `  +${sel.length - 1}` : ''}` : '',
      editingText: !!this.textEdit,
      spacing: !this.textEdit,
      spacingDrag: this.spacingMode || this.altDown,
      handles: !!primary && !this.textEdit && primary !== this.doc.body,
      sizeLabel: this.sizeLabel,
      measure: measureSegs,
      gaps: gaps(selBoxes),
      guides: this.guides,
      find: this.findMatches,
      badges: before ? [] : this.animated,
    });
    for (const { el, pin } of this.pins) {
      const r = !this.clean && el.isConnected ? el.getBoundingClientRect() : null;
      if (!r || (!r.width && !r.height)) {
        pin.style.display = 'none';
        continue;
      }
      // Just inside the top-left corner: the selection label sits above the box, so they don't clash,
      // and full-width blocks don't push the pin under the panel.
      pin.style.display = 'flex';
      pin.style.transform = `translate(${Math.max(2, r.left + 4)}px, ${Math.max(2, r.top + 4)}px)`;
    }
  }

  /** Elements with an animation op, for their badge. Updated on refresh. */
  private animated: Element[] = [];

  // ---------- gestures: resize, nudge, spacing drag, scrub ----------

  /** Boxes the selection can line up with: the primary's parent and its siblings. */
  private guideTargets(): Box[] {
    const el = this.primary;
    const parent = el?.parentElement;
    if (!el || !parent) return [];
    const out: Box[] = [];
    const pb = boxOf(parent);
    if (pb) out.push(pb);
    for (const s of Array.from(parent.children).slice(0, 60)) {
      if (this.selection.includes(s)) continue;
      const b = boxOf(s);
      if (b) out.push(b);
    }
    return out;
  }

  /** Live preview by writing inline styles; on release they're restored and one op group is committed. */
  private drag(e: PointerEvent, move: (dx: number, dy: number, ev: PointerEvent) => void, end: () => void): void {
    const target = e.currentTarget as HTMLElement | null;
    const x0 = e.clientX;
    const y0 = e.clientY;
    this.dragging = true;
    this.app.guardPaused = true;
    try {
      target?.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable; window listeners still work */
    }
    const win = this.doc.defaultView!;
    const onMove = (ev: PointerEvent) => move(ev.clientX - x0, ev.clientY - y0, ev);
    const onUp = () => {
      win.removeEventListener('pointermove', onMove, true);
      win.removeEventListener('pointerup', onUp, true);
      win.removeEventListener('pointercancel', onUp, true);
      this.dragging = false;
      this.app.guardPaused = false;
      end();
      this.refresh();
    };
    win.addEventListener('pointermove', onMove, true);
    win.addEventListener('pointerup', onUp, true);
    win.addEventListener('pointercancel', onUp, true);
  }

  private startResize(h: Handle, e: PointerEvent): void {
    const primary = this.primary;
    if (!primary || this.isBefore()) return;
    const els = this.selection.filter((el) => el !== this.doc.body && el.isConnected);
    const r0 = primary.getBoundingClientRect();
    const starts = els.map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // Rect size includes padding / border; style width may not (box-sizing), so keep the difference.
      const cw = parseFloat(cs.width);
      const ch = parseFloat(cs.height);
      return { el, w: r.width, h: r.height, dw: Number.isFinite(cw) ? r.width - cw : 0, dh: Number.isFinite(ch) ? r.height - ch : 0, inline: { width: readStyle(el, 'width'), height: readStyle(el, 'height') } };
    });
    const targets = this.guideTargets();
    const doW = h !== 's';
    const doH = h !== 'e';
    let last: { w: number; h: number } = { w: r0.width, h: r0.height };
    this.drag(
      e,
      (dx, dy, ev) => {
        let w = r0.width + (doW ? dx : 0);
        let hh = r0.height + (doH ? dy : 0);
        if (ev.shiftKey && doW && doH && r0.height > 0) {
          const ratio = r0.width / r0.height;
          if (Math.abs(dx) > Math.abs(dy)) hh = w / ratio;
          else w = hh * ratio;
        }
        // Snap the moving edges to nearby edges / centres.
        const guides: Guide[] = [];
        if (doW) {
          const g = smartGuides({ left: r0.left + w, top: r0.top, width: 0, height: hh }, targets);
          w += g.snapX;
          guides.push(...g.guides.filter((x) => x.axis === 'x'));
        }
        if (doH) {
          const g = smartGuides({ left: r0.left, top: r0.top + hh, width: w, height: 0 }, targets);
          hh += g.snapY;
          guides.push(...g.guides.filter((x) => x.axis === 'y'));
        }
        w = Math.max(1, w);
        hh = Math.max(1, hh);
        last = { w, h: hh };
        this.guides = guides;
        this.sizeLabel = `${Math.round(w)} × ${Math.round(hh)}`;
        for (const s of starts) {
          const el = s.el as HTMLElement;
          if (doW) el.style.setProperty('width', `${Math.round(s.w + (w - r0.width) - s.dw)}px`, 'important');
          if (doH) el.style.setProperty('height', `${Math.round(s.h + (hh - r0.height) - s.dh)}px`, 'important');
        }
      },
      () => {
        this.sizeLabel = null;
        this.guides = [];
        const ops = starts.map((s) => {
          restoreStyle(s.el, 'width', s.inline.width);
          restoreStyle(s.el, 'height', s.inline.height);
          const changes: Record<string, string> = {};
          if (doW) changes.width = `${Math.round(s.w + (last.w - r0.width) - s.dw)}px`;
          if (doH) changes.height = `${Math.round(s.h + (last.h - r0.height) - s.dh)}px`;
          return createStyleOp(s.el, changes);
        });
        if (last.w !== r0.width || last.h !== r0.height) this.app.commitGroup(ops);
      },
    );
  }

  private startSpacingDrag(kind: 'margin' | 'padding', side: Side, e: PointerEvent): void {
    const el = this.primary;
    if (!el || this.isBefore()) return;
    const prop = `${kind}-${side}`;
    const start = parseFloat(getComputedStyle(el).getPropertyValue(prop)) || 0;
    const inline = readStyle(el, prop);
    // Dragging away from the content grows margin; dragging into the content grows padding.
    const sign = (side === 'top' || side === 'left' ? -1 : 1) * (kind === 'padding' ? -1 : 1);
    let value = start;
    this.drag(
      e,
      (dx, dy, ev) => {
        const d = (side === 'top' || side === 'bottom' ? dy : dx) * sign;
        value = Math.round(start + d);
        if (ev.shiftKey) value = Math.round(value / 4) * 4;
        if (kind === 'padding') value = Math.max(0, value);
        (el as HTMLElement).style.setProperty(prop, `${value}px`, 'important');
        this.sizeLabel = `${kind} ${side}: ${value}`;
      },
      () => {
        this.sizeLabel = null;
        restoreStyle(el, prop, inline);
        if (value !== start) this.app.commit(createStyleOp(el, { [prop]: `${value}px` }));
      },
    );
  }

  /** Arrow keys move the selection with CSS translate; a burst of presses is one undo step. */
  private nudge(dx: number, dy: number): void {
    if (this.isBefore()) return;
    const els = this.selection.filter((el) => el !== this.doc.body && el.isConnected);
    if (!els.length) return;
    const now = performance.now();
    if (!this.nudgeKey || now - this.lastNudge > NUDGE_GESTURE_MS) this.nudgeKey = `nudge:${++this.gesture}`;
    this.lastNudge = now;
    const ops = els.map((el) => {
      const [x, y] = parseTranslate(getComputedStyle(el).getPropertyValue('translate'));
      return createStyleOp(el, { translate: `${x + dx}px ${y + dy}px` });
    });
    this.app.commitGroup(ops, { coalesceKey: this.nudgeKey });
    // Smart guides for keyboard moves too (no snapping: the arrow keys are exact).
    const b = this.primary ? boxOf(this.primary) : null;
    if (b) {
      this.guides = smartGuides(b, this.guideTargets(), 1).guides;
      this.guidesUntil = performance.now() + 900;
    }
  }

  /** Drag a field's label left / right to change its number inputs live (one undo step per drag). */
  private bindScrub(): void {
    for (const label of Array.from(this.wrap.querySelectorAll<HTMLElement>('.scrub'))) {
      label.addEventListener('pointerdown', (e) => {
        const field = label.closest('.field');
        const inputs = Array.from(field?.querySelectorAll<HTMLInputElement>('input[type=number][data-prop]') ?? []);
        if (!inputs.length || !this.primary || this.isBefore()) return;
        e.preventDefault();
        const starts = inputs.map((i) => Number(i.value) || 0);
        const key = `scrub:${++this.gesture}`;
        this.drag(
          e,
          (dx, _dy, ev) => {
            const delta = Math.round(dx / 2) * (ev.shiftKey ? 5 : 1);
            const changes: Record<string, string> = {};
            inputs.forEach((input, i) => {
              const min = input.min === '' ? -Infinity : Number(input.min);
              const v = Math.max(min, starts[i] + delta);
              input.value = String(v);
              changes[input.dataset.prop!] = `${v}${input.dataset.unit ?? ''}`;
            });
            this.applyStyle(changes, { coalesceKey: key });
          },
          () => this.gesture++,
        );
      });
    }
  }

  // ---------- style helpers ----------

  /** Apply style changes to every selected element as one step. */
  private applyStyle(changes: Record<string, string>, opts: { coalesceKey?: string } = {}): void {
    const els = this.selection.filter((el) => el.isConnected);
    if (!els.length || this.isBefore()) return;
    this.app.commitGroup(
      els.map((el) => createStyleOp(el, changes)),
      opts,
    );
  }

  private styleChange(changes: Record<string, string>, discrete: boolean): void {
    const key = `${Object.keys(changes).join(',')}:${this.gesture}`;
    this.applyStyle(changes, discrete ? {} : { coalesceKey: key });
    if (discrete) this.gesture++;
  }

  private copyStyle(): void {
    const el = this.primary;
    if (!el) return;
    const cs = getComputedStyle(el);
    this.styleClip = Object.fromEntries(STYLE_PROPS.map((p) => [p, cs.getPropertyValue(p)]));
    this.host.toast('Style copied. Select other elements and press Ctrl+Alt+V (or Paste style).');
    this.refresh();
  }

  private pasteStyle(): void {
    const clip = this.styleClip;
    if (!clip || this.isBefore()) return;
    const ops: Op[] = [];
    for (const el of this.selection) {
      const cs = getComputedStyle(el);
      const changes: Record<string, string> = {};
      for (const p of STYLE_PROPS) if (clip[p] && cs.getPropertyValue(p) !== clip[p]) changes[p] = clip[p];
      if (Object.keys(changes).length) ops.push(createStyleOp(el, changes));
    }
    if (ops.length) this.app.commitGroup(ops);
    else this.host.toast('Those elements already have that style.');
  }

  // ---------- modes ----------

  private toggleClean(): void {
    this.clean = !this.clean;
    this.host.toast(this.clean ? 'Clean canvas: on-page controls hidden. Press \\ to show them.' : 'On-page controls shown.');
    this.refresh();
  }

  private toggleSpacingMode(): void {
    this.spacingMode = !this.spacingMode;
    this.refresh();
  }

  // ---------- inline text editing ----------

  private canEditText(el: Element): boolean {
    // Not around an inserted block: the text op would copy the block into the page's own markup.
    return !NO_TEXT_EDIT.has(el.tagName) && !(el instanceof SVGElement) && el !== this.doc.body && !el.querySelector(`[${BLOCK_ATTR}]`);
  }

  private startTextEdit(): void {
    const el = this.primary;
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
      const others = this.selection.filter((el) => el !== t.el && el.isConnected && this.canEditText(el));
      if (!others.length) {
        const op = createTextOp(t.el, t.beforeHtml, t.el.innerHTML, t.target);
        if (t.el.innerHTML !== op.after.html) t.el.innerHTML = op.after.html;
        this.app.commit(op, { alreadyApplied: true });
        this.app.session.bindElement(op.id, t.el);
      } else {
        // Several selected: the same text goes into each of them, as one step.
        const html = t.el.innerHTML;
        t.el.innerHTML = t.beforeHtml;
        const ops = [createTextOp(t.el, t.beforeHtml, html, t.target), ...others.map((el) => createTextOp(el, el.innerHTML, html))];
        this.app.commitGroup(ops);
      }
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

    for (const sp of Array.from(this.wrap.querySelectorAll<HTMLSelectElement>('.sp-preset'))) {
      sp.addEventListener('change', () => {
        if (sp.value === '') return;
        const kind = sp.dataset.sp!;
        this.styleChange(Object.fromEntries(['top', 'right', 'bottom', 'left'].map((s) => [`${kind}-${s}`, `${sp.value}px`])), true);
        sp.value = '';
      });
    }

    const find = this.q<HTMLInputElement>('.find-input');
    find.addEventListener('input', () => {
      this.findMatches = this.runFind(find.value);
      this.findIndex = -1;
      this.renderFind();
    });
    find.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.stepFind(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.clearFind();
        find.blur();
      }
    });

    const pinsToggle = this.q<HTMLInputElement>('.pins-toggle');
    pinsToggle.addEventListener('change', () => {
      this.showPins = pinsToggle.checked;
      this.refresh();
    });

    const file = this.q<HTMLInputElement>('.file');
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      const targets = this.imageTargets();
      if (!f || !targets.length) return;
      try {
        await this.app.replaceImage(targets, f);
      } catch (err) {
        this.host.toast(`Couldn't use that image: ${(err as Error).message}`);
      }
    });
  }

  /** Brand colors first, then an eyedropper (where the browser has one), next to each color input. */
  private addColorTools(): void {
    const brand = this.app.getBrand();
    const colors = [...new Set([brand.accent, ...brand.colors].filter((c): c is string => !!c))].slice(0, 6);
    const win = this.doc.defaultView as (Window & { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }) | null;
    for (const input of Array.from(this.wrap.querySelectorAll<HTMLInputElement>('input[data-colortools]'))) {
      const row = this.doc.createElement('span');
      row.className = 'swatches';
      const pick = (hex: string) => {
        input.value = hex;
        this.styleChange({ [input.dataset.prop!]: hex }, true);
      };
      for (const c of colors) {
        const b = this.doc.createElement('button');
        b.className = 'dot';
        b.style.background = c;
        b.title = `Brand color ${c}`;
        b.addEventListener('click', (e) => {
          e.preventDefault();
          pick(c);
        });
        row.append(b);
      }
      if (win?.EyeDropper) {
        const Eye = win.EyeDropper;
        const b = this.doc.createElement('button');
        b.className = 'btn small eyedrop';
        b.textContent = '⌖';
        b.title = 'Pick a color from the page';
        b.addEventListener('click', async (e) => {
          e.preventDefault();
          try {
            pick((await new Eye().open()).sRGBHex);
          } catch {
            /* cancelled */
          }
        });
        row.append(b);
      }
      input.after(row);
    }
  }

  private onAction(act: string): void {
    const s = this.app.session;
    const el = this.primary;
    const els = this.selection.filter((x) => x.isConnected);
    switch (act) {
      case 'undo':
        this.endTextEdit(true);
        s.undo();
        break;
      case 'redo':
        this.endTextEdit(true);
        s.redo();
        break;
      case 'palette':
        this.palette.toggle();
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
        this.selectParent();
        break;
      case 'hide': {
        const targets = els.filter((x) => x !== this.doc.body);
        if (!targets.length || this.isBefore()) break;
        this.endTextEdit(true);
        this.app.commitGroup(targets.map((x) => createHideOp(x)));
        this.select(null);
        break;
      }
      case 'up':
      case 'down': {
        const targets = els.filter((x) => x !== this.doc.body);
        if (!targets.length || this.isBefore()) break;
        this.endTextEdit(true);
        // Top-down for up, bottom-up for down, so each element's index is still right when it moves.
        const ordered = targets.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        if (act === 'down') ordered.reverse();
        const ops = ordered.map((x) => createMoveOp(x, act)).filter((o): o is NonNullable<typeof o> => !!o);
        if (ops.length) {
          const done = this.app.commitGroup(ops);
          done.forEach((op, i) => this.app.session.bindElement(op.id, ordered[i]));
        }
        break;
      }
      case 'image':
        if (this.imageTargets().length) this.q<HTMLInputElement>('.file').click();
        break;
      case 'like':
        this.selectLikeThis();
        break;
      case 'copy-style':
        this.copyStyle();
        break;
      case 'paste-style':
        this.pasteStyle();
        break;
      case 'spacing':
        this.toggleSpacingMode();
        break;
      case 'find-all':
        if (this.findMatches.length) this.selectMany(this.findMatches);
        break;
      case 'note': {
        const op = el && this.latestOpOn(el);
        if (op) this.openNote(op);
        break;
      }
    }
    this.refresh();
  }

  /** Everything the palette can run. Titles are what people would type. */
  private commands(): Command[] {
    const sel = () => this.selection.length > 0 && !this.isBefore();
    const after = () => !this.isBefore();
    const c = (id: string, title: string, group: string, run: () => void, keys?: string, enabled?: () => boolean): Command => ({ id, title, group, run: () => (run(), this.refresh()), keys, enabled });
    const list: Command[] = [
      c('undo', 'Undo', 'History', () => this.app.session.undo(), 'Ctrl+Z', () => this.app.session.canUndo()),
      c('redo', 'Redo', 'History', () => this.app.session.redo(), 'Ctrl+Shift+Z', () => this.app.session.canRedo()),
      c('before', 'Show Before (original page)', 'View', () => this.setView('before')),
      c('after', 'Show After (with edits)', 'View', () => this.setView('after')),
      c('palette', 'Command palette', 'Help', () => undefined, 'Ctrl+K'),
      c('cheats', 'Keyboard shortcuts', 'Help', () => this.cheats.toggle(), '?'),
      c('find', 'Find elements by text or selector', 'Select', () => this.focusFind(), '/'),
      c('next', 'Select next sibling', 'Select', () => this.selectSibling(1), 'Tab', sel),
      c('prev', 'Select previous sibling', 'Select', () => this.selectSibling(-1), 'Shift+Tab', sel),
      c('child', 'Select first child', 'Select', () => this.selectFirstChildOrEdit(), 'Enter', sel),
      c('parent', 'Select parent', 'Select', () => this.selectParent(), 'Shift+Enter', sel),
      c('like', 'Select all like this', 'Select', () => this.selectLikeThis(), 'L', sel),
      c('deselect', 'Deselect', 'Select', () => this.select(null), 'Esc', sel),
      c('text', 'Edit text', 'Edit', () => this.startTextEdit(), 'F2', sel),
      c('hide', 'Hide selected', 'Edit', () => this.onAction('hide'), 'Delete', sel),
      c('up', 'Move up among siblings', 'Edit', () => this.onAction('up'), undefined, sel),
      c('down', 'Move down among siblings', 'Edit', () => this.onAction('down'), undefined, sel),
      c('nudge', 'Nudge (arrow keys, Shift for 10px)', 'Edit', () => undefined, '← ↑ → ↓', sel),
      c('image', 'Replace image…', 'Edit', () => this.onAction('image'), undefined, () => sel() && this.imageTargets().length > 0),
      c('copy-style', 'Copy style', 'Style', () => this.copyStyle(), 'Ctrl+Alt+C', sel),
      c('paste-style', 'Paste style', 'Style', () => this.pasteStyle(), 'Ctrl+Alt+V', () => sel() && !!this.styleClip),
      c('bold', 'Make bold', 'Style', () => this.styleChange({ 'font-weight': '700' }, true), undefined, sel),
      c('center', 'Center text', 'Style', () => this.styleChange({ 'text-align': 'center' }, true), undefined, sel),
      c('note', 'Add note to the latest change on this element', 'Notes', () => this.onAction('note'), undefined, () => !!this.primary && !!this.latestOpOn(this.primary)),
      c('spacing', `${this.spacingMode ? 'Turn off' : 'Turn on'} Spacing mode`, 'View', () => this.toggleSpacingMode(), 'S'),
      c('clean', `${this.clean ? 'Show' : 'Hide'} on-page controls (clean canvas)`, 'View', () => this.toggleClean(), '\\'),
      c('pins', `${this.showPins ? 'Hide' : 'Show'} note pins`, 'View', () => {
        this.showPins = !this.showPins;
        this.q<HTMLInputElement>('.pins-toggle').checked = this.showPins;
      }),
      c('dock', 'Move panel to the other side', 'View', () => this.onAction('dock')),
      c('min', 'Minimise / restore panel', 'View', () => this.onAction('min')),
      c('replay', 'Replay animations on the selection', 'Motion', () => this.app.replayAnimations(this.selection), undefined, sel),
      c('replay-all', 'Replay all animations on the page', 'Motion', () => this.app.replayAnimations()),
      c('png', 'Export before / after image (PNG)', 'Export', () => this.exportPanel().run('png'), undefined, () => this.app.session.getOps().length > 0),
      c('pdf', 'Export PDF', 'Export', () => this.exportPanel().run('pdf'), undefined, () => this.app.session.getOps().length > 0),
      c('md', 'Export change list (.md)', 'Export', () => this.exportPanel().run('md'), undefined, () => this.app.session.getOps().length > 0),
      c('txt', 'Export change list (.txt)', 'Export', () => this.exportPanel().run('txt'), undefined, () => this.app.session.getOps().length > 0),
      c('close', 'Exit edit mode', 'View', () => this.app.closeEditor()),
    ];
    for (const t of TABS) list.push(c(`tab-${t}`, `Open ${t === 'fixes' ? 'Fix library' : t[0].toUpperCase() + t.slice(1)} tab`, 'Panel', () => this.setTab(t)));
    for (const p of PRESETS) {
      list.push(
        c(`preset-${p.id}`, `Add ${p.name.replace(/[“”]/g, '')}`, 'Fix library', () => {
          this.setTab('fixes');
          this.library?.openPreset(p.id);
        }, undefined, after),
      );
    }
    return list;
  }

  private exportPanel(): ExportPanel {
    if (!this.exporter) this.exporter = new ExportPanel(this.app, this.host, this.q('.tab-export'));
    return this.exporter;
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    for (const t of TABS) {
      this.q(`[data-tab="${t}"]`).classList.toggle('on', t === tab);
      this.q(`.tab-${t}`).classList.toggle('hidden', t !== tab);
    }
    if (tab === 'fixes' && !this.library) {
      this.library = new FixLibrary(this.app, this.host, this.q('.tab-fixes'), {
        selected: () => this.primary,
        applied: (op) => {
          const block = this.app.session.changedElement(op);
          if (block) this.select(block);
        },
      });
    }
    if (tab === 'motion' && !this.motion) {
      this.motion = new MotionPanel(this.app, this.host, this.q('.tab-motion'), { selection: () => this.selection.filter((el) => el.isConnected) });
    }
    if (tab === 'export') void this.exportPanel().refresh();
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

  private imageTarget(el: Element): { el: Element; mode: 'img' | 'bg' } | null {
    if (el.tagName === 'IMG') return { el, mode: 'img' };
    if (el.tagName === 'PICTURE') {
      const img = el.querySelector('img');
      if (img) return { el: img, mode: 'img' };
    }
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg.includes('url(')) return { el, mode: 'bg' };
    return null;
  }

  private imageTargets(): { el: Element; mode: 'img' | 'bg' }[] {
    return this.selection.map((el) => this.imageTarget(el)).filter((t): t is { el: Element; mode: 'img' | 'bg' } => !!t);
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
    this.selection = this.selection.filter((el) => el.isConnected);
    const sel = this.primary;

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
    this.q('.empty').classList.toggle('hidden', !!sel || before);
    this.q('.sel').classList.toggle('hidden', !sel || before);
    if (sel) {
      this.renderCrumbs(sel);
      this.renderControls(sel);
      const multi = this.q('.multi-note');
      multi.classList.toggle('hidden', this.selection.length < 2);
      multi.textContent = `${this.selection.length} elements selected. Every change applies to all of them (one undo step). Shift+click adds or removes one.`;
      this.q('.frame-note').classList.toggle('hidden', !isCrossOriginFrame(sel));
    }
    this.q('[data-act="spacing"]').classList.toggle('on', this.spacingMode);
    this.q('.mode-state').textContent = [this.spacingMode ? 'Spacing mode' : '', this.clean ? 'Clean canvas' : ''].filter(Boolean).join(' · ');
    this.renderFind();

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

    this.animated = ops.filter((o) => o.kind === 'animation').map((o) => s.changedElement(o)).filter((el): el is Element => !!el);
    this.q('.notes-n').textContent = numbers.size ? String(numbers.size) : '';
    this.renderNotes(ops, numbers);
    this.renderPins(ops, numbers);
    if (sel) this.q<HTMLButtonElement>('[data-act="note"]').disabled = !this.latestOpOn(sel);
    if (this.tab === 'fixes') this.library?.refresh();
    if (this.tab === 'motion') this.motion?.refresh();
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
      if (input && this.host.root.activeElement !== input && !this.dragging) input.value = value;
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

    // Live contrast of the text against what's behind it (inside the color controls only).
    const fg = parseColor(cs.color);
    const bg = effectiveBackground(el);
    const contrast = this.q('.contrast');
    if (fg && bg) {
      const ratio = contrastRatio([fg.r, fg.g, fg.b], bg);
      const size = parseFloat(cs.fontSize) || 16;
      const large = size >= 24 || (size >= 18.66 && (parseInt(cs.fontWeight, 10) || 400) >= 700);
      const level = contrastLevel(ratio, large);
      contrast.textContent = `Aa  ${ratio.toFixed(1)}:1 · ${level === 'Low' ? 'below AA' : level}`;
      contrast.className = `contrast ${level.toLowerCase()}`;
    } else contrast.textContent = '';

    const disable = (act: string, off: boolean) => (this.q<HTMLButtonElement>(`[data-act="${act}"]`).disabled = off);
    const idx = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : -1;
    disable('text', !this.canEditText(el) || !!this.textEdit);
    disable('hide', isBody);
    disable('parent', !el.parentElement || el.parentElement === this.doc.documentElement);
    disable('up', isBody || (this.selection.length === 1 && idx <= 0));
    disable('down', isBody || (this.selection.length === 1 && (!el.parentElement || idx >= el.parentElement.children.length - 1)));
    disable('image', !this.imageTargets().length);
    disable('paste-style', !this.styleClip);
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

/** "10px 5px" / "10px" / "none" -> [x, y] in px. */
export function parseTranslate(v: string): [number, number] {
  if (!v || v === 'none') return [0, 0];
  const parts = v.trim().split(/\s+/).map((p) => parseFloat(p) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0];
}

/** The first opaque background behind an element (white if none). */
function effectiveBackground(el: Element): [number, number, number] | null {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = parseColor(getComputedStyle(e).backgroundColor);
    if (c && c.a >= 0.95) return [c.r, c.g, c.b];
    if (getComputedStyle(e).backgroundImage !== 'none') return null; // over an image: no honest number
  }
  return [255, 255, 255];
}

function restoreStyle(el: Element, prop: string, v: StyleValue): void {
  const style = (el as HTMLElement).style;
  if (v.value) style.setProperty(prop, v.value, v.important ? 'important' : '');
  else style.removeProperty(prop);
  if (el.getAttribute('style')?.trim() === '') el.removeAttribute('style');
}

/** An iframe whose contents belong to another site. */
function isCrossOriginFrame(el: Element): boolean {
  if (el.tagName !== 'IFRAME') return false;
  try {
    return !(el as HTMLIFrameElement).contentDocument;
  } catch {
    return true;
  }
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
