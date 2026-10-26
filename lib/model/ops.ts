// Creating operations from the live DOM, and applying / reverting a single operation.

import { clampAnimation, isAnimationRunning, startAnimation, stopAnimation } from './animation';
import { newId } from './ids';
import { sanitizeHtml } from './sanitize';
import { BLOCK_ATTR, buildSelector, findBlock, fingerprint } from './selector';
import type {
  AnimationOp,
  AnimationValue,
  BlockPosition,
  HideOp,
  ImageBefore,
  ImageOp,
  InsertBlockOp,
  MoveOp,
  Op,
  StyleMap,
  StyleOp,
  StyleValue,
  TextOp,
} from './types';

export interface ApplyContext {
  /** Returns a URL (data: or blob:) for a stored image, or undefined if it isn't loaded. */
  getAsset(assetId: string): string | undefined;
}

export class OpApplyError extends Error {}

// ---------- reading current values ----------

export function readStyle(el: Element, prop: string): StyleValue {
  const style = (el as HTMLElement).style;
  return { value: style.getPropertyValue(prop), important: style.getPropertyPriority(prop) === 'important' };
}

function writeStyle(el: Element, prop: string, v: StyleValue): void {
  const style = (el as HTMLElement).style;
  if (!v.value) {
    style.removeProperty(prop);
    // Don't leave an empty style="" behind, so "Before" really is the original markup.
    if (el.getAttribute('style')?.trim() === '') el.removeAttribute('style');
  } else style.setProperty(prop, v.value, v.important ? 'important' : '');
}

export function elementIndex(el: Element): number {
  return el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0;
}

function moveToIndex(el: Element, index: number): void {
  const parent = el.parentElement;
  if (!parent) throw new OpApplyError('element has no parent');
  const others = Array.from(parent.children).filter((c) => c !== el);
  if (index < 0 || index > others.length) throw new OpApplyError('move index out of range');
  parent.insertBefore(el, others[index] ?? null);
}

