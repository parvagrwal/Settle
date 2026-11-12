// The single start-up point for everything AG.
//
// Imported first by `main.tsx`, before any component module, so the design
// tokens are published before React mounts.
//
// The AG Grid, AG Charts and AG Studio libraries are heavy and belong to the
// historical and review surfaces, not to the product route. They are therefore
// registered on demand: `ensureAgModules()` is awaited by the screens that
// actually create a grid, chart or studio instance. Nothing else in the source
// tree registers a module or sets a key (`modules.test.ts` enforces that).
import { applyDesignTokens } from "./tokens.ts";
import { readLicenceKeys, type LicenceKeys } from "./licenceConfig.ts";

export const licenceKeys: LicenceKeys = readLicenceKeys(import.meta.env);

// 1. Publish the design tokens to CSS before the first paint.
applyDesignTokens();

let registration: Promise<void> | null = null;

/**
 * Register the AG modules, charts and the grid licence exactly once.
 *
 * The import is dynamic so the product route never loads these libraries. The
 * order is the vendor's: the licence key is set before the first grid exists,
 * the grid modules are registered next, and the chart modules follow.
 */
export function ensureAgModules(): Promise<void> {
  if (registration === null) {
    registration = (async () => {
      const [grid, charts, modules, licence] = await Promise.all([
        import("ag-grid-community"),
        import("ag-charts-community"),
        import("./modules.ts"),
        import("./license.ts"),
      ]);
      // 1. Licence first: AG Grid Enterprise validates when the first grid is created.
      licence.applyGridLicence(licenceKeys.grid);
      // 2. AG Grid: exactly the modules the application's features need.
      grid.ModuleRegistry.registerModules(modules.gridModules({ development: import.meta.env.DEV }));
      // 3. AG Charts, for the one standalone chart outside Studio.
      const { ModuleRegistry: ChartsModuleRegistry } = charts;
      ChartsModuleRegistry.registerModules([charts.AllCommunityModule]);
    })();
  }
  return registration;
}
