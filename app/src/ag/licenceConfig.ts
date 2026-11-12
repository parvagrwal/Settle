// Licence configuration that needs no rendering library.
//
// The keys come from the build environment and are handed unchanged to the
// vendor APIs by `license.ts`. Reading and trimming them lives here so the
// product route can publish configuration without loading AG Grid or AG Studio.
//
// - Keys are supplied at build time through `VITE_AG_GRID_LICENSE_KEY` and
//   `VITE_AG_STUDIO_LICENSE_KEY` (see `.env.example`). They are never committed.
// - They are never invented, logged or rendered.
export interface LicenceKeys { grid: string | null; studio: string | null }

/** Judging ends on this date; winners are announced around 21 December. No change may be made after the submission deadline. */
export const JUDGING_ENDS = new Date("2026-12-15T23:59:59Z");

export function readLicenceKeys(env: Record<string, unknown>): LicenceKeys {
  const clean = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().replace(/^["']|["']$/g, "").trim();
    return trimmed === "" ? null : trimmed;
  };
  return { grid: clean(env.VITE_AG_GRID_LICENSE_KEY), studio: clean(env.VITE_AG_STUDIO_LICENSE_KEY) };
}
