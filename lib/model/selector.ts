// Selector strategy (SPEC.md section 5):
//   1. a stable, unique id
//   2. a stable, unique attribute (data-testid, data-id, name, aria-label, href...)
//   3. a structural path of tag:nth-of-type steps from the nearest stable ancestor (or <body>)
// plus an ElementFingerprint, used when the selector no longer finds the right element.

import type { ElementFingerprint } from './types';

/** Elements belonging to the editor itself carry this attribute and are never targets. */
export const EDITOR_ATTR = 'data-glowup-ui';
/** Blocks inserted from the fix library carry this attribute (value: the block id). */
export const BLOCK_ATTR = 'data-glowup-block';

export function findBlock(doc: Document, blockId: string): Element | null {
  return doc.querySelector(`[${BLOCK_ATTR}="${blockId.replace(/["\\]/g, '\\$&')}"]`);
}

const STABLE_ATTRS = [
  BLOCK_ATTR,
  'data-testid',
  'data-test',
  'data-test-id',
  'data-qa',
  'data-cy',
  'data-id', // Elementor
  'data-block-id', // Squarespace
  'data-section-id', // Squarespace / Shopify
  'name',
  'itemprop',
  'aria-label',
  'for',
  'href',
];

const FP_ATTRS = ['href', 'src', 'alt', 'name', 'type', 'role', 'aria-label', 'data-id', 'data-testid', 'data-block-id', 'title'];

export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  // Minimal CSS.escape polyfill (CSSOM spec), for environments that lack it.
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    if (code === 0) out += '�';
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f || (i === 0 && code >= 0x30 && code <= 0x39) ||
      (i === 1 && code >= 0x30 && code <= 0x39 && value.charCodeAt(0) === 0x2d)) {
      out += '\\' + code.toString(16) + ' ';
    } else if (i === 0 && value.length === 1 && code === 0x2d) out += '\\' + ch;
    else if (code >= 0x80 || code === 0x2d || code === 0x5f || /[0-9A-Za-z]/.test(ch)) out += ch;
    else out += '\\' + ch;
  }
  return out;
}

function attrValueEscape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}

/** Heuristic: ids generated per page load by frameworks are useless after reload. */
export function isStableId(id: string): boolean {
  if (!id || id.length > 80) return false;
  if (/^\d/.test(id)) return false; // purely/leading numeric
  if (/^[:«].*[:»]$/.test(id)) return false; // React useId (":r0:" or "«r0»")
  if (/^(ember|ext-gen|yui_|ui-id-|mui-|radix-|headlessui-|react-aria|rc_|__next)/i.test(id)) return false;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(id)) return false; // uuid
  if (/(^|[-_])[0-9a-f]{10,}($|[-_])/i.test(id) && /\d/.test(id)) return false; // long hex hash
  return true;
}

function isStableClass(c: string): boolean {
  if (!c || c.length > 40) return false;
  if (c.startsWith('glowup')) return false;
  if (/^(css|sc|jsx|svelte|emotion|tw)-[a-z0-9]+$/i.test(c)) return false; // CSS-in-JS
  if (/[A-Za-z]+_[A-Za-z0-9]{5}$/.test(c) && /\d/.test(c)) return false; // CSS modules hash
  if (/\d{4,}/.test(c)) return false;
  return true;
}

