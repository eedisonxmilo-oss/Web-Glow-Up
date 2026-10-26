// Phase 2B animations: runs animation ops in the page with the Web Animations API, and produces
// the CSS / JS a developer needs to reproduce them.
//
// Rules from SPEC.md Phase 2B:
// - entrances animate only transform (translate / scale) and opacity, ease-out, 300–500 ms
// - hover 150–200 ms; nothing above 1 s
// - prefers-reduced-motion: no movement (entrances show at once, hover lift/grow are skipped)
// - nothing loops, nothing flashes
// - content never stays invisible: there is no hidden start state outside a running animation
// Glow and color shift are the exception to "transform and opacity only": they change paint
// (box-shadow / background) on one element while it's hovered, which stays cheap.

import type { AnimationOp, AnimationValue, EntrancePreset, HoverPreset } from './types';

export const MAX_DURATION_MS = 1000;
export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const STAGGER_MS = 100;

export const ENTRANCE_PRESETS: { id: EntrancePreset; label: string }[] = [
  { id: 'fade-in', label: 'Fade in' },
  { id: 'slide-up', label: 'Slide up' },
  { id: 'slide-left', label: 'Slide in from left' },
  { id: 'slide-right', label: 'Slide in from right' },
  { id: 'scale-in', label: 'Scale in' },
];

export const HOVER_PRESETS: { id: HoverPreset; label: string }[] = [
  { id: 'lift', label: 'Lift' },
  { id: 'grow', label: 'Grow' },
  { id: 'glow', label: 'Glow' },
  { id: 'color-shift', label: 'Color shift' },
];

export const EASINGS: { id: string; label: string }[] = [
  { id: EASE_OUT, label: 'Ease out (smooth)' },
  { id: 'ease-out', label: 'Ease out' },
  { id: 'ease-in-out', label: 'Ease in-out' },
  { id: 'linear', label: 'Linear' },
  { id: 'cubic-bezier(0.34, 1.56, 0.64, 1)', label: 'Spring (slight overshoot)' },
];

export function defaultEntrance(preset: EntrancePreset = 'slide-up'): Extract<AnimationValue, { type: 'entrance' }> {
  return { type: 'entrance', preset, trigger: 'view', duration: 450, delay: 0, easing: EASE_OUT };
}

export function defaultHover(preset: HoverPreset = 'lift', color?: string): Extract<AnimationValue, { type: 'hover' }> {
  return { type: 'hover', preset, duration: 180, easing: 'ease-out', ...(preset === 'color-shift' ? { color: color ?? '#2563eb' } : {}) };
}

/** Keep values inside the spec's limits whatever the UI sends. */
export function clampAnimation(v: AnimationValue): AnimationValue {
  const ms = (n: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo)));
  if (v.type === 'entrance') return { ...v, duration: ms(v.duration, 100, MAX_DURATION_MS), delay: ms(v.delay, 0, 3000) };
  return { ...v, duration: ms(v.duration, 80, MAX_DURATION_MS) };
}

/** The "from" state of an entrance; it animates to the element's own resting state. */
export function entranceFrom(preset: EntrancePreset): Record<string, string> {
  switch (preset) {
    case 'fade-in':
      return { opacity: '0' };
    case 'slide-up':
      return { opacity: '0', translate: '0 24px' };
    case 'slide-left':
      return { opacity: '0', translate: '-32px 0' };
    case 'slide-right':
      return { opacity: '0', translate: '32px 0' };
    case 'scale-in':
      return { opacity: '0', scale: '0.92' };
  }
}

/** The hovered state. */
export function hoverTo(v: Extract<AnimationValue, { type: 'hover' }>): Record<string, string> {
  switch (v.preset) {
    case 'lift':
      return { translate: '0 -4px' };
    case 'grow':
      return { scale: '1.04' };
    case 'glow':
      return { boxShadow: '0 0 0 3px rgba(255,255,255,.6), 0 10px 30px rgba(0,0,0,.22)' };
    case 'color-shift':
      return { backgroundColor: v.color ?? '#2563eb' };
  }
}

const isMotion = (v: AnimationValue) => v.type === 'entrance' || v.preset === 'lift' || v.preset === 'grow';

