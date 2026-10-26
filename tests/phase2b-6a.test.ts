import { describe, expect, it } from 'vitest';
import { parseTranslate } from '../lib/editor/ui';
import { contrastLevel, contrastRatio, gaps, measure, smartGuides, spacingBands } from '../lib/editor/geometry';
import { filterCommands, type Command } from '../lib/editor/palette';
import { changeListMarkdown } from '../lib/export/changelist';
import { animationCss, clampAnimation, defaultEntrance, defaultHover, isAnimationRunning, VIEW_SCRIPT } from '../lib/model/animation';
import { createAnimationOp, createHideOp, createStyleOp } from '../lib/model/ops';
import { describeOp } from '../lib/model/project';
import { EditSession } from '../lib/model/session';
import type { Op } from '../lib/model/types';

const ctx = { getAsset: () => undefined };

function page(): Document {
  document.body.innerHTML = `<main><h1>Title</h1><ul class="cards"><li class="card">A</li><li class="card">B</li><li class="card">C</li></ul><p>Text</p></main>`;
  return document;
}

describe('grouped ops (one gesture on several elements = one undo step)', () => {
  it('undoes and redoes a group as one step', () => {
    const doc = page();
    const s = new EditSession(doc, [], ctx);
    s.commit(createStyleOp(doc.querySelector('h1')!, { color: '#ff0000' }));
    const cards = Array.from(doc.querySelectorAll('.card'));
    const ops = s.commitGroup(cards.map((c) => createStyleOp(c, { color: '#00ff00' })));
    expect(new Set(ops.map((o) => o.group)).size).toBe(1);
    expect(cards.every((c) => (c as HTMLElement).style.color === 'rgb(0, 255, 0)')).toBe(true);

    s.undo();
    expect(cards.every((c) => (c as HTMLElement).style.color === '')).toBe(true);
    expect((doc.querySelector('h1') as HTMLElement).style.color).toBe('rgb(255, 0, 0)');
    expect(s.getOps()).toHaveLength(1);

    s.redo();
    expect(s.getOps()).toHaveLength(4);
    expect(cards.every((c) => (c as HTMLElement).style.color === 'rgb(0, 255, 0)')).toBe(true);
  });

  it('a single op never carries a group id', () => {
    const doc = page();
    const s = new EditSession(doc, [], ctx);
    const [op] = s.commitGroup([createHideOp(doc.querySelector('p')!)]);
    expect(op.group).toBeUndefined();
  });

  it('coalesces a dragged group into one step, keeping each original "before"', () => {
    const doc = page();
    const s = new EditSession(doc, [], ctx);
    const cards = Array.from(doc.querySelectorAll('.card'));
    for (const px of [10, 20, 30]) s.commitGroup(cards.map((c) => createStyleOp(c, { translate: `${px}px 0px` })), { coalesceKey: 'nudge:1' });
    expect(s.getOps()).toHaveLength(3);
    expect((s.getOps()[0] as Extract<Op, { kind: 'style' }>).after.translate.value).toBe('30px 0px');
    expect((s.getOps()[0] as Extract<Op, { kind: 'style' }>).before.translate.value).toBe('');
    s.undo();
    expect(s.getOps()).toHaveLength(0);
    expect(cards.every((c) => !(c as HTMLElement).getAttribute('style'))).toBe(true);
  });

  it('a single commit does not merge into the last op of a group', () => {
    const doc = page();
    const s = new EditSession(doc, [], ctx);
    const cards = Array.from(doc.querySelectorAll('.card'));
    s.commitGroup(cards.map((c) => createStyleOp(c, { color: '#000000' })), { coalesceKey: 'k' });
    s.commit(createStyleOp(cards[2], { color: '#111111' }), { coalesceKey: 'k' });
    expect(s.getOps()).toHaveLength(4);
  });

  it('replays grouped ops on reload like any others', () => {
    let doc = page();
    const s = new EditSession(doc, [], ctx);
    s.commitGroup(Array.from(doc.querySelectorAll('.card')).map((c) => createStyleOp(c, { 'font-weight': '700' })));
    const ops = JSON.parse(JSON.stringify(s.getOps()));
    doc = page();
    const res = new EditSession(doc, ops, ctx).replay();
    expect(res.failed).toHaveLength(0);
    expect(Array.from(doc.querySelectorAll('.card')).every((c) => (c as HTMLElement).style.fontWeight === '700')).toBe(true);
  });
});

