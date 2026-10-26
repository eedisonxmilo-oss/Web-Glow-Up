// The "Export" tab (SPEC.md Phase 3): branded before/after PNG, PDF (one page per view) and the
// developer change list (.md / .txt). Everything is generated in the page and saved as a download;
// nothing is uploaded anywhere.

import { changeListMarkdown, changeListText } from '../export/changelist';
import { canvasToBlob, compose, type Shot } from '../export/compose';
import { buildPdf, dataUrlToBytes } from '../export/pdf';
import type { AgencySettings, ExportLayout } from '../settings';
import type { GlowUp } from './controller';
import type { ShadowHost } from './host';

const HTML = `
<p class="hint">Screenshots show what's on screen right now. Scroll the page to the part you want to show first.</p>
<div class="field"><span>Layout</span><div class="ctl radios">
  <label><input type="radio" name="exp-layout" value="side"> Side by side</label>
  <label><input type="radio" name="exp-layout" value="stacked"> Stacked</label>
</div></div>
<label class="check"><input type="checkbox" class="exp-notes" checked> Include numbered notes</label>
<button class="btn primary" data-exp="png">⬇ Before / after image (PNG)</button>
<button class="btn" data-exp="pdf">⬇ PDF, one page per view</button>
<h4>For developers</h4>
<div class="row2">
  <button class="btn" data-exp="md">⬇ Change list (.md)</button>
  <button class="btn" data-exp="txt">⬇ Change list (.txt)</button>
</div>
<p class="hint exp-status" aria-live="polite"></p>
<canvas class="exp-preview hidden"></canvas>
<p class="hint agency-line"></p>`;

export class ExportPanel {
  private layout: ExportLayout | null = null;
  private busy = false;
  private q: <T extends Element = HTMLElement>(sel: string) => T;

  constructor(
    private app: GlowUp,
    private host: ShadowHost,
    private root: HTMLElement,
  ) {
    root.innerHTML = HTML;
    this.q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    root.addEventListener('click', (e) => {
      const kind = (e.target as Element).closest<HTMLElement>('[data-exp]')?.dataset.exp;
      if (kind) void this.run(kind as 'png' | 'pdf' | 'md' | 'txt');
    });
    for (const r of Array.from(root.querySelectorAll<HTMLInputElement>('input[name="exp-layout"]'))) {
      r.addEventListener('change', () => r.checked && (this.layout = r.value as ExportLayout));
    }
    void this.refresh();
  }

  private get doc(): Document {
    return this.root.ownerDocument;
  }

  /** Re-read agency settings (they may have been changed in the popup) and update the tab. */
  async refresh(): Promise<void> {
    const a = await this.app.getAgency();
    if (!this.layout) this.layout = a.layout;
    for (const r of Array.from(this.root.querySelectorAll<HTMLInputElement>('input[name="exp-layout"]'))) r.checked = r.value === this.layout;
    this.q('.agency-line').textContent =
      a.name || a.logo
        ? `Branding: ${a.name || 'logo only'}${a.name && a.logo ? ' with logo' : ''}. Change it in the Glow-Up toolbar popup → Agency branding.`
        : 'No agency branding yet. Add your name, logo and color in the Glow-Up toolbar popup → Agency branding.';
    const hasOps = this.app.session.getOps().length > 0;
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-exp]'))) b.disabled = this.busy || !hasOps;
    const empty = 'Make a change first. There is nothing to compare yet.';
    if (!hasOps && !this.busy) this.status(empty);
    else if (this.q('.exp-status').textContent === empty) this.status('');
  }

  private status(text: string): void {
    this.q('.exp-status').textContent = text;
  }

  async run(kind: 'png' | 'pdf' | 'md' | 'txt'): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    void this.refresh();
    const agency = await this.app.getAgency();
    const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    const base = fileBase(this.app.pageUrl);
    try {
      if (kind === 'md' || kind === 'txt') {
        const input = this.app.changeListInput(agency, date);
        const text = kind === 'md' ? changeListMarkdown(input, this.doc) : changeListText(input, this.doc);
        this.download(new Blob([text], { type: kind === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' }), `${base}-changes.${kind}`);
        this.status(`Saved ${base}-changes.${kind}`);
        return;
      }
      this.status('Taking screenshots…');
      const shots = await this.app.captureBeforeAfter();
      this.status('Building the export…');
      if (kind === 'png') {
        const canvas = await this.composeAll(shots, agency, date);
        this.download(await canvasToBlob(canvas, 'image/png'), `${base}-before-after.png`);
        this.preview(canvas);
        this.status(`Saved ${base}-before-after.png`);
      } else {
        const pages = await this.composePages(shots, agency, date);
        const pdf = buildPdf(
          pages.map((c) => ({ jpeg: dataUrlToBytes(c.toDataURL('image/jpeg', 0.9)), width: c.width, height: c.height })),
          { title: `Before / after: ${this.app.projectTitle}`, author: agency.name || undefined },
        );
        this.download(new Blob([pdf], { type: 'application/pdf' }), `${base}-before-after.pdf`);
        this.preview(pages[1]);
        this.status(`Saved ${base}-before-after.pdf (${pages.length} pages)`);
      }
    } catch (e) {
      this.status('');
      this.host.toast((e as Error).message || 'Export failed.', { sticky: true });
    } finally {
      this.busy = false;
      void this.refresh();
    }
  }

  private legend(): { n: number; text: string }[] {
    if (!this.q<HTMLInputElement>('.exp-notes').checked) return [];
    return this.app.numberedNotes().map(({ n, text }) => ({ n, text }));
  }

  private composeAll(s: { before: Shot; after: Shot }, agency: AgencySettings, date: string) {
    const notes = this.q<HTMLInputElement>('.exp-notes').checked;
    return compose(
      {
        views: [
          { label: 'Before', shot: s.before, pins: false },
          { label: 'After', shot: s.after, pins: notes },
        ],
        arrange: this.layout === 'stacked' ? 'column' : 'row',
        agency,
        url: this.app.pageUrl,
        date,
        legend: this.legend(),
      },
      this.doc,
    );
  }

  /** PDF: the Before view on page 1, the After view (pins + notes) on page 2. */
  private async composePages(s: { before: Shot; after: Shot }, agency: AgencySettings, date: string) {
    const notes = this.q<HTMLInputElement>('.exp-notes').checked;
    const common = { arrange: 'column' as const, agency, url: this.app.pageUrl, date };
    return [
      await compose({ ...common, views: [{ label: 'Before', shot: s.before, pins: false }], legend: [] }, this.doc),
      await compose({ ...common, views: [{ label: 'After', shot: s.after, pins: notes }], legend: this.legend() }, this.doc),
    ];
  }

  /** Drawn on a canvas rather than an <img>, so the page's Content-Security-Policy can't block it. */
  private preview(src: HTMLCanvasElement): void {
    const c = this.q<HTMLCanvasElement>('.exp-preview');
    const w = 560;
    c.width = w;
    c.height = Math.round((w * src.height) / src.width);
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    c.classList.remove('hidden');
  }

  private download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = this.doc.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    // Inside the editor's shadow root, so the click never reaches the site's own listeners.
    this.host.root.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** e.g. glowup-example.com-services-2026-10-25 */
export function fileBase(pageUrl: string, now = new Date()): string {
  const u = new URL(pageUrl);
  let pathname = u.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    /* keep it encoded */
  }
  const path = pathname.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return ['glowup', u.hostname.replace(/^www\./, ''), path, d].filter(Boolean).join('-');
}
