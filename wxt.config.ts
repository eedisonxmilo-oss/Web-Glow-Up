import { defineConfig } from 'wxt';

// See SPEC.md section 2 (hard rules) and section 4 (tech stack).
export default defineConfig({
  manifestVersion: 3,
  // No network code at all in the bundle (Vite's modulepreload polyfill uses fetch).
  vite: () => ({ build: { modulePreload: { polyfill: false } } }),
  manifest: ({ browser }) => ({
    name: 'Website Glow-Up',
    description: 'Edit any live web page in place, locally. Nothing leaves your device.',
    // Minimal permissions (SPEC 2.6 / 4):
    //  activeTab        - touch the current tab only when the user clicks the toolbar button or shortcut
    //  scripting        - inject the editor into that tab
    //  storage          - settings in storage.local
    //  unlimitedStorage - IndexedDB projects and replaced images can exceed default quotas
    permissions: ['activeTab', 'scripting', 'storage', 'unlimitedStorage'],
    // Not granted at install. Requested one site at a time, only when the user opts in to
    // "restore my edits automatically on this site", so saved edits re-apply when they return
    // without clicking. Never requested for all sites. See README "Permissions".
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    commands: {
      'toggle-editor': {
        suggested_key: { default: 'Alt+Shift+E' },
        description: 'Toggle edit mode on the current tab',
      },
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'website-glow-up@local',
              strict_min_version: '128.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
});
