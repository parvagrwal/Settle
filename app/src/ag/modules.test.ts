// The module list is architecture, so it is tested like architecture:
// one registration point, only the modules a feature in the code needs,
// and no "All…" bundle that would hide a missing registration.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENTERPRISE_MODULE_NAMES, GRID_FEATURES, GRID_MODULES, gridModules } from "./modules.ts";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("AG Grid module registration", () => {
  it("registers each module once and names a feature for every one of them", () => {
    const names = GRID_MODULES.map((module) => module.moduleName);
    expect(new Set(names).size).toBe(names.length);
    for (const module of GRID_MODULES) {
      expect(GRID_FEATURES.some((feature) => feature.modules.includes(module)), `${module.moduleName} is justified by a feature`).toBe(true);
    }
    for (const feature of GRID_FEATURES) {
      expect(feature.usedBy.length, `${feature.feature} names where it is used`).toBeGreaterThan(0);
      expect(feature.modules.length).toBeGreaterThan(0);
    }
  });

  it("registers exactly the Enterprise modules the application uses, and no catch-all bundle", () => {
    expect([...ENTERPRISE_MODULE_NAMES].sort()).toEqual(["Clipboard", "ColumnsToolPanel", "ContextMenu", "FiltersToolPanel", "MasterDetail", "SetFilter", "SideBar", "StatusBar"]);
    const names = GRID_MODULES.map((module) => module.moduleName);
    expect(names).not.toContain("AllCommunity");
    expect(names).not.toContain("AllEnterprise");
    for (const unused of ["RowGrouping", "Pivot", "ServerSideRowModel", "IntegratedCharts", "ExcelExport", "CellSelection", "AdvancedFilter", "TreeData"]) {
      expect(names, `${unused} is not used by the application`).not.toContain(unused);
    }
  });

  it("covers every feature the two fixed errors named", () => {
    const names = GRID_MODULES.map((module) => module.moduleName);
    for (const required of ["SideBar", "ContextMenu", "ColumnsToolPanel", "FiltersToolPanel", "SetFilter", "ClientSideRowModel", "RowSelection", "Pagination", "QuickFilter", "ExternalFilter", "CsvExport"]) {
      expect(names).toContain(required);
    }
  });

  it("adds the validation module in development only", () => {
    expect(gridModules({ development: true }).map((module) => module.moduleName)).toContain("Validation");
    expect(gridModules({ development: false }).map((module) => module.moduleName)).not.toContain("Validation");
  });

  it("is the only place in the source tree that registers AG Grid or AG Charts modules or sets a licence key", () => {
    const offenders: string[] = [];
    const licenceCallers: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      const relative = file.slice(sourceRoot.length + 1);
      const text = readFileSync(file, "utf8");
      // ag/license.ts wraps the vendor call; ag/setup.ts is the only caller of that wrapper.
      if (relative !== join("ag", "setup.ts") && relative !== join("ag", "license.ts") && /\.registerModules\s*\(|setLicenseKey\s*\(/.test(text)) offenders.push(relative);
      if (relative !== join("ag", "license.ts") && /applyGridLicence\s*\(/.test(text)) licenceCallers.push(relative);
    }
    expect(offenders).toEqual([]);
    expect(licenceCallers).toEqual([join("ag", "setup.ts")]);
    const setup = readFileSync(join(sourceRoot, "ag", "setup.ts"), "utf8");
    expect(setup.match(/(?<!Charts)ModuleRegistry\.registerModules\(/g)?.length).toBe(1);
    expect(setup.match(/ChartsModuleRegistry\.registerModules\(/g)?.length).toBe(1);
  });

  it("loads the registration before any component that could create a grid", () => {
    const main = readFileSync(join(sourceRoot, "main.tsx"), "utf8");
    const firstImport = main.split("\n").find((line) => line.startsWith("import "));
    expect(firstImport).toContain("./ag/setup.ts");
  });

  it("no component uses the deprecated selection properties or the inert Alpine class", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      const text = readFileSync(file, "utf8");
      if (/\bcheckboxSelection\s*:|\bheaderCheckboxSelection\s*:|ag-theme-(alpine|balham|material|quartz)/.test(text)) offenders.push(file.slice(sourceRoot.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});
