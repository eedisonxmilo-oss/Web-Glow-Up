import { describe, expect, it } from 'vitest';
import { fileBase } from '../lib/editor/export-panel';
import { changeListMarkdown, changeListText, prettyHtml, type ChangeListInput } from '../lib/export/changelist';
import { buildPdf, dataUrlToBytes } from '../lib/export/pdf';
import { createHideOp, createInsertBlockOp, createMoveOp, createStyleOp, createTextOp } from '../lib/model/ops';
import { BLOCK_ATTR, buildSelector, fingerprint } from '../lib/model/selector';
import { EditSession } from '../lib/model/session';
import type { Note } from '../lib/model/types';
import { DEFAULT_AGENCY, normalizeAgency } from '../lib/settings';

const ctx = { getAsset: () => undefined };
const dec = new TextDecoder('latin1');

describe('agency settings', () => {
  it('fills defaults and drops malformed values', () => {
    expect(normalizeAgency(undefined)).toEqual(DEFAULT_AGENCY);
    expect(normalizeAgency({ name: 'Acme', accent: 'red', logo: 'javascript:x', layout: 'grid' })).toEqual({ ...DEFAULT_AGENCY, name: 'Acme' });
    expect(normalizeAgency({ accent: '#00AA11', logo: 'data:image/png;base64,AA', layout: 'stacked' })).toMatchObject({
      accent: '#00AA11',
      logo: 'data:image/png;base64,AA',
      layout: 'stacked',
    });
  });
});

