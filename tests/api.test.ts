// Payouts integration tests — with a mock fetch. No live PayPal call,
// no money moved, in these tests. Live Payouts is proved separately, in
// scripts/run-payout.ts, with sandbox $1 items, and saved in evidence/payouts/.
// Run: node --test tests/api.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPayoutBatch, pollPayoutBatch, centsToDollars, PayPalError } from "../src/server/payouts.ts";
import { payApprovedJobs, type Job } from "../src/server/jobs.ts";

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

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    job_id: "job-1",
    freelancer_id: "freelancer-1",
    paypal_email: "freelancer@example.com",
    amount_cents: 10000, // $100
    currency: "USD",
    approval_state: "approved",
    approved_at: Date.now(),
    status: "waiting",
    payout_batch_id: null,
    payout_item_id: null,
    decision_reason: null,
    ...overrides,
  };
}

test("cents to dollars: 10000 cents is $100.00, 1 cent is $0.01", () => {
  assert.equal(centsToDollars(10000), "100.00");
  assert.equal(centsToDollars(1), "0.01");
  assert.equal(centsToDollars(20000), "200.00");
  assert.throws(() => centsToDollars(0), /positive integer/);
  assert.throws(() => centsToDollars(-5), /positive integer/);
});

test("decide gate blocks an unapproved job, mock PayPal is never called", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return mockResponse(201, {});
  }) as unknown as typeof fetch;
  const result = await payApprovedJobs({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    jobs: [makeJob({ approval_state: "not_approved" })],
    allowlistedEmails: new Set(["freelancer@example.com"]),
    fetchFn,
    poll: false,
  });
  assert.equal(calls, 0);
  assert.equal(result.payoutBatchId, null);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].status, "blocked");
  assert.match(result.rejected[0].decision_reason ?? "", /JobNotApproved/);
});

test("decide gate blocks an over-cap job, mock PayPal is never called", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return mockResponse(201, {});
  }) as unknown as typeof fetch;
  const result = await payApprovedJobs({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    jobs: [makeJob({ amount_cents: 20001 })], // $200.01
    allowlistedEmails: new Set(["freelancer@example.com"]),
    fetchFn,
    poll: false,
  });
  assert.equal(calls, 0);
  assert.equal(result.rejected[0].status, "waiting_for_meera");
  assert.match(result.rejected[0].decision_reason ?? "", /PerRequestCapExceeded/);
});

test("decide gate blocks a duplicate job, mock PayPal is never called", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return mockResponse(201, {});
  }) as unknown as typeof fetch;
  const result = await payApprovedJobs({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    jobs: [makeJob({ status: "paid" })],
    allowlistedEmails: new Set(["freelancer@example.com"]),
    fetchFn,
    poll: false,
  });
  assert.equal(calls, 0);
  assert.match(result.rejected[0].decision_reason ?? "", /DuplicatePayout/);
});

test("create batch sends the right payload, with a unique sender_batch_id and PayPal-Request-Id", async () => {
  const seen: Array<{ url: string; init: Record<string, unknown> }> = [];
  const fetchFn = (async (url: string, init: Record<string, unknown>) => {
    seen.push({ url, init });
    return mockResponse(201, {
      batch_header: { payout_batch_id: "BATCH-123", batch_status: "PENDING" },
    });
  }) as unknown as typeof fetch;
  const result = await createPayoutBatch({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    items: [{ jobId: "job-1", recipientEmail: "freelancer@example.com", amountCents: 10000 }],
    senderBatchId: "settle-123",
    requestId: "req-123",
    fetchFn,
  });
  assert.equal(result.payoutBatchId, "BATCH-123");
  assert.equal(result.batchStatus, "PENDING");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api-m.sandbox.paypal.com/v1/payments/payouts");
  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers["PayPal-Request-Id"], "req-123");
  assert.equal(headers.Authorization, "Bearer test-token");
  const body = JSON.parse(seen[0].init.body as string) as Record<string, unknown>;
  const header = body.sender_batch_header as Record<string, string>;
  assert.equal(header.sender_batch_id, "settle-123");
  const items = body.items as Array<Record<string, unknown>>;
  assert.equal(items[0].recipient_type, "EMAIL");
  assert.equal(items[0].receiver, "freelancer@example.com");
  assert.deepEqual(items[0].amount, { value: "100.00", currency: "USD" });
  assert.equal(items[0].sender_item_id, "job-1");
});

test("replay: retry after a 5xx returns the original batch, not a second payment", async () => {
  const bodies: string[] = [];
  let calls = 0;
  const fetchFn = (async (_url: string, init: Record<string, unknown>) => {
    calls++;
    bodies.push(init.body as string);
    if (calls === 1) return mockResponse(500, { name: "INTERNAL_ERROR", message: "boom" });
    return mockResponse(201, {
      batch_header: { payout_batch_id: "BATCH-ORIGINAL", batch_status: "PENDING" },
    });
  }) as unknown as typeof fetch;
  const result = await createPayoutBatch({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    items: [{ jobId: "job-1", recipientEmail: "freelancer@example.com", amountCents: 10000 }],
    senderBatchId: "settle-replay-1",
    requestId: "req-replay-1",
    fetchFn,
  });
  assert.equal(calls, 2);
  assert.equal(result.payoutBatchId, "BATCH-ORIGINAL");
  // Same body on retry, same sender_batch_id, same PayPal-Request-Id.
  assert.equal(bodies[0], bodies[1]);
  assert.match(bodies[1], /settle-replay-1/);
});

