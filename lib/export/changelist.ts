// Developer change list (SPEC.md Phase 3): every change in order, in plain words, with CSS / HTML
// a developer can copy. Exported as Markdown or plain text from the same content.

import { animationCss, VIEW_SCRIPT } from '../model/animation';
import { describeOp, noteNumbers } from '../model/project';
import { BLOCK_ATTR } from '../model/selector';
import type { Note, Op } from '../model/types';

export interface ChangeListInput {
  title: string;
  url: string;
  date: string;
  agency?: string;
  ops: readonly Op[];
  notes: readonly Note[];
  /** Current HTML of an inserted block (includes later edits inside it); falls back to the op's HTML. */
  blockHtml?(op: Extract<Op, { kind: 'insertBlock' }>): string | null;
  /** File name to quote for a replaced image. */
  imageName?(assetId: string): string | undefined;
}

type Part = { p: string } | { code: string; lang: 'css' | 'html' } | { quote: string };

interface Item {
  title: string;
  parts: Part[];
}

const POS_TEXT = {
  beforebegin: 'directly above',
  afterend: 'directly below',
  afterbegin: 'inside, at the start of',
  beforeend: 'inside, at the end of',
} as const;

function target(op: Op): string {
  const fp = op.fallback;
  const text = fp.text ? ` “${fp.text.length > 60 ? fp.text.slice(0, 60) + '…' : fp.text}”` : '';
  return `<${fp.tag}>${text}`;
}

function cssRule(selector: string, decls: [string, string][]): string {
  return `${selector} {\n${decls.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}`;
}

