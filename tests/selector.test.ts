import { beforeEach, describe, expect, it } from 'vitest';
import { buildSelector, cssEscape, fingerprint, isStableId, resolveTarget } from '../lib/model/selector';

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('isStableId', () => {
  it('accepts hand-written and CMS ids', () => {
    for (const id of ['hero', 'main-nav', 'comp-kfx8u7fy', 'shopify-section-template--1612__main', 'site_header']) {
      expect(isStableId(id), id).toBe(true);
    }
  });
  it('rejects generated ids', () => {
    for (const id of [':r1:', '«r3»', 'ember123', '12345', 'radix-:R1:', '3f2a9c1e-1b2c-4d5e-8f90-1234567890ab', 'el-9f8e7d6c5b4a']) {
      expect(isStableId(id), id).toBe(false);
    }
  });
});

describe('buildSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('prefers a stable unique id', () => {
    const doc = page('<div><h1 id="hero-title">Hi</h1></div>');
    expect(buildSelector(doc.querySelector('h1')!)).toBe('#hero-title');
  });

  it('skips generated ids and uses stable attributes', () => {
    const doc = page('<button id=":r5:" data-testid="buy">Buy</button><button>Other</button>');
    expect(buildSelector(doc.querySelector('[data-testid]')!)).toBe('button[data-testid="buy"]');
  });

  it('falls back to a structural path anchored on a stable ancestor', () => {
    const doc = page('<section id="pricing"><div><p>a</p><p>b</p></div></section>');
    const p = doc.querySelectorAll('p')[1];
    const sel = buildSelector(p);
    expect(sel).toBe('#pricing > div > p:nth-of-type(2)');
    expect(doc.querySelector(sel)).toBe(p);
  });

  it('anchors on body when nothing is stable', () => {
    const doc = page('<div><span>x</span></div><div><span>y</span></div>');
    const span = doc.querySelectorAll('span')[1];
    const sel = buildSelector(span);
    expect(sel).toBe('body > div:nth-of-type(2) > span');
    expect(doc.querySelector(sel)).toBe(span);
  });

  it('escapes awkward ids', () => {
    const doc = page('<div id="a.b:c">x</div>');
    const sel = buildSelector(doc.querySelector('div')!);
    expect(doc.querySelector(sel)).toBe(doc.querySelector('div'));
  });

  it('every element in a messy page gets a selector that finds it uniquely', () => {
    const doc = page(`
      <header id="top"><nav><a href="/">Home</a><a href="/about">About</a><a href="/about">About again</a></nav></header>
      <main><section class="hero"><h1>Title</h1><p>Lead</p><img src="/a.jpg?v=1" alt="Hero"></section>
      <ul><li>1</li><li>2</li><li><b>3</b></li></ul></main>
      <footer><p>a</p><p>b</p></footer>`);
    for (const el of Array.from(doc.body.querySelectorAll('*'))) {
      const sel = buildSelector(el);
      const found = doc.querySelectorAll(sel);
      expect(found.length, sel).toBe(1);
      expect(found[0], sel).toBe(el);
    }
  });
});

describe('cssEscape', () => {
  it('escapes leading digits', () => {
    expect(cssEscape('1a')).toBe('\\31 a');
  });
});

describe('resolveTarget', () => {
  it('finds the element by selector when the page is unchanged', () => {
    const doc = page('<div><p>One</p><p>Two</p></div>');
    const el = doc.querySelectorAll('p')[1];
    const sel = buildSelector(el);
    const fp = fingerprint(el);
    expect(resolveTarget(sel, fp, doc)).toEqual({ el, via: 'selector' });
  });

  it('uses the fingerprint when an inserted element shifts the structural path', () => {
    const doc = page('<div><p>Intro text</p><p>Call us today on 555-0100</p></div>');
    const el = doc.querySelectorAll('p')[1];
    const sel = buildSelector(el); // body > div > p:nth-of-type(2)
    const fp = fingerprint(el);
    // Reload: a cookie banner paragraph now comes first.
    page('<div><p>We use cookies</p><p>Intro text</p><p>Call us today on 555-0100</p></div>');
    const hit = resolveTarget(sel, fp, doc);
    expect(hit?.via).toBe('fingerprint');
    expect(hit?.el.textContent).toBe('Call us today on 555-0100');
  });

  it('uses the fingerprint when the id changed', () => {
    const doc = page('<h2 id="title-a" class="section-title">Our services</h2>');
    const el = doc.querySelector('h2')!;
    const sel = buildSelector(el);
    const fp = fingerprint(el);
    page('<h2 id="title-b" class="section-title">Our services</h2>');
    expect(resolveTarget(sel, fp, doc)?.el.textContent).toBe('Our services');
  });

  it('returns null when the element is gone', () => {
    const doc = page('<p id="gone">Limited offer</p>');
    const el = doc.querySelector('p')!;
    const sel = buildSelector(el);
    const fp = fingerprint(el);
    page('<p>Something else entirely</p>');
    expect(resolveTarget(sel, fp, doc)).toBeNull();
  });

  it('returns null rather than guessing between identical candidates', () => {
    const doc = page('<div><span>Item</span></div>');
    const el = doc.querySelector('span')!;
    const fp = fingerprint(el);
    page('<section><span>Item</span><span>Item</span></section>');
    expect(resolveTarget('#does-not-exist', fp, doc)).toBeNull();
  });

  it('rejects a selector hit with the wrong tag', () => {
    const doc = page('<p id="x">Hello there</p>');
    const fp = fingerprint(doc.querySelector('p')!);
    page('<div id="x">Hello there</div>');
    expect(resolveTarget('#x', fp, doc)).toBeNull();
  });
});
