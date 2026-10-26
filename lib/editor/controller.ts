// Runs in the page. Owns the project for the current URL, the EditSession, auto-save and
// re-applying saved edits. The UI (ui.ts) only exists while edit mode is on.

import { captureBrand } from '../brand';
import type { Asset } from '../db';
import type { ChangeListInput } from '../export/changelist';
import type { Shot } from '../export/compose';
import type { CaptureResult } from '../messages';
import { newId } from '../model/ids';
import { assetIds, createImageOp, createInsertBlockOp, createStyleOp } from '../model/ops';
import { activeVersion, createProject, noteNumbers, urlKey } from '../model/project';
import { BLOCK_ATTR, findBlock } from '../model/selector';
import { DEFAULT_AGENCY, normalizeAgency, type AgencySettings } from '../settings';
import { EditSession, type CommitOptions } from '../model/session';
import type { BlockPosition, BrandCapture, Note, Op, Project } from '../model/types';
import { brandStyle, type Preset } from '../presets';
import { ShadowHost } from './host';
import { EditorUI } from './ui';

/** Where the editor reads and writes data. In the extension this goes to the background. */
export interface EditorStore {
  getProject(url: string): Promise<Project | null>;
  saveProject(project: Project): Promise<void>;
  getAssets(ids: string[]): Promise<Record<string, string>>;
  putAsset(asset: Asset): Promise<void>;
  /** Agency branding for exports (storage.local in the extension). */
  getAgency(): Promise<AgencySettings>;
  /** PNG of the visible part of this tab. */
  capture(): Promise<CaptureResult>;
}

