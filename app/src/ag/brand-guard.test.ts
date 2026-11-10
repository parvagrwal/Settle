import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The approved brand values belong in the token source only, not individual screens.
describe("brand token boundary", () => {
  it("does not hardcode approved brand values outside the token source", () => {
    const root = join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(css|tsx|ts)$/.test(path) && !path.endsWith("theme.ts") && !path.endsWith("brand-guard.test.ts") && /(?:#(?:241e2b|b5c0cf|d9e95b)(?:[0-9a-f]{2})?\b|rgba?\(\s*(?:36\s*,\s*30\s*,\s*43|181\s*,\s*192\s*,\s*207|217\s*,\s*233\s*,\s*91)\b)/i.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
