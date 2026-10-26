import * as db from '@/lib/db';
import { EDITOR_SCRIPT, isEditableUrl, onMessage, sendToTab, type BackgroundMessage, type CaptureResult } from '@/lib/messages';

const RESTORE_SCRIPT_ID = 'glowup-restore';

/** Inject the editor into a tab (if it isn't there yet) and toggle edit mode. */
async function toggleEditor(tabId: number): Promise<void> {
  const tab = await browser.tabs.get(tabId);
  if (!isEditableUrl(tab.url)) return;
  if (!(await isInjected(tabId))) await inject(tabId);
  await sendToTab(tabId, { type: 'editor:toggle' });
}

/**
 * Uses activeTab: the browser allows it after the user clicked the toolbar button or used the
 * shortcut on this tab (no extra permission needed). If they opened the editor some other way
 * (e.g. from the "restored" toast), it is refused and the editor asks them to click the button.
 */
async function capture(tab: Browser.tabs.Tab | undefined): Promise<CaptureResult> {
  if (!tab?.id || tab.windowId == null) return { error: 'No tab to capture.' };
  try {
    return { dataUrl: await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' }) };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}

async function isInjected(tabId: number): Promise<boolean> {
  try {
    return (await sendToTab<boolean>(tabId, { type: 'editor:ping' })) === true;
  } catch {
    return false;
  }
}

async function inject(tabId: number): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId }, files: [EDITOR_SCRIPT] });
}

/**
 * Sites the user allowed for automatic restore get a content script registered for them, so
 * saved edits re-apply when they come back without clicking anything. Only origins the user
 * granted one at a time are ever included.
 */
async function syncRestoreScripts(): Promise<void> {
  const { origins = [] } = await browser.permissions.getAll();
  const matches = origins.filter((o) => /^https?:\/\/[^*]/.test(o));
  try {
    await browser.scripting.unregisterContentScripts({ ids: [RESTORE_SCRIPT_ID] });
  } catch {
    /* not registered yet */
  }
  if (!matches.length) return;
  await browser.scripting.registerContentScripts([
    { id: RESTORE_SCRIPT_ID, matches, js: [EDITOR_SCRIPT], runAt: 'document_idle', persistAcrossSessions: false },
  ]);
}

/** After the user grants a site, restore edits in tabs already open on it. */
async function injectIntoOpenTabs(origins: string[]): Promise<void> {
  if (!origins.length) return;
  const tabs = await browser.tabs.query({ url: origins });
  await Promise.all(
    tabs.map(async (t) => {
      if (t.id != null && !(await isInjected(t.id))) await inject(t.id).catch(() => undefined);
    }),
  );
}

export default defineBackground(() => {
  onMessage<BackgroundMessage>((msg, sender) => {
    switch (msg.type) {
      case 'project:get':
        return db.getProjectByUrl(msg.url);
      case 'project:save':
        return db.saveProject(msg.project);
      case 'assets:get':
        return db.getAssets(msg.ids);
      case 'asset:put':
        return db.putAsset(msg.asset);
      case 'editor:toggle':
        return toggleEditor(msg.tabId);
      case 'tab:capture':
        return capture(sender.tab);
    }
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-editor') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) await toggleEditor(tab.id).catch((e) => console.error('[Glow-Up]', e));
  });

  browser.permissions.onAdded.addListener(async (p) => {
    await syncRestoreScripts();
    await injectIntoOpenTabs(p.origins ?? []);
  });
  browser.permissions.onRemoved.addListener(() => void syncRestoreScripts());
  browser.runtime.onStartup.addListener(() => void syncRestoreScripts());
  browser.runtime.onInstalled.addListener(() => void syncRestoreScripts());
});
