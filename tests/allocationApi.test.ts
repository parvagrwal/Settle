import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettleServer } from "../src/server/routes.ts";
import { seedJobs } from "../src/server/seed.ts";
import { AllocationStore } from "../src/server/allocationStore.ts";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

async function setup(groqApiKey = "", fetchFn?: typeof fetch) {
  const app = createSettleServer({
    jobs: seedJobs("receiver@example.test"), allowlistedEmails: new Set(), groqApiKey, fetchFn,
    allocationStore: new AllocationStore(join(mkdtempSync(join(tmpdir(), "settle-api-allocation-")), "db.sqlite")),
  });
  const port = await app.listen(0);
  return { app, url: `http://127.0.0.1:${port}` };
}

test("AI-disabled API exposes deterministic alternatives but no recommendation or payment", async () => {
  const { app, url } = await setup();
  try {
    const context = await (await fetch(`${url}/api/allocation/demo-context`)).json() as { source: string };
    assert.match(context.source, /illustrative/);
    const response = await fetch(`${url}/api/allocation/recommend`, { method: "POST" });
    const body = await response.json() as { status: string; recommendation: unknown; deterministicAlternatives: unknown[] };
    assert.equal(response.status, 200);
    assert.equal(body.status, "recommendation_unavailable");
    assert.equal(body.recommendation, null);
    assert.equal(body.deterministicAlternatives.length, 3);
  } finally { await app.close(); }
});

test("valid model scenario selection is persisted as proposed, never approved", async () => {
  const fetchFn = (async (url: string) => {
    if (!String(url).includes("groq")) throw new Error("unexpected provider call");
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ scenarioId: "demo-studio-v1:operational-stability", reason: "Protect operations.", uncertainties: [], changeTriggers: ["Funds change"] }) } }] }) };
  }) as unknown as typeof fetch;
  const { app, url } = await setup("test-key", fetchFn);
  try {
    const response = await fetch(`${url}/api/allocation/recommend`, { method: "POST" });
    const body = await response.json() as { status: string; recommendation: { selectedPlan: { planId: string } } };
    assert.equal(body.status, "recommendation_ready");
    assert.equal(body.recommendation.selectedPlan.planId, "demo-studio-v1:operational-stability");
    const stored = await (await fetch(`${url}/api/allocation/plans/demo-studio-v1:operational-stability`)).json() as { status: string };
    assert.equal(stored.status, "proposed");
  } finally { await app.close(); }
});

test("counterfactual API compares changed funds without changing policy", async () => {
  const { app, url } = await setup();
  try {
    const response = await fetch(`${url}/api/allocation/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ counterfactual: true }) });
    const body = await response.json() as { context: { contextId: string; clearedFundsCents: number }; deterministicAlternatives: { totalAllocatedCents: number }[] };
    assert.equal(body.context.contextId, "demo-studio-delayed-receipt-v2");
    assert.equal(body.context.clearedFundsCents, 10000);
    assert.ok(body.deterministicAlternatives.every((plan) => plan.totalAllocatedCents <= 8000));
  } finally { await app.close(); }
});
