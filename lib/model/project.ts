import { ENTRANCE_PRESETS, HOVER_PRESETS } from './animation';
import { newId } from './ids';
import type { Op, Project, Version } from './types';

/** Projects are keyed by origin + path. Query strings and hashes are ignored. */
export function urlKey(href: string): string {
  const u = new URL(href);
  let path = u.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return u.origin + path;
}

export function createProject(url: string, title: string): Project {
  const version: Version = { id: newId('v_'), label: 'A', ops: [] };
  return { id: newId('p_'), url: urlKey(url), title: title.trim() || url, versions: [version], notes: [], updatedAt: Date.now() };
}

/** Phase 1 edits one version per project. */
export function activeVersion(project: Project): Version {
  if (!project.versions.length) project.versions.push({ id: newId('v_'), label: 'A', ops: [] });
  return project.versions[0];
}

export function countOps(project: Project): number {
  return project.versions.reduce((n, v) => n + v.ops.length, 0);
}

function describeTarget(op: Op): string {
  const fp = op.fallback;
  const text = fp.text ? ` “${fp.text.length > 30 ? fp.text.slice(0, 30) + '…' : fp.text}”` : '';
  return `<${fp.tag}>${text}`;
}

/** Plain-language description of a change (used in the editor's change list). */
export function describeOp(op: Op): string {
  const target = describeTarget(op);
  switch (op.kind) {
    case 'text':
      return `Edited text of ${target}`;
    case 'style':
      return `Changed ${Object.keys(op.after).join(', ')} of ${target}`;
    case 'hide':
      return `Hid ${target}`;
    case 'move':
      return `Moved ${target} ${op.after.index < op.before.index ? 'up' : 'down'}`;
    case 'image':
      return op.after.mode === 'bg' ? `Replaced background image of ${target}` : `Replaced image ${target}`;
    case 'insertBlock': {
      const where = { beforebegin: 'above', afterend: 'below', afterbegin: 'at the top of', beforeend: 'at the end of' }[op.after.position];
      return op.fallback.tag === 'body' && op.after.position === 'beforeend'
        ? `Added ${op.after.label}`
        : `Added ${op.after.label} ${where} ${op.fallback.tag === 'body' ? 'the page' : target}`;
    }
    case 'animation': {
      const a = op.after;
      const name = (a.type === 'entrance' ? ENTRANCE_PRESETS : HOVER_PRESETS).find((p) => p.id === a.preset)?.label ?? a.preset;
      if (a.type === 'hover') return `Hover effect “${name}” on ${target}`;
      const when = a.trigger === 'view' ? 'when scrolled into view' : 'on page load';
      return `Animated ${target}: ${name} ${when}${a.delay ? `, ${a.delay} ms delay` : ''}`;
    }
  }
}

/**
 * Note numbers as shown on the page pins: notes are numbered in the order of the changes they
 * are attached to, so the numbers read top-to-bottom through the change list.
 */
export function noteNumbers(ops: readonly Op[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const op of ops) if (op.noteId && !out.has(op.noteId)) out.set(op.noteId, out.size + 1);
  return out;
}
