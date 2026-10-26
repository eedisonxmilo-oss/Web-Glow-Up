// EditSession: the one place ops are applied to a page. Powers undo/redo, re-applying saved
// edits on reload, the Before/After toggle and "couldn't re-apply" reporting.
//
// Invariant: ops are applied in list order and reverted in reverse order. Each op's selector and
// fingerprint were captured with every earlier op applied, so replaying in order on a fresh page
// reproduces the same DOM states the user saw while editing.

import { applyOp, isInEffect, opKeys, reapplyKeys, revertOp, type ApplyContext } from './ops';
import { newId } from './ids';
import { findBlock, resolveTarget } from './selector';
import type { Op, OpStatus } from './types';

export type View = 'after' | 'before';

const MAX_REASSERTS = 25;

export interface ReplayResult {
  applied: Op[];
  failed: Op[];
}

export interface CommitOptions {
  /** True if the change is already visible in the DOM (e.g. typed in place). */
  alreadyApplied?: boolean;
  /**
   * Consecutive commits with the same key merge into one op (one undo step), e.g. dragging a
   * colour picker. Only merges while nothing else happened in between.
   */
  coalesceKey?: string;
}

type Listener = () => void;

export class EditSession {
  private ops: Op[];
  private redoStack: Op[] = [];
  private status = new Map<string, OpStatus>();
  private elements = new Map<string, Element>();
  private listeners = new Set<Listener>();
  private lastCoalesceKey: string | null = null;
  private reasserts = new Map<string, number>();
  private _view: View = 'after';

  constructor(
    private doc: Document,
    ops: Op[],
    private ctx: ApplyContext,
  ) {
    this.ops = [...ops];
    for (const op of this.ops) this.status.set(op.id, 'pending');
  }

  get view(): View {
    return this._view;
  }

  getOps(): readonly Op[] {
    return this.ops;
  }

  /** Undone ops that redo can bring back (newest last). */
  redoOps(): readonly Op[] {
    return this.redoStack;
  }

  getStatus(opId: string): OpStatus | undefined {
    return this.status.get(opId);
  }

  failedOps(): Op[] {
    return this.ops.filter((o) => this.status.get(o.id) === 'failed');
  }

  canUndo(): boolean {
    return this._view === 'after' && this.ops.length > 0;
  }

