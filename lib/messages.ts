// Messages between the in-page editor (content script), the background and the popup.
// Everything stays inside the extension; nothing is sent to any server.

import type { Asset } from './db';
import type { Project } from './model/types';

export type BackgroundMessage =
  | { type: 'project:get'; url: string }
  | { type: 'project:save'; project: Project }
  | { type: 'assets:get'; ids: string[] }
  | { type: 'asset:put'; asset: Asset }
  | { type: 'editor:toggle'; tabId: number }
  /** Screenshot of the visible part of the sender's tab, for exports. */
  | { type: 'tab:capture' };

export type CaptureResult = { dataUrl: string } | { error: string };

export type TabMessage = { type: 'editor:ping' } | { type: 'editor:toggle' } | { type: 'editor:state' };

export interface EditorState {
  editing: boolean;
  opCount: number;
  failedCount: number;
}

/** Path of the runtime-registered content script, as WXT emits it. */
export const EDITOR_SCRIPT = '/content-scripts/editor.js' as const;

export function sendToBackground<T = unknown>(msg: BackgroundMessage): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

export function sendToTab<T = unknown>(tabId: number, msg: TabMessage): Promise<T> {
  return browser.tabs.sendMessage(tabId, msg) as Promise<T>;
}

/**
 * Wires an async handler to runtime.onMessage using sendResponse, which behaves the same in
 * Chrome and Firefox.
 */
export function onMessage<M>(handler: (msg: M, sender: Browser.runtime.MessageSender) => Promise<unknown> | undefined): void {
  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const result = handler(msg as M, sender);
    if (!result) return false;
    result.then(
      (value) => sendResponse(value ?? null),
      (err) => {
        console.error('[Glow-Up]', err);
        sendResponse(null);
      },
    );
    return true;
  });
}

/** Match pattern covering one site (any port), e.g. https://example.com/* */
export function sitePattern(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** Pages extensions aren't allowed to script, or that make no sense to edit. */
export function isEditableUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (!/^https?:/i.test(url)) return false;
  return !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|addons\.mozilla\.org|microsoftedge\.microsoft\.com\/addons)/i.test(url);
}
