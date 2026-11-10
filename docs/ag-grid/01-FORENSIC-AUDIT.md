# AG Grid / AG Studio forensic audit (Phase 0)

Scope: the AG Grid, AG Charts and AG Studio implementation of the Settle dashboard.
Method: read every file involved, then reproduce in a real browser (bundled Chromium
153 driven by Playwright) against the **unmodified** commit, in the Vite dev server
(React Strict Mode) and in the production build. Nothing was changed before this
audit was complete.

| Item | Value |
| --- | --- |
| Audited commit | `a4590643ee5aff245f1789dd0a5b33ed1471b971` (`main`, single commit) |
| Working tree before audit | clean |
| Branch of this work | `arena/8a6a1df4-settle` |
| Date | 2026-11-10 |
| Node / npm | v22.22.3 / 10.9.8 |
| Earlier audit supplied by the owner | written against `2dea9ac…`; every claim below was re-verified at the commit above |

Raw evidence: `evidence/ag-grid/before/` (the JSON console captures
`before1.json`, `before2.json`, `before4.json`, `before5.json`, plus `build.txt`
and `regression-at-a459064.txt`). The screenshots taken during the audit are
not in this repository: they were not included in the patch that carried this
work, so the rows below cite the JSON captures only.

## 1. Installed versions (from `app/node_modules`, not from memory)

| Package | Declared in `app/package.json` | Installed | Latest on npm (2026-11-10) |
| --- | --- | --- | --- |
| `ag-grid-react` | `36.2.0` | 36.2.0 | 36.3.0 |
| `ag-grid-community` | **not declared** (imported directly by app code) | 36.2.0 (via `ag-grid-react`) | 36.3.0 |
| `ag-grid-enterprise` | **not declared** | 36.2.0 (via `ag-studio`) | 36.3.0 |
| `ag-charts-community` / `ag-charts-react` | `14.2.0` | 14.2.0 | 14.3.0 |
| `ag-charts-enterprise` | not declared | 14.2.0 (via `ag-studio`) | 14.3.0 |
| `ag-studio` / `ag-studio-react` | `3.0.0` | 3.0.0 | 3.1.0 |
| `react` / `react-dom` | `^19.3.1` | 19.3.1 | — |
| `typescript` | `~7.0.2` | 7.0.2 | — |
| `vite` / `vitest` | `^8.3.6` / `^5.1.0` | 8.3.6 / 5.1.0 | — |

The installed set is internally consistent: `ag-studio@3.0.0` requires
`ag-grid-enterprise ~36.2.0`, `ag-charts-enterprise ~14.2.0`, `ag-stack ~36.2.0`.
`ag-studio@3.1.0` requires the `36.3` / `14.3` line, so Studio, Grid and Charts can
only move together.

## 2. Baseline (before any change)

| Check | Command | Result |
| --- | --- | --- |
| Server tests | `npm test` | 260 tests, 260 pass |
| Dashboard build | `npm --prefix app run build` | passes; one JS chunk, 5,891.55 kB (gzip 1,644 kB), CSS 10.83 kB |
| Dashboard unit tests | — | none exist; `app/package.json` has no `test` script |
| Browser tests | `npm run test:e2e` | Chromium does not start (missing `libnss3`); with the bundled libraries enabled: 2 pass, 1 fails (browser hangs creating the second page because of `--single-process`) |
| 390 px layout | scripted measurement, five views | no horizontal overflow in any view |
| Static serving | `performance` entries | the 5.89 MB bundle is sent uncompressed (`transferSize` = `decodedBodySize`) |

## 3. Architecture as found

- **Module registration** is scattered: `ModuleRegistry.registerModules([AllCommunityModule])`
  in `TransactionsDashboard.tsx:8` and again in `AllocationPlanner.tsx:6`; the AG Charts
  registry is called in `StudioDashboard.tsx:19`. No Enterprise module is registered
  anywhere. AG Studio registers the grid modules it needs **per grid instance**
  (`createGrid(…, { modules: STUDIO_GRID_MODULES })`), so it does not make Enterprise
  features available to the application's own grids.
- **Licensing**: no licence key is read or set anywhere (`grep` for `LicenseManager`,
  `licenseKey`, `AG_` finds nothing; `.env.example` has no such variable).
- **Theme**: both application grids sit in a `<div className="ag-theme-alpine">` but no
  legacy theme CSS is imported and `theme="legacy"` is not set, so the class is inert
  and the grids silently render with the Theming API default (`themeQuartz`, font
  "IBM Plex Sans"). `GridFallback.tsx` passes the `themeQuartz` object. The page itself
  uses `system-ui`. Studio uses its default theme. Three visual languages on one page.
- **Grid data**: `TransactionsDashboard` passes `rowData={[]}` (a new array on every
  render) and pushes rows with `api.applyTransaction` from a `useEffect([rows])`,
  through a `useRef` holding the Grid API that is never cleared.
- **Studio**: three `AgStudio` instances, all `mode="view"`, default theme, no custom
  widget, no AI module, no page filters defined.
- **Investigation**: `POST /api/investigate` analyses only verified webhook rows with two
  regular-expression intents; the client applies a set-filter model to a column that
  has a text filter.
- **State**: each view polls independently (`App.tsx` every 5 s, `TransactionsDashboard`
  every 4 s); nothing is shared between the grid, Studio and the investigation.
- **Tests**: 33 server test files; 3 Playwright tests with every API mocked; no unit
  tests for the dashboard.

