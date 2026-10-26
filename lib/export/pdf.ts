// Minimal PDF writer: one JPEG image per page, generated locally (SPEC.md Phase 3). Pages are
// rendered to a canvas first (layout, text, pins), so all a PDF needs is to place each image on
// its own page. Small enough that no PDF library has to be bundled.

export interface PdfPage {
  /** Baseline JPEG bytes. */
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
}

/** Page width in points (A4 landscape width); height follows each image's aspect ratio. */
const PAGE_WIDTH_PT = 842;

const enc = new TextEncoder();

/** PDF text string: plain ASCII literal when possible, else UTF-16BE hex with a BOM. */
function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, '\\$&')})`;
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

export function buildPdf(pages: PdfPage[], info: { title?: string; author?: string } = {}): Uint8Array<ArrayBuffer> {
  if (!pages.length) throw new Error('A PDF needs at least one page.');
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    size += bytes.length;
  };
  const obj = (n: number, body: string | (string | Uint8Array)[]) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    for (const part of Array.isArray(body) ? body : [body]) push(part);
    push('\nendobj\n');
  };

  // Objects: 1 catalog, 2 page tree, 3 info, then 3 per page (page, content stream, image).
  const first = 4;
  const pageNums = pages.map((_, i) => first + i * 3);
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const infoParts = [`/Producer ${pdfString('Website Glow-Up')}`];
  if (info.title) infoParts.push(`/Title ${pdfString(info.title)}`);
  if (info.author) infoParts.push(`/Author ${pdfString(info.author)}`);
  obj(3, `<< ${infoParts.join(' ')} >>`);

  pages.forEach((pg, i) => {
    const n = pageNums[i];
    const w = PAGE_WIDTH_PT;
    const h = Math.round((PAGE_WIDTH_PT * pg.height) / pg.width);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    obj(n + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(n + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`,
      pg.jpeg,
      '\nendstream',
    ]);
  });

  const count = first + pages.length * 3;
  const xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
