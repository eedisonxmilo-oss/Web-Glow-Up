// Dev-only test harness: the real in-page editor with a localStorage-backed store instead of
// extension messaging, so the editor can be exercised on a page without loading the extension.
// Build: npm run harness  ->  dev/harness.js (not part of the extension).
import { GlowUp, type EditorStore } from '../lib/editor/controller';
import * as model from '../lib/model';
import { normalizeAgency } from '../lib/settings';

const K = '__glowup_harness__';
const read = () => JSON.parse(localStorage.getItem(K) || '{"projects":{},"assets":{}}');
const write = (d: unknown) => localStorage.setItem(K, JSON.stringify(d));

const store: EditorStore = {
  async getProject(url) {
    return read().projects[url] ?? null;
  },
  async saveProject(p) {
    const d = read();
    d.projects[p.url] = p;
    write(d);
  },
  async getAssets(ids) {
    const d = read();
    const out: Record<string, string> = {};
    for (const id of ids) if (d.assets[id]) out[id] = d.assets[id];
    return out;
  },
  async putAsset(a) {
    const d = read();
    d.assets[a.id] = a.dataUrl;
    write(d);
  },
  async getAgency() {
    return normalizeAgency(JSON.parse(localStorage.getItem(`${K}agency`) || '{}'));
  },
  // A page can't screenshot itself, so the harness draws a stand-in "screenshot": a wireframe of
  // the visible elements' boxes (blocks inserted by Glow-Up filled in), labelled with the view.
  // Enough to check export layout, pins and file output. Real captures need the extension.
  async capture() {
    const dpr = window.devicePixelRatio || 1;
    const c = document.createElement('canvas');
    c.width = Math.round(innerWidth * dpr);
    c.height = Math.round(innerHeight * dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#f4f5f8';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    for (const el of Array.from(document.body.querySelectorAll('*')).slice(0, 4000)) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) continue;
      const block = el.hasAttribute('data-glowup-block');
      ctx.strokeStyle = block ? '#0a7d4f' : 'rgba(80,90,120,.25)';
      ctx.lineWidth = block ? 3 : 1;
      if (block) {
        ctx.fillStyle = 'rgba(10,125,79,.15)';
        ctx.fillRect(r.left, r.top, r.width, r.height);
      }
      ctx.strokeRect(r.left, r.top, r.width, r.height);
    }
    ctx.fillStyle = '#1f2330';
    ctx.font = '700 28px system-ui';
    ctx.fillText(`HARNESS STAND-IN · ${w.__glowup!.session.view.toUpperCase()}`, 24, innerHeight - 24);
    return { dataUrl: c.toDataURL('image/png') };
  },
};

const w = window as unknown as { __glowup?: GlowUp; __glowupModel?: unknown };
if (!w.__glowup) w.__glowup = new GlowUp(store);
// Exposed so scripted checks can make the same ops the UI makes.
w.__glowupModel = model;
