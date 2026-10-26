# Website Glow-Up — Build Spec (v1)

Working name. Check the name is free on the Chrome Web Store, Edge Add-ons and Firefox Add-ons before launch.

## 1. What this is

A free browser extension that lets an agency open **any prospect's live website**, improve it visually in place, explain each change, and export **sales proof** (before/after images, PDF, reveal video, developer change list).

Positioning: *"Your real page, fixed. Free."* Not an AI redesign tool, not a website builder, not an audit tool.

Primary user: small agencies, freelancers and in-house marketers pitching website improvements to businesses of any industry, including ecommerce.

## 2. Hard rules (never break these)

1. **Free core.** Every v1 feature works without payment.
2. **Local only.** No server, no backend, no accounts, no logins. All data stays in the user's browser.
3. **No AI calls, no paid APIs.** Nothing that costs money per use.
4. **No ads, no tracking, no analytics** sent anywhere.
5. **Every browser.** One codebase for Chrome, Edge, Brave, Opera and Firefox. Safari later.
6. **Minimal permissions.** The extension only touches a page when the user clicks it. No "read all sites" permission.
7. **No remote code.** All libraries are bundled (Manifest V3 forbids loading code from CDNs).
8. **Never modify the real website.** All edits exist only in the user's browser view.

## 3. Not in scope — Opportunity Engine territory

Glow-Up **makes**. Opportunity Engine **thinks**. Glow-Up must never:

- Automatically scan a site or detect what's wrong with it
- Score, grade, rank or prioritize anything (sites, pages or fixes)
- Produce audit reports or "issues found" lists
- Identify "why now" signals or match services to a prospect
- Decide or suggest which prospects to pursue
- Track outreach, opens or views

Wording guard: preset text may describe **what a fix does** ("Puts your phone number one tap away on mobile"). It must never claim **the site has a problem** ("Your site is losing calls").

Future hook (not v1): Opportunity Engine may later open Glow-Up with its findings pre-loaded. Keep the edit model (section 5) clean so that is possible.

## 4. Tech stack

- **WXT** framework + **TypeScript**, Manifest V3, builds for Chrome and Firefox targets
- Permissions: `activeTab`, `scripting`, `storage`, `unlimitedStorage`. Add others only when a feature needs them, and document why
- Editor UI injected into the page inside a **Shadow DOM** so the site's CSS can't break it and ours can't break the site
- **IndexedDB** for screenshots and project data; `storage.local` for settings
- Bundled libraries only (e.g. jsPDF for PDF export)
- Plain, lightweight UI. No heavy framework required
- **Persistent edits on dynamic sites:** use a MutationObserver-based approach so edits re-apply when React/Vue/Shopify sites re-render. Evaluate the open-source `dom-mutator` library (bundled via npm, never loaded from a CDN) before writing our own. See section 6A.

## 5. Core architecture: the edit model

Every change is stored as an **operation**, never as a raw HTML snapshot:

```ts
type Op = {
  id: string;
  selector: string;          // robust selector for the target element
  fallback: ElementFingerprint; // tag, text snippet, position — used if selector breaks
  kind: 'text' | 'style' | 'hide' | 'move' | 'insertBlock' | 'image';
  before: unknown;           // original value, for undo and "before" view
  after: unknown;            // new value
  noteId?: string;           // optional linked user note
  createdAt: number;
};

type Version = { id: string; label: string; ops: Op[] };   // A, B, C
type Project = {
  id: string;
  url: string;               // origin + path
  title: string;
  versions: Version[];
  notes: Note[];
  brand?: BrandCapture;
  updatedAt: number;
};
```

This one model powers undo/redo, saved projects, re-applying edits on reload, before/after toggling, multiple versions and the developer change list. Build it first and test it hard.

Selector strategy: prefer stable IDs and attributes, then structural paths; store a fingerprint fallback. When an op can't find its element on reload, show it as "couldn't re-apply" instead of failing silently.

