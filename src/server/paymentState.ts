// Canonical payment state machine and confirmation timing.
//
// Vocabulary, and why it is kept explicit:
//
//   approved               owner authorized the obligation; nothing was sent
//   reserved               an atomic reservation holds budget; nothing was sent
//   submitted              a create request is in flight or its outcome is not yet known
//   awaiting confirmation  PayPal accepted the batch and is still processing it
//   pending                provider item status PENDING (funds not yet credited)
//   unclaimed              provider item status UNCLAIMED
//   onhold                 provider item status ONHOLD
//   provider_confirmed     provider item status SUCCESS
//   failed / blocked       provider item status FAILED / BLOCKED
//   returned / reversed / refunded  provider item status of the same name
//   outcome_unknown        the submission itself is ambiguous; reconcile, never resubmit blindly
//   reconciliation_required  confirmation budget exhausted; a human or a later run must resolve it
//
// "Unknown" is reserved for an ambiguous *submission*. A payment that PayPal has
// acknowledged and is still processing is "awaiting confirmation", not "unknown",
// and never "failed".

export type PaymentState =
  | "approved"
  | "reserved"
  | "submitted"
  | "awaiting_confirmation"
  | "pending"
  | "unclaimed"
  | "onhold"
  | "provider_confirmed"
  | "failed"
  | "blocked"
  | "returned"
  | "reversed"
  | "refunded"
  | "outcome_unknown"
  | "reconciliation_required";

/** States in which no further provider movement is expected without a return/reversal. */
export const TERMINAL_STATES: ReadonlySet<PaymentState> = new Set<PaymentState>([
  "provider_confirmed",
  "failed",
  "blocked",
  "returned",
  "reversed",
  "refunded",
]);

/** States where money may still be moving and durable confirmation must continue. */
export const IN_FLIGHT_STATES: ReadonlySet<PaymentState> = new Set<PaymentState>([
  "submitted",
  "awaiting_confirmation",
  "pending",
  "unclaimed",
  "onhold",
]);

export const AMBIGUOUS_STATES: ReadonlySet<PaymentState> = new Set<PaymentState>([
  "outcome_unknown",
  "reconciliation_required",
]);

/** States that count against the owner's rolling cap as active exposure. */
export const EXPOSURE_STATES: ReadonlySet<PaymentState> = new Set<PaymentState>([
  "reserved",
  "submitted",
  "awaiting_confirmation",
  "pending",
  "unclaimed",
  "onhold",
  "outcome_unknown",
  "reconciliation_required",
]);

const ALLOWED: Record<PaymentState, ReadonlySet<PaymentState>> = {
  approved: new Set(["reserved", "outcome_unknown"]),
  reserved: new Set(["submitted", "outcome_unknown", "approved"]),
  submitted: new Set(["awaiting_confirmation", "pending", "provider_confirmed", "failed", "unclaimed", "onhold", "blocked", "outcome_unknown", "reconciliation_required"]),
  awaiting_confirmation: new Set(["pending", "provider_confirmed", "failed", "unclaimed", "onhold", "blocked", "outcome_unknown", "reconciliation_required"]),
  pending: new Set(["provider_confirmed", "failed", "unclaimed", "onhold", "blocked", "returned", "reversed", "refunded", "reconciliation_required"]),
  unclaimed: new Set(["provider_confirmed", "failed", "returned", "reconciliation_required"]),
  onhold: new Set(["pending", "provider_confirmed", "failed", "blocked", "returned", "reconciliation_required"]),
  provider_confirmed: new Set(["returned", "reversed", "refunded"]),
  failed: new Set(),
  blocked: new Set(),
  returned: new Set(),
  reversed: new Set(),
  refunded: new Set(),
  outcome_unknown: new Set(["awaiting_confirmation", "pending", "provider_confirmed", "failed", "unclaimed", "onhold", "blocked", "reconciliation_required"]),
  reconciliation_required: new Set(["awaiting_confirmation", "pending", "provider_confirmed", "failed", "unclaimed", "onhold", "blocked"]),
};

export function transitionAllowed(from: PaymentState, to: PaymentState): boolean {
  return ALLOWED[from]?.has(to) ?? false;
}

