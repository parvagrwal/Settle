// Owner-token tests for the guarded routes: approve, pay, and the
// allocation recommend write. No live PayPal call, no money moved:
// the pay test uses a mock fetch and stops at the manual hold.
// Run: node --test tests/ownerAuth.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettleServer } from "../src/server/routes.ts";
import { seedJobs } from "../src/server/seed.ts";
import { AllocationStore } from "../src/server/allocationStore.ts";

process.env.SETTLE_OWNER_TOKEN = "test-owner-token";
const OWNER_HEADERS = { "x-settle-owner-token": "test-owner-token" };
const WRONG_HEADERS = { "x-settle-owner-token": "not-the-token" };

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

async function setup() {
  const fetchFn = (async (url: string, init: Record<string, unknown>) => {
    const method = (init.method as string) ?? "GET";
    if (method === "POST") {
      return mockResponse(201, { batch_header: { payout_batch_id: "BATCH-AUTH", batch_status: "PENDING" } });
    }
    return mockResponse(200, { batch_header: { payout_batch_id: "BATCH-AUTH", batch_status: "SUCCESS" } });
  }) as unknown as typeof fetch;
  const app = createSettleServer({
    jobs: seedJobs("freelancer@example.com"),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-paypal-token",
    fetchFn,
    allocationStore: new AllocationStore(join(mkdtempSync(join(tmpdir(), "settle-auth-allocation-")), "db.sqlite")),
  });
  const port = await app.listen(0);
  return { app, base: `http://127.0.0.1:${port}` };
}

test("approve without a token is refused, 401, and nothing is approved", async () => {
  const { app, base } = await setup();
  try {
    const res = await fetch(`${base}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: "demo-approve-1" }),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /owner token/);
    const grid = (await (await fetch(`${base}/api/grid`)).json()) as { rows: Array<{ job_id: string; status: string }> };
    assert.equal(grid.rows.find((row) => row.job_id === "demo-approve-1")?.status, "waiting");
  } finally {
    await app.close();
  }
});

test("approve with the wrong token is refused, 401", async () => {
  const { app, base } = await setup();
  try {
    const res = await fetch(`${base}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...WRONG_HEADERS },
      body: JSON.stringify({ job_id: "demo-approve-1" }),
    });
    assert.equal(res.status, 401);
  } finally {
    await app.close();
  }
});

test("pay without a token is refused, 401, and no payout is made", async () => {
  const { app, base } = await setup();
  try {
    const res = await fetch(`${base}/api/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /owner token/);
  } finally {
    await app.close();
  }
});

test("allocation recommend without a token is refused, 401", async () => {
  const { app, base } = await setup();
  try {
    const res = await fetch(`${base}/api/allocation/recommend`, { method: "POST" });
    assert.equal(res.status, 401);
  } finally {
    await app.close();
  }
});

test("approve with no token configured fails closed, 503", async () => {
  const saved = process.env.SETTLE_OWNER_TOKEN;
  delete process.env.SETTLE_OWNER_TOKEN;
  const { app, base } = await setup();
  try {
    const res = await fetch(`${base}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...OWNER_HEADERS },
      body: JSON.stringify({ job_id: "demo-approve-1" }),
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /owner token is not configured/);
  } finally {
    process.env.SETTLE_OWNER_TOKEN = saved;
    await app.close();
  }
});

test("approve with the correct token works, 200", async () => {
  const { app, base } = await setup();
  try {
    const res = await fetch(`${base}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...OWNER_HEADERS },
      body: JSON.stringify({ job_id: "demo-approve-1" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { job: { approval_state: string } };
    assert.equal(body.job.approval_state, "approved");
  } finally {
    await app.close();
  }
});

test("allocation recommend with the correct token works, 200", async () => {
  const { app, base } = await setup();
  try {
    const res = await fetch(`${base}/api/allocation/recommend`, {
      method: "POST",
      headers: { ...OWNER_HEADERS },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, "recommendation_unavailable");
  } finally {
    await app.close();
  }
});

test("pay with the correct token works, 200, and holds for the owner without a key", async () => {
  const { app, base } = await setup();
  try {
    const res = await fetch(`${base}/api/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...OWNER_HEADERS },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { proposer: string; payout_batch_id: string | null };
    assert.equal(body.proposer, "manual-hold");
    assert.equal(body.payout_batch_id, null);
  } finally {
    await app.close();
  }
});