## 6A. Editor quality bar (applies to every phase)

Benchmark: VisBug (~200k Chrome users, 4.8 rating). Glow-Up must match its editing power and beat it on ease of use, persistence and output. Each rule below is backed by a source in section 9.

**Selection**
- Hover outline appears instantly; selection must feel immediate (target under 100 ms) [S1]
- Keyboard tree navigation: Tab / Shift+Tab = next/previous sibling, Enter = first child, Shift+Enter = parent (VisBug pattern) [S2]
- Multi-select with Shift+click. **Every tool must work on multiple selected elements** (VisBug rule) [S3]
- Find elements by visible text or selector, highlighting matches [S4]
- **"Select all like this":** select every element matching the current one (same tag + classes), so one change restyles all of them

**Direct manipulation**
- Drag handles to resize, with live pixel values shown while dragging; Shift keeps aspect ratio [S2]
- Arrow keys nudge 1px, Shift+arrow 10px
- **Spacing is never changed by accident.** Figma users report grabbing padding handles when trying to resize [S5]. Padding/margin dragging only works in Spacing mode or while holding a modifier key
- **One gesture = one undo step.** Live preview while dragging, single commit on release [S6]

**Seeing spacing and alignment**
- Selected element shows margin values outside its border and padding values inside (Webflow pattern, shipped May 2026) [S7]
- Hold Alt+Shift and hover to see spacing without selecting [S7]
- Measuring: with one element selected, hovering another shows the pixel distance; Shift+click several to check equal spacing (VisBug guides) [S8]
- Smart guides while moving/resizing, including keyboard moves [S9]

**Styling speed**
- Preset spacing values menu on padding/margin controls (Webflow pattern) [S10]
- Captured brand colors shown first in every color picker, plus an eyedropper
- Copy style / paste style between elements
- Scrub inputs: drag left/right on number fields to change values live
- Small live contrast indicator inside the color picker only. Never a page-level report (section 3)

