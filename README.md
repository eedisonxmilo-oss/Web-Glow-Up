# Website Glow-Up (Phases 1–3: editor, fix library, notes, exports)

Free browser extension: open a live page, improve it in place, and your edits stay on your device.
`SPEC.md` is the source of truth. This repo implements **Phases 1, 2 and 3**.

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
- Hover to highlight, click to select. The breadcrumb (and **Parent**) select ancestors.
- Double-click or press **Enter** to edit text. **Enter** finishes, **Shift+Enter** adds a new line, **Esc** cancels.
- Style panel: text color, font size, weight, font, alignment, background, padding, margin, corner radius.
- **Hide**, **Move up / down** (among siblings), **Image…** (replaces an `<img>` or a CSS background image with a file from your computer).
- Undo **Ctrl/⌘+Z**, redo **Ctrl/⌘+Shift+Z** or **Ctrl+Y**. **Esc** deselects.
- **Before / After** switches all edits off and on.
- Edits save automatically per page (origin + path). When you come back they are re-applied. Edits that can't find their element are listed as **"couldn't re-apply"** (try again, or remove them).
- Popup → **Projects**: open, rename, delete.

The panel has four tabs: **Edit** (above), **Fix library**, **Notes** and **Export**.

**Fix library**
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
lib/editor/     in-page editor: controller (load/save/restore), Shadow DOM host, UI, fix library tab, CSS
entrypoints/    background (inject, per-site restore scripts), editor content script, popup
tests/          vitest suites for the model and storage
dev/            harness for trying the editor on real pages without loading the extension
```

## Dev harness

`npm run harness`, then open `http://localhost:5179/p/https/<host>/<path>` (e.g.
`/p/https/theme-dawn-demo.myshopify.com/`). It serves the real page's HTML with the editor attached and
localStorage instead of extension storage. Call `await __glowup.toggle()` in the console to open the editor.
For development only. It is not part of the extension.