function plainText(html: string, doc: Document): string {
  const t = doc.createElement('template');
  t.innerHTML = html;
  return (t.content.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Indent block HTML one element per line so it can be read and pasted; inline text stays inline. */
export function prettyHtml(html: string, doc: Document): string {
  const t = doc.createElement('template');
  t.innerHTML = html;
  const out: string[] = [];
  const attrs = (el: Element) =>
    Array.from(el.attributes)
      .filter((a) => a.name !== BLOCK_ATTR)
      .map((a) => ` ${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
      .join('');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const walk = (node: Node, depth: number) => {
    const pad = '  '.repeat(depth);
    if (node.nodeType === 3) {
      const s = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (s) out.push(pad + esc(s));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const open = `<${tag}${attrs(el)}>`;
    if (VOID.has(tag)) return void out.push(pad + open);
    // Elements holding only text stay on one line.
    if (Array.from(el.childNodes).every((c) => c.nodeType === 3)) {
      return void out.push(`${pad}${open}${esc((el.textContent ?? '').replace(/\s+/g, ' ').trim())}</${tag}>`);
    }
    out.push(pad + open);
    for (const c of Array.from(el.childNodes)) walk(c, depth + 1);
    out.push(`${pad}</${tag}>`);
  };
  for (const n of Array.from(t.content.childNodes)) walk(n, 0);
  return out.join('\n');
}

function blockIdIn(selector: string): string | null {
  const m = selector.match(new RegExp(`\\[${BLOCK_ATTR}="([^"]+)"\\]`));
  return m ? m[1] : null;
}

function items(input: ChangeListInput, doc: Document): Item[] {
  const numbers = noteNumbers(input.ops.filter((o) => o.noteId && input.notes.some((n) => n.id === o.noteId)));
  const noteById = new Map(input.notes.map((n) => [n.id, n]));
  const blockChange = new Map<string, number>();
  input.ops.forEach((op, i) => op.kind === 'insertBlock' && blockChange.set(op.after.blockId, i + 1));

  const list = input.ops.map((op, i) => {
    const parts: Part[] = [];
    const n = op.noteId ? numbers.get(op.noteId) : undefined;
    const note = op.noteId ? noteById.get(op.noteId) : undefined;
    if (n && note?.text) parts.push({ quote: `Note ${n}: ${note.text}` });

    const inBlock = blockIdIn(op.selector);
    const insideChange = inBlock ? blockChange.get(inBlock) : undefined;
    const where = insideChange
      ? `Inside the block added in change ${insideChange}. Already included in that block’s HTML; nothing extra to do.`
      : `Element: ${target(op)} — selector \`${op.selector}\``;

    let title: string;
    switch (op.kind) {
      case 'text': {
        title = `Change the text of ${target(op)}`;
        parts.push({ p: where });
        if (!insideChange) {
          parts.push({ p: `Was: “${plainText(op.before.html, doc)}”` });
          parts.push({ p: 'New content:' }, { code: prettyHtml(op.after.html, doc) || plainText(op.after.html, doc), lang: 'html' });
        }
        break;
      }
      case 'style': {
        const props = Object.keys(op.after);
        title = `Restyle ${target(op)} (${props.join(', ')})`;
        parts.push({ p: where });
        if (!insideChange) {
          const decls = props.map((p) => [p, op.after[p].value || 'initial'] as [string, string]);
          parts.push({ code: cssRule(op.selector, decls), lang: 'css' });
        }
        break;
      }
      case 'hide':
        title = `Hide ${target(op)}`;
        parts.push({ p: where });
        if (!insideChange) parts.push({ code: cssRule(op.selector, [['display', 'none']]), lang: 'css' });
        break;
      case 'move': {
        const up = op.after.index < op.before.index;
        title = `Move ${target(op)} ${up ? 'up' : 'down'} one place`;
        parts.push({ p: where });
        if (!insideChange) {
          parts.push({
            p: `In the page’s markup, move this element ${up ? 'before the element just above it' : 'after the element just below it'} (position ${op.before.index + 1} → ${op.after.index + 1} among its parent’s children).`,
          });
        }
        break;
      }
      case 'image': {
        const file = input.imageName?.(op.after.assetId);
        const fileText = file ? `“${file}”` : 'the new image (sent with this list)';
        if (op.after.mode === 'bg') {
          title = `Replace the background image of ${target(op)}`;
          parts.push({ p: where }, { p: `Use ${fileText} as the background image:` });
          parts.push({ code: cssRule(op.selector, [['background-image', `url("${file ?? 'new-image.jpg'}")`]]), lang: 'css' });
        } else {
          title = `Replace the image ${target(op)}`;
          parts.push({ p: where }, { p: `Replace the image file with ${fileText}. Keep the same size and alt text, and remove any srcset so the new image is used everywhere.` });
        }
        break;
      }
      case 'insertBlock': {
        const html = input.blockHtml?.(op) ?? op.after.html;
        title = `Add ${op.after.label}`;
        const fixed = op.fallback.tag === 'body' && op.after.position === 'beforeend';
        parts.push({
          p: fixed
            ? 'Add this just before </body>. It is fixed to the corner of the screen, so it shows on every page it is added to.'
            : `Add this ${POS_TEXT[op.after.position]} ${op.fallback.tag === 'body' ? 'the page (<body>)' : `${target(op)} — selector \`${op.selector}\``}.`,
        });
        parts.push({ p: `Styles are inline, so it needs no extra CSS.${/\shref=/.test(html) ? ' Point the link (href) at the real phone number or page.' : ''}` });
        parts.push({ code: prettyHtml(html, doc), lang: 'html' });
        break;
      }
      case 'animation': {
        const a = op.after;
        title = describeOp(op);
        parts.push({ p: where });
        if (a.type === 'entrance' && a.trigger === 'view') {
          parts.push({ p: 'Add the attribute data-gu-animate to this element, add this CSS, and add the scroll script at the end of this list once per page.' });
        } else {
          parts.push({ p: 'Add this CSS. It respects visitors who ask for reduced motion.' });
        }
        parts.push({ code: animationCss(op.selector, a, `gu-${a.preset}-${i + 1}`), lang: 'css' });
        break;
      }
    }
    return { title: `${i + 1}. ${title}${n ? ` [note ${n}]` : ''}`, parts };
  });
  if (input.ops.some((o) => o.kind === 'animation' && o.after.type === 'entrance' && o.after.trigger === 'view')) {
    list.push({
      title: 'Scroll script (once per page)',
      parts: [
        { p: 'Needed by the “when scrolled into view” animations above. Add it once, just before </body>. Without it the content simply shows, never stays hidden.' },
        { code: VIEW_SCRIPT, lang: 'html' },
      ],
    });
  }
  return list;
}

function intro(input: ChangeListInput): string[] {
  const lines = [`Page: ${input.url}`, `Prepared${input.agency ? ` by ${input.agency}` : ''} on ${input.date}`];
  lines.push(
    `${input.ops.length} change${input.ops.length === 1 ? '' : 's'}. Make them in order: each one was made with the ones before it already in place.`,
    'CSS snippets use the selectors Glow-Up used. If a rule doesn’t take effect, the theme’s own CSS is more specific: use a more specific selector or add !important.',
  );
  return lines;
}

export function changeListMarkdown(input: ChangeListInput, doc: Document = document): string {
  const out: string[] = [`# Change list: ${input.title}`, '', ...intro(input).map((l) => l + '  '), ''];
  for (const it of items(input, doc)) {
    out.push(`## ${it.title}`, '');
    for (const part of it.parts) {
      if ('quote' in part) out.push(`> ${part.quote}`, '');
      else if ('p' in part) out.push(part.p, '');
      else out.push('```' + part.lang, part.code, '```', '');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}

export function changeListText(input: ChangeListInput, doc: Document = document): string {
  const rule = '='.repeat(60);
  const out: string[] = [`CHANGE LIST: ${input.title}`, rule, ...intro(input), ''];
  for (const it of items(input, doc)) {
    out.push(it.title.replace(/`/g, ''), '-'.repeat(Math.min(60, it.title.length)));
    for (const part of it.parts) {
      if ('quote' in part) out.push(`  ${part.quote}`);
      else if ('p' in part) out.push(part.p.replace(/`/g, ''));
      else out.push('', ...part.code.split('\n').map((l) => '    ' + l), '');
    }
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}