**Easy for beginners, fast for pros**
- Visible controls by default (VisBug's interactions have a learning curve [S11])
- "Clean canvas" toggle hides on-page controls for keyboard users (requested by Figma power users [S12])
- Command palette (Ctrl/Cmd+K) for every action
- Shortcut cheat sheet on "?"

**Robust on real websites**
- Edits re-apply automatically when the site re-renders. Optimizely documents that MutationObserver re-application can miss rapid hydration updates and cause flicker [S13], so test this on React/Next.js sites specifically
- Throttle observer work with requestAnimationFrame; inject UI once (idempotent); keep all UI in one Shadow DOM root [S14]
- Handle sticky headers, popups, cookie banners and lazy-loaded images without glitches
- Unsupported areas (some cross-origin iframes) show a clear "can't edit this part" message
- Editor overlays animate only transform/opacity and stay at 60fps [S15]

## 6. Features by phase

### Phase 1 — Core editor
- Toolbar button toggles edit mode on the current tab
- Hover highlight + click to select any element; breadcrumb to select parent
- Edit text inline
- Style panel: text color, background color, font size, font weight, font family, padding/margin, border radius, alignment
- Hide element; move element up/down among siblings
- Replace image (from user's computer, stored locally)
- Undo / redo (keyboard shortcuts too)
- **Before/After toggle** (switch all ops off and on instantly)
- **Saved projects per page:** edits auto-save and re-apply when the user returns
- Project list in the extension popup (open, rename, delete)

**Done when:** a user can edit a WordPress, Wix, Squarespace and Shopify page, close the tab, come back, and see their edits restored.

### Phase 2 — Brand capture, fix library, notes
- **Brand capture:** read computed styles to find the site's main colors, heading/body fonts and button style. Used only to style edits and presets. No judgments
- **Fix library:** user-picked, pre-built blocks styled with the captured brand:
  - Trust bar (stars + review count + badges, editable text)
  - Sticky "Call now" / "Book now" button (mobile and desktop)
  - Phone number in header
  - Clearer hero headline + subheadline + CTA button
  - Review/testimonial strip
  - Service-area or "Serving [city]" badge
  - Ecommerce: free-shipping banner, guarantee badge, "Add to cart" emphasis
- Each preset has optional neutral note wording (see wording guard, section 3)
- **Numbered notes:** user attaches a note to any op; a numbered pin shows on the page

**Done when:** a user can add three presets that match the site's colors and pin numbered notes to them.

### Phase 2B — Animations
Add motion to any element while designing, so the glow-up feels like a modern site (Framer-style effects [S16]).

- **New op kind:** `animation` (stored in the edit model like every other change)
- **Entrance presets:** fade in, slide up, slide in from left/right, scale in
- **Hover presets** for buttons, cards and images: lift, grow, glow, color shift
- **Stagger:** apply one entrance to a group (e.g. three service cards) with an offset delay between items [S16]
- **Triggers:** on page load, or when the element scrolls into view [S16]
- **Controls:** preset, trigger, duration, delay, easing, plus a ▶ replay button and "Replay whole page"
- Animation badge on animated elements; animations listed in the history panel

**Motion rules (built into presets and defaults):**
- Defaults: hover/feedback 150–200 ms; entrances 300–500 ms; never above 1 s, since 1 s is the limit of the user's flow of thought [S1]
- Ease-out for elements entering [S17]
- Animate **only transform and opacity**. They are the cheap properties browsers can run at 60fps; others trigger layout/paint [S15][S18]
- Scroll-into-view uses IntersectionObserver for every browser. CSS scroll-driven animations work in Chrome/Edge (since 2023) and Safari (since Sept 2025) but not Firefox [S19], so they're optional only, wrapped in `@supports` so content never stays invisible [S20]
- **Accessibility:** respect `prefers-reduced-motion` (WCAG technique C39) in preview and exported code [S21]. No looping animation by default; anything moving over 5 seconds needs pause (WCAG 2.2.2); nothing flashes more than 3 times per second (WCAG 2.3.1) [S22]

**Exports:** the developer change list includes the CSS keyframes, the scroll-trigger snippet and the reduced-motion query. The reveal video (Phase 4) captures animations playing.

**Done when:** a user can add an entrance, a hover effect and a staggered group, replay them, and export working CSS, with reduced-motion respected.

### Phase 3 — Exports
- **Before/after image:** capture the visible area with ops off, then on; compose side by side (or stacked) with agency logo, prospect URL, date and numbered notes legend
- **PDF:** same content, one page per view, generated locally
- **Developer change list:** plain list of every change plus copyable CSS / HTML snippets, exported as .md or .txt
- **Agency branding settings:** upload logo, agency name, accent color (stored locally)

**Done when:** one click produces a branded before/after PNG and PDF, and a change list a developer could follow.

### Phase 4 — Versions, mobile, reveal video
- **Versions A/B/C** per page; duplicate a version; export compares any two
- **Mobile view:** open the same page in a narrow (~390px) window with the current version applied; include desktop + mobile in exports
- **Reveal video:** animate a wipe/slider from before to after on a canvas, record with MediaRecorder, export WebM (MP4/GIF later if feasible locally)
- Full-page capture (scroll and stitch) for long pages

**Done when:** a user can export a 5–10 second before→after reveal video and a desktop+mobile comparison.

### Phase 5 — Store launch
- Builds and listings for Chrome Web Store, Edge Add-ons, Firefox Add-ons
- Privacy policy: "Nothing leaves your device"
- 30-second before/after demo video for listings
- Link back to the parent company site

## 7. Testing checklist

Test every phase on: WordPress (Elementor + classic), Wix, Squarespace, Shopify, Webflow, a plain HTML site, and a React/Next.js single-page site. Check: edits apply, survive reload, don't break the page's own scripts, and the editor UI is never restyled by the site.

## 8. Open decisions

- Final product name and icon
- Export layout default: side-by-side or stacked
- Free forever vs. optional paid extras later (must never lock v1 features)
- Keyboard shortcut set

## 9. Research sources

- [S1] Nielsen Norman Group thresholds (100 ms feels instant, 1 s is the limit of flow of thought), via Val Head: https://valhead.com/?p=2978
- [S2] VisBug keyboard navigation and resize behavior: https://expertbeacon.com/visbug-the-future-of-visual-web-design-is-here/
- [S3] VisBug contributor rule, features must handle multiselect: https://github.com/nickofthyme/ProjectVisBug
- [S4] VisBug search tool: https://aicoolies.com/tools/visbug
- [S5] Figma forum, padding handles grabbed when resizing: https://forum.figma.com/t/accidentally-changing-the-padding-when-i-drag/21554.rss
- [S6] One gesture = one undo step pattern: https://cdn.jsdelivr.net/npm/@flowscape-ui/canvas-react@1.1.1/README.md
- [S7] Webflow, spacing values on canvas (May 2026): https://webflow.com/updates/see-spacing-values-on-the-canvas and https://releases.sh/release/rel_oAzQYbv2XKOvUhx-lWYpr
- [S8] VisBug guides and measuring (Adam Argyle interview): https://shop.smashingmagazine.com/2021/05/smashing-podcast-episode-37/
- [S9] Smart guides on keyboard moves: https://www.goodreads.com/author_blog_posts/19055690-improved-guides-pencil-tool-and-adding-images-in-bulk?tab=book
- [S10] Webflow preset spacing values: https://webflow.com/blog/meet-the-new-style-panel
- [S11] VisBug 101 (learning curve): https://medium.com/dev-channel/visbug-101-749f26a485c8
- [S12] Figma forum, toggle for on-canvas controls: https://forum.figma.com/suggest-a-feature-11/preferences-toggle-to-control-on-canvas-ui-variant-padding-handles-ai-agent-etc-55414
- [S13] Optimizely, MutationObserver re-application and React hydration limits: https://docs.developers.optimizely.com/web-experimentation/docs/react-server-side-rendering-and-hydration
- [S14] Content script practices for SPA-heavy sites: https://smithery.ai/skills/neversight/content-script-developer ; persistent mutations library: https://www.npmjs.com/package/dom-mutator
- [S15] web.dev, animations and performance (transform/opacity, 60fps): https://web.dev/articles/animations-and-performance
- [S16] Framer effects (appear, scroll, hover, stagger): https://framer.com/features/effects and https://framer.com/features/animations
- [S17] Easing guidance (ease-out for entering): https://merge.rocks/resources/websites-playbook/ui-patterns/timing-animation-definition-the-ultimate-ui-guide-chart-examples
- [S18] web.dev, high-performance CSS animations: https://web.dev/animations-guide/
- [S19] Scroll-driven animation support (Chrome 2023, Safari Sept 2025, Firefox pending): https://www.buildmvpfast.com/blog/css-scroll-driven-animations-replace-js-2026 and https://connect.mozilla.org/t5/ideas/implement-css-scroll-driven-animations-animation-timeline/idc-p/116613
- [S20] @supports fallback so content stays visible: https://www.buildmvpfast.com/blog/css-scroll-driven-animations-replace-js-2026
- [S21] W3C WCAG technique C39 (prefers-reduced-motion): https://w3.org/WAI/WCAG22/Techniques/css/C39
- [S22] WCAG 2.3.3 Animation from Interactions: https://w3c.github.io/wcag/understanding/animation-from-interactions ; WCAG 2.2.2 (pause motion over 5 s) and 2.3.1 (max 3 flashes/s) summarized at https://teamdynamix.umich.edu/TDClient/30/Portal/KB/PrintArticle?ID=14019 and https://www.a11y-collective.com/blog/wcag-animation/
