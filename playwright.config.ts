import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "./e2e/support/browser.ts";

// Two projects, two servers.
//
// - `mocked`: the Vite dev server (React Strict Mode, AG Grid validation on) with
//   every API answered by a labelled fixture. Deterministic UI states, and the
//   place lifecycle mistakes show up.
// - `stack`: the production build served by the real routes and SQLite stores,
//   with a scripted PayPal fake (e2e/support/stack-server.ts). True end to end:
//   ledger → projection → grid, Studio, widget and agent.
const launchOptions = await chromiumLaunchOptions();
const STACK_PORT = Number(process.env.SETTLE_E2E_STACK_PORT ?? "3210");
const DEV_PORT = Number(process.env.SETTLE_E2E_DEV_PORT ?? "5173");

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { outputFolder: "evidence/browser/playwright-report", open: "never" }]],
  use: {
    viewport: { width: 1440, height: 1000 },
    launchOptions,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mocked", testIgnore: /stack\//, use: { baseURL: `http://127.0.0.1:${DEV_PORT}` } },
    { name: "stack", testMatch: /stack\/.*\.spec\.ts/, use: { baseURL: `http://127.0.0.1:${STACK_PORT}` } },
  ],
  webServer: [
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${DEV_PORT} --strictPort`,
      cwd: "./app",
      url: `http://127.0.0.1:${DEV_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm --prefix app run build && node --experimental-strip-types e2e/support/stack-server.ts",
      url: `http://127.0.0.1:${STACK_PORT}/api/caps`,
      // The port opens before the fixture scenario has been driven through the API; wait for the script to say so.
      wait: { stdout: /^READY$/m },
      env: { PORT: String(STACK_PORT), SETTLE_OWNER_TOKEN: "e2e-owner-token" },
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 3000 },
    },
  ],
});