function reducedMotion(el: Element): boolean {
  return el.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// ---------- running in the page ----------

interface Running {
  stop(): void;
  replay(): void;
}

const running = new WeakMap<Element, Map<string, Running>>();

function canAnimate(el: Element): el is HTMLElement {
  return typeof (el as HTMLElement).animate === 'function';
}

function runEntrance(el: HTMLElement, v: Extract<AnimationValue, { type: 'entrance' }>, delay = v.delay): Animation | null {
  if (!canAnimate(el) || reducedMotion(el)) return null;
  // One keyframe (offset 0): the browser animates to the element's own computed state, so any
  // transform, translate or opacity it already has is kept. fill "backwards" holds the start state
  // only during the delay; afterwards the element is exactly as before.
  return el.animate([{ ...entranceFrom(v.preset), offset: 0 }], { duration: v.duration, delay, easing: v.easing, fill: 'backwards' });
}

function startEntrance(el: HTMLElement, v: Extract<AnimationValue, { type: 'entrance' }>): Running {
  let anim: Animation | null = null;
  let io: IntersectionObserver | null = null;
  const win = el.ownerDocument.defaultView;
  if (v.trigger === 'view' && win && 'IntersectionObserver' in win) {
    io = new win.IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io?.disconnect();
        io = null;
        anim = runEntrance(el, v);
      },
      { threshold: 0.15 },
    );
    io.observe(el);
  } else {
    anim = runEntrance(el, v);
  }
  return {
    stop() {
      io?.disconnect();
      io = null;
      anim?.cancel();
      anim = null;
    },
    replay() {
      io?.disconnect();
      io = null;
      anim?.cancel();
      anim = runEntrance(el, v);
    },
  };
}

function startHover(el: HTMLElement, v: Extract<AnimationValue, { type: 'hover' }>): Running {
  let anim: Animation | null = null;
  const play = (forward: boolean) => {
    if (!canAnimate(el)) return;
    if (isMotion(v) && reducedMotion(el)) return;
    if (!anim) anim = el.animate([{ ...hoverTo(v), offset: 1 }], { duration: v.duration, easing: v.easing, fill: 'forwards' });
    anim.playbackRate = forward ? 1 : -1;
    anim.play();
  };
  const enter = () => play(true);
  const leave = () => play(false);
  el.addEventListener('mouseenter', enter);
  el.addEventListener('mouseleave', leave);
  const stop = () => {
    anim?.cancel();
    anim = null;
  };
  return {
    stop() {
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
      stop();
    },
    replay() {
      // Show the effect once: in, then back out.
      stop();
      play(true);
      const a = anim as Animation | null;
      if (a)
        a.onfinish = () => {
          a.onfinish = null; // once: the reverse play finishes too
          play(false);
        };
    },
  };
}

export function startAnimation(el: Element, op: AnimationOp): void {
  stopAnimation(el, op.id);
  if (!(el instanceof el.ownerDocument.defaultView!.HTMLElement)) return;
  const r = op.after.type === 'entrance' ? startEntrance(el, op.after) : startHover(el, op.after);
  let m = running.get(el);
  if (!m) running.set(el, (m = new Map()));
  m.set(op.id, r);
}

export function stopAnimation(el: Element, opId: string): void {
  const m = running.get(el);
  m?.get(opId)?.stop();
  m?.delete(opId);
}

export function isAnimationRunning(el: Element, opId: string): boolean {
  return !!running.get(el)?.has(opId);
}

export function replayAnimation(el: Element, opId: string): void {
  running.get(el)?.get(opId)?.replay();
}

// ---------- code for developers ----------

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const decls = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${kebab(k)}: ${v};`).join(' ');

/** CSS reproducing an animation op on `selector`. "view" entrances also need VIEW_SCRIPT. */
export function animationCss(selector: string, v: AnimationValue, name: string): string {
  const reduced = (body: string) => `@media (prefers-reduced-motion: reduce) {\n  ${body}\n}`;
  if (v.type === 'entrance') {
    const kf = `@keyframes ${name} {\n  from { ${decls(entranceFrom(v.preset))} }\n}`;
    const run = `animation: ${name} ${v.duration}ms ${v.easing} ${v.delay}ms both;`;
    if (v.trigger === 'load') {
      return [kf, `${selector} {\n  ${run}\n}`, reduced(`${selector} { animation: none; }`)].join('\n\n');
    }
    // Hidden only once the script has marked it (gu-pending), so it can never stay invisible.
    return [
      kf,
      `${selector}.gu-pending {\n  ${decls(entranceFrom(v.preset))}\n}`,
      `${selector}.gu-in {\n  ${run}\n}`,
      reduced(`${selector}.gu-pending { opacity: 1; translate: none; scale: none; }\n  ${selector}.gu-in { animation: none; }`),
    ].join('\n\n');
  }
  const to = hoverTo(v);
  const props = Object.keys(to).map(kebab);
  const css = [
    `${selector} {\n  transition: ${props.map((p) => `${p} ${v.duration}ms ${v.easing}`).join(', ')};\n}`,
    `${selector}:hover {\n  ${decls(to)}\n}`,
  ];
  if (isMotion(v)) css.push(reduced(`${selector} { transition: none; }\n  ${selector}:hover { ${props.map((p) => `${p}: none;`).join(' ')} }`));
  return css.join('\n\n');
}

/** Add once per page, before </body>, for "when scrolled into view" entrances. */
export const VIEW_SCRIPT = `<script>
(function () {
  var els = document.querySelectorAll('[data-gu-animate]');
  if (!('IntersectionObserver' in window)) return; // no support: content simply shows
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.remove('gu-pending');
      e.target.classList.add('gu-in');
      io.unobserve(e.target);
    });
  }, { threshold: 0.15 });
  els.forEach(function (el) { el.classList.add('gu-pending'); io.observe(el); });
})();
</script>`;
