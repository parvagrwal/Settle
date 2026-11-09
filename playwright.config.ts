import { defineConfig } from "@playwright/test";
import chromium from "@sparticuz/chromium";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "evidence/browser/playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: await chromium.executablePath(), args: chromium.args, headless: true },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 0.0.0.0 --port 5173 --strictPort",
    cwd: "./app",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
