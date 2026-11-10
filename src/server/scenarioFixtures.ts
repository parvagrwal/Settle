import type { AllocationContext } from "./allocation.ts";

function relativeIso(base: Date, daysFromNow: number): string {
  return new Date(base.getTime() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

/** Reproducible product scenario, not a customer record or available cash balance. */
export function allocationDemoContext(now: Date = new Date()): AllocationContext {
  const captured = new Date(now.getTime());
  return {
    contextId: "demo-studio-v1",
    capturedAt: captured.toISOString(),
    validUntil: new Date(captured.getTime() + 60 * 60 * 1000).toISOString(),
    clearedFundsCents: 15000,
    reserveCents: 2000,
    perPaymentCapCents: 20000,
    totalCapCents: 13000,
    committedCents: 0,
    obligations: [
      { obligationId: "brand-refresh", recipient: "sandbox-designer@example.test", currency: "USD", owedCents: 8000, settledCents: 0, dueAt: relativeIso(captured, 1), mandatory: false, partialAllowed: true, priority: "normal", note: "Client delivery is complete; scheduling is discretionary." },
      { obligationId: "studio-software", recipient: "sandbox-vendor@example.test", currency: "USD", owedCents: 9000, settledCents: 0, dueAt: relativeIso(captured, 3), mandatory: true, partialAllowed: false, priority: "operational", note: "Required to keep the studio operating." },
      { obligationId: "urgent-retouch", recipient: "sandbox-artist@example.test", currency: "USD", owedCents: 5000, settledCents: 0, dueAt: relativeIso(captured, 2), mandatory: false, partialAllowed: false, priority: "urgent", note: "Owner marked urgent; no contract change." },
    ],
  };
}

/** One-condition mutation of a demo context: cleared funds fall by
 * $50, everything else stays the same. The context ID changes too, so
 * the mutated context is a new version, not the same one. */
export function allocationCounterfactual(base: AllocationContext = allocationDemoContext()): AllocationContext {
  return { ...base, contextId: `${base.contextId}-delayed-receipt`, clearedFundsCents: base.clearedFundsCents - 5000 };
}
