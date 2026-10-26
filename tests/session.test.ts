import { describe, expect, it } from 'vitest';
import { createHideOp, createImageOp, createMoveOp, createStyleOp, createTextOp } from '../lib/model/ops';
import { buildSelector, fingerprint } from '../lib/model/selector';
import { EditSession } from '../lib/model/session';
import type { Op } from '../lib/model/types';

const ctx = { getAsset: (id: string) => (id === 'img1' ? 'data:image/png;base64,AAAA' : undefined) };

const SITE = `
  <header id="site-header"><a href="/">Acme Plumbing</a><nav><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>
  <main>
    <section class="hero"><h1>Plumbing done right</h1><p>Family run since 1990.</p><img src="/hero.jpg" alt="Van"></section>
    <ul class="features"><li>Fast</li><li>Friendly</li><li>Fair</li></ul>
    <div class="promo">Spring sale</div>
  </main>
  <footer><p>© Acme</p></footer>`;

function load(html = SITE): Document {
  document.body.innerHTML = html;
  return document;
}

/** Simulates a user editing session and returns the saved ops (JSON round-trip, like storage). */
function editSite(): Op[] {
  const doc = load();
  const s = new EditSession(doc, [], ctx);
  const h1 = doc.querySelector('h1')!;
  s.commit(createStyleOp(h1, { color: '#112233', 'font-size': '48px' }));

  const p = doc.querySelector('.hero p')!;
  const target = { selector: buildSelector(p), fallback: fingerprint(p) };
  const before = p.innerHTML;
  p.innerHTML = 'Family run since 1990. <b>Call 555-0100</b>';
  s.commit(createTextOp(p, before, p.innerHTML, target), { alreadyApplied: true });

  s.commit(createHideOp(doc.querySelector('.promo')!));
  s.commit(createMoveOp(doc.querySelectorAll('.features li')[2], 'up')!);
  s.commit(createImageOp(doc.querySelector('img')!, 'img1', 'img'));
  return JSON.parse(JSON.stringify(s.getOps()));
}

function snapshot(doc: Document) {
  return doc.body.innerHTML;
}

describe('EditSession: re-apply on reload', () => {
  it('replays saved ops onto a freshly loaded page and reproduces the edited page', () => {
    const ops = editSite();
    const edited = snapshot(document);

    const fresh = load();
    const s = new EditSession(fresh, ops, ctx);
    const res = s.replay();
    expect(res.failed).toHaveLength(0);
    expect(res.applied).toHaveLength(5);
    expect(snapshot(fresh)).toBe(edited);
  });

  it('still re-applies when the page changed a bit (banner inserted, classes shuffled)', () => {
    const ops = editSite();
    const changed = SITE.replace('<main>', '<div class="cookie">We use cookies</div><main>').replace(
      '<section class="hero">',
      '<section class="hero hero--v2">',
    );
    const doc = load(changed);
    const res = new EditSession(doc, ops, ctx).replay();
    expect(res.failed).toHaveLength(0);
    expect(doc.querySelector('h1')!.style.color).toBe('rgb(17, 34, 51)');
    expect(doc.querySelector('.hero p')!.innerHTML).toContain('Call 555-0100');
    expect((doc.querySelector('.promo') as HTMLElement).style.display).toBe('none');
    expect(Array.from(doc.querySelectorAll('.features li')).map((l) => l.textContent)).toEqual(['Fast', 'Fair', 'Friendly']);
  });

  it('reports ops whose element is gone as failed instead of failing silently', () => {
    const ops = editSite();
    const doc = load(SITE.replace('<div class="promo">Spring sale</div>', ''));
    const s = new EditSession(doc, ops, ctx);
    const res = s.replay();
    expect(res.failed.map((o) => o.kind)).toEqual(['hide']);
    expect(s.getStatus(res.failed[0].id)).toBe('failed');
    expect(s.failedOps()).toHaveLength(1);
    // Others still applied.
    expect(res.applied).toHaveLength(4);
  });

  it('reports an image op as failed when its image is missing from storage', () => {
    const ops = editSite();
    const doc = load();
    const res = new EditSession(doc, ops, { getAsset: () => undefined }).replay();
    expect(res.failed.map((o) => o.kind)).toEqual(['image']);
  });

  it('retryFailed picks up content that loaded late', () => {
    const ops = editSite();
    const doc = load(SITE.replace('<div class="promo">Spring sale</div>', ''));
    const s = new EditSession(doc, ops, ctx);
    s.replay();
    doc.querySelector('main')!.insertAdjacentHTML('beforeend', '<div class="promo">Spring sale</div>');
    expect(s.retryFailed()).toBe(1);
    expect(s.failedOps()).toHaveLength(0);
    expect((doc.querySelector('.promo') as HTMLElement).style.display).toBe('none');
  });

  it('removeFailed drops only failed ops', () => {
    const ops = editSite();
    const doc = load(SITE.replace('<div class="promo">Spring sale</div>', ''));
    const s = new EditSession(doc, ops, ctx);
    s.replay();
    expect(s.removeFailed()).toBe(1);
    expect(s.getOps()).toHaveLength(4);
  });
});