function pictureSources(img: Element): HTMLSourceElement[] {
  const parent = img.parentElement;
  if (!parent || parent.tagName !== 'PICTURE') return [];
  return Array.from(parent.querySelectorAll(':scope > source')) as HTMLSourceElement[];
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (value == null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

// ---------- creating ops ----------

function base(el: Element) {
  return {
    id: newId('op_'),
    selector: buildSelector(el),
    fallback: fingerprint(el),
    createdAt: Date.now(),
  };
}

/**
 * Text ops are created after the user has edited the element in place, so the caller passes
 * the HTML captured before editing began. Must be called while the DOM is otherwise in the
 * state it was in before the edit (selector/fingerprint use the old text).
 */
export function createTextOp(el: Element, beforeHtml: string, afterHtml: string, beforeEl?: { selector: string; fallback: Op['fallback'] }): TextOp {
  const b = base(el);
  return {
    ...b,
    ...(beforeEl ?? {}),
    kind: 'text',
    before: { html: beforeHtml },
    after: { html: sanitizeHtml(afterHtml, el.ownerDocument) },
  };
}

export function createStyleOp(el: Element, changes: Record<string, string>): StyleOp {
  const before: StyleMap = {};
  const after: StyleMap = {};
  for (const [prop, value] of Object.entries(changes)) {
    before[prop] = readStyle(el, prop);
    after[prop] = { value, important: value !== '' };
  }
  return { ...base(el), kind: 'style', before, after };
}

export function createHideOp(el: Element): HideOp {
  return { ...base(el), kind: 'hide', before: readStyle(el, 'display'), after: { value: 'none', important: true } };
}

/** Returns null if the element can't move further in that direction. */
export function createMoveOp(el: Element, direction: 'up' | 'down'): MoveOp | null {
  const parent = el.parentElement;
  if (!parent) return null;
  const from = elementIndex(el);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= parent.children.length) return null;
  return { ...base(el), kind: 'move', before: { index: from }, after: { index: to } };
}

export function createImageOp(el: Element, assetId: string, mode: 'img' | 'bg'): ImageOp {
  const before: ImageBefore =
    mode === 'img'
      ? {
          src: el.getAttribute('src'),
          srcset: el.getAttribute('srcset'),
          sizes: el.getAttribute('sizes'),
          sources: pictureSources(el).map((s) => s.getAttribute('srcset')),
        }
      : { src: null, srcset: null, sizes: null, sources: [], bg: readStyle(el, 'background-image') };
  return { ...base(el), kind: 'image', before, after: { assetId, mode } };
}

/** `anchor` is the element the block is placed against; `html` must have one root element. */
export function createInsertBlockOp(
  anchor: Element,
  block: { presetId: string; label: string; position: BlockPosition; html: string },
): InsertBlockOp {
  const doc = anchor.ownerDocument;
  if (anchor === doc.body && (block.position === 'beforebegin' || block.position === 'afterend')) {
    throw new OpApplyError('blocks can only go inside <body>');
  }
  return {
    ...base(anchor),
    kind: 'insertBlock',
    before: null,
    after: { ...block, blockId: newId('blk_'), html: sanitizeHtml(block.html, doc) },
  };
}

export function createAnimationOp(el: Element, value: AnimationValue): AnimationOp {
  return { ...base(el), kind: 'animation', before: null, after: clampAnimation(value) };
}

function insertBlock(anchor: Element, op: InsertBlockOp): void {
  const doc = anchor.ownerDocument;
  if (findBlock(doc, op.after.blockId)?.isConnected) return; // already there
  const tpl = doc.createElement('template');
  tpl.innerHTML = sanitizeHtml(op.after.html, doc);
  const block = tpl.content.firstElementChild;
  if (!block) throw new OpApplyError('block has no content');
  if (anchor === doc.body && (op.after.position === 'beforebegin' || op.after.position === 'afterend')) {
    throw new OpApplyError('blocks can only go inside <body>');
  }
  block.setAttribute(BLOCK_ATTR, op.after.blockId);
  anchor.insertAdjacentElement(op.after.position, block);
}

// ---------- applying / reverting ----------

export function applyOp(el: Element, op: Op, ctx: ApplyContext): void {
  switch (op.kind) {
    case 'text':
      el.innerHTML = sanitizeHtml(op.after.html, el.ownerDocument);
      return;
    case 'style':
      for (const [prop, v] of Object.entries(op.after)) writeStyle(el, prop, v);
      return;
    case 'hide':
      writeStyle(el, 'display', op.after);
      return;
    case 'move':
      moveToIndex(el, op.after.index);
      return;
    case 'image': {
      const url = ctx.getAsset(op.after.assetId);
      if (!url) throw new OpApplyError('image not found in local storage');
      if (op.after.mode === 'bg') {
        writeStyle(el, 'background-image', { value: `url("${url}")`, important: true });
        return;
      }
      el.setAttribute('src', url);
      el.removeAttribute('srcset');
      el.removeAttribute('sizes');
      for (const s of pictureSources(el)) s.setAttribute('srcset', url);
      return;
    }
    case 'insertBlock':
      insertBlock(el, op);
      return;
    case 'animation':
      startAnimation(el, op);
      return;
  }
}

export function revertOp(el: Element, op: Op): void {
  switch (op.kind) {
    case 'text':
      el.innerHTML = op.before.html;
      return;
    case 'style':
      for (const [prop, v] of Object.entries(op.before)) writeStyle(el, prop, v);
      return;
    case 'hide':
      writeStyle(el, 'display', op.before);
      return;
    case 'move':
      moveToIndex(el, op.before.index);
      return;
    case 'image':
      if (op.after.mode === 'bg') {
        writeStyle(el, 'background-image', op.before.bg ?? { value: '', important: false });
        return;
      }
      setAttr(el, 'src', op.before.src);
      setAttr(el, 'srcset', op.before.srcset);
      setAttr(el, 'sizes', op.before.sizes);
      pictureSources(el).forEach((s, i) => setAttr(s, 'srcset', op.before.sources[i] ?? null));
      return;
    case 'insertBlock':
      findBlock(el.ownerDocument, op.after.blockId)?.remove();
      return;
    case 'animation':
      stopAnimation(el, op.id);
      return;
  }
}

// ---------- keeping ops in effect ----------
// Some sites re-render after load (hydration, responsive image swaps) and overwrite edits.
// These helpers let the session notice and re-apply, one aspect ("key") at a time, so a later
// op on the same element/property always wins.

/** The aspects of an element an op controls. Move ops are excluded (later moves shift indexes). */
export function opKeys(op: Op): string[] {
  switch (op.kind) {
    case 'style':
      return Object.keys(op.after).map((p) => `style:${p}`);
    case 'hide':
      return ['style:display'];
    case 'text':
      return ['text'];
    case 'image':
      return op.after.mode === 'bg' ? ['style:background-image'] : ['src'];
    case 'insertBlock':
      return [`block:${op.after.blockId}`];
    case 'animation':
      return [`anim:${op.id}`];
    default:
      return [];
  }
}

const normalized = new Map<string, string>();
function normalizedStyle(doc: Document, prop: string, value: string): string {
  const k = `${prop}\n${value}`;
  let v = normalized.get(k);
  if (v === undefined) {
    const probe = doc.createElement('div');
    probe.style.setProperty(prop, value);
    v = probe.style.getPropertyValue(prop);
    normalized.set(k, v);
  }
  return v;
}

function textOf(html: string, doc: Document): string {
  const tpl = doc.createElement('template');
  tpl.innerHTML = html;
  return tpl.content.textContent ?? '';
}

function styleFor(op: Op, key: string, ctx: ApplyContext): StyleValue | null {
  const prop = key.slice('style:'.length);
  if (op.kind === 'style') return op.after[prop] ?? null;
  if (op.kind === 'hide') return op.after;
  if (op.kind === 'image' && op.after.mode === 'bg') {
    const url = ctx.getAsset(op.after.assetId);
    return url ? { value: `url("${url}")`, important: true } : null;
  }
  return null;
}

/** True if every given key of `op` is still visible on the element. */
export function isInEffect(el: Element, op: Op, keys: string[], ctx: ApplyContext): boolean {
  const doc = el.ownerDocument;
  for (const key of keys) {
    if (key === 'text') {
      if (op.kind === 'text' && el.textContent !== textOf(op.after.html, doc)) return false;
    } else if (key === 'src') {
      if (op.kind === 'image' && (el.getAttribute('src') !== ctx.getAsset(op.after.assetId) || el.hasAttribute('srcset'))) return false;
    } else if (key.startsWith('block:')) {
      // Re-rendering frameworks sometimes drop nodes they didn't create.
      if (op.kind === 'insertBlock' && !findBlock(doc, op.after.blockId)) return false;
    } else if (key.startsWith('anim:')) {
      // A re-render can swap the element for a new one without our listeners.
      if (op.kind === 'animation' && !isAnimationRunning(el, op.id)) return false;
    } else {
      const want = styleFor(op, key, ctx);
      if (!want) continue;
      const prop = key.slice('style:'.length);
      const have = readStyle(el, prop);
      if (have.value !== normalizedStyle(doc, prop, want.value) || have.important !== want.important) return false;
    }
  }
  return true;
}

/** Re-apply only the given keys of `op`. */
export function reapplyKeys(el: Element, op: Op, keys: string[], ctx: ApplyContext): void {
  if (keys.includes('text') || keys.includes('src') || op.kind === 'insertBlock' || op.kind === 'animation') {
    applyOp(el, op, ctx);
    return;
  }
  for (const key of keys) {
    const want = styleFor(op, key, ctx);
    if (want) writeStyle(el, key.slice('style:'.length), want);
  }
}

/** Asset ids referenced by a list of ops (to preload before replay). */
export function assetIds(ops: Op[]): string[] {
  return [...new Set(ops.filter((o): o is ImageOp => o.kind === 'image').map((o) => o.after.assetId))];
}
