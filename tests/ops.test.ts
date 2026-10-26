import { describe, expect, it } from 'vitest';
import {
  applyOp,
  createHideOp,
  createImageOp,
  createMoveOp,
  createStyleOp,
  createTextOp,
  revertOp,
} from '../lib/model/ops';
import { buildSelector, fingerprint } from '../lib/model/selector';
import { sanitizeHtml } from '../lib/model/sanitize';

const ctx = { getAsset: (id: string) => (id === 'img1' ? 'data:image/png;base64,AAAA' : undefined) };

function page(html: string) {
  document.body.innerHTML = html;
  return document;
}

describe('style op', () => {
  it('applies with !important and reverts to the original inline style', () => {
    const doc = page('<p style="color: blue">x</p>');
    const p = doc.querySelector('p')!;
    const op = createStyleOp(p, { color: '#ff0000', 'font-size': '20px' });
    applyOp(p, op, ctx);
    expect(p.style.getPropertyValue('color')).toBe('rgb(255, 0, 0)');
    expect(p.style.getPropertyPriority('color')).toBe('important');
    expect(p.style.getPropertyValue('font-size')).toBe('20px');
    revertOp(p, op);
    expect(p.getAttribute('style')).toBe('color: blue;');
  });
});

describe('hide op', () => {
  it('hides and restores', () => {
    const doc = page('<div>banner</div>');
    const d = doc.querySelector('div')!;
    const op = createHideOp(d);
    applyOp(d, op, ctx);
    expect(d.style.display).toBe('none');
    revertOp(d, op);
    expect(d.getAttribute('style')).toBeNull();
  });
});

describe('move op', () => {
  it('moves up and down among siblings and reverts', () => {
    const doc = page('<ul><li>a</li><li>b</li><li>c</li></ul>');
    const order = () => Array.from(doc.querySelectorAll('li')).map((l) => l.textContent).join('');
    const b = doc.querySelectorAll('li')[1];
    const up = createMoveOp(b, 'up')!;
    applyOp(b, up, ctx);
    expect(order()).toBe('bac');
    revertOp(b, up);
    expect(order()).toBe('abc');
    const down = createMoveOp(b, 'down')!;
    applyOp(b, down, ctx);
    expect(order()).toBe('acb');
  });

  it('returns null at the ends', () => {
    const doc = page('<ul><li>a</li><li>b</li></ul>');
    expect(createMoveOp(doc.querySelectorAll('li')[0], 'up')).toBeNull();
    expect(createMoveOp(doc.querySelectorAll('li')[1], 'down')).toBeNull();
  });
});

describe('text op', () => {
  it('keeps inline markup and sanitises the new html', () => {
    const doc = page('<p>Call <a href="/c">us</a></p>');
    const p = doc.querySelector('p')!;
    const target = { selector: buildSelector(p), fallback: fingerprint(p) };
    const before = p.innerHTML;
    const op = createTextOp(p, before, 'Phone <a href="/c">now</a><img src=x onerror="alert(1)"><script>x()</script>', target);
    expect(op.after.html).toBe('Phone <a href="/c">now</a><img src="x">');
    applyOp(p, op, ctx);
    expect(p.innerHTML).toBe('Phone <a href="/c">now</a><img src="x">');
    revertOp(p, op);
    expect(p.innerHTML).toBe(before);
  });
});

describe('sanitizeHtml', () => {
  it('drops javascript: urls and editor attributes', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)" contenteditable="true">x</a>')).toBe('<a>x</a>');
  });
});

describe('image op', () => {
  it('replaces an <img> including srcset and <picture> sources, then reverts', () => {
    const doc = page('<picture><source srcset="/big.webp"><img src="/a.jpg" srcset="/a2.jpg 2x" sizes="100vw"></picture>');
    const img = doc.querySelector('img')!;
    const op = createImageOp(img, 'img1', 'img');
    applyOp(img, op, ctx);
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(doc.querySelector('source')!.getAttribute('srcset')).toBe('data:image/png;base64,AAAA');
    revertOp(img, op);
    expect(img.getAttribute('src')).toBe('/a.jpg');
    expect(img.getAttribute('srcset')).toBe('/a2.jpg 2x');
    expect(img.getAttribute('sizes')).toBe('100vw');
    expect(doc.querySelector('source')!.getAttribute('srcset')).toBe('/big.webp');
  });

  it('replaces a background image', () => {
    const doc = page('<div class="hero"></div>');
    const d = doc.querySelector('div')!;
    const op = createImageOp(d, 'img1', 'bg');
    applyOp(d, op, ctx);
    expect(d.style.getPropertyValue('background-image')).toContain('data:image/png;base64,AAAA');
    revertOp(d, op);
    expect(d.style.getPropertyValue('background-image')).toBe('');
  });

  it('throws when the image is missing from storage', () => {
    const doc = page('<img src="/a.jpg">');
    const img = doc.querySelector('img')!;
    const op = createImageOp(img, 'missing', 'img');
    expect(() => applyOp(img, op, ctx)).toThrow();
  });
});
