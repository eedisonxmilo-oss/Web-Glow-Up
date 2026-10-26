import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureBrand, onColor } from '../lib/brand';
import { GlowUp, type EditorStore } from '../lib/editor/controller';
import { createInsertBlockOp, createStyleOp, createTextOp } from '../lib/model/ops';
import { describeOp, noteNumbers } from '../lib/model/project';
import { BLOCK_ATTR, buildSelector, fingerprint } from '../lib/model/selector';
import { EditSession } from '../lib/model/session';
import type { Op, Project } from '../lib/model/types';
import { brandStyle, defaultValues, esc, getPreset, linkFor, PRESETS } from '../lib/presets';

const ctx = { getAsset: () => undefined };

const SITE = `
  <header id="top"><a href="/">Acme Plumbing</a><nav><a href="/contact">Contact</a></nav></header>
  <main>
    <section class="hero"><h1>Plumbing done right</h1><p>Family run since 1990.</p></section>
    <form><button class="add-to-cart" type="submit">Add to cart</button></form>
  </main>
  <footer><p>Acme</p></footer>`;

function load(html = SITE): Document {
  document.body.innerHTML = html;
  return document;
}

const BLOCK = '<div style="padding:8px;background:#eef"><span>Serving Springfield</span></div>';

describe('insertBlock ops', () => {
  it('inserts, undoes, redoes and toggles Before/After', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    const hero = doc.querySelector('.hero')!;
    const op = s.commit(createInsertBlockOp(hero, { presetId: 'service-area', label: 'Badge', position: 'afterend', html: BLOCK }));
    const block = hero.nextElementSibling!;
    expect(block.getAttribute(BLOCK_ATTR)).toBe((op as Extract<Op, { kind: 'insertBlock' }>).after.blockId);
    expect(block.textContent).toBe('Serving Springfield');
    expect(s.changedElement(op)).toBe(block);

    s.showBefore();
    expect(doc.querySelector(`[${BLOCK_ATTR}]`)).toBeNull();
    s.showAfter();
    expect(doc.querySelectorAll(`[${BLOCK_ATTR}]`)).toHaveLength(1);

    s.undo();
    expect(doc.querySelector(`[${BLOCK_ATTR}]`)).toBeNull();
    s.redo();
    expect(doc.querySelectorAll(`[${BLOCK_ATTR}]`)).toHaveLength(1);
  });

  it('supports all four positions and refuses to go outside <body>', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    const p = doc.querySelector('.hero p')!;
    for (const position of ['beforebegin', 'afterbegin', 'beforeend', 'afterend'] as const) {
      s.commit(createInsertBlockOp(p, { presetId: 'x', label: position, position, html: `<b>${position}</b>` }));
    }
    const hero = doc.querySelector('.hero')!;
    expect(Array.from(hero.children).map((c) => c.tagName + (c.tagName === 'B' ? `:${c.textContent}` : ''))).toEqual(['H1', 'B:beforebegin', 'P', 'B:afterend']);
    expect(Array.from(p.children).map((c) => c.textContent)).toEqual(['afterbegin', 'beforeend']);
    expect(() => createInsertBlockOp(doc.body, { presetId: 'x', label: 'x', position: 'afterend', html: '<b>x</b>' })).toThrow();
  });

  it('strips scripts and event handlers from block HTML', () => {
    const doc = load();
    const op = createInsertBlockOp(doc.body, {
      presetId: 'x',
      label: 'x',
      position: 'afterbegin',
      html: '<div onclick="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">hi</a></div>',
    });
    expect(op.after.html).not.toMatch(/onclick|script|javascript/);
  });

  it('re-applies on reload, including text edits made inside the block', () => {
    let doc = load();
    const s = new EditSession(doc, [], ctx);
    s.commit(createInsertBlockOp(doc.querySelector('.hero')!, { presetId: 'x', label: 'Badge', position: 'afterend', html: BLOCK }));
    const span = doc.querySelector(`[${BLOCK_ATTR}] span`)!;
    const target = { selector: buildSelector(span), fallback: fingerprint(span) };
    expect(target.selector.startsWith(`[${BLOCK_ATTR}=`) || target.selector.includes(BLOCK_ATTR)).toBe(true);
    const before = span.innerHTML;
    span.innerHTML = 'Serving Shelbyville';
    s.commit(createTextOp(span, before, span.innerHTML, target), { alreadyApplied: true });
    s.commit(createStyleOp(doc.querySelector('h1')!, { color: '#ff0000' }));
    const edited = doc.body.innerHTML;
    const ops: Op[] = JSON.parse(JSON.stringify(s.getOps()));

    doc = load();
    const res = new EditSession(doc, ops, ctx).replay();
    expect(res.failed).toHaveLength(0);
    expect(doc.body.innerHTML).toBe(edited);
  });

  it('reports a block whose anchor is gone as couldn’t re-apply', () => {
    let doc = load();
    const s = new EditSession(doc, [], ctx);
    s.commit(createInsertBlockOp(doc.querySelector('.hero')!, { presetId: 'x', label: 'Badge', position: 'afterend', html: BLOCK }));
    const ops = JSON.parse(JSON.stringify(s.getOps()));
    doc = load(SITE.replace(/<section class="hero">.*?<\/section>/, ''));
    const res = new EditSession(doc, ops, ctx).replay();
    expect(res.failed).toHaveLength(1);
  });

  it('puts the block back when the site re-renders it away', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    s.commit(createInsertBlockOp(doc.querySelector('main')!, { presetId: 'x', label: 'Badge', position: 'afterbegin', html: BLOCK }));
    doc.querySelector(`[${BLOCK_ATTR}]`)!.remove();
    expect(s.reassert()).toBe(1);
    expect(doc.querySelectorAll(`[${BLOCK_ATTR}]`)).toHaveLength(1);
    expect(s.reassert()).toBe(0); // in effect, nothing to do
  });

  it('describes blocks in the change list', () => {
    const doc = load();
    const a = createInsertBlockOp(doc.body, { presetId: 'sticky-cta', label: 'Sticky button', position: 'beforeend', html: '<a>x</a>' });
    const b = createInsertBlockOp(doc.querySelector('h1')!, { presetId: 'x', label: 'Trust bar', position: 'afterend', html: '<a>x</a>' });
    expect(describeOp(a)).toBe('Added Sticky button');
    expect(describeOp(b)).toBe('Added Trust bar below <h1> “Plumbing done right”');
  });
});