describe('EditSession: undo / redo', () => {
  it('undoes and redoes every op kind back to the exact original DOM', () => {
    const original = snapshot(load());
    const ops = editSite();
    const doc = load();
    const s = new EditSession(doc, ops, ctx);
    s.replay();
    const edited = snapshot(doc);
    while (s.canUndo()) s.undo();
    expect(snapshot(doc)).toBe(original);
    while (s.canRedo()) s.redo();
    expect(snapshot(doc)).toBe(edited);
  });

  it('a new edit clears the redo stack', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    const h1 = doc.querySelector('h1')!;
    s.commit(createStyleOp(h1, { color: 'red' }));
    s.undo();
    expect(s.canRedo()).toBe(true);
    s.commit(createStyleOp(h1, { color: 'blue' }));
    expect(s.canRedo()).toBe(false);
  });

  it('coalesces a run of edits with the same key into one undo step', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    const h1 = doc.querySelector('h1')!;
    for (const c of ['#100000', '#200000', '#300000']) s.commit(createStyleOp(h1, { color: c }), { coalesceKey: 'drag1' });
    expect(s.getOps()).toHaveLength(1);
    expect(h1.style.color).toBe('rgb(48, 0, 0)');
    s.undo();
    expect(h1.getAttribute('style')).toBeNull();
  });

  it('does not coalesce across different keys', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    const h1 = doc.querySelector('h1')!;
    s.commit(createStyleOp(h1, { color: 'red' }), { coalesceKey: 'a' });
    s.commit(createStyleOp(h1, { color: 'blue' }), { coalesceKey: 'b' });
    expect(s.getOps()).toHaveLength(2);
  });

  it('handles a style edit on a child after its parent text was rewritten', () => {
    const doc = load('<p>Hello <b>world</b></p>');
    const s = new EditSession(doc, [], ctx);
    const p = doc.querySelector('p')!;
    const target = { selector: buildSelector(p), fallback: fingerprint(p) };
    const before = p.innerHTML;
    p.innerHTML = 'Hi <b>world</b>';
    s.commit(createTextOp(p, before, p.innerHTML, target), { alreadyApplied: true });
    s.commit(createStyleOp(doc.querySelector('b')!, { color: 'red' }));
    s.undo();
    s.undo();
    expect(doc.body.innerHTML).toBe('<p>Hello <b>world</b></p>');
    s.redo();
    s.redo();
    expect(doc.querySelector('b')!.style.color).toBe('red');
    expect(p.textContent).toBe('Hi world');
  });
});

