// Browser inspection of the product surfaces.
//
// A small, dependency-free driver that walks the four destinations with the
// real Chromium bundle the repository already uses, records a screenshot of
// each surface, and reports anything the browser complained about.
//
//   node scripts/inspect-product.mjs [baseUrl] [outDir]
//
// It is a review aid, not a test: the assertions live in `e2e/`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "../e2e/support/browser.ts";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5173";
const outDir = resolve(process.argv[3] ?? "evidence/inspection");
const ownerToken = process.env.SETTLE_OWNER_TOKEN ?? "dev-owner-token";

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(await chromiumLaunchOptions());
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const consoleEntries = [];
page.on("console", (message) => consoleEntries.push({ kind: "console", type: message.type(), text: message.text() }));
page.on("pageerror", (error) => consoleEntries.push({ kind: "pageerror", type: "error", text: String(error?.stack ?? error) }));

const visit = async (label, path, action) => {
  consoleEntries.length = 0;
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  if (action) await action();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, `${label}.png`), fullPage: true });
  const overflow = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    clientWidth: document.documentElement.clientWidth,
  }));
  const problems = consoleEntries.filter((entry) => entry.kind === "pageerror" || entry.type === "error");
  console.log(`${label.padEnd(28)} ${JSON.stringify(overflow)}${problems.length ? ` PROBLEMS: ${problems.length}` : ""}`);
  for (const problem of problems) console.log(`   ${problem.kind}: ${problem.text.split("\n")[0]}`);
};

await visit("01-landing", "/");
await visit("02-signin", "/signin");
await visit("03-overview-public", "/overview");

// Sign in as the owner so the operational workspace is reachable.
await page.goto(`${baseUrl}/signin`, { waitUntil: "domcontentloaded" });
await page.getByLabel(/owner token/i).fill(ownerToken);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(outDir, "04-after-signin.png"), fullPage: true });

await visit("05-overview-owner", "/overview");
await visit("06-jobs", "/jobs");
await visit("07-payments", "/payments");
await visit("08-controls", "/controls");

// The receipt: open the first payment record.
await page.goto(`${baseUrl}/payments`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const firstPayment = page.locator(".payment-row").first();
if (await firstPayment.count()) {
  await firstPayment.click();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: join(outDir, "09-receipt.png"), fullPage: true });
  console.log("09-receipt                    opened");
} else {
  console.log("09-receipt                    NO PAYMENT ROWS");
}

// Mobile pass.
const mobile = await browser.newContext({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true });
const mobilePage = await mobile.newPage();
for (const [label, path] of [["10-mobile-landing", "/"], ["11-mobile-overview", "/overview"], ["12-mobile-jobs", "/jobs"], ["13-mobile-payments", "/payments"], ["14-mobile-controls", "/controls"]]) {
  await mobilePage.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForTimeout(1200);
  await mobilePage.screenshot({ path: join(outDir, `${label}.png`), fullPage: true });
  const overflow = await mobilePage.evaluate(() => ({ scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), clientWidth: document.documentElement.clientWidth }));
  console.log(`${label.padEnd(28)} ${JSON.stringify(overflow)}`);
}

writeFileSync(join(outDir, "console.json"), JSON.stringify(consoleEntries, null, 2));
await browser.close();