const SAVE_DELAY_MS = 300;
/** Browsers allow about two tab captures per second. */
const CAPTURE_GAP_MS = 600;
/** Time for the page to repaint (and lazy images to settle) after switching Before/After. */
const SETTLE_MS = 300;
/** How long to keep retrying ops whose elements haven't appeared yet (late-loading sites). */
const RETRY_WINDOW_MS = 12000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2560;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export class GlowUp {
  readonly host: ShadowHost;
  session: EditSession;
  saveState: SaveState = 'idle';
  private project: Project | null = null;
  private notes: Note[] = [];
  private brand: BrandCapture | undefined;
  private assets = new Map<string, string>();
  private ui: EditorUI | null = null;
  private ready: Promise<void>;
  private pageKey: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | null = null;
  private retryStop: (() => void) | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private store: EditorStore,
    private doc: Document = document,
  ) {
    this.host = new ShadowHost(doc);
    this.pageKey = urlKey(doc.location.href);
    this.session = this.newSession([]);
    this.ready = this.load();
    this.watchUrl();
    this.guard();
    doc.defaultView?.addEventListener('pagehide', () => this.flush());
  }

  get editing(): boolean {
    return !!this.ui;
  }

  get projectTitle(): string {
    return this.project?.title ?? this.doc.title;
  }

  /** UI subscribes to save-state changes. */
  onStatus(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setSaveState(s: SaveState): void {
    this.saveState = s;
    for (const fn of this.listeners) fn();
  }

  private newSession(ops: Op[]): EditSession {
    this.unsubscribe?.();
    const s = new EditSession(this.doc, ops, { getAsset: (id) => this.assets.get(id) });
    this.unsubscribe = s.onChange(() => this.scheduleSave());
    return s;
  }

  /** Load the saved project for this URL (if any) and re-apply its edits. */
  private async load(): Promise<void> {
    let project: Project | null = null;
    try {
      project = await this.store.getProject(this.pageKey);
    } catch (e) {
      console.error('[Glow-Up] could not load project', e);
    }
    this.project = project;
    this.notes = project?.notes ? [...project.notes] : [];
    this.brand = project?.brand;
    if (!project) {
      this.session = this.newSession([]);
      return;
    }
    const ops = activeVersion(project).ops;
    const ids = assetIds(ops);
    if (ids.length) {
      const found = await this.store.getAssets(ids).catch(() => ({}) as Record<string, string>);
      for (const [id, url] of Object.entries(found)) this.assets.set(id, url);
    }
    this.session = this.newSession(ops);
    const { applied, failed } = this.session.replay();
    if (!ops.length) return;
    if (!failed.length) {
      this.announce(applied.length, 0);
      return;
    }
    this.retryUntilSettled(() => this.announce(this.session.getOps().length - this.session.failedOps().length, this.session.failedOps().length));
  }

  private announce(applied: number, failed: number): void {
    if (this.ui) return; // the panel shows status itself
    const restored = `Glow-Up restored ${applied} edit${applied === 1 ? '' : 's'}`;
    if (!failed) {
      this.host.toast(`${restored}.`, { action: 'Edit', onAction: () => void this.toggle() });
    } else {
      this.host.toast(`${restored}. ${failed} couldn't re-apply.`, { action: 'Review', onAction: () => void this.toggle(), sticky: true });
    }
  }

  /** Keep retrying failed ops while the page is still building itself, then call `done`. */
  private retryUntilSettled(done: () => void): void {
    this.retryStop?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        this.session.retryFailed();
        if (!this.session.failedOps().length) finish();
      }, 400);
    });
    const deadline = setTimeout(() => finish(), RETRY_WINDOW_MS);
    const finish = () => {
      observer.disconnect();
      clearTimeout(deadline);
      clearTimeout(timer);
      this.retryStop = null;
      done();
    };
    this.retryStop = () => {
      observer.disconnect();
      clearTimeout(deadline);
      clearTimeout(timer);
      this.retryStop = null;
    };
    observer.observe(this.doc.body ?? this.doc.documentElement, { childList: true, subtree: true });
  }

  async toggle(): Promise<boolean> {
    await this.ready;
    if (this.ui) this.closeEditor();
    else this.openEditor();
    return this.editing;
  }

  openEditor(): void {
    if (this.ui) return;
    this.host.hideToast();
    this.host.attach();
    this.ui = new EditorUI(this, this.host);
    this.ui.mount();
  }

  closeEditor(): void {
    this.ui?.destroy();
    this.ui = null;
    this.flush();
  }

  commit(op: Op, opts?: CommitOptions): Op {
    return this.session.commit(op, opts);
  }

  retryFailed(): number {
    return this.session.retryFailed();
  }

  removeFailed(): void {
    this.session.removeFailed();
  }

  // ---------- brand ----------

  /** The page's look, captured the first time it's needed (and saved with the project). */
  getBrand(): BrandCapture {
    if (!this.brand) this.brand = captureBrand(this.doc);
    return this.brand;
  }

  recaptureBrand(): BrandCapture {
    this.brand = captureBrand(this.doc);
    if (this.project) this.scheduleSave();
    return this.brand;
  }

  /** User override of a captured value (e.g. a different accent). Only affects new fixes. */
  setBrand(patch: Partial<BrandCapture>): void {
    this.brand = { ...this.getBrand(), ...patch, edited: true };
    if (this.project) this.scheduleSave();
  }

  // ---------- fix library ----------

  /**
   * Add a preset. `target` is the element the user selected (or null): relative blocks are placed
   * against it (top of the page without one), style presets restyle it, fixed ones ignore it.
   */
  applyPreset(preset: Preset, values: Record<string, string>, target: { el: Element; position: BlockPosition } | null, noteText?: string): Op {
    const result = preset.build(brandStyle(this.getBrand()), values);
    let op: Op;
    if ('styles' in result) {
      if (!target) throw new Error('Select the element to restyle first.');
      op = createStyleOp(target.el, result.styles);
    } else {
      const body = this.doc.body;
      const place = preset.placement === 'fixed' || !target ? { el: body, position: (preset.placement === 'fixed' ? 'beforeend' : 'afterbegin') as BlockPosition } : target;
      op = createInsertBlockOp(place.el, { presetId: preset.id, label: preset.name, position: place.position, html: result.html });
    }
    const committed = this.commit(op);
    if (this.session.getStatus(committed.id) !== 'applied') {
      this.session.removeFailed([committed.id]);
      throw new Error('Couldn’t place it there. Try another spot.');
    }
    if (noteText?.trim()) this.addNote(committed.id, noteText);
    return committed;
  }

  // ---------- notes ----------

  getNote(id: string | undefined): Note | undefined {
    return id ? this.notes.find((n) => n.id === id) : undefined;
  }

  /** Attach a new note to an op. */
  addNote(opId: string, text = ''): Note {
    const note: Note = { id: newId('n_'), text: text.trim(), createdAt: Date.now() };
    this.notes.push(note);
    this.session.setNote(opId, note.id); // emits, which saves
    return note;
  }

  updateNote(id: string, text: string): void {
    const note = this.getNote(id);
    if (!note || note.text === text) return;
    note.text = text;
    this.scheduleSave();
  }

  removeNote(id: string): void {
    this.notes = this.notes.filter((n) => n.id !== id);
    for (const op of [...this.session.getOps(), ...this.session.redoOps()]) if (op.noteId === id) this.session.setNote(op.id, undefined);
    this.scheduleSave();
  }

  // ---------- exports ----------

  get pageUrl(): string {
    return this.pageKey;
  }

  async getAgency(): Promise<AgencySettings> {
    try {
      return normalizeAgency(await this.store.getAgency());
    } catch {
      return { ...DEFAULT_AGENCY };
    }
  }

  /** Notes in pin order, with the op each one is attached to. */
  numberedNotes(): { n: number; text: string; op: Op }[] {
    const ops = this.session.getOps().filter((o) => this.getNote(o.noteId));
    const numbers = noteNumbers(ops);
    const out: { n: number; text: string; op: Op }[] = [];
    for (const op of ops) {
      const n = numbers.get(op.noteId!)!;
      if (!out.some((e) => e.n === n)) out.push({ n, text: this.getNote(op.noteId)!.text, op });
    }
    return out;
  }

  /** Pin centres for notes whose change is visible in the viewport (CSS px). */
  private pinPositions(): Shot['pins'] {
    const win = this.doc.defaultView!;
    const pins: Shot['pins'] = [];
    for (const { n, op } of this.numberedNotes()) {
      const r = this.session.changedElement(op)?.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) continue;
      if (r.bottom < 0 || r.right < 0 || r.top > win.innerHeight || r.left > win.innerWidth) continue;
      // Same spot as the editor's pins: just inside the top-left corner.
      pins.push({ n, x: Math.max(15, r.left + 15), y: Math.max(15, r.top + 15) });
    }
    return pins;
  }

  private async shot(pins: Shot['pins']): Promise<Shot> {
    const res = await this.store.capture();
    if ('error' in res) {
      throw new Error(
        /activeTab|permission|<all_urls>/i.test(res.error)
          ? 'The browser needs you to click the Glow-Up toolbar button on this tab once before taking screenshots. Click it, then export again.'
          : `Couldn’t take a screenshot: ${res.error}`,
      );
    }
    const win = this.doc.defaultView!;
    return { dataUrl: res.dataUrl, viewW: win.innerWidth, viewH: win.innerHeight, pins };
  }

  /**
   * Screenshot the visible area with every edit off, then on. The editor is hidden while it
   * works, and the page is left in the view it was in.
   */
  async captureBeforeAfter(): Promise<{ before: Shot; after: Shot }> {
    const startView = this.session.view;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const settle = async () => {
      // Two frames so the switch is painted; background tabs pause rAF, so don't wait on it forever.
      await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(100)]);
      await sleep(SETTLE_MS);
    };
    this.host.setHidden(true);
    try {
      this.session.showAfter();
      await settle();
      const after = await this.shot(this.pinPositions());
      await sleep(CAPTURE_GAP_MS);
      this.session.showBefore();
      await settle();
      const before = await this.shot([]);
      return { before, after };
    } finally {
      if (startView === 'after') this.session.showAfter();
      this.host.setHidden(false);
    }
  }

  changeListInput(agency: AgencySettings, date: string): ChangeListInput {
    return {
      title: this.projectTitle,
      url: this.pageKey,
      date,
      agency: agency.name || undefined,
      ops: this.session.getOps(),
      notes: this.notes,
      // The live block includes edits made inside it after it was added.
      blockHtml: (op) => {
        if (this.session.view !== 'after') return null;
        const el = findBlock(this.doc, op.after.blockId);
        if (!el) return null;
        const copy = el.cloneNode(true) as Element;
        copy.removeAttribute(BLOCK_ATTR);
        return copy.outerHTML;
      },
    };
  }

  // ---------- saving ----------

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY_MS);
  }

  private flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      void this.save();
    }
  }

  private ensureProject(): Project {
    if (!this.project) this.project = createProject(this.doc.location.href, this.doc.title);
    return this.project;
  }

  private async save(): Promise<void> {
    this.saveTimer = undefined;
    const ops = this.session.getOps();
    if (!this.project && !ops.length) return;
    const project = this.ensureProject();
    activeVersion(project).ops = JSON.parse(JSON.stringify(ops));
    // Keep notes that a change (or a change redo can bring back) still points at.
    const linked = new Set([...ops, ...this.session.redoOps()].map((o) => o.noteId).filter(Boolean));
    this.notes = this.notes.filter((n) => linked.has(n.id));
    project.notes = JSON.parse(JSON.stringify(this.notes));
    if (this.brand) project.brand = { ...this.brand };
    project.updatedAt = Date.now();
    this.setSaveState('saving');
    try {
      await this.store.saveProject(project);
      this.setSaveState('saved');
    } catch (e) {
      console.error('[Glow-Up] save failed', e);
      this.setSaveState('error');
    }
  }

  // ---------- images ----------

  async replaceImage(el: Element, mode: 'img' | 'bg', file: File): Promise<void> {
    const dataUrl = await readImage(file);
    const project = this.ensureProject();
    const asset: Asset = { id: newId('img_'), projectId: project.id, dataUrl, name: file.name, createdAt: Date.now() };
    await this.store.saveProject(project);
    await this.store.putAsset(asset);
    this.assets.set(asset.id, dataUrl);
    this.commit(createImageOp(el, asset.id, mode));
  }

  // ---------- keeping edits in place ----------

  /** Set while the user is typing in an element, so the guard doesn't "restore" their text. */
  guardPaused = false;

  /** Re-apply edits the site's own scripts overwrite after load (see EditSession.reassert). */
  private guard(): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (timer || this.guardPaused || !this.session.getOps().length) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!this.guardPaused) this.session.reassert();
      }, 250);
    });
    observer.observe(this.doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'src', 'srcset'],
    });
  }

  // ---------- single-page apps ----------

  /** SPAs change the URL without reloading; switch to that page's project when they do. */
  private watchUrl(): void {
    setInterval(() => {
      const key = urlKey(this.doc.location.href);
      if (key === this.pageKey) return;
      const wasEditing = this.editing;
      this.closeEditor();
      this.retryStop?.();
      this.pageKey = key;
      this.project = null;
      this.notes = [];
      this.brand = undefined;
      this.assets.clear();
      this.ready = this.load().then(() => {
        if (wasEditing) this.openEditor();
      });
    }, 1000);
  }
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result);
      if (file.size <= MAX_IMAGE_BYTES || file.type === 'image/svg+xml' || file.type === 'image/gif') return resolve(url);
      // Large photos are scaled down so projects stay small and quick to restore.
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
      };
      img.onerror = () => resolve(url);
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}
