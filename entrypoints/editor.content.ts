// The in-page editor. Not listed in the manifest: it is injected with activeTab when the user
// clicks the toolbar button / shortcut, or registered per site after the user allows automatic
// restore (see background.ts).

import { GlowUp, type EditorStore } from '@/lib/editor/controller';
import { onMessage, sendToBackground, type CaptureResult, type EditorState, type TabMessage } from '@/lib/messages';
import { AGENCY_KEY, normalizeAgency } from '@/lib/settings';

const store: EditorStore = {
  getProject: (url) => sendToBackground({ type: 'project:get', url }),
  saveProject: (project) => sendToBackground({ type: 'project:save', project }),
  getAssets: (ids) => sendToBackground({ type: 'assets:get', ids }),
  putAsset: (asset) => sendToBackground({ type: 'asset:put', asset }),
  getAgency: async () => normalizeAgency((await browser.storage.local.get(AGENCY_KEY))[AGENCY_KEY]),
  capture: async () => (await sendToBackground<CaptureResult | null>({ type: 'tab:capture' })) ?? { error: 'No answer from the extension.' },
};

declare global {
  interface Window {
    __glowup?: GlowUp;
  }
}

export default defineContentScript({
  registration: 'runtime',
  main() {
    // May be injected more than once (toolbar click + auto-restore); only boot once per page.
    if (window.__glowup || window.top !== window) return;
    const app = new GlowUp(store);
    window.__glowup = app;

    onMessage<TabMessage>((msg) => {
      switch (msg.type) {
        case 'editor:ping':
          return Promise.resolve(true);
        case 'editor:toggle':
          return app.toggle();
        case 'editor:state':
          return Promise.resolve<EditorState>({
            editing: app.editing,
            opCount: app.session.getOps().length,
            failedCount: app.session.failedOps().length,
          });
      }
    });
  },
});
