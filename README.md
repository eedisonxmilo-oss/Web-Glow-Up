# Website Glow-Up (Phases 1–3 + 2B, editor quality bar 6A)

Free browser extension: open a live page, improve it in place, and your edits stay on your device.
`SPEC.md` is the source of truth. This repo implements **Phases 1, 2, 2B (animations) and 3**, and the
**editor quality bar (section 6A)**. Phases 4 and 5 are next.

## Commands

```bash
npm install
npm test               # edit-model tests (vitest + jsdom)
npm run compile        # type-check
npm run build          # Chrome/Edge/Brave/Opera  -> .output/chrome-mv3
npm run build:firefox  # Firefox (MV3)            -> .output/firefox-mv3
npm run dev            # Chrome with live reload
npm run harness        # dev-only: try the editor on real sites without the extension (see below)
```

## Load the unpacked extension

**Chrome / Edge / Brave / Opera**
1. `npm run build`
2. Open `chrome://extensions` (Edge: `edge://extensions`), turn on **Developer mode**.
3. Click **Load unpacked** and pick the `.output/chrome-mv3` folder.
4. Pin the extension and click it on any normal web page, then click **Edit this page** (or press `Alt+Shift+E`).

**Firefox (128+)**
1. `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick `.output/firefox-mv3/manifest.json`.
   (Temporary add-ons are removed when Firefox restarts. Saved projects are kept, because the add-on id is fixed.)

## Using it

- Toolbar button → **Edit this page** turns edit mode on (`Alt+Shift+E` toggles it directly).
- **Ctrl/⌘+K** opens the command palette (every action by name). **?** shows all shortcuts.
- Popup → **Projects**: open, rename, delete.

The panel has five tabs: **Edit**, **Fixes**, **Motion**, **Notes** and **Export**.

**Selecting** (SPEC 6A)
- Hover to highlight, click to select, **Shift+click** to add or remove more. Every tool works on the whole
  selection, and one gesture is one undo step.
- Keyboard: **Tab / Shift+Tab** next / previous sibling, **Enter** first child (edits text when there is
  none), **Shift+Enter** parent, **Esc** deselect. The breadcrumb selects any ancestor.
- **Find** (top of the Edit tab, or **/**): by visible text or CSS selector; matches are highlighted,
  **Enter** steps through them, **Select all** selects every match.
- **All like this** (**L**): selects every element with the same tag and classes, so one change restyles all.
- Cross-origin iframes say "can't edit inside it" (you can still hide, move or resize the frame).

**Editing**
- **F2** or double-click edits text (**Enter** finishes, **Shift+Enter** new line, **Esc** cancels). With
  several elements selected, the new text goes into all of them.
- **Resize** with the handles on the right edge, bottom edge and corner; the live size is shown and
  **Shift** keeps the aspect ratio. Edges snap to nearby edges and centres (smart guides).
- **Arrow keys** nudge 1px, **Shift+arrow** 10px (CSS `translate`, so layout around it doesn't shift);
  a burst of presses is one undo step. Smart guides show when edges line up.
- **Spacing is never changed by accident:** padding / margin bands can only be dragged in **Spacing mode**
  (**S**) or while holding **Alt**.
- Style panel: text color, font size, weight, font, alignment, background, padding, margin (with preset
  values), corner radius. Brand colors sit first next to every color picker, plus an eyedropper where the
  browser has one (Chrome, Edge). A small live contrast badge sits under the text color.
- Drag a field's label (**Font size**, **Padding**, **Margin**, **Corner radius**) left/right to scrub it.
- **Copy style / Paste style** (**Ctrl+Alt+C / V**) between elements.
- **Hide** (**Delete**), **Move up / down**, **Image…** (an `<img>` or CSS background image, from your computer).
- Undo **Ctrl/⌘+Z**, redo **Ctrl/⌘+Shift+Z** or **Ctrl+Y**. **Before / After** switches all edits off and on.
- Edits save automatically per page (origin + path) and re-apply when you come back, including after the
  site re-renders itself. Edits that can't find their element are listed as **"couldn't re-apply"**.

**Seeing spacing and alignment**
- The selected element shows its margins (orange, outside) and padding (green, inside) with values.
- Hover another element to see the distance to the selected one. Hold **Alt+Shift** and hover to see any
  element's spacing without selecting it. With several selected, the gaps between them are shown, green
  with "=" when they're all equal.
- **Clean canvas** (**\\**) hides every on-page control for keyboard users.

**Motion** (SPEC Phase 2B)
- Select elements, pick an **entrance** (fade in, slide up, slide in from left/right, scale in) that starts
  on page load or when scrolled into view, set duration, delay and easing, then **Add entrance**. With
  several selected it's **staggered** (an offset delay per element, in page order).
- **Hover effects** for buttons, cards and images: lift, grow, glow, color shift.
- **▶ Replay** the selection, or **Replay whole page**. Animated elements carry a "✦ motion" badge, and
  every animation is listed in the change list.
- Motion rules built in: entrances move and fade only (transform / opacity) with ease-out, 300–500 ms by
  default, hover 150–200 ms, never above 1 s, nothing loops, and `prefers-reduced-motion` turns movement off.
  Glow and color shift change paint (shadow / background) on the hovered element only.
- The change list includes the CSS keyframes, the scroll-trigger script (once per page) and the
  reduced-motion query. Content is hidden only by a class the script adds, so it can never stay invisible.

**Fixes**
- **Site brand** at the top: the page's accent, text and background colors, heading/body fonts and button
  corners, read from computed styles the first time you open the tab. Click a color dot or use the pickers
  to change them; **Re-read** reads the page again. They only style *new* fixes and are saved with the project.
- Pick a preset, fill in its fields, choose **Where** (above/below/inside the selected element, or top of
  the page), then **Add to page**. Presets: trust bar, sticky "Call now"/"Book now" button, phone number in
  header, clearer hero, review strip, "Serving [city]" badge, and for shops: free-shipping banner,
  guarantee badge, "Add to cart" emphasis (restyles the selected button).
- Added blocks are ordinary edits: undo/redo, Before/After and restore on reload all work, and you can
  select and edit text or styles inside them.
- Each preset can add a numbered note with neutral wording that says what the fix does.

**Notes**
- Attach a note to any change: select an element and click **📝 Note**, or **+ note** in the change list.
- Notes are numbered in change order and shown as numbered pins on the page (toggle on the Notes tab).

**Export**
- Scroll to the part of the page you want to show, then pick an export. Screenshots are of the visible
  area; the editor hides itself while they're taken.
- **Before / after image (PNG):** both views side by side or stacked, with your agency logo, name and
  color, the prospect's URL, the date, numbered pins on the After view and a notes legend.
- **PDF:** the same, one page per view (Before, then After with pins and notes). Built locally.
- **Change list (.md / .txt):** every change in order, in plain words, with copyable CSS and HTML
  (inserted blocks include any later edits made inside them). For the developer who makes it real.
- **Agency branding** lives in the toolbar popup → *Agency branding*: name, logo, accent color and the
  default layout. Stored in `storage.local` on this device.
- Screenshots use `activeTab`, so the browser allows them after you click the Glow-Up toolbar button
  (or press the shortcut) on that tab. If the editor came back on its own after a reload, click the
  toolbar button once before exporting; the editor tells you if this is needed.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Touch the current tab only when you click the toolbar button or use the shortcut. |
| `scripting` | Inject the editor into that tab. |
| `storage` | Small settings (which sites you said "no" to) in `storage.local`. |
| `unlimitedStorage` | Projects and replaced images live in IndexedDB and can grow past default quotas. |
| `optional_host_permissions` (per site, **not granted at install**) | See below. |

**Why the optional per-site permission exists:** `activeTab` only lasts until the page reloads, so it can't
re-apply your edits by itself when you come back. The first time you click **Edit this page** on a site,
the browser asks whether Glow-Up may run on *that one site* (e.g. `https://example.com/*`). If you allow it,
saved edits re-apply on their own when you return. If you decline, nothing breaks: your edits are still
saved and come back as soon as you click **Edit this page**. You can turn this on or off per site with the
checkbox in the popup. Deleting a site's last project removes the permission again. Glow-Up never asks for
"all sites", and the install prompt shows no host access.

