// Licence handling: keys come from the environment at build time, are handed to
// the official AG APIs unchanged, and are never invented, logged or rendered.
import { describe, expect, it, vi } from "vitest";
import { JUDGING_ENDS, describeLicence, licenceReport, readLicenceKeys } from "./license.ts";

describe("licence configuration", () => {
  it("reads the two keys from the build environment and trims accidental whitespace or quotes", () => {
    expect(readLicenceKeys({})).toEqual({ grid: null, studio: null });
    expect(readLicenceKeys({ VITE_AG_GRID_LICENSE_KEY: "  ", VITE_AG_STUDIO_LICENSE_KEY: "" })).toEqual({ grid: null, studio: null });
    expect(readLicenceKeys({ VITE_AG_GRID_LICENSE_KEY: ' "grid-key" \n', VITE_AG_STUDIO_LICENSE_KEY: "studio-key" })).toEqual({ grid: "grid-key", studio: "studio-key" });
  });

  it("reports a missing key as evaluation mode, in the vendor's own terms", () => {
    const report = describeLicence({ product: "AG Grid Enterprise", key: null, details: null, now: new Date("2026-11-10T00:00:00Z") });
    expect(report.state).toBe("missing");
    expect(report.coversJudging).toBe(false);
    expect(report.summary).toMatch(/no licence key/i);
    expect(report.summary).toMatch(/trial/i);
  });

  it("reports an invalid key without echoing it", () => {
    const report = describeLicence({ product: "AG Studio", key: "not-a-key", details: { valid: false, incorrectLicenseType: false, currentLicenseType: "STUDIO-PRO-AI" }, now: new Date("2026-11-10T00:00:00Z") });
    expect(report.state).toBe("invalid");
    expect(JSON.stringify(report)).not.toContain("not-a-key");
  });

  it("reports a key of the wrong type as incompatible and says which type is required", () => {
    const report = describeLicence({ product: "AG Studio", key: "k", details: { valid: false, incorrectLicenseType: true, currentLicenseType: "STUDIO-PRO-AI", suppliedLicenseType: "STUDIO-CORE" }, now: new Date("2026-11-10T00:00:00Z") });
    expect(report.state).toBe("incompatible");
    expect(report.summary).toContain("STUDIO-PRO-AI");
    expect(report.summary).toContain("STUDIO-CORE");
  });

  it("checks a trial key's expiry against the end of judging", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    const during = describeLicence({ product: "AG Grid Enterprise", key: "k", details: { valid: true, isTrial: true, expiry: "5 December 2026", currentLicenseType: "GRID", suppliedLicenseType: "GRID" }, now });
    expect(during.state).toBe("valid");
    expect(during.isTrial).toBe(true);
    expect(during.coversJudging).toBe(false);
    expect(during.summary).toMatch(/before judging ends/i);
    const after = describeLicence({ product: "AG Grid Enterprise", key: "k", details: { valid: true, isTrial: true, expiry: "25 December 2026", currentLicenseType: "GRID", suppliedLicenseType: "GRID" }, now });
    expect(after.coversJudging).toBe(true);
    const expired = describeLicence({ product: "AG Grid Enterprise", key: "k", details: { valid: true, isTrial: true, expiry: "1 November 2026", currentLicenseType: "GRID", suppliedLicenseType: "GRID" }, now });
    expect(expired.state).toBe("expired");
    expect(JUDGING_ENDS.toISOString().slice(0, 10)).toBe("2026-12-15");
  });

  it("treats a perpetual key as covering judging unless the version is newer than the key allows", () => {
    const ok = describeLicence({ product: "AG Grid Enterprise", key: "k", details: { valid: true, isTrial: false, expired: false, expiry: "1 January 2027", currentLicenseType: "GRID", suppliedLicenseType: "BOTH" }, now: new Date("2026-11-10T00:00:00Z") });
    expect(ok.state).toBe("valid");
    expect(ok.coversJudging).toBe(true);
    const tooNew = describeLicence({ product: "AG Grid Enterprise", key: "k", details: { valid: true, isTrial: false, expired: true, expiry: "1 January 2026", currentLicenseType: "GRID", suppliedLicenseType: "GRID" }, now: new Date("2026-11-10T00:00:00Z") });
    expect(tooNew.state).toBe("expired");
  });

  it("asks the vendor's own validators and never prints a key", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const report = licenceReport({ grid: "grid-secret-key-value", studio: null }, { studioNeedsAi: true, now: new Date("2026-11-10T00:00:00Z") });
    expect(report.grid.state).toBe("invalid");
    expect(report.studio.state).toBe("missing");
    expect(report.studio.requiredType).toBe("STUDIO-PRO-AI");
    expect(JSON.stringify(report)).not.toContain("grid-secret-key-value");
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