## 4. Reported issues, reproduced and classified

`C` confirmed · `P` partially confirmed (real, but different from the report) ·
evidence file in brackets.

| # | Reported issue | Result | What was actually observed |
| --- | --- | --- | --- |
| 1 | AG Grid error #200 | **C** | `AG Grid: error #200 Unable to use sideBar as SideBarModule is not registered. Unable to use getContextMenuItems as ContextMenuModule is not registered.` Logged on every mount of the grid; in dev it also opens an overlay that covers the grid [`before1.json`]. Present in the production build too [`before5.json`]. |
| 2 | Missing `SideBarModule` | **C** | No side bar is rendered at all (`.ag-side-bar` absent). |
| 3 | Missing `ContextMenuModule` | **C** | Right-click shows the browser menu; the "Inspect transaction history" item is unreachable. |
| 4 | Deprecated checkbox selection | **C** | `warning #306` twice (`checkboxSelection`, `headerCheckboxSelection`). Because `rowSelection.checkboxes` is also set, **every row shows two checkboxes**. |
| 5 | Grid API calls after destruction | **C** | `warning #26 … forEachNode() cannot be called as the grid has been destroyed` and the same for `applyTransaction()`, after switching to the analytics tab while polling continues [`before2.json`]. |
| 6 | Studio missing licence | **C** | `AG Studio Core License — License Key Not Found — All AG Studio Core features are unlocked for trial.` on every Studio mount. The watermark is hidden only because the host is `localhost`. |
| 7 | Incomplete Studio integration | **C** | One chart and one grid in view mode; no link to the application grid. |
| 8 | Missing Studio theme | **C** | Default blue palette, grey canvas, different font. |
| 9 | Missing custom widgets | **C** | None. |
| 10 | Missing Agent Framework | **C** | `AgStudioAiModule` not registered; no `ai` property. |
| 11 | Empty filter panel | **P** | Two different things. (a) The **grid** Filters tool panel cannot be opened at all, because the side bar is missing (#2). (b) The **Studio** filters panel is shown but permanently says "No filters available": the report state defines no page filter and `enableFilterEditingInViewMode` is off, so a viewer can never add one. |
| 12 | Incorrect Alpine theme configuration | **C** | `ag-theme-alpine` class with no legacy CSS; the grid actually renders Quartz defaults. |
| 13 | Version discrepancies | **P** | The installed versions agree with each other. The real discrepancies are: one minor behind npm (table above); `ag-grid-community` and `ag-grid-enterprise` are imported or required without being declared; the public documentation site already describes Studio 3.1 APIs (`AgLoadingOverlay`, `onDataUpdated`, `getDataHandle`) that do not exist in the installed 3.0.0. |

## 5. Defects found that were not in the report

| # | Defect | Evidence | Severity |
| --- | --- | --- | --- |
| A | **The main grid loses every row about four seconds after it loads.** `rowData={[]}` is a new array on each render, so any re-render that does not change `rows` (the next poll) replaces the rows with an empty set: `1 to 6 of 6` → `0 to 0 of 0`, while the KPI tiles still say 6. Happens in dev and in the production build. | `before5.json` | P0 |
| B | **"Reveal evidence rows in grid" hides every row.** The investigation result leaves the grid at `0 to 0 of 0`. The existing browser test passes only because its next mocked poll changes a row. | `before4.json` (`reveal_after`) | P0 |
| C | A failed investigation request is an unhandled promise rejection; nothing is shown to the user. | `before4.json` (`investigate_failure`) | P1 |
| D | No guard against stale or concurrent investigation responses, and no validation of the returned identifiers before filtering. | code | P1 |
| E | Inline object and function props on `AgGridReact` (`sideBar`, `defaultColDef`, `rowSelection`, `getContextMenuItems`…) change identity on every render; once the modules are registered this closes open menus and rebuilds the side bar on each poll. | spike | P1 |
| F | History contract mismatch: the server returns `eventReceivedAt`, `correlationId`, `rawEvent`; the client type expects `receivedAt`, `transmissionId`, `resource`, so the drawer renders "Received undefined" against the real server. The browser test mocks the client's shape. | `transactionStore.getHistory`, `transactions.ts` | P1 |
| G | With no PayPal webhook configured (a fresh clone) the centre-piece grid and its Studio analytics are empty; the seeded and workspace obligations never reach an AG Grid with payment semantics. | Evidence: the operations grid shows no rows on a fresh clone (see the `before/` console captures). | P1 |
| H | `/api/investigate` cannot answer questions about deadlines, approval, budget or reconciliation, and returns no investigation id, uncertainty or grid action. | `investigation.ts` | P1 |
| I | Browser test 2 waits for `.ag-chart-canvas`; the real class is `.ag-charts-canvas`. | `before2.json` | P2 |
| J | The dev server rejects any host other than localhost, and the bundle is served uncompressed. | measurements | P2 |

## 6. Behaviour that works and must be preserved

- Server: 260 tests.
- The four views load and switch; the legacy dashboard, allocation planner and
  operational workspace workflows.
- Transaction inspection (history drawer), delta polling from a durable cursor, the
  explicit empty state that never substitutes sample payments.
- The Studio chart renders with data and report state is persisted locally.
- **No horizontal overflow at 390 px** in any view.

These are pinned by `e2e/regression.spec.ts`, written before any component was changed
and run first against the audited commit (see `evidence/ag-grid/before/regression-at-a459064.txt`).