## Keeping edits on dynamic sites, and `dom-mutator` (SPEC section 4)

The spec asks to evaluate the open-source [`dom-mutator`](https://www.npmjs.com/package/dom-mutator) before
writing our own. Decision: **keep Glow-Up's own re-apply layer.** `dom-mutator` applies mutations by CSS
selector and keeps them applied with a MutationObserver, which suits A/B-test style changes. Glow-Up's edit
model needs more than that, which `dom-mutator` doesn't cover:

- a fingerprint fallback when a selector breaks, and an honest "couldn't re-apply" list instead of silence;
- ops replayed in order with exact undo / redo, grouped steps and an instant Before / After;
- inserted blocks, replaced images from local storage and animation ops in the same history.

What we took from the same idea: one MutationObserver per page, throttled to a single check per animation
frame (with a timer for background tabs) so a re-render is corrected before it's painted; only the newest op
per element and property is re-applied; and each op is re-applied a limited number of times so we never fight
a page that keeps changing. Optimizely documents that this approach can still miss very fast hydration
updates, so test React / Next.js sites specifically (SPEC section 7).

## Hard rules check (SPEC section 2)

- No server, accounts, analytics, ads, AI or paid APIs. The built bundle has no `fetch`/XHR/beacon calls.
- All code is bundled. There are no runtime dependencies at all (WXT, Vitest etc. are build-time only).
- The real website is never modified: edits exist only in your browser's view of the page.
- Nothing from SPEC section 3 is built: no scanning, scoring, audits, recommendations or tracking.

## Project layout

```
lib/model/      edit model (SPEC section 5): types, selector + fingerprint, ops, EditSession (undo/redo,
                replay, before/after, reassert), project helpers. Has no extension APIs, so other
                tools can produce or consume projects later.
lib/db.ts       IndexedDB: projects + images (extension origin only)
lib/brand.ts    brand capture: colors, fonts and button style from computed styles
lib/presets.ts  fix library presets: (brand, field values) -> inline-styled block HTML or style changes
lib/settings.ts agency branding settings (storage.local)
lib/export/     canvas layout for PNG/PDF pages, a minimal local PDF writer, the developer change list
lib/model/animation.ts  Phase 2B: runs animation ops (Web Animations API) and writes their CSS / JS
lib/editor/     in-page editor: controller (load/save/restore), Shadow DOM host, UI (selection, keyboard,
                gestures), overlays (spacing, measuring, guides, handles), geometry, command palette,
                Fixes / Motion / Export tabs, CSS
entrypoints/    background (inject, per-site restore scripts), editor content script, popup
tests/          vitest suites for the model and storage
dev/            harness for trying the editor on real pages without loading the extension
```

## Dev harness

`npm run harness`, then open `http://localhost:5179/p/https/<host>/<path>` (e.g.
`/p/https/theme-dawn-demo.myshopify.com/`). It serves the real page's HTML with the editor attached and
localStorage instead of extension storage. Call `await __glowup.toggle()` in the console to open the editor.
For development only. It is not part of the extension.
