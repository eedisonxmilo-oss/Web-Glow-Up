// Fix library (SPEC.md Phase 2): pre-built blocks the user picks and places, styled with the
// captured brand. Each preset turns field values into one root element with inline styles only,
// so the site's CSS has as little to grab onto as possible and the block needs no stylesheet.
//
// Wording guard (SPEC section 3): `note` says what the fix does. It never says the site has a problem.

import { mix, onColor } from './brand';
import type { BlockPosition, BrandCapture } from './model/types';

export interface BrandStyle {
  accent: string;
  onAccent: string;
  text: string;
  muted: string;
  background: string;
  /** A light wash of the accent over the background, for panels and bars. */
  tint: string;
  border: string;
  headingFont: string;
  bodyFont: string;
  button: { background: string; color: string; radius: string };
}

const FALLBACK_ACCENT = '#2563eb';
const FALLBACK_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

export function brandStyle(b?: BrandCapture): BrandStyle {
  const accent = b?.accent ?? b?.button?.background ?? FALLBACK_ACCENT;
  const background = b?.background ?? '#ffffff';
  const text = b?.text ?? '#1f2330';
  const radius = clampRadius(b?.button?.radius ?? '8px');
  return {
    accent,
    onAccent: onColor(accent),
    text,
    muted: mix(text, background, 0.3),
    background,
    tint: mix(accent, background, 0.9),
    border: mix(text, background, 0.82),
    headingFont: b?.headingFont ?? b?.bodyFont ?? FALLBACK_FONT,
    bodyFont: b?.bodyFont ?? FALLBACK_FONT,
    button: b?.button
      ? { background: b.button.background, color: b.button.color, radius }
      : { background: accent, color: onColor(accent), radius },
  };
}

function clampRadius(r: string): string {
  const n = parseFloat(r);
  if (!Number.isFinite(n)) return '8px';
  return `${Math.min(Math.max(n, 0), 999)}px`;
}

export interface PresetField {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
}

/**
 * fixed:    pinned to the viewport, added at the end of <body>
 * relative: placed against an element the user selects (or the top of the page)
 * style:    restyles the selected element instead of inserting a block
 */
export type Placement = 'fixed' | 'relative' | 'style';

export type PresetResult = { html: string } | { styles: Record<string, string> };

export interface Preset {
  id: string;
  name: string;
  group: 'General' | 'Ecommerce';
  summary: string;
  /** Optional neutral note wording: what the fix does. */
  note: string;
  placement: Placement;
  defaultPosition?: BlockPosition;
  fields: PresetField[];
  build(b: BrandStyle, v: Record<string, string>): PresetResult;
}

// ---------- helpers ----------

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** style="" attribute from a property map (values are escaped for the attribute). */
function st(o: Record<string, string | number>): string {
  const decl = Object.entries(o)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return `style="${esc(decl)}"`;
}

/** Resets that keep the site's own element rules from leaking into a block. */
const RESET = { 'box-sizing': 'border-box', margin: '0', border: '0', 'text-transform': 'none', 'letter-spacing': 'normal', float: 'none' };

function root(b: BrandStyle, extra: Record<string, string | number>): string {
  return st({ ...RESET, display: 'block', clear: 'both', width: 'auto', 'font-family': b.bodyFont, color: b.text, 'line-height': '1.45', 'text-align': 'center', ...extra });
}

const looksLikePhone = (v: string) => /^[+()\d\s.-]{6,}$/.test(v.trim());

/** A phone number becomes a tel: link; anything else is treated as a web address. */
export function linkFor(v: string): string {
  const s = v.trim();
  if (!s) return '#';
  if (looksLikePhone(s)) return `tel:${s.replace(/[^\d+]/g, '')}`;
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(s)) return s;
  return `https://${s}`;
}

function button(b: BrandStyle, label: string, href: string, extra: Record<string, string | number> = {}): string {
  return `<a href="${esc(linkFor(href))}" ${st({
    ...RESET,
    display: 'inline-block',
    padding: '14px 28px',
    background: b.button.background,
    color: b.button.color,
    'border-radius': b.button.radius,
    font: `600 17px/1.2 ${b.bodyFont}`,
    'text-decoration': 'none',
    ...extra,
  })}>${esc(label)}</a>`;
}

