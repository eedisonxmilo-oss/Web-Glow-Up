// Agency branding for exports (SPEC.md Phase 3). Stored in storage.local under AGENCY_KEY;
// edited in the popup, read by the editor when exporting. Nothing here leaves the device.

export type ExportLayout = 'side' | 'stacked';

export interface AgencySettings {
  name: string;
  /** data: URL, scaled down to at most LOGO_MAX_SIDE px. Empty for none. */
  logo: string;
  /** Hex color for labels, pins and the notes legend. */
  accent: string;
  /** Default before/after arrangement (SPEC section 8 leaves this open; side by side by default). */
  layout: ExportLayout;
}

export const AGENCY_KEY = 'agency';
export const LOGO_MAX_SIDE = 400;

export const DEFAULT_AGENCY: AgencySettings = { name: '', logo: '', accent: '#6d28d9', layout: 'side' };

/** Fill in defaults and drop anything malformed (settings may come from an older version). */
export function normalizeAgency(raw: unknown): AgencySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AgencySettings>;
  return {
    name: typeof r.name === 'string' ? r.name.slice(0, 80) : DEFAULT_AGENCY.name,
    logo: typeof r.logo === 'string' && r.logo.startsWith('data:image/') ? r.logo : '',
    accent: typeof r.accent === 'string' && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent : DEFAULT_AGENCY.accent,
    layout: r.layout === 'stacked' ? 'stacked' : 'side',
  };
}