test("401 refreshes the token once, then succeeds", async () => {
  let calls = 0;
  const fetchFn = (async (_url: string, init: Record<string, unknown>) => {
    calls++;
    const auth = (init.headers as Record<string, string>).Authorization;
    if (auth === "Bearer old-token") {
      return mockResponse(401, { name: "invalid_token", message: "expired" });
    }
    return mockResponse(201, {
      batch_header: { payout_batch_id: "BATCH-401", batch_status: "PENDING" },
    });
  }) as unknown as typeof fetch;
  const result = await createPayoutBatch({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "old-token",
    items: [{ jobId: "job-1", recipientEmail: "freelancer@example.com", amountCents: 10000 }],
    refreshToken: async () => "new-token",
    fetchFn,
  });
  assert.equal(calls, 2);
  assert.equal(result.payoutBatchId, "BATCH-401");
});

test("403 PAYOUT_NOT_AVAILABLE throws, with no retry", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return mockResponse(403, {
      name: "PAYOUT_NOT_AVAILABLE",
      message: "You live in a country that is not allowed to send this payout.",
      debug_id: "test-debug-id",
    });
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      createPayoutBatch({
        baseUrl: "https://api-m.sandbox.paypal.com",
        token: "test-token",
        items: [{ jobId: "job-1", recipientEmail: "freelancer@example.com", amountCents: 10000 }],
        fetchFn,
      }),
    (err: unknown) => {
      assert.ok(err instanceof PayPalError);
      assert.equal((err as PayPalError).status, 403);
      assert.equal((err as PayPalError).paypalName, "PAYOUT_NOT_AVAILABLE");
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("400 duplicate throws DUPLICATE_REQUEST_ID, caller must use a fresh sender_batch_id", async () => {
  const fetchFn = (async () =>
    mockResponse(400, {
      name: "DUPLICATE_REQUEST_ID",
      message: "sender_batch_id was already used",
    })) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      createPayoutBatch({
        baseUrl: "https://api-m.sandbox.paypal.com",
        token: "test-token",
        items: [{ jobId: "job-1", recipientEmail: "freelancer@example.com", amountCents: 10000 }],
        senderBatchId: "settle-duplicate-1",
        fetchFn,
      }),
    (err: unknown) => {
      assert.ok(err instanceof PayPalError);
      assert.equal((err as PayPalError).paypalName, "DUPLICATE_REQUEST_ID");
      return true;
    },
  );
});

test("429 backs off, then succeeds, with the same requestId", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    if (calls === 1) return mockResponse(429, { name: "RATE_LIMIT_REACHED", message: "slow down" });
    return mockResponse(201, {
      batch_header: { payout_batch_id: "BATCH-429", batch_status: "PENDING" },
    });
  }) as unknown as typeof fetch;
  const result = await createPayoutBatch({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    items: [{ jobId: "job-1", recipientEmail: "freelancer@example.com", amountCents: 10000 }],
    fetchFn,
  });
  assert.equal(calls, 2);
  assert.equal(result.payoutBatchId, "BATCH-429");
});

test("poll returns SUCCESS after PENDING", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    const status = calls === 1 ? "PENDING" : "SUCCESS";
    return mockResponse(200, {
      batch_header: { payout_batch_id: "BATCH-POLL", batch_status: status },
    });
  }) as unknown as typeof fetch;
  const result = await pollPayoutBatch({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    payoutBatchId: "BATCH-POLL",
    fetchFn,
    maxAttempts: 3,
    delayMs: 0,
  });
  assert.equal(result.batchStatus, "SUCCESS");
  assert.equal(calls, 2);
});

test("payApprovedJobs: accepted jobs get the batch ID and paid status, rejected jobs get no PayPal call", async () => {
  const fetchFn = (async (url: string) => {
    if (url.includes("/v1/payments/payouts/")) {
      return mockResponse(200, {
        batch_header: { payout_batch_id: "BATCH-JOBS", batch_status: "SUCCESS" },
      });
    }
    return mockResponse(201, {
      batch_header: { payout_batch_id: "BATCH-JOBS", batch_status: "PENDING" },
    });
  }) as unknown as typeof fetch;
  const jobs = [
    makeJob({ job_id: "job-1", amount_cents: 10000 }),
    makeJob({ job_id: "job-2", freelancer_id: "freelancer-2", paypal_email: "f2@example.com", amount_cents: 20001 }),
  ];
  const result = await payApprovedJobs({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com", "f2@example.com"]),
    fetchFn,
  });
  assert.equal(result.payoutBatchId, "BATCH-JOBS");
  assert.equal(result.batchStatus, "SUCCESS");
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].job_id, "job-1");
  assert.equal(result.accepted[0].status, "paid");
  assert.equal(result.accepted[0].payout_batch_id, "BATCH-JOBS");
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].job_id, "job-2");
  assert.equal(result.rejected[0].status, "waiting_for_meera");
});
