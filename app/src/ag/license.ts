// Licence keys for AG Grid Enterprise and AG Studio.
//
// How it works, and what it deliberately does not do:
//
// - Keys are supplied at build time through `VITE_AG_GRID_LICENSE_KEY` and
//   `VITE_AG_STUDIO_LICENSE_KEY` (see `.env.example`). They are never committed.
// - They are handed, unchanged, to the vendor's documented entry points:
//   `LicenseManager.setLicenseKey` for the grid and the `licenseKey` of
//   `AgStudioProvider` for Studio. Validation is entirely the vendor's.
// - With no key the libraries run in their documented evaluation mode: every
//   feature works, a notice is printed to the console and a watermark is shown
//   on hosts other than localhost. Nothing here hides or suppresses that.
// - The two products are licensed separately. A Studio licence does not cover
//   AG Grid Enterprise used outside Studio, and registering the Studio AI module
//   raises the required Studio licence to "Pro with AI".
import { LicenseManager } from "ag-grid-enterprise";
import { AgStudioLicenseManager } from "ag-studio";

/** Winners are announced around this date; nothing may be changed after the submission deadline. */
export const JUDGING_ENDS = new Date("2026-12-21T23:59:59Z");

export interface LicenceKeys { grid: string | null; studio: string | null }

export function readLicenceKeys(env: Record<string, unknown>): LicenceKeys {
  const clean = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().replace(/^["']|["']$/g, "").trim();
    return trimmed === "" ? null : trimmed;
  };
  return { grid: clean(env.VITE_AG_GRID_LICENSE_KEY), studio: clean(env.VITE_AG_STUDIO_LICENSE_KEY) };
}

/** The subset of the vendor's `getLicenseDetails` result this module reads. */
export interface VendorLicenceDetails {
  valid: boolean;
  missing?: boolean;
  incorrectLicenseType?: boolean;
  currentLicenseType?: string;
  suppliedLicenseType?: string;
  expiry?: string;
  expired?: boolean;
  isTrial?: boolean | null;
  trialExpired?: boolean;
}

export type LicenceState = "missing" | "invalid" | "incompatible" | "expired" | "valid" | "unknown";

export interface LicenceStatus {
  product: string;
  state: LicenceState;
  requiredType: string | null;
  suppliedType: string | null;
  isTrial: boolean | null;
  expiry: string | null;
  /** True only when a valid key will still be valid when judging ends. */
  coversJudging: boolean;
  summary: string;
}

export function describeLicence(input: { product: string; key: string | null; details: VendorLicenceDetails | null; now: Date }): LicenceStatus {
  const { product, details } = input;
  const base = { product, requiredType: details?.currentLicenseType ?? null, suppliedType: details?.suppliedLicenseType ?? null, isTrial: details?.isTrial ?? null, expiry: details?.expiry ?? null };
  if (!input.key) {
    return { ...base, state: "missing", coversJudging: false, summary: `${product}: no licence key configured. Running in the vendor's evaluation mode: all features are unlocked for trial, with a console notice and a watermark on hosts other than localhost.` };
  }
  if (!details) {
    return { ...base, state: "unknown", coversJudging: false, summary: `${product}: a key is configured but this version exposes no way to inspect it. The library validates it when it starts; check the browser console.` };
  }
  if (!details.valid) {
    if (details.incorrectLicenseType) {
      return { ...base, state: "incompatible", coversJudging: false, summary: `${product}: the key is for ${details.suppliedLicenseType ?? "another product"} and does not cover ${details.currentLicenseType ?? "this configuration"}.` };
    }
    return { ...base, state: "invalid", coversJudging: false, summary: `${product}: the configured key is not valid.` };
  }
  const expiry = details.expiry ? new Date(details.expiry) : null;
  const expiryKnown = expiry !== null && !Number.isNaN(expiry.getTime());
  if (details.isTrial) {
    if (details.trialExpired || (expiryKnown && expiry < input.now)) {
      return { ...base, state: "expired", coversJudging: false, summary: `${product}: the trial key expired on ${details.expiry ?? "an unknown date"}.` };
    }
    const covers = expiryKnown && expiry >= JUDGING_ENDS;
    return {
      ...base, state: "valid", coversJudging: covers,
      summary: covers
        ? `${product}: trial key valid until ${details.expiry}, after judging ends (${JUDGING_ENDS.toISOString().slice(0, 10)}).`
        : `${product}: trial key valid until ${details.expiry ?? "an unknown date"}, which is before judging ends (${JUDGING_ENDS.toISOString().slice(0, 10)}). Request an extension or a new key.`,
    };
  }
  if (details.expired) {
    return { ...base, state: "expired", coversJudging: false, summary: `${product}: the key covers versions released before ${details.expiry ?? "an earlier date"}; this version is newer.` };
  }
  return { ...base, state: "valid", coversJudging: true, summary: `${product}: licence key valid for this version.` };
}

/** Ask each vendor validator about the configured key. Read-only; a key is never returned or logged. */
export function licenceReport(keys: LicenceKeys, options: { studioNeedsAi: boolean; now?: Date }): { grid: LicenceStatus; studio: LicenceStatus } {
  const now = options.now ?? new Date();
  const gridDetails = keys.grid ? LicenseManager.getLicenseDetails(keys.grid) as VendorLicenceDetails : null;
  // `AgStudioLicenseManager.getLicenseDetails` is marked internal by the vendor. It is used here for a
  // diagnostic only; if a later version removes it the status degrades to "unknown" rather than guessing.
  const inspectStudio = (AgStudioLicenseManager as unknown as { getLicenseDetails?: (key: string, licences: Set<string>) => VendorLicenceDetails }).getLicenseDetails;
  const required = new Set<string>(options.studioNeedsAi ? ["PRO-AI"] : ["CORE"]);
  const studioDetails = keys.studio && typeof inspectStudio === "function" ? inspectStudio.call(AgStudioLicenseManager, keys.studio, required) : null;
  const studio = describeLicence({ product: "AG Studio", key: keys.studio, details: studioDetails, now });
  return {
    grid: { ...describeLicence({ product: "AG Grid Enterprise", key: keys.grid, details: gridDetails, now }), requiredType: gridDetails?.currentLicenseType ?? "GRID" },
    studio: { ...studio, requiredType: studio.requiredType ?? (options.studioNeedsAi ? "STUDIO-PRO-AI" : "STUDIO-CORE") },
  };
}

/** Hand the grid key to AG Grid Enterprise. Called once, before any grid exists. */
export function applyGridLicence(key: string | null): void {
  if (key) LicenseManager.setLicenseKey(key);
}
