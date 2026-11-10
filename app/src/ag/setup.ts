// The single start-up point for everything AG.
//
// Imported first by `main.tsx`, before any component module, so that modules
// and licence keys are in place before the first grid, chart or Studio instance
// is created. Nothing else in the source tree registers a module or sets a key
// (`modules.test.ts` enforces that).
import { ModuleRegistry } from "ag-grid-community";
import { AllCommunityModule as AllChartsCommunityModule, ModuleRegistry as ChartsModuleRegistry } from "ag-charts-community";
import { enableStudioDevValidations } from "ag-studio";
import { gridModules } from "./modules.ts";
import { applyGridLicence, readLicenceKeys } from "./license.ts";
import { applyDesignTokens } from "./theme.ts";

export const licenceKeys = readLicenceKeys(import.meta.env);

// 1. Licence first: AG Grid Enterprise validates when the first grid is created.
applyGridLicence(licenceKeys.grid);

// 2. AG Grid: exactly the modules the application's features need.
ModuleRegistry.registerModules(gridModules({ development: import.meta.env.DEV }));

// 3. AG Charts, for the one standalone chart outside Studio.
ChartsModuleRegistry.registerModules([AllChartsCommunityModule]);

// 4. Studio's extended checks in development only. Studio's own modules and its
//    licence key are supplied per instance through `AgStudioProvider` (see StudioProvider.tsx).
if (import.meta.env.DEV) enableStudioDevValidations();

// 5. One visual language: publish the theme tokens to CSS.
applyDesignTokens();
