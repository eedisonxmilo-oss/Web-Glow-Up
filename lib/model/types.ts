// The edit model (SPEC.md section 5). Every change is an operation, never an HTML snapshot.
// Keep this file free of browser-extension APIs so other tools (e.g. Opportunity Engine)
// can produce or consume projects later.

export type OpKind = 'text' | 'style' | 'hide' | 'move' | 'insertBlock' | 'image';

/** Enough about an element to find it again when its selector no longer matches. */
export interface ElementFingerprint {
  tag: string;
  /** Normalised text content, first 120 characters. */
  text: string;
  id?: string;
  /** Classes that look hand-written (generated hashes are dropped). */
  classes: string[];
  /** A few identifying attributes: href, src (no query), alt, name, role, aria-label, data-id... */
  attrs: Record<string, string>;
  /** Ancestor tag names from <body> down to the parent. */
  path: string[];
  /** Position among all elements with the same tag in the document. */
  index: number;
  /** Position among the parent's element children. */
  siblingIndex: number;
}

/** One inline style declaration. An empty value means "no inline value". */
export interface StyleValue {
  value: string;
  important: boolean;
}
export type StyleMap = Record<string, StyleValue>;

export interface TextValue {
  html: string;
}

/** Index among the parent's element children. */
export interface MoveValue {
  index: number;
}

export interface ImageBefore {
  src: string | null;
  srcset: string | null;
  sizes: string | null;
  /** srcset of each <source> in a parent <picture>, in order. */
  sources: (string | null)[];
  /** Inline background-image, for background-image replacements. */
  bg?: StyleValue;
}

export interface ImageAfter {
  /** Key into the local asset store (IndexedDB). */
  assetId: string;
  mode: 'img' | 'bg';
}

/** Where an inserted block goes relative to its anchor element (insertAdjacentElement positions). */
export type BlockPosition = 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend';

export interface BlockValue {
  /** Written to the inserted element as data-glowup-block, so later ops can target its contents. */
  blockId: string;
  /** Fix library preset it came from. */
  presetId: string;
  /** Human name for the change list, e.g. "Trust bar". */
  label: string;
  position: BlockPosition;
  /** One root element, inline styles only. Sanitised before it is inserted. */
  html: string;
}

interface OpBase {
  id: string;
  /** Robust selector for the target element. */
  selector: string;
  /** Used if the selector breaks. */
  fallback: ElementFingerprint;
  noteId?: string;
  createdAt: number;
}

export type TextOp = OpBase & { kind: 'text'; before: TextValue; after: TextValue };
export type StyleOp = OpBase & { kind: 'style'; before: StyleMap; after: StyleMap };
export type HideOp = OpBase & { kind: 'hide'; before: StyleValue; after: StyleValue };
export type MoveOp = OpBase & { kind: 'move'; before: MoveValue; after: MoveValue };
export type ImageOp = OpBase & { kind: 'image'; before: ImageBefore; after: ImageAfter };
/** A fix library block. The selector/fallback describe the anchor element it is placed against. */
export type InsertBlockOp = OpBase & { kind: 'insertBlock'; before: null; after: BlockValue };

export type Op = TextOp | StyleOp | HideOp | MoveOp | ImageOp | InsertBlockOp;

/** A user note. Linked from an op's noteId; numbered on the page in op order. */
export interface Note {
  id: string;
  text: string;
  createdAt: number;
}

export interface ButtonStyle {
  background: string;
  color: string;
  radius: string;
}

/**
 * The site's look, read from computed styles (SPEC Phase 2). Used only to style presets.
 * Colors are hex. The user can override any of them; `edited` marks that.
 */
export interface BrandCapture {
  /** Main colors, most prominent first (accent first when there is one). */
  colors: string[];
  accent?: string;
  text?: string;
  background?: string;
  headingFont?: string;
  bodyFont?: string;
  button?: ButtonStyle;
  capturedAt?: number;
  edited?: boolean;
}

export interface Version {
  id: string;
  label: string; // A, B, C
  ops: Op[];
}

export interface Project {
  id: string;
  /** origin + path */
  url: string;
  title: string;
  versions: Version[];
  notes: Note[];
  brand?: BrandCapture;
  updatedAt: number;
}

export type OpStatus = 'applied' | 'failed' | 'pending';