describe('notes', () => {
  it('numbers notes in change order and links them through setNote', () => {
    const doc = load();
    const s = new EditSession(doc, [], ctx);
    const a = s.commit(createStyleOp(doc.querySelector('h1')!, { color: '#ff0000' }));
    const b = s.commit(createStyleOp(doc.querySelector('.hero p')!, { color: '#00ff00' }));
    const c = s.commit(createStyleOp(doc.querySelector('footer p')!, { color: '#0000ff' }));
    s.setNote(c.id, 'n_c');
    s.setNote(a.id, 'n_a');
    expect([...noteNumbers(s.getOps())]).toEqual([
      ['n_a', 1],
      ['n_c', 2],
    ]);
    s.setNote(b.id, 'n_b');
    expect(noteNumbers(s.getOps()).get('n_c')).toBe(3);
    s.setNote(a.id, undefined);
    expect(noteNumbers(s.getOps()).get('n_b')).toBe(1);
    // Notes ride along with undo/redo
    s.undo();
    expect(s.redoOps()[0].noteId).toBe('n_c');
    s.redo();
    expect(noteNumbers(s.getOps()).get('n_c')).toBe(2);
  });
});

describe('brand capture', () => {
  it('finds the accent, text, background, fonts and button style', () => {
    load(`
      <style>
        body { background: #ffffff; color: #222222; font-family: "Open Sans", Arial, sans-serif; }
        h1, h2 { font-family: Montserrat, sans-serif; color: #111111; }
        a { color: #0a7d4f; }
        .btn { background: #0a7d4f; color: #ffffff; border-radius: 6px; }
      </style>
      <h1>Heading here</h1>
      <p>Some body copy that is long enough to count as the main text of the page.</p>
      <p>More body copy. <a href="/x">A link</a></p>
      <a class="btn" href="/book">Book now</a>
      <button class="btn">Get a quote</button>`);
    const b = captureBrand(document);
    expect(b.accent).toBe('#0a7d4f');
    expect(b.colors[0]).toBe('#0a7d4f');
    expect(b.text).toBe('#222222');
    expect(b.background).toBe('#ffffff');
    expect(b.headingFont).toMatch(/Montserrat/);
    expect(b.bodyFont).toMatch(/Open Sans/);
    expect(b.button).toEqual({ background: '#0a7d4f', color: '#ffffff', radius: '6px' });
  });

  it('ignores blocks Glow-Up inserted', () => {
    load(`<p style="color:#333333">Text</p><div ${BLOCK_ATTR}="b1" style="background:#ff00aa"><a class="btn" style="background:#ff00aa">x</a></div>`);
    expect(captureBrand(document).colors).not.toContain('#ff00aa');
  });

  it('picks readable text colors', () => {
    expect(onColor('#0a7d4f')).toBe('#ffffff');
    expect(onColor('#ffd400')).toBe('#111111');
  });
});