export function isTerminal(state: PaymentState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isInFlight(state: PaymentState): boolean {
  return IN_FLIGHT_STATES.has(state);
}

export function countsAsExposure(state: PaymentState): boolean {
  return EXPOSURE_STATES.has(state);
}

/** PayPal payout item status → internal state. Unknown statuses are refused upstream. */
export const PROVIDER_ITEM_STATE: Record<string, PaymentState> = {
  SUCCESS: "provider_confirmed",
  FAILED: "failed",
  PENDING: "pending",
  UNCLAIMED: "unclaimed",
  ONHOLD: "onhold",
  BLOCKED: "blocked",
  RETURNED: "returned",
  REFUNDED: "refunded",
  REVERSED: "reversed",
};

/** How advanced a provider fact is. A later read can advance the lifecycle; it
 * can never move it backwards. PENDING and UNCLAIMED/ONHOLD are both "not
 * settled", FAILED/BLOCKED are terminal failures, SUCCESS is terminal success,
 * and RETURNED/REVERSED/REFUNDED are post-success adjustments. */
export function providerStatusRank(status: string): number {
  switch (status) {
    case "PENDING": return 10;
    case "UNCLAIMED": return 10;
    case "ONHOLD": return 10;
    case "FAILED": return 20;
    case "BLOCKED": return 20;
    case "SUCCESS": return 30;
    case "RETURNED": return 40;
    case "REVERSED": return 40;
    case "REFUNDED": return 40;
    default: return 0;
  }
}

/** Batch status → internal state for a newly accepted batch with no item detail yet. */
export const PROVIDER_BATCH_STATE: Record<string, PaymentState> = {
  PENDING: "awaiting_confirmation",
  PROCESSING: "awaiting_confirmation",
  SUCCESS: "awaiting_confirmation",
  DENIED: "failed",
  CANCELED: "failed",
};

export function publicStateLabel(state: string): string {
  switch (state) {
    case "approved": return "Approved — nothing sent to PayPal";
    case "reserved": return "Reserved — nothing sent to PayPal";
    case "submitted": return "Submitted — provider outcome not confirmed yet";
    case "awaiting_confirmation": return "PayPal is processing this payout";
    case "pending": return "Pending at PayPal";
    case "unclaimed": return "Unclaimed at PayPal";
    case "onhold": return "On hold at PayPal";
    case "provider_confirmed": return "Provider confirmed";
    case "failed": return "Failed at PayPal";
    case "blocked": return "Blocked at PayPal";
    case "returned": return "Returned to sender";
    case "reversed": return "Reversed";
    case "refunded": return "Refunded";
    case "outcome_unknown": return "Outcome unknown — reconcile, do not resubmit";
    case "reconciliation_required": return "Reconciliation required";
    default: return state;
  }
}

export interface ConfirmationPolicy {
  baseMs: number;
  factor: number;
  maxMs: number;
  maxAttempts: number;
  /** 0.2 = ±20% jitter around the computed delay. */
  jitterRatio: number;
}

export const DEFAULT_CONFIRMATION_POLICY: ConfirmationPolicy = {
  baseMs: 2_000,
  factor: 2,
  maxMs: 60_000,
  maxAttempts: 12,
  jitterRatio: 0.2,
};

export function confirmationPolicyFromEnv(env: Record<string, string | undefined> = process.env): ConfirmationPolicy {
  const int = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  };
  // Jitter is a fraction in [0, 1); 0 is meaningful (deterministic backoff), so
  // it is parsed separately from the positive-integer settings.
  const jitter = (): number => {
    const raw = env.SETTLE_CONFIRM_JITTER;
    if (raw === undefined || raw.trim() === "") return DEFAULT_CONFIRMATION_POLICY.jitterRatio;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value < 1 ? value : DEFAULT_CONFIRMATION_POLICY.jitterRatio;
  };
  return {
    baseMs: int("SETTLE_CONFIRM_BASE_MS", DEFAULT_CONFIRMATION_POLICY.baseMs),
    factor: int("SETTLE_CONFIRM_FACTOR", DEFAULT_CONFIRMATION_POLICY.factor),
    maxMs: int("SETTLE_CONFIRM_MAX_MS", DEFAULT_CONFIRMATION_POLICY.maxMs),
    maxAttempts: int("SETTLE_CONFIRM_MAX_ATTEMPTS", DEFAULT_CONFIRMATION_POLICY.maxAttempts),
    jitterRatio: jitter(),
  };
}

/** Bounded exponential backoff with jitter. `attemptIndex` is 0-based. */
export function nextConfirmationDelayMs(
  policy: ConfirmationPolicy,
  attemptIndex: number,
  random: () => number = Math.random,
): number {
  if (!Number.isSafeInteger(attemptIndex) || attemptIndex < 0) throw new Error("attempt index must be a non-negative integer");
  const baseline = Math.min(policy.maxMs, policy.baseMs * Math.pow(policy.factor, attemptIndex));
  const spread = baseline * policy.jitterRatio;
  const offset = (random() * 2 - 1) * spread;
  const delay = Math.max(0, Math.min(policy.maxMs, Math.round(baseline + offset)));
  return Number.isFinite(delay) ? delay : policy.maxMs;
}