  canRedo(): boolean {
    return this._view === 'after' && this.redoStack.length > 0;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Element for an op, preferring the one cached this session if it's still in the page. */
  resolve(op: Op): Element | null {
    const cached = this.elements.get(op.id);
    if (cached?.isConnected) return cached;
    const hit = resolveTarget(op.selector, op.fallback, this.doc);
    if (hit) this.elements.set(op.id, hit.el);
    return hit?.el ?? null;
  }

  /** Where an applied op's change shows on the page: the inserted block for insertBlock ops. */
  changedElement(op: Op): Element | null {
    if (this.status.get(op.id) !== 'applied') return null;
    if (op.kind === 'insertBlock') return findBlock(this.doc, op.after.blockId);
    return this.resolve(op);
  }

  /** Link a note to an op (or unlink with undefined). Not an undo step. */
  setNote(opId: string, noteId: string | undefined): void {
    const op = this.ops.find((o) => o.id === opId) ?? this.redoStack.find((o) => o.id === opId);
    if (!op) return;
    if (noteId) op.noteId = noteId;
    else delete op.noteId;
    this.emit();
  }

  private tryApply(op: Op): boolean {
    const el = this.resolve(op);
    if (!el) {
      this.status.set(op.id, 'failed');
      return false;
    }
    try {
      applyOp(el, op, this.ctx);
      this.status.set(op.id, 'applied');
      return true;
    } catch {
      this.status.set(op.id, 'failed');
      return false;
    }
  }

  private tryRevert(op: Op): void {
    if (this.status.get(op.id) !== 'applied') return;
    const el = this.resolve(op);
    if (el) {
      try {
        revertOp(el, op);
      } catch {
        /* element changed under us; nothing more we can do */
      }
    }
    this.status.set(op.id, 'pending');
  }

  /** Apply every saved op in order (page load). */
  replay(): ReplayResult {
    const applied: Op[] = [];
    const failed: Op[] = [];
    for (const op of this.ops) {
      if (this.status.get(op.id) === 'applied') {
        applied.push(op);
        continue;
      }
      (this.tryApply(op) ? applied : failed).push(op);
    }
    this._view = 'after';
    this.emit();
    return { applied, failed };
  }

  /**
   * Retry ops that couldn't be applied (content that loads late). Only safe to retry an op if
   * every op after it is also unapplied, otherwise order would be broken, so we revert the
   * tail first and replay from the first failure.
   */
  retryFailed(): number {
    if (this._view !== 'after') return 0;
    const firstFailed = this.ops.findIndex((o) => this.status.get(o.id) === 'failed');
    if (firstFailed < 0) return 0;
    const before = this.failedOps().length;
    for (let i = this.ops.length - 1; i > firstFailed; i--) this.tryRevert(this.ops[i]);
    for (let i = firstFailed; i < this.ops.length; i++) this.tryApply(this.ops[i]);
    const recovered = before - this.failedOps().length;
    if (recovered) this.emit();
    return recovered;
  }

  /** Record a new op. Returns the op that's now on top of the history. */
  commit(op: Op, opts: CommitOptions = {}): Op {
    return this.commitGroup([op], opts)[0];
  }

  /**
   * Record ops made by one gesture (e.g. one change applied to several selected elements). With
   * more than one op they share a group id and undo / redo as a single step. Returns the ops now
   * on top of the history (the existing ones when a coalescing commit merged into them).
   */
  commitGroup(ops: Op[], opts: CommitOptions = {}): Op[] {
    if (this._view !== 'after') throw new Error('Switch to "After" before editing');
    if (!ops.length) return [];
    const tail = this.ops.slice(-ops.length);
    const canMerge =
      !!opts.coalesceKey &&
      opts.coalesceKey === this.lastCoalesceKey &&
      this.redoStack.length === 0 &&
      tail.length === ops.length &&
      (ops.length === 1 ? !tail[0].group : !!tail[0].group && tail.every((t) => t.group === tail[0].group)) &&
      tail.every((t, i) => t.kind === ops[i].kind && t.selector === ops[i].selector && this.status.get(t.id) === 'applied');
    if (canMerge) {
      tail.forEach((top, i) => this.mergeInto(top, ops[i], !!opts.alreadyApplied));
      this.emit();
      return tail;
    }

    this.lastCoalesceKey = opts.coalesceKey ?? null;
    this.redoStack = [];
    const group = ops.length > 1 ? newId('g_') : undefined;
    for (const op of ops) {
      if (group) op.group = group;
      else delete op.group;
      this.ops.push(op);
      if (opts.alreadyApplied) {
        this.status.set(op.id, 'applied');
        const el = this.resolve(op);
        if (el) this.elements.set(op.id, el);
      } else {
        this.tryApply(op);
      }
    }
    this.emit();
    return ops;
  }

  private mergeInto(top: Op, op: Op, alreadyApplied: boolean): void {
    if (top.kind === 'style' && op.kind === 'style') {
      // Keep the original "before"; take the newest "after" for each property.
      for (const [prop, v] of Object.entries(op.before)) if (!(prop in top.before)) top.before[prop] = v;
      Object.assign(top.after, op.after);
    } else {
      (top as { after: unknown }).after = op.after;
    }
    if (!alreadyApplied) {
      const el = this.resolve(top);
      if (el) applyOp(el, top, this.ctx);
    }
  }

  /** The ops of the newest undo step (one op, or every op of its group). */
  private topStep(stack: Op[]): number {
    const top = stack[stack.length - 1];
    if (!top) return 0;
    if (!top.group) return 1;
    let n = 0;
    while (n < stack.length && stack[stack.length - 1 - n].group === top.group) n++;
    return n;
  }

  /** Tell the session which element an op targets (avoids re-resolving right after creation). */
  bindElement(opId: string, el: Element): void {
    this.elements.set(opId, el);
  }

  /** Undo the newest step (a whole group at once). Returns the oldest op of that step. */
  undo(): Op | null {
    if (!this.canUndo()) return null;
    let op: Op | null = null;
    for (let n = this.topStep(this.ops); n > 0; n--) {
      op = this.ops.pop()!;
      this.tryRevert(op);
      this.status.delete(op.id);
      this.redoStack.push(op);
    }
    this.lastCoalesceKey = null;
    this.emit();
    return op;
  }

  /** Redo the next step (a whole group at once). Returns the newest op of that step. */
  redo(): Op | null {
    if (!this.canRedo()) return null;
    let op: Op | null = null;
    for (let n = this.topStep(this.redoStack); n > 0; n--) {
      op = this.redoStack.pop()!;
      this.ops.push(op);
      this.tryApply(op);
    }
    this.lastCoalesceKey = null;
    this.emit();
    return op;
  }

  /** Switch every op off. */
  showBefore(): void {
    if (this._view === 'before') return;
    for (let i = this.ops.length - 1; i >= 0; i--) this.tryRevert(this.ops[i]);
    this._view = 'before';
    this.lastCoalesceKey = null;
    this.emit();
  }

  /** Switch every op back on. */
  showAfter(): void {
    if (this._view === 'after') return;
    for (const op of this.ops) this.tryApply(op);
    this._view = 'after';
    this.emit();
  }

  toggleView(): View {
    if (this._view === 'after') this.showBefore();
    else this.showAfter();
    return this._view;
  }

  /**
   * Re-apply edits the site's own scripts have overwritten since (hydration, responsive image
   * swaps, re-renders). Checks the newest op for each element/aspect only, so older ops never
   * undo newer ones. Each op is re-applied at most MAX_REASSERTS times so we never fight a page
   * that keeps changing (a carousel, a ticker). Returns how many ops were re-applied.
   */
  reassert(): number {
    if (this._view !== 'after') return 0;
    const seen = new Map<Element, Set<string>>();
    let count = 0;
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (this.status.get(op.id) !== 'applied') continue;
      const keys = opKeys(op);
      if (!keys.length) continue;
      const el = this.resolve(op);
      if (!el) continue;
      let done = seen.get(el);
      if (!done) seen.set(el, (done = new Set()));
      const fresh = keys.filter((k) => !done!.has(k));
      for (const k of keys) done.add(k);
      if (!fresh.length || isInEffect(el, op, fresh, this.ctx)) continue;
      const n = this.reasserts.get(op.id) ?? 0;
      if (n >= MAX_REASSERTS) continue;
      this.reasserts.set(op.id, n + 1);
      try {
        reapplyKeys(el, op, fresh, this.ctx);
        count++;
      } catch {
        /* leave it; it will show as applied but the page owns that element now */
      }
    }
    return count;
  }

  /**
   * Remove ops that couldn't be re-applied. Ops that are applied are left alone (removing one
   * from the middle would break the ops after it); use undo for those.
   */
  removeFailed(opIds?: string[]): number {
    const ids = new Set(opIds ?? this.failedOps().map((o) => o.id));
    const keep = this.ops.filter((o) => !(ids.has(o.id) && this.status.get(o.id) === 'failed'));
    const removed = this.ops.length - keep.length;
    for (const o of this.ops) if (!keep.includes(o)) this.status.delete(o.id);
    this.ops = keep;
    if (removed) this.emit();
    return removed;
  }
}