describe('fix library presets', () => {
  const brand = brandStyle({ colors: ['#0a7d4f'], accent: '#0a7d4f', text: '#222222', background: '#ffffff', bodyFont: '"Open Sans", sans-serif' });

  it('has every preset from the spec', () => {
    const ids = PRESETS.map((p) => p.id);
    for (const id of ['trust-bar', 'sticky-cta', 'header-phone', 'hero', 'reviews', 'service-area', 'free-shipping', 'guarantee', 'add-to-cart']) {
      expect(ids).toContain(id);
    }
  });

  it('builds one root element per block preset, styled with the brand', () => {
    for (const p of PRESETS) {
      const r = p.build(brand, defaultValues(p));
      if ('styles' in r) {
        expect(r.styles['background-color']).toBe('#0a7d4f');
        continue;
      }
      const tpl = document.createElement('template');
      tpl.innerHTML = r.html;
      expect(tpl.content.children).toHaveLength(1);
      expect(r.html).toMatch(/#0a7d4f|Open Sans/);
    }
  });

  it('escapes what the user types', () => {
    const p = getPreset('service-area')!;
    const r = p.build(brand, { city: '<img src=x onerror=alert(1)>', suffix: '' }) as { html: string };
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain(esc('<img'));
  });

  it('turns phone numbers into tel: links and leaves other links usable', () => {
    expect(linkFor('(555) 010-0100')).toBe('tel:5550100100');
    expect(linkFor('+44 20 7946 0000')).toBe('tel:+442079460000');
    expect(linkFor('calendly.com/acme')).toBe('https://calendly.com/acme');
    expect(linkFor('#contact')).toBe('#contact');
  });

  it('note wording says what a fix does, never that the site has a problem (SPEC section 3)', () => {
    const problem = /\b(losing|lost|missing|problem|issue|bad|poor|broken|fail|lack|weak|wrong|hurting|costing|your site)\b/i;
    for (const p of PRESETS) {
      expect(p.note.length).toBeGreaterThan(0);
      expect(p.note).not.toMatch(problem);
    }
  });
});

describe('GlowUp controller: presets + notes + brand persist', () => {
  afterEach(() => vi.useRealTimers());

  function memoryStore() {
    const projects = new Map<string, Project>();
    const store: EditorStore = {
      getProject: async (url) => (projects.has(url) ? JSON.parse(JSON.stringify(projects.get(url))) : null),
      saveProject: async (p) => void projects.set(p.url, JSON.parse(JSON.stringify(p))),
      getAssets: async () => ({}),
      putAsset: async () => undefined,
      getAgency: async () => ({ name: '', logo: '', accent: '#6d28d9', layout: 'side' }),
      capture: async () => ({ error: 'no screenshots in tests' }),
    };
    return { store, projects };
  }

  it('adds three presets with notes, saves, and restores them on a fresh page', async () => {
    vi.useFakeTimers();
    load(`<style>body{color:#222222}.btn{background:#0a7d4f;color:#fff}</style>${SITE}<a class="btn">Book</a>`);
    const { store, projects } = memoryStore();
    const app = new GlowUp(store, document);
    await vi.runOnlyPendingTimersAsync();

    const hero = document.querySelector('.hero')!;
    app.applyPreset(getPreset('trust-bar')!, defaultValues(getPreset('trust-bar')!), { el: hero, position: 'afterend' }, getPreset('trust-bar')!.note);
    app.applyPreset(getPreset('sticky-cta')!, defaultValues(getPreset('sticky-cta')!), null, 'Sticky note');
    app.applyPreset(getPreset('add-to-cart')!, {}, { el: document.querySelector('.add-to-cart')!, position: 'beforeend' }, 'Cart note');
    expect(document.querySelectorAll(`[${BLOCK_ATTR}]`)).toHaveLength(2);
    expect((document.querySelector('.add-to-cart') as HTMLElement).style.backgroundColor).toBe('rgb(10, 125, 79)');
    const trustBar = document.querySelector(`[${BLOCK_ATTR}]`) as HTMLElement;
    expect(trustBar.outerHTML).toContain('color:#0a7d4f'); // check marks in the accent
    expect(trustBar.style.color).toBe('rgb(34, 34, 34)'); // page text color, not white-on-accent

    await vi.advanceTimersByTimeAsync(1000);
    const saved = [...projects.values()][0];
    expect(saved.versions[0].ops).toHaveLength(3);
    expect(saved.notes.map((n) => n.text)).toEqual([getPreset('trust-bar')!.note, 'Sticky note', 'Cart note']);
    expect(saved.brand?.accent).toBe('#0a7d4f');
    expect([...noteNumbers(saved.versions[0].ops).values()]).toEqual([1, 2, 3]);

    // Removing a note drops it from the project on the next save.
    app.removeNote(saved.notes[1].id);
    await vi.advanceTimersByTimeAsync(1000);
    expect([...projects.values()][0].notes.map((n) => n.text)).toEqual([getPreset('trust-bar')!.note, 'Cart note']);

    // Fresh page load: everything comes back.
    load(`<style>.btn{background:#0a7d4f;color:#fff}</style>${SITE}<a class="btn">Book</a>`);
    const again = new GlowUp(store, document);
    await vi.runOnlyPendingTimersAsync();
    expect(again.session.failedOps()).toHaveLength(0);
    expect(document.querySelectorAll(`[${BLOCK_ATTR}]`)).toHaveLength(2);
    expect(again.getNote(again.session.getOps()[2].noteId)?.text).toBe('Cart note');
  });
});
