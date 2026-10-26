import * as db from '@/lib/db';
import { isEditableUrl, sendToBackground, sendToTab, sitePattern, type EditorState } from '@/lib/messages';
import { AGENCY_KEY, LOGO_MAX_SIDE, normalizeAgency, type AgencySettings } from '@/lib/settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Sites where the user said no to automatic restore; we don't ask again on every click. */
async function getDeclined(): Promise<string[]> {
  const { declinedSites } = await browser.storage.local.get('declinedSites');
  return Array.isArray(declinedSites) ? declinedSites : [];
}
async function setDeclined(pattern: string, declined: boolean): Promise<void> {
  const list = new Set(await getDeclined());
  if (declined) list.add(pattern);
  else list.delete(pattern);
  await browser.storage.local.set({ declinedSites: [...list] });
}

async function hasSite(pattern: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [pattern] });
}

async function initCurrentTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const toggle = $<HTMLButtonElement>('toggle');
  const auto = $<HTMLInputElement>('auto');
  if (!tab?.id || !isEditableUrl(tab.url)) {
    $('site').textContent = 'Glow-Up can’t edit this page (browser and store pages are off limits).';
    toggle.disabled = true;
    $('auto-wrap').classList.add('hidden');
    return;
  }
  const tabId = tab.id;
  const url = new URL(tab.url!);
  const pattern = sitePattern(url.href)!;
  $('site').textContent = url.hostname + url.pathname;

  let state: EditorState | null = null;
  try {
    state = await sendToTab<EditorState>(tabId, { type: 'editor:state' });
  } catch {
    /* editor not injected in this tab yet */
  }
  if (state?.editing) toggle.textContent = 'Stop editing';

  const granted = await hasSite(pattern);
  const declined = (await getDeclined()).includes(pattern);
  auto.checked = granted;

  toggle.addEventListener('click', () => {
    const turningOn = !state?.editing;
    const done = sendToBackground({ type: 'editor:toggle', tabId });
    // permissions.request must run synchronously inside the click, so it is not awaited first.
    if (turningOn && !granted && !declined) {
      browser.permissions
        .request({ origins: [pattern] })
        .then((ok) => setDeclined(pattern, !ok))
        .catch(() => undefined)
        .finally(() => window.close());
    } else {
      done.finally(() => window.close());
    }
  });

  auto.addEventListener('change', () => {
    if (auto.checked) {
      browser.permissions
        .request({ origins: [pattern] })
        .then(async (ok) => {
          auto.checked = ok;
          await setDeclined(pattern, !ok);
        })
        .catch(() => (auto.checked = false));
    } else {
      void browser.permissions.remove({ origins: [pattern] });
      void setDeclined(pattern, true);
    }
  });
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

async function renderProjects(): Promise<void> {
  const list = await db.listProjects();
  const ul = $('projects');
  $('empty').classList.toggle('hidden', list.length > 0);
  ul.replaceChildren(...list.map(projectRow));
}

function projectRow(p: db.ProjectSummary): HTMLLIElement {
  const li = document.createElement('li');
  const info = document.createElement('div');
  info.className = 'info';
  const title = document.createElement('button');
  title.className = 'title';
  title.textContent = p.title;
  title.title = `Open ${p.url}`;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const u = new URL(p.url);
  meta.textContent = `${u.hostname}${u.pathname === '/' ? '' : u.pathname} · ${p.opCount} change${p.opCount === 1 ? '' : 's'} · ${fmtDate(p.updatedAt)}`;
  info.append(title, meta);

  const rename = document.createElement('button');
  rename.className = 'mini';
  rename.textContent = 'Rename';
  const del = document.createElement('button');
  del.className = 'mini danger';
  del.textContent = 'Delete';
  li.append(info, rename, del);

  title.addEventListener('click', () => openProject(p.url));

  rename.addEventListener('click', () => {
    const input = document.createElement('input');
    input.value = p.title;
    input.setAttribute('aria-label', 'Project name');
    title.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async (save: boolean) => {
      if (finished) return;
      finished = true;
      if (save && input.value.trim()) await db.renameProject(p.id, input.value);
      await renderProjects();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void finish(true);
      if (e.key === 'Escape') void finish(false);
    });
    input.addEventListener('blur', () => void finish(true));
  });

  del.addEventListener('click', () => {
    if (del.dataset.confirm !== '1') {
      del.dataset.confirm = '1';
      del.textContent = 'Delete?';
      rename.textContent = 'Keep';
      rename.onclick = (e) => {
        e.stopImmediatePropagation();
        void renderProjects();
      };
      return;
    }
    void (async () => {
      await db.deleteProject(p.id);
      // Drop the site permission once no saved pages remain on that site.
      const origin = new URL(p.url).origin;
      if (!(await db.projectOrigins()).includes(origin)) {
        const pattern = sitePattern(p.url);
        if (pattern && (await hasSite(pattern))) await browser.permissions.remove({ origins: [pattern] });
      }
      await renderProjects();
    })();
  });
  return li;
}

function openProject(url: string): void {
  const pattern = sitePattern(url);
  if (!pattern) return;
  // Ask for the site in the same click (no prompt if already allowed), so edits restore on load.
  // If the user says no, the page opens anyway and edits restore when they click "Edit this page".
  browser.permissions
    .request({ origins: [pattern] })
    .then((ok) => setDeclined(pattern, !ok))
    .catch(() => undefined);
  void browser.tabs.create({ url });
}

// ---------- agency branding (used by exports) ----------

async function getAgency(): Promise<AgencySettings> {
  const got = await browser.storage.local.get(AGENCY_KEY);
  return normalizeAgency(got[AGENCY_KEY]);
}

async function saveAgency(patch: Partial<AgencySettings>): Promise<AgencySettings> {
  const next = normalizeAgency({ ...(await getAgency()), ...patch });
  await browser.storage.local.set({ [AGENCY_KEY]: next });
  $('agency-saved').textContent = 'Saved on this device only.';
  return next;
}

/** Logos are scaled down and stored as PNG so exports stay small and keep transparency. */
function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || LOGO_MAX_SIDE) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || LOGO_MAX_SIDE) * scale));
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read.'));
    };
    img.src = url;
  });
}

async function initAgency(): Promise<void> {
  const a = await getAgency();
  const name = $<HTMLInputElement>('agency-name');
  const accent = $<HTMLInputElement>('agency-accent');
  const preview = $<HTMLImageElement>('agency-logo-preview');
  const remove = $('agency-logo-remove');
  const file = $<HTMLInputElement>('agency-logo');
  const showLogo = (logo: string) => {
    preview.classList.toggle('hidden', !logo);
    remove.classList.toggle('hidden', !logo);
    if (logo) preview.src = logo;
    else preview.removeAttribute('src');
  };

  name.value = a.name;
  accent.value = a.accent;
  showLogo(a.logo);
  for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="agency-layout"]'))) {
    r.checked = r.value === a.layout;
    r.addEventListener('change', () => r.checked && void saveAgency({ layout: r.value as AgencySettings['layout'] }));
  }
  name.addEventListener('change', () => void saveAgency({ name: name.value.trim() }));
  accent.addEventListener('change', () => void saveAgency({ accent: accent.value }));
  $('agency-logo-pick').addEventListener('click', () => file.click());
  remove.addEventListener('click', async () => showLogo((await saveAgency({ logo: '' })).logo));
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      showLogo((await saveAgency({ logo: await readLogo(f) })).logo);
    } catch (e) {
      $('agency-saved').textContent = (e as Error).message;
    }
  });
}

void initCurrentTab();
void renderProjects();
void initAgency();