describe('PDF writer', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

  it('writes a valid file: header, one page per image, correct xref offsets', () => {
    const bytes = buildPdf(
      [
        { jpeg, width: 2000, height: 1000 },
        { jpeg, width: 1000, height: 1000 },
      ],
      { title: 'Before / after: Acme (home)', author: 'Glow Agency' },
    );
    const s = dec.decode(bytes);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Count 2');
    expect(s).toContain('/MediaBox [0 0 842 421]');
    expect(s).toContain('/MediaBox [0 0 842 842]');
    expect(s).toContain('/Title (Before / after: Acme \\(home\\))');
    expect(s.match(/\/Filter \/DCTDecode/g)).toHaveLength(2);

    // Every xref entry must point at the start of its object.
    const startxref = Number(s.match(/startxref\n(\d+)/)![1]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');
    const entries = s.slice(startxref).split('\n').slice(3).filter((l) => / n $/.test(l));
    entries.forEach((line, i) => {
      const off = Number(line.slice(0, 10));
      expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('encodes non-ASCII titles as UTF-16', () => {
    const s = dec.decode(buildPdf([{ jpeg, width: 10, height: 10 }], { title: 'Café' }));
    expect(s).toContain('/Title <FEFF00430061006600E9>');
  });

  it('decodes data URLs to bytes', () => {
    expect(Array.from(dataUrlToBytes('data:image/jpeg;base64,/9j/'))).toEqual([0xff, 0xd8, 0xff]);
  });
});

describe('developer change list', () => {
  function build(): ChangeListInput {
    document.body.innerHTML = `
      <header><nav><a href="/">Home</a></nav></header>
      <main><section class="hero"><h1>Plumbing done right</h1><p>Family run.</p></section>
      <ul class="f"><li>Fast</li><li>Friendly</li></ul><div class="promo">Sale</div></main>`;
    const doc = document;
    const s = new EditSession(doc, [], ctx);
    const h1 = doc.querySelector('h1')!;
    const style = s.commit(createStyleOp(h1, { color: '#112233', 'font-size': '48px' }));
    const p = doc.querySelector('.hero p')!;
    const target = { selector: buildSelector(p), fallback: fingerprint(p) };
    p.innerHTML = 'Family run. <b>Call 555-0100</b>';
    s.commit(createTextOp(p, 'Family run.', p.innerHTML, target), { alreadyApplied: true });
    s.commit(createHideOp(doc.querySelector('.promo')!));
    s.commit(createMoveOp(doc.querySelectorAll('.f li')[1], 'up')!);
    const block = s.commit(
      createInsertBlockOp(doc.querySelector('.hero')!, {
        presetId: 'service-area',
        label: '“Serving [city]” badge',
        position: 'afterend',
        html: '<div style="padding:8px"><span style="color:#0a7d4f">Serving Springfield</span></div>',
      }),
    );
    const span = doc.querySelector(`[${BLOCK_ATTR}] span`)!;
    s.commit(createStyleOp(span, { 'font-weight': '700' }));
    const notes: Note[] = [
      { id: 'n1', text: 'Bigger, darker headline.', createdAt: 0 },
      { id: 'n2', text: 'Shows the area served at a glance.', createdAt: 0 },
    ];
    s.setNote(block.id, 'n2');
    s.setNote(style.id, 'n1');
    return {
      title: 'Acme Plumbing',
      url: 'https://acme.example/',
      date: '25 October 2026',
      agency: 'Glow Agency',
      ops: s.getOps(),
      notes,
      blockHtml: (op) => {
        const el = doc.querySelector(`[${BLOCK_ATTR}="${op.after.blockId}"]`)!.cloneNode(true) as Element;
        el.removeAttribute(BLOCK_ATTR);
        return el.outerHTML;
      },
    };
  }

  it('lists every change in order with copyable CSS / HTML and notes', () => {
    const md = changeListMarkdown(build());
    expect(md).toMatch(/^# Change list: Acme Plumbing/);
    expect(md).toContain('Prepared by Glow Agency on 25 October 2026');
    expect(md).toContain('6 changes.');
    const titles = md.match(/^## .*$/gm)!;
    expect(titles).toEqual([
      '## 1. Restyle <h1> “Plumbing done right” (color, font-size) [note 1]',
      '## 2. Change the text of <p> “Family run.”',
      '## 3. Hide <div> “Sale”',
      '## 4. Move <li> “Friendly” up one place',
      '## 5. Add “Serving [city]” badge [note 2]',
      '## 6. Restyle <span> “Serving Springfield” (font-weight)',
    ]);
    expect(md).toContain('> Note 1: Bigger, darker headline.');
    expect(md).toMatch(/```css\n.*h1.* \{\n {2}color: #112233;\n {2}font-size: 48px;\n\}\n```/);
    expect(md).toContain('<b>Call 555-0100</b>');
    expect(md).toMatch(/\{\n {2}display: none;\n\}/);
    expect(md).toContain('position 2 → 1');
    // The block's HTML includes the later edit inside it, and that edit says so.
    expect(md).toMatch(/<span style="[^"]*font-weight: 700[^"]*">Serving Springfield<\/span>/);
    expect(md).toContain('Inside the block added in change 5. Already included');
    expect(md).not.toContain(BLOCK_ATTR);
  });

  it('plain text version has no Markdown fences and indents code', () => {
    const txt = changeListText(build());
    expect(txt).not.toContain('```');
    expect(txt).toMatch(/^CHANGE LIST: Acme Plumbing/);
    expect(txt).toContain('    <div style="padding:8px">');
  });

  it('pretty-prints block HTML one element per line', () => {
    expect(prettyHtml('<div a="1"><span>Hi <b>x</b></span><img src="y"></div>', document)).toBe(
      ['<div a="1">', '  <span>', '    Hi', '    <b>x</b>', '  </span>', '  <img src="y">', '</div>'].join('\n'),
    );
  });
});

describe('export file names', () => {
  it('uses host, path and date', () => {
    const d = new Date(2026, 9, 5);
    expect(fileBase('https://www.acme.example/', d)).toBe('glowup-acme.example-2026-10-05');
    expect(fileBase('https://acme.example/services/drain cleaning', d)).toBe('glowup-acme.example-services-drain-cleaning-2026-10-05');
  });
});
