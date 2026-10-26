// The "Motion" tab (SPEC.md Phase 2B): entrance and hover presets for the selected elements,
// stagger across a group, replay. Each added animation is an ordinary op (undo, Before/After,
// saved, listed in the change list).

import { defaultEntrance, defaultHover, EASINGS, ENTRANCE_PRESETS, HOVER_PRESETS, STAGGER_MS } from '../model/animation';
import { describeOp } from '../model/project';
import type { AnimationValue, EntrancePreset, HoverPreset, Op } from '../model/types';
import type { GlowUp } from './controller';
import type { ShadowHost } from './host';

const opts = (list: { id: string; label: string }[]) => list.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');

const HTML = `
<p class="hint mo-empty">Select one or more elements to animate. Shift+click adds to the selection.</p>
<div class="mo-body hidden">
  <p class="notice mo-rm hidden">This computer asks for reduced motion, so previews here won’t move. Visitors with that setting won’t see movement either.</p>
  <div class="group">
    <h4>Entrance</h4>
    <label class="field"><span>Effect</span><div class="ctl"><select class="mo-entrance">${opts(ENTRANCE_PRESETS)}</select></div></label>
    <div class="field"><span>Starts</span><div class="ctl radios">
      <label><input type="radio" name="mo-trigger" value="view" checked> In view</label>
      <label><input type="radio" name="mo-trigger" value="load"> On load</label>
    </div></div>
    <label class="field"><span>Duration</span><div class="ctl"><input type="number" class="mo-dur" min="100" max="1000" step="50" value="450"><span class="unit">ms</span></div></label>
    <label class="field"><span>Delay</span><div class="ctl"><input type="number" class="mo-delay" min="0" max="3000" step="50" value="0"><span class="unit">ms</span></div></label>
    <label class="field"><span>Easing</span><div class="ctl"><select class="mo-ease">${opts(EASINGS)}</select></div></label>
    <label class="field mo-stagger-row"><span>Stagger</span><div class="ctl"><input type="number" class="mo-stagger" min="0" max="1000" step="25" value="${STAGGER_MS}"><span class="unit">ms each</span></div></label>
    <button class="btn primary" data-mo="entrance">Add entrance</button>
  </div>
  <div class="group">
    <h4>Hover</h4>
    <label class="field"><span>Effect</span><div class="ctl"><select class="mo-hover">${opts(HOVER_PRESETS)}</select></div></label>
    <label class="field mo-color-row hidden"><span>Hover color</span><div class="ctl"><input type="color" class="mo-color"></div></label>
    <label class="field"><span>Duration</span><div class="ctl"><input type="number" class="mo-hdur" min="80" max="1000" step="10" value="180"><span class="unit">ms</span></div></label>
    <button class="btn primary" data-mo="hover">Add hover effect</button>
  </div>
  <div class="group">
    <h4>On the selection</h4>
    <ul class="mo-list"></ul>
    <div class="row2">
      <button class="btn" data-mo="replay">▶ Replay</button>
      <button class="btn" data-mo="replay-all">▶ Replay whole page</button>
    </div>
  </div>
  <p class="hint">Entrances move and fade only (smooth on any device), never loop, and stay under 1 second.</p>
</div>`;

export interface MotionHooks {
  selection(): Element[];
}

export class MotionPanel {
  private q: <T extends Element = HTMLElement>(sel: string) => T;

  constructor(
    private app: GlowUp,
    private host: ShadowHost,
    private root: HTMLElement,
    private hooks: MotionHooks,
  ) {
    root.innerHTML = HTML;
    this.q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    const accent = app.getBrand().accent;
    if (accent) this.q<HTMLInputElement>('.mo-color').value = accent;
    this.q('.mo-hover').addEventListener('change', () => this.refresh());
    root.addEventListener('click', (e) => {
      const act = (e.target as Element).closest<HTMLElement>('[data-mo]')?.dataset.mo;
      if (act) this.act(act);
    });
    this.refresh();
  }

  private get doc(): Document {
    return this.root.ownerDocument;
  }

  private num(sel: string): number {
    return Number(this.q<HTMLInputElement>(sel).value);
  }

  private act(act: string): void {
    const els = this.hooks.selection();
    try {
      if (act === 'entrance' || act === 'hover') {
        if (!els.length) return;
        let value: AnimationValue;
        if (act === 'entrance') {
          const trigger = (this.root.querySelector<HTMLInputElement>('input[name="mo-trigger"]:checked')?.value ?? 'view') as 'view' | 'load';
          value = {
            ...defaultEntrance(this.q<HTMLSelectElement>('.mo-entrance').value as EntrancePreset),
            trigger,
            duration: this.num('.mo-dur'),
            delay: this.num('.mo-delay'),
            easing: this.q<HTMLSelectElement>('.mo-ease').value,
          };
        } else {
          value = { ...defaultHover(this.q<HTMLSelectElement>('.mo-hover').value as HoverPreset, this.q<HTMLInputElement>('.mo-color').value), duration: this.num('.mo-hdur') };
        }
        const stagger = els.length > 1 ? this.num('.mo-stagger') : 0;
        const ops = this.app.addAnimations(els, value, stagger);
        this.host.toast(`${act === 'entrance' ? 'Entrance' : 'Hover effect'} added to ${ops.length} element${ops.length === 1 ? '' : 's'}.${act === 'hover' ? ' Hover over it to see it.' : ''}`);
      } else if (act === 'replay') {
        this.app.replayAnimations(els);
      } else if (act === 'replay-all') {
        this.app.replayAnimations();
      }
    } catch (e) {
      this.host.toast((e as Error).message);
    }
  }

  refresh(): void {
    const els = this.hooks.selection();
    const before = this.app.session.view === 'before';
    this.q('.mo-empty').classList.toggle('hidden', els.length > 0);
    this.q('.mo-body').classList.toggle('hidden', !els.length);
    this.q('.mo-stagger-row').classList.toggle('hidden', els.length < 2);
    this.q('.mo-color-row').classList.toggle('hidden', this.q<HTMLSelectElement>('.mo-hover').value !== 'color-shift');
    const rm = this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.q('.mo-rm').classList.toggle('hidden', !rm);
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-mo="entrance"], [data-mo="hover"]'))) b.disabled = before;
    this.q('[data-mo="entrance"]').textContent = els.length > 1 ? `Add entrance to ${els.length} (staggered)` : 'Add entrance';

    const ops = this.app.session.getOps().filter((o): o is Extract<Op, { kind: 'animation' }> => o.kind === 'animation' && els.includes(this.app.session.changedElement(o)!));
    this.q('.mo-list').replaceChildren(
      ...(ops.length
        ? ops.map((o) => {
            const li = this.doc.createElement('li');
            li.textContent = describeOp(o);
            return li;
          })
        : [Object.assign(this.doc.createElement('li'), { className: 'hint', textContent: 'No animations on the selection yet.' })]),
    );
  }
}