function isUnique(doc: Document, selector: string, el: Element): boolean {
  try {
    const found = doc.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/** A short unique selector for `el` that doesn't depend on DOM position, or null. */
function anchorSelector(el: Element, doc: Document): string | null {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id && isStableId(id)) {
    const sel = `#${cssEscape(id)}`;
    if (isUnique(doc, sel, el)) return sel;
  }
  for (const attr of STABLE_ATTRS) {
    const v = el.getAttribute(attr);
    if (!v || v.length > 200 || (attr === 'href' && /^(#|javascript:)/i.test(v))) continue;
    const sel = `${tag}[${attr}="${attrValueEscape(v)}"]`;
    if (isUnique(doc, sel, el)) return sel;
  }
  return null;
}

function nthOfTypeStep(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  let n = 0;
  let total = 0;
  for (const sib of Array.from(parent.children)) {
    if (sib.tagName === el.tagName) {
      total++;
      if (sib === el) n = total;
    }
  }
  return total > 1 ? `${tag}:nth-of-type(${n})` : tag;
}

export function buildSelector(el: Element, doc: Document = el.ownerDocument): string {
  const direct = anchorSelector(el, doc);
  if (direct) return direct;

  const steps: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== doc.documentElement) {
    if (cur === doc.body) {
      steps.unshift('body');
      break;
    }
    if (cur !== el) {
      const anchor = anchorSelector(cur, doc);
      if (anchor) {
        steps.unshift(anchor);
        break;
      }
    }
    steps.unshift(nthOfTypeStep(cur));
    cur = cur.parentElement;
  }
  const sel = steps.join(' > ');
  return sel || el.tagName.toLowerCase();
}

export function normalizeText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function stripQuery(url: string): string {
  return url.split(/[?#]/)[0];
}

export function fingerprint(el: Element, doc: Document = el.ownerDocument): ElementFingerprint {
  const tag = el.tagName.toLowerCase();
  const attrs: Record<string, string> = {};
  for (const a of FP_ATTRS) {
    const v = el.getAttribute(a);
    if (v != null && v.length <= 300 && !v.startsWith('data:')) attrs[a] = a === 'src' ? stripQuery(v) : v;
  }
  const path: string[] = [];
  for (let p = el.parentElement; p && p !== doc.documentElement; p = p.parentElement) {
    path.unshift(p.tagName.toLowerCase());
    if (p === doc.body) break;
  }
  const sameTag = Array.from(doc.getElementsByTagName(tag));
  const id = el.getAttribute('id') ?? undefined;
  return {
    tag,
    text: normalizeText(el),
    ...(id ? { id } : {}),
    classes: Array.from(el.classList).filter(isStableClass).slice(0, 8),
    attrs,
    path,
    index: sameTag.indexOf(el),
    siblingIndex: el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0,
  };
}

/** How well `el` matches a stored fingerprint. Higher is better; -Infinity if the tag differs. */
export function scoreFingerprint(el: Element, fp: ElementFingerprint, doc: Document = el.ownerDocument): number {
  if (el.tagName.toLowerCase() !== fp.tag) return -Infinity;
  let s = 0;
  const text = normalizeText(el);
  if (fp.text) {
    if (text === fp.text) s += 6;
    else if (text && fp.text.length >= 10 && (text.startsWith(fp.text.slice(0, 40)) || fp.text.startsWith(text.slice(0, 40)))) s += 3;
    else s -= 2;
  } else if (!text) {
    s += 1;
  }
  if (fp.id && el.getAttribute('id') === fp.id) s += 4;
  for (const [k, v] of Object.entries(fp.attrs)) {
    const cur = el.getAttribute(k);
    if (cur == null) continue;
    if ((k === 'src' ? stripQuery(cur) : cur) === v) s += 2;
  }
  if (fp.classes.length) {
    const have = new Set(el.classList);
    const hit = fp.classes.filter((c) => have.has(c)).length;
    s += (3 * hit) / fp.classes.length;
  }
  const path: string[] = [];
  for (let p = el.parentElement; p && p !== doc.documentElement; p = p.parentElement) {
    path.unshift(p.tagName.toLowerCase());
    if (p === doc.body) break;
  }
  if (path.join('>') === fp.path.join('>')) s += 2;
  if (el.parentElement && Array.from(el.parentElement.children).indexOf(el) === fp.siblingIndex) s += 0.5;
  if (Array.from(doc.getElementsByTagName(fp.tag)).indexOf(el) === fp.index) s += 1;
  return s;
}

const MAX_CANDIDATES = 4000;
/** Minimum score for a fingerprint-only match, and how far ahead of the runner-up it must be. */
const FP_MIN_SCORE = 5;
const FP_MIN_LEAD = 2; // more than position alone can contribute
/** A selector hit at least this confident skips the fingerprint search. */
const SELECTOR_CONFIDENT = 5;

function isEditorNode(el: Element): boolean {
  return !!el.closest(`[${EDITOR_ATTR}]`);
}

export function findByFingerprint(fp: ElementFingerprint, doc: Document = document): { el: Element; score: number } | null {
  const candidates = Array.from(doc.getElementsByTagName(fp.tag)).slice(0, MAX_CANDIDATES);
  let best: Element | null = null;
  let bestScore = -Infinity;
  let second = -Infinity;
  for (const el of candidates) {
    if (isEditorNode(el)) continue;
    const s = scoreFingerprint(el, fp, doc);
    if (s > bestScore) {
      second = bestScore;
      bestScore = s;
      best = el;
    } else if (s > second) {
      second = s;
    }
  }
  if (!best || bestScore < FP_MIN_SCORE || bestScore - second < FP_MIN_LEAD) return null;
  return { el: best, score: bestScore };
}

export type ResolveResult = { el: Element; via: 'selector' | 'fingerprint' } | null;

export function resolveTarget(selector: string, fp: ElementFingerprint, doc: Document = document): ResolveResult {
  let candidate: Element | null = null;
  try {
    const found = doc.querySelectorAll(selector);
    if (found.length === 1 && found[0].tagName.toLowerCase() === fp.tag && !isEditorNode(found[0])) candidate = found[0];
  } catch {
    candidate = null;
  }
  let candScore = -Infinity;
  if (candidate) {
    candScore = scoreFingerprint(candidate, fp, doc);
    if (candScore >= SELECTOR_CONFIDENT) return { el: candidate, via: 'selector' };
  }
  const fpHit = findByFingerprint(fp, doc);
  if (candidate) {
    if (fpHit && fpHit.el !== candidate && fpHit.score > candScore + 1) return { el: fpHit.el, via: 'fingerprint' };
    return { el: candidate, via: 'selector' };
  }
  return fpHit ? { el: fpHit.el, via: 'fingerprint' } : null;
}