const STAR_COLOR = '#f5b301';
const stars = (size: number) => `<span ${st({ color: STAR_COLOR, 'font-size': `${size}px`, 'letter-spacing': '2px', 'line-height': '1' })}>★★★★★</span>`;

// ---------- the library ----------

export const PRESETS: Preset[] = [
  {
    id: 'trust-bar',
    name: 'Trust bar',
    group: 'General',
    summary: 'Stars, review count and badges in one strip.',
    note: 'Shows the rating and credentials in one line, near the top of the page.',
    placement: 'relative',
    defaultPosition: 'afterend',
    fields: [
      { key: 'rating', label: 'Rating', value: '4.9' },
      { key: 'reviews', label: 'Reviews', value: '200+ reviews on Google' },
      { key: 'badges', label: 'Badges (comma separated)', value: 'Licensed & insured, Family owned, Free quotes' },
    ],
    build(b, v) {
      const badges = v.badges
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((t) => `<span ${st({ display: 'inline-flex', 'align-items': 'center', gap: '6px', 'white-space': 'nowrap' })}><span ${st({ color: b.accent, 'font-weight': '700' })}>✓</span>${esc(t)}</span>`)
        .join('');
      const rating = [v.rating, v.reviews].filter((s) => s.trim()).map(esc).join(' from ');
      return {
        html: `<div ${root(b, { background: b.tint, padding: '12px 16px', 'font-size': '15px', display: 'flex', 'flex-wrap': 'wrap', 'justify-content': 'center', 'align-items': 'center', gap: '8px 28px' })}><span ${st({ display: 'inline-flex', 'align-items': 'center', gap: '8px', 'font-weight': '600' })}>${stars(18)}<span>${rating}</span></span>${badges}</div>`,
      };
    },
  },
  {
    id: 'sticky-cta',
    name: 'Sticky “Call now” / “Book now” button',
    group: 'General',
    summary: 'A button that stays in the corner while visitors scroll, on mobile and desktop.',
    note: 'Keeps a call or booking button in view while visitors scroll, on mobile and desktop.',
    placement: 'fixed',
    fields: [
      { key: 'label', label: 'Button text', value: 'Call now' },
      { key: 'link', label: 'Phone number or booking link', value: '(555) 010-0100' },
    ],
    build(b, v) {
      const icon = looksLikePhone(v.link) ? '📞' : '📅';
      return {
        html: `<a href="${esc(linkFor(v.link))}" ${st({
          ...RESET,
          position: 'fixed',
          right: '16px',
          bottom: '16px',
          'z-index': '2147483000',
          display: 'inline-flex',
          'align-items': 'center',
          gap: '8px',
          'max-width': 'calc(100vw - 32px)',
          padding: '14px 22px',
          background: b.button.background,
          color: b.button.color,
          'border-radius': b.button.radius === '0px' ? '0px' : '999px',
          font: `700 16px/1.2 ${b.bodyFont}`,
          'text-decoration': 'none',
          'box-shadow': '0 8px 24px rgba(0,0,0,.25)',
        })}><span aria-hidden="true">${icon}</span><span>${esc(v.label)}</span></a>`,
      };
    },
  },
  {
    id: 'header-phone',
    name: 'Phone number in header',
    group: 'General',
    summary: 'A tap-to-call phone link. Select the header or menu, then add it inside.',
    note: 'Puts the phone number in the header, one tap away on mobile.',
    placement: 'relative',
    defaultPosition: 'beforeend',
    fields: [
      { key: 'phone', label: 'Phone number', value: '(555) 010-0100' },
      { key: 'label', label: 'Label (optional)', value: 'Call us' },
    ],
    build(b, v) {
      const label = v.label.trim() ? `<span ${st({ 'font-weight': '400', color: b.muted })}>${esc(v.label)}</span>` : '';
      return {
        html: `<a href="${esc(linkFor(v.phone))}" ${st({
          ...RESET,
          display: 'inline-flex',
          'align-items': 'center',
          gap: '6px',
          padding: '6px 12px',
          margin: '4px 8px',
          color: b.accent,
          font: `700 16px/1.2 ${b.bodyFont}`,
          'text-decoration': 'none',
          'white-space': 'nowrap',
          'vertical-align': 'middle',
        })}><span aria-hidden="true">📞</span>${label}<span>${esc(v.phone)}</span></a>`,
      };
    },
  },
  {
    id: 'hero',
    name: 'Clearer hero',
    group: 'General',
    summary: 'Headline, subheadline and one button.',
    note: 'Says what the business does in one line and gives visitors one clear next step.',
    placement: 'relative',
    defaultPosition: 'beforebegin',
    fields: [
      { key: 'headline', label: 'Headline', value: 'Fast, friendly service in Your City' },
      { key: 'sub', label: 'Subheadline', value: 'Upfront prices, on-time arrivals and work we stand behind.' },
      { key: 'cta', label: 'Button text', value: 'Get a free quote' },
      { key: 'link', label: 'Button link or phone', value: '#contact' },
    ],
    build(b, v) {
      const sub = v.sub.trim() ? `<div ${st({ font: `400 clamp(16px, 2vw, 20px)/1.5 ${b.bodyFont}`, color: b.muted, margin: '0 0 26px' })}>${esc(v.sub)}</div>` : '';
      const cta = v.cta.trim() ? button(b, v.cta, v.link) : '';
      return {
        html: `<section ${root(b, { background: b.tint, padding: '56px 24px' })}><div ${st({ 'max-width': '760px', margin: '0 auto' })}><div ${st({ font: `700 clamp(28px, 4.5vw, 48px)/1.15 ${b.headingFont}`, color: b.text, margin: '0 0 14px' })}>${esc(v.headline)}</div>${sub}${cta}</div></section>`,
      };
    },
  },
  {
    id: 'reviews',
    name: 'Review strip',
    group: 'General',
    summary: 'Up to three customer quotes with stars.',
    note: 'Puts customer reviews where visitors are making up their minds.',
    placement: 'relative',
    defaultPosition: 'afterend',
    fields: [
      { key: 'heading', label: 'Heading', value: 'What our customers say' },
      { key: 'q1', label: 'Review 1', value: 'Showed up on time and fixed it in an hour. Highly recommend.' },
      { key: 'n1', label: 'Name 1', value: 'Sarah M.' },
      { key: 'q2', label: 'Review 2', value: 'Fair price, clear explanation, tidy work.' },
      { key: 'n2', label: 'Name 2', value: 'James T.' },
      { key: 'q3', label: 'Review 3', value: 'Friendly team. We will use them again.' },
      { key: 'n3', label: 'Name 3', value: 'Priya K.' },
    ],
    build(b, v) {
      const cards = [1, 2, 3]
        .filter((i) => v[`q${i}`]?.trim())
        .map(
          (i) =>
            `<div ${st({ background: b.background, border: `1px solid ${b.border}`, 'border-radius': '12px', padding: '20px', 'text-align': 'left' })}>${stars(16)}<div ${st({ margin: '10px 0 12px', 'font-size': '16px', color: b.text })}>“${esc(v[`q${i}`])}”</div><div ${st({ 'font-size': '14px', 'font-weight': '600', color: b.muted })}>${esc(v[`n${i}`] ?? '')}</div></div>`,
        )
        .join('');
      const heading = v.heading.trim() ? `<div ${st({ font: `700 clamp(22px, 3vw, 30px)/1.2 ${b.headingFont}`, color: b.text, margin: '0 0 24px' })}>${esc(v.heading)}</div>` : '';
      return {
        html: `<section ${root(b, { background: b.tint, padding: '40px 24px' })}><div ${st({ 'max-width': '1100px', margin: '0 auto' })}>${heading}<div ${st({ display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' })}>${cards}</div></div></section>`,
      };
    },
  },
  {
    id: 'service-area',
    name: '“Serving [city]” badge',
    group: 'General',
    summary: 'A small badge with the area the business covers.',
    note: 'Shows the area served at a glance.',
    placement: 'relative',
    defaultPosition: 'afterend',
    fields: [
      { key: 'city', label: 'City or area', value: 'Your City' },
      { key: 'suffix', label: 'After the city', value: '& surrounding areas' },
    ],
    build(b, v) {
      return {
        html: `<div ${root(b, { display: 'flex', 'justify-content': 'center', padding: '10px 16px' })}><span ${st({ display: 'inline-flex', 'align-items': 'center', gap: '8px', padding: '8px 16px', 'border-radius': '999px', background: b.tint, border: `1px solid ${b.accent}`, color: b.text, font: `600 15px/1.3 ${b.bodyFont}` })}><span aria-hidden="true">📍</span><span>Serving ${esc(v.city)} ${esc(v.suffix)}</span></span></div>`,
      };
    },
  },
  {
    id: 'free-shipping',
    name: 'Free-shipping banner',
    group: 'Ecommerce',
    summary: 'A full-width announcement bar.',
    note: 'Shows the free-shipping offer before visitors reach checkout.',
    placement: 'relative',
    defaultPosition: 'afterbegin',
    fields: [{ key: 'text', label: 'Text', value: 'Free shipping on orders over $50' }],
    build(b, v) {
      return {
        html: `<div ${root(b, { background: b.accent, color: b.onAccent, padding: '10px 16px', font: `600 14px/1.4 ${b.bodyFont}` })}><span aria-hidden="true">🚚 </span>${esc(v.text)}</div>`,
      };
    },
  },
  {
    id: 'guarantee',
    name: 'Guarantee badge',
    group: 'Ecommerce',
    summary: 'A boxed promise, e.g. money-back or satisfaction guarantee.',
    note: 'Shows the guarantee right next to the buying decision.',
    placement: 'relative',
    defaultPosition: 'afterend',
    fields: [
      { key: 'title', label: 'Title', value: '30-day money-back guarantee' },
      { key: 'sub', label: 'Detail', value: 'Not happy? Send it back for a full refund.' },
    ],
    build(b, v) {
      const sub = v.sub.trim() ? `<span ${st({ display: 'block', font: `400 14px/1.4 ${b.bodyFont}`, color: b.muted })}>${esc(v.sub)}</span>` : '';
      return {
        html: `<div ${root(b, { display: 'flex', 'justify-content': 'center', padding: '12px 0' })}><div ${st({ display: 'inline-flex', 'align-items': 'center', gap: '12px', padding: '12px 18px', border: `2px solid ${b.accent}`, 'border-radius': '12px', background: b.background, 'text-align': 'left' })}><span aria-hidden="true" ${st({ 'font-size': '28px', 'line-height': '1' })}>🛡️</span><span><span ${st({ display: 'block', font: `700 16px/1.3 ${b.headingFont}`, color: b.text })}>${esc(v.title)}</span>${sub}</span></div></div>`,
      };
    },
  },
  {
    id: 'add-to-cart',
    name: '“Add to cart” emphasis',
    group: 'Ecommerce',
    summary: 'Restyles the selected button in the brand color, bolder and roomier.',
    note: 'Makes the Add to cart button the most visible action on the page.',
    placement: 'style',
    fields: [],
    build(b) {
      return {
        styles: {
          'background-color': b.accent,
          'border-color': b.accent,
          color: b.onAccent,
          'font-weight': '700',
          'padding-top': '14px',
          'padding-bottom': '14px',
          'padding-left': '28px',
          'padding-right': '28px',
          'border-radius': b.button.radius,
          'box-shadow': '0 6px 18px rgba(0,0,0,.18)',
        },
      };
    },
  },
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function defaultValues(p: Preset): Record<string, string> {
  return Object.fromEntries(p.fields.map((f) => [f.key, f.value]));
}