describe('animation ops (Phase 2B)', () => {
  it('clamps values to the spec limits (never above 1 s)', () => {
    const v = clampAnimation({ ...defaultEntrance(), duration: 5000, delay: -10 });
    expect(v).toMatchObject({ duration: 1000, delay: 0 });
    expect(clampAnimation({ ...defaultHover(), duration: 10 })).toMatchObject({ duration: 80 });
  });

  it('defaults follow the motion rules: ease-out entrances 300–500 ms, hover 150–200 ms', () => {
    const e = defaultEntrance();
    expect(e.duration).toBeGreaterThanOrEqual(300);
    expect(e.duration).toBeLessThanOrEqual(500);
    expect(e.easing).toMatch(/cubic-bezier|ease-out/);
    const h = defaultHover();
    expect(h.duration).toBeGreaterThanOrEqual(150);
    expect(h.duration).toBeLessThanOrEqual(200);
  });

  it('starts on apply, stops on Before / undo, restarts after a re-render', () => {
    const doc = page();
    const s = new EditSession(doc, [], ctx);
    const h1 = doc.querySelector('h1')!;
    const op = s.commit(createAnimationOp(h1, defaultHover('lift')));
    expect(isAnimationRunning(h1, op.id)).toBe(true);
    s.showBefore();
    expect(isAnimationRunning(h1, op.id)).toBe(false);
    s.showAfter();
    expect(isAnimationRunning(h1, op.id)).toBe(true);

    // The site re-renders the heading: the new element gets the animation back.
    const fresh = doc.createElement('h1');
    fresh.textContent = 'Title';
    h1.replaceWith(fresh);
    expect(s.reassert()).toBe(1);
    expect(isAnimationRunning(fresh, op.id)).toBe(true);

    s.undo();
    expect(isAnimationRunning(fresh, op.id)).toBe(false);
  });

  it('describes animations for the change list', () => {
    const doc = page();
    expect(describeOp(createAnimationOp(doc.querySelector('h1')!, { ...defaultEntrance('fade-in'), delay: 200 }))).toBe('Animated <h1> “Title”: Fade in when scrolled into view, 200 ms delay');
    expect(describeOp(createAnimationOp(doc.querySelector('h1')!, defaultHover('grow')))).toBe('Hover effect “Grow” on <h1> “Title”');
  });

  it('exports CSS that only animates transform and opacity, with reduced motion respected', () => {
    const css = animationCss('.card', { ...defaultEntrance('slide-up'), trigger: 'load' }, 'gu-slide-up-1');
    expect(css).toContain('@keyframes gu-slide-up-1');
    expect(css).toContain('from { opacity: 0; translate: 0 24px; }');
    expect(css).toMatch(/animation: gu-slide-up-1 450ms .* 0ms both;/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    // Nothing else is animated, and nothing loops.
    expect(css).not.toMatch(/width|height|top:|left:|margin|infinite/);

    const view = animationCss('.card', defaultEntrance('scale-in'), 'gu-scale-in-2');
    expect(view).toContain('.card.gu-pending');
    expect(view).toContain('.card.gu-in');

    const hover = animationCss('.btn', defaultHover('lift'), 'x');
    expect(hover).toContain('transition: translate 180ms ease-out;');
    expect(hover).toContain('.btn:hover {\n  translate: 0 -4px;\n}');
    expect(hover).toContain('prefers-reduced-motion');
  });

  it('the scroll script never leaves content hidden without it', () => {
    // Hidden state comes from a class the script itself adds.
    expect(VIEW_SCRIPT).toContain("classList.add('gu-pending')");
    expect(VIEW_SCRIPT).toContain("if (!('IntersectionObserver' in window)) return;");
  });

  it('change list includes keyframes, a staggered group and the scroll script once', () => {
    const doc = page();
    const s = new EditSession(doc, [], ctx);
    const cards = Array.from(doc.querySelectorAll('.card'));
    s.commitGroup(cards.map((c, i) => createAnimationOp(c, { ...defaultEntrance('slide-up'), delay: i * 100 })));
    s.commit(createAnimationOp(doc.querySelector('h1')!, defaultHover('lift')));
    const md = changeListMarkdown({ title: 'T', url: 'https://x.example/', date: 'today', ops: s.getOps(), notes: [] }, doc);
    expect(md.match(/@keyframes/g)).toHaveLength(3);
    expect(md).toContain('100 ms delay');
    expect(md).toContain('200 ms delay');
    expect(md.match(/Scroll script \(once per page\)/g)).toHaveLength(1);
    expect(md).toContain('data-gu-animate');
  });
});

describe('editor geometry (6A)', () => {
  it('measures the gap between separate elements', () => {
    expect(measure({ left: 0, top: 0, width: 100, height: 50 }, { left: 130, top: 10, width: 50, height: 20 })).toEqual([{ x1: 100, y1: 20, x2: 130, y2: 20, label: '30' }]);
    const v = measure({ left: 0, top: 0, width: 100, height: 50 }, { left: 0, top: 74, width: 100, height: 20 });
    expect(v.map((s) => s.label)).toEqual(['24']);
  });

  it('measures an element inside another from each edge', () => {
    const segs = measure({ left: 20, top: 10, width: 60, height: 30 }, { left: 0, top: 0, width: 100, height: 100 });
    expect(segs.map((s) => s.label).sort()).toEqual(['10', '20', '20', '60']);
  });

  it('checks equal spacing across several elements', () => {
    const row = [0, 120, 240].map((left) => ({ left, top: 0, width: 100, height: 40 }));
    expect(gaps(row)).toMatchObject({ equal: true });
    expect(gaps(row).segs.map((s) => s.label)).toEqual(['20', '20']);
    expect(gaps([...row.slice(0, 2), { left: 250, top: 0, width: 100, height: 40 }]).equal).toBe(false);
  });

  it('smart guides snap to a nearby edge or centre', () => {
    // The moving box's right edge (98) is 2px from the other box's left edge (100).
    const r = smartGuides({ left: 0, top: 0, width: 98, height: 10 }, [{ left: 100, top: 50, width: 50, height: 10 }]);
    expect(r.snapX).toBe(2);
    expect(r.guides[0]).toMatchObject({ axis: 'x', at: 100 });
    // Nothing within 4px: no snap, no guide.
    const far = smartGuides({ left: 0, top: 0, width: 80, height: 10 }, [{ left: 100, top: 50, width: 50, height: 10 }], 4);
    expect(far.snapX).toBe(0);
    expect(far.guides).toHaveLength(0);
  });

  it('builds margin bands outside and padding bands inside the border', () => {
    const bands = spacingBands({ left: 100, top: 100, width: 200, height: 100 }, { top: 10, right: 0, bottom: 0, left: 20 }, { top: 8, right: 8, bottom: 8, left: 8 }, { top: 2, right: 2, bottom: 2, left: 2 });
    const marginTop = bands.find((b) => b.kind === 'margin' && b.side === 'top')!;
    expect(marginTop.box).toEqual({ left: 100, top: 90, width: 200, height: 10 });
    const padLeft = bands.find((b) => b.kind === 'padding' && b.side === 'left')!;
    expect(padLeft.box).toMatchObject({ left: 102, width: 8 });
    expect(bands.filter((b) => b.kind === 'margin')).toHaveLength(2);
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrastLevel(4.6)).toBe('AA');
    expect(contrastLevel(3.2)).toBe('Low');
    expect(contrastLevel(3.2, true)).toBe('AA');
  });

  it('reads CSS translate values', () => {
    expect(parseTranslate('none')).toEqual([0, 0]);
    expect(parseTranslate('12px')).toEqual([12, 0]);
    expect(parseTranslate('12px -4px')).toEqual([12, -4]);
  });
});

describe('command palette', () => {
  const cmds = ['Undo', 'Redo', 'Select all like this', 'Copy style', 'Paste style', 'Export PDF'].map(
    (title, i): Command => ({ id: String(i), title, group: i > 4 ? 'Export' : 'Edit', run: () => undefined }),
  );
  it('matches every word, best (prefix) matches first', () => {
    expect(filterCommands(cmds, 'style').map((c) => c.title)).toEqual(['Copy style', 'Paste style']);
    expect(filterCommands(cmds, 'paste').map((c) => c.title)).toEqual(['Paste style']);
    expect(filterCommands(cmds, 'sel like').map((c) => c.title)).toEqual(['Select all like this']);
    expect(filterCommands(cmds, 'export')[0].title).toBe('Export PDF');
    expect(filterCommands(cmds, '')).toHaveLength(6);
  });
});
