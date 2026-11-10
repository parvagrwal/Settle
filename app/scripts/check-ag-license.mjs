// Licence check for AG Grid Enterprise and AG Studio.
//
// Reads the two licence keys from the environment, falling back to `app/.env`
// then the repo-root `.env`, and asks each vendor validator about them. A key
// value is never printed or logged, only whether one is configured and where
// it came from. Run with: `npm --prefix app run license:check`.
//
// Exit code: 1 when a configured key is invalid, expired, for the wrong
// product, or a trial that ends before judging (2026-12-21). 0 when no key is
// configured (the libraries run in their evaluation mode: all features work,
// with a console notice and a watermark on hosts other than localhost) or when
// every configured key is valid and covers judging.
import { readFileSync, existsSync } from "node:fs";
import { licenceReport, readLicenceKeys, JUDGING_ENDS } from "../src/ag/license.ts";

const KEY_VARS = ["VITE_AG_GRID_LICENSE_KEY", "VITE_AG_STUDIO_LICENSE_KEY"];

function readEnvFile(path) {
  const found = {};
  if (!existsSync(path)) return found;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && KEY_VARS.includes(match[1])) found[match[1]] = match[2].trim();
  }
  return found;
}

// Process environment wins; then app/.env; then the repo-root .env.
const fromFiles = { ...readEnvFile(".env"), ...readEnvFile("../.env") };
const env = {};
const source = {};
for (const name of KEY_VARS) {
  if (process.env[name] !== undefined && process.env[name] !== "") {
    env[name] = process.env[name];
    source[name] = "environment";
  } else if (fromFiles[name] !== undefined && fromFiles[name] !== "") {
    env[name] = fromFiles[name];
    source[name] = ".env file";
  }
}

const keys = readLicenceKeys(env);
// The Studio AI module is used by one workspace, so a Studio key must cover
// the Pro-with-AI requirement: the strictest licence the app needs.
const report = licenceReport(keys, { studioNeedsAi: true });

let bad = false;
for (const [product, status] of [["AG Grid Enterprise", report.grid], ["AG Studio", report.studio]]) {
  const keyName = product === "AG Grid Enterprise" ? KEY_VARS[0] : KEY_VARS[1];
  const where = keys[product === "AG Grid Enterprise" ? "grid" : "studio"] ? ` (from ${source[keyName]})` : "";
  console.log(`${status.summary}${where}`);
  if (status.state === "invalid" || status.state === "incompatible" || status.state === "expired") bad = true;
  if (status.state === "valid" && !status.coversJudging) bad = true;
}
console.log(`Judging ends ${JUDGING_ENDS.toISOString().slice(0, 10)}. A trial key must still be valid then.`);
if (bad) {
  console.log("Licence check FAILED: a configured key does not cover judging. Request an extension or a new key.");
  process.exit(1);
}
console.log("Licence check passed.");