describe('EditSession: reassert (site re-renders after load)', () => {
  it('re-applies an image the site swapped back, and a style it wiped', () => {
    const ops = editSite();
    const doc = load();
    const s = new EditSession(doc, ops, ctx);
    s.replay();
    const img = doc.querySelector('img')!;
    img.setAttribute('src', '/hero.jpg'); // e.g. a responsive-image script
    img.setAttribute('srcset', '/hero@2x.jpg 2x');
    doc.querySelector('h1')!.removeAttribute('style'); // e.g. a framework re-render
    expect(s.reassert()).toBe(2);
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(doc.querySelector('h1')!.style.color).toBe('rgb(17, 34, 51)');
    expect(s.reassert()).toBe(0);
  });

  it('re-applies text the site re-rendered, and finds a replaced element', () => {
    const ops = editSite();
    const doc = load();
    const s = new EditSession(doc, ops, ctx);
    s.replay();
    const old = doc.querySelector('.hero p')!;
    const fresh = doc.createElement('p');
    fresh.textContent = 'Family run since 1990.';
    old.replaceWith(fresh); // hydration swapped the node
    expect(s.reassert()).toBe(1);
    expect(doc.querySelector('.hero p')!.innerHTML).toContain('Call 555-0100');
  });

  it('never lets an older op undo a newer one on the same property', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    const h1 = doc.querySelector('h1')!;
    s.commit(createStyleOp(h1, { color: '#ff0000', 'font-size': '30px' }));
    s.commit(createStyleOp(h1, { color: '#0000ff' }));
    expect(s.reassert()).toBe(0);
    expect(h1.style.color).toBe('rgb(0, 0, 255)');
    h1.removeAttribute('style');
    s.reassert();
    expect(h1.style.color).toBe('rgb(0, 0, 255)');
    expect(h1.style.fontSize).toBe('30px');
  });

  it('does not fight a text op on a parent after a style op on a child', () => {
    const doc = load('<p>Hello <b>world</b></p>');
    const s = new EditSession(doc, [], ctx);
    const p = doc.querySelector('p')!;
    const target = { selector: buildSelector(p), fallback: fingerprint(p) };
    const before = p.innerHTML;
    p.innerHTML = 'Hi <b>world</b>';
    s.commit(createTextOp(p, before, p.innerHTML, target), { alreadyApplied: true });
    s.commit(createStyleOp(doc.querySelector('b')!, { color: 'red' }));
    expect(s.reassert()).toBe(0);
  });

  it('gives up on an element the page keeps changing', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    const h1 = doc.querySelector('h1')!;
    s.commit(createStyleOp(h1, { color: 'red' }));
    let total = 0;
    for (let i = 0; i < 40; i++) {
      h1.removeAttribute('style');
      total += s.reassert();
    }
    expect(total).toBe(25);
  });

  it('does nothing while showing Before', () => {
    const ops = editSite();
    const doc = load();
    const s = new EditSession(doc, ops, ctx);
    s.replay();
    s.showBefore();
    expect(s.reassert()).toBe(0);
  });
});

describe('EditSession: Before / After', () => {
  it('switches all ops off and on', () => {
    const original = snapshot(load());
    const ops = editSite();
    const doc = load();
    const s = new EditSession(doc, ops, ctx);
    s.replay();
    const edited = snapshot(doc);
    s.showBefore();
    expect(s.view).toBe('before');
    expect(snapshot(doc)).toBe(original);
    s.showAfter();
    expect(snapshot(doc)).toBe(edited);
    expect(s.toggleView()).toBe('before');
    expect(s.toggleView()).toBe('after');
    expect(snapshot(doc)).toBe(edited);
  });

  it('blocks editing and undo while showing Before', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    s.commit(createHideOp(doc.querySelector('.promo')!));
    s.showBefore();
    expect(s.canUndo()).toBe(false);
    expect(() => s.commit(createHideOp(doc.querySelector('h1')!))).toThrow();
  });

  it('notifies listeners on change', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    let n = 0;
    s.onChange(() => n++);
    s.commit(createHideOp(doc.querySelector('.promo')!));
    s.undo();
    s.redo();
    s.toggleView();
    expect(n).toBe(4);
  });
});
