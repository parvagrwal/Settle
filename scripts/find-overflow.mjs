// Find the elements that overflow a viewport width.
//   node --experimental-strip-types scripts/find-overflow.mjs <url> <width> [label]
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "../e2e/support/browser.ts";

const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const width = Number(process.argv[3] ?? "320");
const label = process.argv[4] ?? "page";

const browser = await chromium.launch(await chromiumLaunchOptions());
const context = await browser.newContext({ viewport: { width, height: 720 } });
const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const root = document.documentElement;
  const offenders = [];
  for (const element of document.querySelectorAll("body *")) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.right <= root.clientWidth + 1) continue;
    if (getComputedStyle(element).position === "fixed") continue;
    let parent = element.parentElement;
    let contained = false;
    while (parent && parent !== document.body) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden" || overflowX === "clip") { contained = true; break; }
      parent = parent.parentElement;
    }
    if (!contained) {
      offenders.push({
        tag: element.tagName.toLowerCase(),
        className: String(element.className).slice(0, 80),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        text: (element.textContent ?? "").trim().slice(0, 50),
      });
    }
  }
  return { clientWidth: root.clientWidth, scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth), offenders: offenders.slice(0, 20) };
});

console.log(`${label}: client=${report.clientWidth} scroll=${report.scrollWidth}`);
for (const offender of report.offenders) console.log(`  ${offender.tag}.${offender.className} right=${offender.right} w=${offender.width} "${offender.text}"`);
await browser.close();
