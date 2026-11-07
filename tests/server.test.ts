// Dashboard server tests — caps endpoint, static dashboard serving, and
// the pay route with seed jobs. No live PayPal call, no money moved:
// the pay test uses a mock fetch that returns a successful batch.
// Run: node --test tests/server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettleServer } from "../src/server/routes.ts";
import { seedJobs } from "../src/server/seed.ts";

type MockResponse = {
  status: number;
  ok: boolean;
  json: () => Promise<Record<string, unknown>>;
  headers: { get: (name: string) => string | null };
};

function mockResponse(status: number, json: Record<string, unknown>): MockResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => json,
    headers: { get: () => null },
  };
}

test("caps endpoint returns the locked caps and the worst-case line", async () => {
  const app = createSettleServer({ jobs: [], allowlistedEmails: new Set<string>() });
  const port = await app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/caps`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.per_payment_cap_cents, 20000);
    assert.equal(body.weekly_cap_cents, 150000);
    assert.equal(body.window_days, 7);
    assert.equal(body.approval_expiry_days, 7);
    assert.equal(body.worst_case_exposure, "Worst-case exposure: $1,500 per week.");
  } finally {
    await app.close();
  }
});

test("static serving: home page, asset, missing asset 404, screen falls back to home", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-static-"));
  writeFileSync(join(dir, "index.html"), "<html><body>dashboard home</body></html>");
  writeFileSync(join(dir, "app.js"), "console.log('app');");
  const app = createSettleServer({ jobs: [], allowlistedEmails: new Set<string>(), staticDir: dir });
  const port = await app.listen(0);
  try {
    const base = `http://127.0.0.1:${port}`;
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await home.text(), /dashboard home/);

    const asset = await fetch(`${base}/app.js`);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /console\.log\('app'\)/);

    const missing = await fetch(`${base}/missing.js`);
    assert.equal(missing.status, 404);

    const screen = await fetch(`${base}/dashboard`);
    assert.equal(screen.status, 200);
    assert.match(await screen.text(), /dashboard home/);

    // The API still answers when static serving is on.
    const grid = await fetch(`${base}/api/grid`);
    assert.equal(grid.status, 200);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pay with seed jobs: waiting jobs paid, over-cap refused, proposer named", async () => {
  const fetchFn = (async (url: string, init: Record<string, unknown>) => {
    const method = (init.method as string) ?? "GET";
    if (method === "POST") {
      return mockResponse(201, { batch_header: { payout_batch_id: "BATCH-SERVER", batch_status: "PENDING" } });
    }
    return mockResponse(200, { batch_header: { payout_batch_id: "BATCH-SERVER", batch_status: "SUCCESS" } });
  }) as unknown as typeof fetch;
  const jobs = seedJobs("freelancer@example.com");
  const app = createSettleServer({
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn,
  });
  const port = await app.listen(0);
  try {
    const base = `http://127.0.0.1:${port}`;
    const payRes = await fetch(`${base}/api/pay`, { method: "POST" });
    assert.equal(payRes.status, 200);
    const paid = (await payRes.json()) as {
      payout_batch_id: string;
      accepted: string[];
      rejected: Array<{ job_id: string; label: string }>;
      proposer: string;
    };
    assert.equal(paid.payout_batch_id, "BATCH-SERVER");
    assert.deepEqual(paid.accepted, ["demo-waiting-1", "demo-waiting-2"]);
    // The over-cap job is not proposed again: it waits for the owner, and
    // its seeded reason stays on its grid row instead of a fresh refusal.
    assert.deepEqual(paid.rejected, []);
    // No Groq key was passed, so the loop proposed rule-based, and says so.
    assert.equal(paid.proposer, "rule-based");

    const gridRes = await fetch(`${base}/api/grid`);
    const grid = (await gridRes.json()) as { rows: Array<{ job_id: string; status: string; reason: string | null }> };
    const byId = new Map(grid.rows.map((row) => [row.job_id, row]));
    assert.equal(byId.get("demo-waiting-1")?.status, "paid");
    assert.equal(byId.get("demo-waiting-2")?.status, "paid");
    assert.equal(byId.get("demo-over-cap")?.status, "waiting_for_meera");
    assert.match(byId.get("demo-over-cap")?.reason ?? "", /PerRequestCapExceeded/);
    assert.equal(byId.get("settle-audit-1")?.status, "paid");
  } finally {
    await app.close();
  }
});

test("home page without a built dashboard names the build step", async () => {
  const app = createSettleServer({ jobs: [], allowlistedEmails: new Set<string>() });
  const port = await app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await res.text(), /not built yet/);
  } finally {
    await app.close();
  }
});
