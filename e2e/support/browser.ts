// Launch options for the Chromium build bundled with @sparticuz/chromium.
//
// Two things made the browser tests unrunnable on a plain Linux host:
//
// 1. The binary needs NSS/NSPR (`libnss3.so`, `libnspr4.so`). The package ships
//    them for Amazon Linux 2023 but only unpacks them when it believes it is
//    running in Lambda. When the system does not provide them we unpack the
//    bundled copies and put them on LD_LIBRARY_PATH, which is exactly what the
//    package does for itself in Lambda.
// 2. The package's recommended flags include `--single-process`, which is right
//    for Lambda and hangs here as soon as a second page is created. The tests
//    use an ordinary multi-process browser instead.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";

const require = createRequire(import.meta.url);

function starts(executablePath: string): boolean {
  try {
    execFileSync(executablePath, ["--version"], { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export async function chromiumLaunchOptions(): Promise<{ executablePath: string; args: string[]; headless: true }> {
  const executablePath = await chromium.executablePath();
  if (!starts(executablePath)) {
    const libraries = join(tmpdir(), "al2023", "lib");
    if (!existsSync(libraries)) {
      // The package's exports map does not expose ./package.json, so locate
      // the bin folder relative to the resolved main entry (build/index.js).
      const bin = join(dirname(require.resolve("@sparticuz/chromium")), "..", "bin");
      await inflate(join(bin, "al2023.tar.br"));
    }
    setupLambdaEnvironment(libraries);
    if (!starts(executablePath)) {
      throw new Error(`Bundled Chromium does not start on this host (${executablePath}), even with the bundled NSS libraries. Install libnss3/libnspr4, or set a system browser.`);
    }
  }
  return {
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--font-render-hinting=none",
    ],
  };
}
