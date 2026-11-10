import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";

export type WorkspaceKind = "demo" | "operational";
export type RecordOrigin = "synthetic" | "seed" | "application" | "paypal_sandbox" | "paypal_production";
export type ProviderEnvironment = "none" | "sandbox" | "production";
export type VerificationState = "synthetic" | "unverified" | "provider_response_received" | "provider_confirmed" | "reconciled" | "discrepancy_detected" | "verification_unavailable" | "historical_evidence_only";
export type Row = Record<string, unknown>;

export interface ProductUser { userId: string; displayName: string; email: string | null; authProvider: string }
export interface Workspace {
  workspaceId: string; name: string; kind: WorkspaceKind; providerEnvironment: ProviderEnvironment;
  owner: ProductUser | null; createdAt: string; updatedAt: string;
}
export interface ProductJob {
  jobId: string; workspaceId: string; title: string; recipientName: string; recipientEmail: string;
  amountCents: number; currency: string; dueAt: string | null; priority: "high" | "normal" | "low";
  approvalState: "not_approved" | "approved"; approvedBy: string | null; approvedAt: string | null;
  origin: RecordOrigin; providerEnvironment: ProviderEnvironment; sourceTimestamp: string | null; ingestedAt: string;
  createdAt: string; updatedAt: string;
}
export interface ProductDecision {
  decisionId: string; workspaceId: string; status: string; summary: string; rationale: string;
  recommendedJobIds: string[]; origin: RecordOrigin; createdBy: string; createdAt: string;
}
export interface WorkspacePolicy { perPaymentCapCents: number; rollingCapCents: number; windowHours: number; approvalExpiryDays: number; updatedBy: string; updatedAt: string }
export interface ReceiptTimelineEvent { kind: "authorization" | "submission" | "provider_acknowledgement" | "item_outcome" | "transaction" | "reconciliation"; label: string; state: "complete" | "missing" | "historical"; at: string | null; detail: string }
export interface ProductReceipt {
  receiptId: string; workspaceId: string; jobId: string | null; paymentId: string | null;
  title: string; recipientName: string; recipientEmail: string | null; amountCents: number; currency: string;
  origin: RecordOrigin; providerEnvironment: ProviderEnvironment; verificationState: VerificationState;
  approvedBy: string | null; approvedAt: string | null; policyVersion: number | null; submittedAt: string | null;
  payoutBatchId: string | null; payoutItemId: string | null; transactionId: string | null; providerStatus: string | null;
  feeCents: number | null; providerTimestamp: string | null; ingestedAt: string | null;
  lastReconciledAt: string | null; reconciliationRunId: string | null; discrepancies: Row[];
  timeline: ReceiptTimelineEvent[];
}

export class ProductPermissionError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const DEMO_ID = "demo";
function text(value: unknown): string | null { return typeof value === "string" && value !== "" ? value : null; }
function mapUser(row: Row): ProductUser { return { userId: String(row.user_id), displayName: String(row.display_name), email: text(row.email), authProvider: String(row.auth_provider) }; }
function safeCents(value: number, name: string, allowZero = false): void {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer number of cents`);
}
function sessionHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

/** Durable product boundary. Demo scenarios and operational obligations use
 * different database-enforced state machines; only operational receipt links
 * may point at the FinancialStore's permanent payment identities. */
export class ProductStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS product_users (
        user_id TEXT PRIMARY KEY, auth_provider TEXT NOT NULL, provider_subject TEXT NOT NULL,
        display_name TEXT NOT NULL, email TEXT, created_at TEXT NOT NULL,
        UNIQUE(auth_provider,provider_subject)
      );
      CREATE TABLE IF NOT EXISTS product_workspaces (
        workspace_id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('demo','operational')),
        owner_user_id TEXT REFERENCES product_users(user_id), provider_environment TEXT NOT NULL CHECK(provider_environment IN ('none','sandbox','production')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK((kind='demo' AND owner_user_id IS NULL) OR (kind='operational' AND owner_user_id IS NOT NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_operational_workspace_per_owner ON product_workspaces(owner_user_id) WHERE kind='operational';
      CREATE TABLE IF NOT EXISTS product_memberships (
        workspace_id TEXT NOT NULL REFERENCES product_workspaces(workspace_id), user_id TEXT NOT NULL REFERENCES product_users(user_id),
        role TEXT NOT NULL CHECK(role IN ('owner','operator','viewer')), PRIMARY KEY(workspace_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS product_sessions (
        session_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES product_users(user_id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS product_workspace_policies (
        workspace_id TEXT PRIMARY KEY REFERENCES product_workspaces(workspace_id), per_payment_cap_cents INTEGER NOT NULL CHECK(per_payment_cap_cents>0),
        rolling_cap_cents INTEGER NOT NULL CHECK(rolling_cap_cents>=0), window_hours INTEGER NOT NULL CHECK(window_hours=168),
        approval_expiry_days INTEGER NOT NULL CHECK(approval_expiry_days=7), updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS product_jobs (
        job_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES product_workspaces(workspace_id), title TEXT NOT NULL,
        recipient_name TEXT NOT NULL, recipient_email TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), currency TEXT NOT NULL CHECK(currency='USD'),
        due_at TEXT, priority TEXT NOT NULL CHECK(priority IN ('high','normal','low')), approval_state TEXT NOT NULL CHECK(approval_state IN ('not_approved','approved')),
        approved_by TEXT, approved_at TEXT, origin TEXT NOT NULL CHECK(origin IN ('synthetic','seed','application','paypal_sandbox','paypal_production')),
        provider_environment TEXT NOT NULL CHECK(provider_environment IN ('none','sandbox','production')), source_timestamp TEXT, ingested_at TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS product_jobs_workspace ON product_jobs(workspace_id,created_at);
      CREATE TABLE IF NOT EXISTS product_decisions (
        decision_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES product_workspaces(workspace_id), status TEXT NOT NULL,
        summary TEXT NOT NULL, rationale TEXT NOT NULL, recommended_job_ids_json TEXT NOT NULL,
        origin TEXT NOT NULL CHECK(origin IN ('synthetic','seed','application','paypal_sandbox','paypal_production')),
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS product_receipts (
        receipt_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES product_workspaces(workspace_id), job_id TEXT REFERENCES product_jobs(job_id), payment_id TEXT UNIQUE,
        title TEXT NOT NULL, recipient_name TEXT NOT NULL, recipient_email TEXT, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), currency TEXT NOT NULL,
        origin TEXT NOT NULL CHECK(origin IN ('synthetic','seed','application','paypal_sandbox','paypal_production')),
        provider_environment TEXT NOT NULL CHECK(provider_environment IN ('none','sandbox','production')),
        verification_state TEXT NOT NULL CHECK(verification_state IN ('synthetic','unverified','provider_response_received','provider_confirmed','reconciled','discrepancy_detected','verification_unavailable','historical_evidence_only')),
        approved_by TEXT, approved_at TEXT, policy_version INTEGER, submitted_at TEXT, payout_batch_id TEXT, payout_item_id TEXT, transaction_id TEXT,
        provider_status TEXT, fee_cents INTEGER, provider_timestamp TEXT, ingested_at TEXT, last_reconciled_at TEXT, reconciliation_run_id TEXT, raw_json TEXT
      );
      CREATE TABLE IF NOT EXISTS product_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, workspace_id TEXT NOT NULL,
        actor_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT, reason TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS product_audit_no_update BEFORE UPDATE ON product_audit BEGIN SELECT RAISE(ABORT,'immutable product audit'); END;
      CREATE TRIGGER IF NOT EXISTS product_audit_no_delete BEFORE DELETE ON product_audit BEGIN SELECT RAISE(ABORT,'immutable product audit'); END;
      CREATE TRIGGER IF NOT EXISTS demo_job_origin_insert BEFORE INSERT ON product_jobs WHEN
        (SELECT kind FROM product_workspaces WHERE workspace_id=NEW.workspace_id)='demo' AND (NEW.origin NOT IN ('synthetic','seed') OR NEW.provider_environment NOT IN ('none','sandbox'))
        BEGIN SELECT RAISE(ABORT,'demo jobs cannot become operational provider records'); END;
      CREATE TRIGGER IF NOT EXISTS demo_job_origin_update BEFORE UPDATE ON product_jobs WHEN
        (SELECT kind FROM product_workspaces WHERE workspace_id=NEW.workspace_id)='demo' AND (NEW.origin NOT IN ('synthetic','seed') OR NEW.provider_environment NOT IN ('none','sandbox'))
        BEGIN SELECT RAISE(ABORT,'demo jobs cannot become operational provider records'); END;
      CREATE TRIGGER IF NOT EXISTS demo_receipt_isolation_insert BEFORE INSERT ON product_receipts WHEN
        (SELECT kind FROM product_workspaces WHERE workspace_id=NEW.workspace_id)='demo' AND
        (NEW.payment_id IS NOT NULL OR NEW.origin NOT IN ('synthetic','seed') OR NEW.verification_state NOT IN ('synthetic','historical_evidence_only') OR NEW.last_reconciled_at IS NOT NULL)
        BEGIN SELECT RAISE(ABORT,'demo evidence cannot enter operational payment states'); END;
      CREATE TRIGGER IF NOT EXISTS demo_receipt_isolation_update BEFORE UPDATE ON product_receipts WHEN
        (SELECT kind FROM product_workspaces WHERE workspace_id=NEW.workspace_id)='demo' AND
        (NEW.payment_id IS NOT NULL OR NEW.origin NOT IN ('synthetic','seed') OR NEW.verification_state NOT IN ('synthetic','historical_evidence_only') OR NEW.last_reconciled_at IS NOT NULL)
        BEGIN SELECT RAISE(ABORT,'demo evidence cannot enter operational payment states'); END;
      CREATE TRIGGER IF NOT EXISTS operational_receipt_origin BEFORE INSERT ON product_receipts WHEN
        (SELECT kind FROM product_workspaces WHERE workspace_id=NEW.workspace_id)='operational' AND NEW.origin='synthetic'
        BEGIN SELECT RAISE(ABORT,'synthetic receipts are prohibited in operational workspaces'); END;
    `);
    this.ensureDemo();
  }
  close(): void { this.db.close(); }
  private audit(workspaceId: string, actorId: string, action: string, resourceId: string | null, reason: string, at: string): void {
    this.db.prepare("INSERT INTO product_audit(event_id,workspace_id,actor_id,action,resource_id,reason,at) VALUES(?,?,?,?,?,?,?)")
      .run(randomUUID(), workspaceId, actorId, action, resourceId, reason, at);
  }
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private ensureDemo(): void {
    if (this.db.prepare("SELECT 1 FROM product_workspaces WHERE workspace_id=?").get(DEMO_ID)) return;
    this.tx(() => this.insertDemoRows(new Date().toISOString()));
  }
  private insertDemoRows(at: string): void {
    const baseMs = Date.parse(at);
    const relativeDue = (days: number) => new Date((Number.isFinite(baseMs) ? baseMs : Date.now()) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    this.db.prepare("INSERT INTO product_workspaces VALUES(?,?,?,?,?,?,?)").run(DEMO_ID, "Northstar Studio — illustrative", "demo", null, "none", at, at);
    this.db.prepare("INSERT INTO product_workspace_policies VALUES(?,?,?,?,?,?,?)").run(DEMO_ID, 20000, 150000, 168, 7, "demonstration fixture", at);
    const jobs = [
      ["demo-retouch", "Rush retouching", "Asha — sample recipient", "asha@example.test", 8000, relativeDue(2), "high", "approved"],
      ["demo-brand", "Brand identity handoff", "Ravi — sample recipient", "ravi@example.test", 12000, relativeDue(4), "normal", "approved"],
      ["demo-license", "Studio font license", "Type vendor — sample recipient", "vendor@example.test", 25000, relativeDue(3), "normal", "approved"],
      ["demo-approval", "Social launch assets", "Maya — sample recipient", "maya@example.test", 6000, relativeDue(5), "normal", "not_approved"],
    ];
    for (const [id, title, recipient, email, amount, due, priority, approval] of jobs) {
      this.db.prepare(`INSERT INTO product_jobs(job_id,workspace_id,title,recipient_name,recipient_email,amount_cents,currency,due_at,priority,approval_state,approved_by,approved_at,origin,provider_environment,source_timestamp,ingested_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'USD',?,?,?,?,?,'synthetic','none',?,?,?,?)`).run(id, DEMO_ID, title, recipient, email, amount, due, priority, approval,
        approval === "approved" ? "illustrative owner" : null, approval === "approved" ? at : null, at, at, at, at);
    }
    this.db.prepare(`INSERT INTO product_receipts(receipt_id,workspace_id,job_id,payment_id,title,recipient_name,recipient_email,amount_cents,currency,origin,provider_environment,verification_state,approved_by,approved_at,policy_version,submitted_at,payout_batch_id,payout_item_id,transaction_id,provider_status,fee_cents,provider_timestamp,ingested_at,last_reconciled_at,reconciliation_run_id,raw_json)
      VALUES(?,?,?,NULL,?,?,?,?,'USD','seed','sandbox','historical_evidence_only',?,?,NULL,NULL,?,NULL,NULL,'SUCCESS',NULL,NULL,?,NULL,NULL,NULL)`)
      .run("demo-historical-receipt", DEMO_ID, null, "Historical agent-loop payout", "freelancer-1 — seeded recipient", null, 100,
        "repository seed", "2026-11-07T12:00:00.000Z", "RBZ4V8LCSSK5W", at);
    this.createRecommendation(DEMO_ID, null, at);
    this.audit(DEMO_ID, "demonstration fixture", "demo_seeded", DEMO_ID, "Synthetic jobs and one repository-seeded historical Sandbox reference; no operational payment created.", at);
  }
  createUser(profile: { displayName: string; email: string | null }, at: string): ProductUser {
    const userId = randomUUID();
    this.db.prepare("INSERT INTO product_users VALUES(?,?,?,?,?,?)").run(userId, "settle-owner-token", randomUUID(), profile.displayName, profile.email, at);
    return { userId, ...profile, authProvider: "settle-owner-token" };
  }
  createOwnerSession(profile: { displayName: string; email: string | null }, at: string, ttlMs: number): { sessionToken: string; user: ProductUser; expiresAt: string } {
    const existing = this.db.prepare("SELECT * FROM product_users WHERE auth_provider='settle-owner-token' AND provider_subject='primary-owner'").get() as Row | undefined;
    const user = existing ? mapUser(existing) : (() => {
      const userId = randomUUID();
      this.db.prepare("INSERT INTO product_users VALUES(?,?,'primary-owner',?,?,?)").run(userId, "settle-owner-token", profile.displayName, profile.email, at);
      return { userId, ...profile, authProvider: "settle-owner-token" };
    })();
    const sessionToken = randomUUID() + randomUUID();
    const expiresAt = new Date(Date.parse(at) + ttlMs).toISOString();
    this.db.prepare("INSERT INTO product_sessions VALUES(?,?,?,?)").run(sessionHash(sessionToken), user.userId, at, expiresAt);
    return { sessionToken, user, expiresAt };
  }
  getUserBySession(token: string | null, at = new Date().toISOString()): ProductUser | null {
    if (!token) return null;
    const row = this.db.prepare(`SELECT u.* FROM product_sessions s JOIN product_users u ON u.user_id=s.user_id WHERE s.session_hash=? AND s.expires_at>?`).get(sessionHash(token), at) as Row | undefined;
    return row ? mapUser(row) : null;
  }
  deleteSession(token: string | null): void { if (token) this.db.prepare("DELETE FROM product_sessions WHERE session_hash=?").run(sessionHash(token)); }
  private workspaceRow(workspaceId: string): Row {
    const row = this.db.prepare("SELECT * FROM product_workspaces WHERE workspace_id=?").get(workspaceId) as Row | undefined;
    if (!row) throw new ProductPermissionError(404, "workspace not found");
    return row;
  }
  getWorkspace(workspaceId: string, userId: string | null): Workspace {
    const row = this.workspaceRow(workspaceId);
    if (String(row.kind) === "operational") {
      if (!userId) throw new ProductPermissionError(401, "owner sign-in is required for an operational workspace");
      const membership = this.db.prepare("SELECT role FROM product_memberships WHERE workspace_id=? AND user_id=?").get(workspaceId, userId);
      if (!membership) throw new ProductPermissionError(403, "you do not have permission to access this workspace");
    }
    let owner: ProductUser | null = null;
    if (row.owner_user_id) {
      const ownerRow = this.db.prepare("SELECT * FROM product_users WHERE user_id=?").get(String(row.owner_user_id)) as Row;
      owner = mapUser(ownerRow);
    }
    return { workspaceId, name: String(row.name), kind: row.kind as WorkspaceKind, providerEnvironment: row.provider_environment as ProviderEnvironment, owner, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }
  listWorkspaces(userId: string | null): Workspace[] {
    const ids = this.db.prepare("SELECT workspace_id FROM product_workspaces WHERE kind='demo' OR owner_user_id=? ORDER BY created_at").all(userId) as Row[];
    return ids.map((row) => this.getWorkspace(String(row.workspace_id), userId));
  }
  createOperationalWorkspace(userId: string, name: string, at: string): Workspace {
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 100) throw new Error("studio name must contain 2–100 characters");
    if (this.db.prepare("SELECT 1 FROM product_workspaces WHERE owner_user_id=? AND kind='operational'").get(userId)) throw new Error("this owner already has an operational workspace");
    const id = randomUUID();
    this.tx(() => {
      this.db.prepare("INSERT INTO product_workspaces VALUES(?,?,'operational',?,'sandbox',?,?)").run(id, clean, userId, at, at);
      this.db.prepare("INSERT INTO product_memberships VALUES(?,?,'owner')").run(id, userId);
      this.db.prepare("INSERT INTO product_workspace_policies VALUES(?,?,?,?,?,?,?)").run(id, 20000, 150000, 168, 7, userId, at);
      this.audit(id, userId, "workspace_created", id, `Operational workspace ${clean} created.`, at);
    });
    return this.getWorkspace(id, userId);
  }
  private requireOwner(workspaceId: string, userId: string | null, operational = false): Workspace {
    if (!userId) throw new ProductPermissionError(401, "owner sign-in is required");
    const workspace = this.getWorkspace(workspaceId, userId);
    if (operational && workspace.kind !== "operational") throw new ProductPermissionError(409, "this action requires an operational workspace; demonstration records cannot enter the financial ledger");
    if (workspace.owner?.userId !== userId) throw new ProductPermissionError(403, "only the workspace owner may perform this action");
    return workspace;
  }
  createJob(workspaceId: string, userId: string, input: { title: string; recipientName: string; recipientEmail: string; amountCents: number; dueAt: string | null; priority: "high" | "normal" | "low" }, at: string): ProductJob {
    this.requireOwner(workspaceId, userId, true);
    safeCents(input.amountCents, "job amount");
    if (input.title.trim().length < 2 || input.recipientName.trim().length < 2) throw new Error("job title and recipient name are required");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.recipientEmail)) throw new Error("a valid recipient email is required");
    if (!["high", "normal", "low"].includes(input.priority)) throw new Error("invalid job priority");
    const id = randomUUID();
    this.tx(() => {
      this.db.prepare(`INSERT INTO product_jobs(job_id,workspace_id,title,recipient_name,recipient_email,amount_cents,currency,due_at,priority,approval_state,approved_by,approved_at,origin,provider_environment,source_timestamp,ingested_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'USD',?,?,'not_approved',NULL,NULL,'application','sandbox',NULL,?,?,?)`).run(id, workspaceId, input.title.trim(), input.recipientName.trim(), input.recipientEmail, input.amountCents, input.dueAt, input.priority, at, at, at);
      this.audit(workspaceId, userId, "job_created", id, "Application-generated operational obligation; no approval or payment yet.", at);
    });
    return this.getJob(workspaceId, id, userId);
  }
  private jobRow(row: Row): ProductJob {
    return { jobId: String(row.job_id), workspaceId: String(row.workspace_id), title: String(row.title), recipientName: String(row.recipient_name), recipientEmail: String(row.recipient_email),
      amountCents: Number(row.amount_cents), currency: String(row.currency), dueAt: text(row.due_at), priority: row.priority as ProductJob["priority"], approvalState: row.approval_state as ProductJob["approvalState"],
      approvedBy: text(row.approved_by), approvedAt: text(row.approved_at), origin: row.origin as RecordOrigin, providerEnvironment: row.provider_environment as ProviderEnvironment,
      sourceTimestamp: text(row.source_timestamp), ingestedAt: String(row.ingested_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }
  getJob(workspaceId: string, jobId: string, userId: string | null): ProductJob {
    this.getWorkspace(workspaceId, userId);
    const row = this.db.prepare("SELECT * FROM product_jobs WHERE workspace_id=? AND job_id=?").get(workspaceId, jobId) as Row | undefined;
    if (!row) throw new ProductPermissionError(404, "job not found");
    return this.jobRow(row);
  }
  listJobs(workspaceId: string, userId: string | null): ProductJob[] {
    this.getWorkspace(workspaceId, userId);
    return (this.db.prepare("SELECT * FROM product_jobs WHERE workspace_id=? ORDER BY due_at,created_at").all(workspaceId) as Row[]).map((row) => this.jobRow(row));
  }
  createRecommendation(workspaceId: string, userId: string | null, at: string): ProductDecision {
    const workspace = this.getWorkspace(workspaceId, userId);
    if (workspace.kind === "operational") this.requireOwner(workspaceId, userId, true);
    const policy = this.getPolicy(workspaceId, userId);
    const jobs = this.listJobs(workspaceId, userId);
    const rank = { high: 0, normal: 1, low: 2 };
    const eligible = jobs.filter((job) => job.approvalState === "approved" && job.amountCents <= policy.perPaymentCapCents)
      .sort((a, b) => rank[a.priority] - rank[b.priority] || String(a.dueAt).localeCompare(String(b.dueAt)));
    let remaining = policy.rollingCapCents;
    const recommended: string[] = [];
    const held: string[] = [];
    for (const job of eligible) {
      if (job.amountCents <= remaining) { recommended.push(job.jobId); remaining -= job.amountCents; }
      else held.push(`${job.title}: insufficient illustrative allocation room`);
    }
    for (const job of jobs.filter((row) => row.approvalState !== "approved")) held.push(`${job.title}: owner approval is still required`);
    for (const job of jobs.filter((row) => row.amountCents > policy.perPaymentCapCents)) held.push(`${job.title}: exceeds the per-payment policy`);
    const id = randomUUID();
    const origin: RecordOrigin = workspace.kind === "demo" ? "synthetic" : "application";
    const actor = workspace.kind === "demo" ? "demonstration agent" : userId!;
    const summary = recommended.length ? `${recommended.length} approved ${recommended.length === 1 ? "job" : "jobs"} recommended; nothing is paid` : "No payment recommendation is ready";
    const rationale = `Ranked owner-approved work by priority and due date. Applied the $${(policy.perPaymentCapCents / 100).toFixed(2)} per-payment and $${(policy.rollingCapCents / 100).toFixed(2)} rolling limits. ${held.length ? `Held: ${held.join("; ")}.` : "No jobs were held."} The agent cannot approve its own recommendation or execute a payout.`;
    this.db.prepare("INSERT INTO product_decisions VALUES(?,?,?,?,?,?,?,?,?)").run(id, workspaceId, recommended.length ? "recommendation_ready" : "no_candidates", summary, rationale, JSON.stringify(recommended), origin, actor, at);
    this.audit(workspaceId, actor, "recommendation_created", id, summary, at);
    return this.listDecisions(workspaceId, userId).find((decision) => decision.decisionId === id)!;
  }
  listDecisions(workspaceId: string, userId: string | null): ProductDecision[] {
    this.getWorkspace(workspaceId, userId);
    return (this.db.prepare("SELECT * FROM product_decisions WHERE workspace_id=? ORDER BY created_at DESC").all(workspaceId) as Row[]).map((row) => ({
      decisionId: String(row.decision_id), workspaceId, status: String(row.status), summary: String(row.summary), rationale: String(row.rationale),
      recommendedJobIds: JSON.parse(String(row.recommended_job_ids_json)) as string[], origin: row.origin as RecordOrigin, createdBy: String(row.created_by), createdAt: String(row.created_at),
    }));
  }
  approveJob(workspaceId: string, jobId: string, userId: string, at: string): ProductJob {
    this.requireOwner(workspaceId, userId, true);
    const job = this.getJob(workspaceId, jobId, userId);
    this.tx(() => {
      this.db.prepare("UPDATE product_jobs SET approval_state='approved',approved_by=?,approved_at=?,updated_at=? WHERE job_id=?").run(userId, at, at, jobId);
      this.db.prepare(`INSERT OR IGNORE INTO product_receipts(receipt_id,workspace_id,job_id,payment_id,title,recipient_name,recipient_email,amount_cents,currency,origin,provider_environment,verification_state,approved_by,approved_at,ingested_at)
        VALUES(?,?,?,NULL,?,?,?,?,'USD','application','sandbox','unverified',?,?,?)`).run(`receipt-${jobId}`, workspaceId, jobId, job.title, job.recipientName, job.recipientEmail, job.amountCents, userId, at, at);
      this.audit(workspaceId, userId, "job_approved", jobId, "Owner authorized this obligation; no provider submission has occurred.", at);
    });
    return this.getJob(workspaceId, jobId, userId);
  }
  getPolicy(workspaceId: string, userId: string | null): WorkspacePolicy {
    this.getWorkspace(workspaceId, userId);
    const row = this.db.prepare("SELECT * FROM product_workspace_policies WHERE workspace_id=?").get(workspaceId) as Row;
    return { perPaymentCapCents: Number(row.per_payment_cap_cents), rollingCapCents: Number(row.rolling_cap_cents), windowHours: Number(row.window_hours), approvalExpiryDays: Number(row.approval_expiry_days), updatedBy: String(row.updated_by), updatedAt: String(row.updated_at) };
  }
  updatePolicy(workspaceId: string, userId: string, input: { perPaymentCapCents: number; rollingCapCents: number }, at: string): WorkspacePolicy {
    this.requireOwner(workspaceId, userId);
    safeCents(input.perPaymentCapCents, "per-payment cap"); safeCents(input.rollingCapCents, "rolling cap", true);
    if (input.perPaymentCapCents > input.rollingCapCents) throw new Error("per-payment cap cannot exceed the rolling cap");
    this.db.prepare("UPDATE product_workspace_policies SET per_payment_cap_cents=?,rolling_cap_cents=?,updated_by=?,updated_at=? WHERE workspace_id=?").run(input.perPaymentCapCents, input.rollingCapCents, userId, at, workspaceId);
    this.audit(workspaceId, userId, "policy_changed", workspaceId, `Per-payment $${input.perPaymentCapCents / 100}; rolling $${input.rollingCapCents / 100}.`, at);
    return this.getPolicy(workspaceId, userId);
  }
  private receiptRow(row: Row): ProductReceipt {
    const common = { receiptId: String(row.receipt_id), workspaceId: String(row.workspace_id), jobId: text(row.job_id), paymentId: text(row.payment_id), title: String(row.title), recipientName: String(row.recipient_name), recipientEmail: text(row.recipient_email), amountCents: Number(row.amount_cents), currency: String(row.currency), origin: row.origin as RecordOrigin, providerEnvironment: row.provider_environment as ProviderEnvironment, verificationState: row.verification_state as VerificationState,
      approvedBy: text(row.approved_by), approvedAt: text(row.approved_at), policyVersion: row.policy_version === null ? null : Number(row.policy_version), submittedAt: text(row.submitted_at), payoutBatchId: text(row.payout_batch_id), payoutItemId: text(row.payout_item_id), transactionId: text(row.transaction_id), providerStatus: text(row.provider_status), feeCents: row.fee_cents === null ? null : Number(row.fee_cents), providerTimestamp: text(row.provider_timestamp), ingestedAt: text(row.ingested_at), lastReconciledAt: text(row.last_reconciled_at), reconciliationRunId: text(row.reconciliation_run_id), discrepancies: row.raw_json ? JSON.parse(String(row.raw_json)) as Row[] : [] };
    const historical = common.verificationState === "historical_evidence_only";
    const timeline: ReceiptTimelineEvent[] = [
      { kind: "authorization", label: "Owner authorization", state: common.approvedAt ? historical ? "historical" : "complete" : "missing", at: common.approvedAt, detail: common.approvedBy ?? "No owner authorization recorded" },
      { kind: "submission", label: "Payment submission", state: common.submittedAt ? "complete" : "missing", at: common.submittedAt, detail: common.submittedAt ? "Submitted by Settle" : "No submission timestamp in this record" },
      { kind: "provider_acknowledgement", label: "Provider acknowledgement", state: common.payoutBatchId ? historical ? "historical" : "complete" : "missing", at: null, detail: common.payoutBatchId ? `PayPal batch ${common.payoutBatchId}` : "No PayPal batch ID available" },
      { kind: "item_outcome", label: "Payout item outcome", state: common.providerStatus ? historical ? "historical" : "complete" : "missing", at: common.providerTimestamp, detail: common.providerStatus ? `${common.providerStatus}${common.payoutItemId ? ` · item ${common.payoutItemId}` : " · item ID unavailable"}` : "No item-level provider outcome available" },
      { kind: "transaction", label: "Transaction evidence", state: common.transactionId ? "complete" : "missing", at: common.providerTimestamp, detail: common.transactionId ?? "No PayPal transaction ID available" },
      { kind: "reconciliation", label: "Independent reconciliation", state: common.lastReconciledAt ? "complete" : "missing", at: common.lastReconciledAt, detail: common.lastReconciledAt ? `Run ${common.reconciliationRunId ?? "ID unavailable"}` : historical ? "Historical reference only; this application has not independently reconciled it" : "Not independently reconciled" },
    ];
    return { ...common, timeline };
  }
  listReceipts(workspaceId: string, userId: string | null): ProductReceipt[] {
    this.getWorkspace(workspaceId, userId);
    return (this.db.prepare("SELECT * FROM product_receipts WHERE workspace_id=? ORDER BY COALESCE(provider_timestamp,approved_at) DESC,receipt_id").all(workspaceId) as Row[]).map((row) => this.receiptRow(row));
  }
  getReceipt(workspaceId: string, receiptId: string, userId: string | null): ProductReceipt {
    this.getWorkspace(workspaceId, userId);
    const row = this.db.prepare("SELECT * FROM product_receipts WHERE workspace_id=? AND receipt_id=?").get(workspaceId, receiptId) as Row | undefined;
    if (!row) throw new ProductPermissionError(404, "receipt not found");
    return this.receiptRow(row);
  }
  linkPayment(workspaceId: string, jobId: string, paymentId: string, userId: string, at: string): void {
    this.requireOwner(workspaceId, userId, true);
    const result = this.db.prepare("UPDATE product_receipts SET payment_id=?,ingested_at=? WHERE workspace_id=? AND job_id=?")
      .run(paymentId, at, workspaceId, jobId);
    if (result.changes === 0) throw new Error("approved receipt not found");
  }
  syncPaymentEvidence(input: { workspaceId: string; paymentId: string; verificationState: VerificationState; submittedAt: string | null; policyVersion: number | null; payoutBatchId: string | null; payoutItemId: string | null; transactionId: string | null; providerStatus: string | null; feeCents: number | null; providerTimestamp: string | null; ingestedAt: string | null; lastReconciledAt: string | null; reconciliationRunId: string | null; discrepancies?: Row[] }): void {
    this.db.prepare(`UPDATE product_receipts SET verification_state=?,submitted_at=?,policy_version=?,payout_batch_id=?,payout_item_id=?,transaction_id=?,provider_status=?,fee_cents=?,provider_timestamp=?,ingested_at=?,last_reconciled_at=?,reconciliation_run_id=?,raw_json=? WHERE workspace_id=? AND payment_id=?`)
      .run(input.verificationState, input.submittedAt, input.policyVersion, input.payoutBatchId, input.payoutItemId, input.transactionId, input.providerStatus, input.feeCents, input.providerTimestamp, input.ingestedAt, input.lastReconciledAt, input.reconciliationRunId, JSON.stringify(input.discrepancies ?? []), input.workspaceId, input.paymentId);
  }
  resetDemo(userId: string, at: string): void {
    if (!userId) throw new ProductPermissionError(401, "owner sign-in is required to reset the demonstration");
    this.tx(() => {
      this.db.prepare("DELETE FROM product_receipts WHERE workspace_id='demo'").run();
      this.db.prepare("DELETE FROM product_decisions WHERE workspace_id='demo'").run();
      this.db.prepare("DELETE FROM product_jobs WHERE workspace_id='demo'").run();
      this.db.prepare("DELETE FROM product_workspace_policies WHERE workspace_id='demo'").run();
      this.db.prepare("DELETE FROM product_workspaces WHERE workspace_id='demo' AND kind='demo'").run();
      this.insertDemoRows(at);
    });
  }
  listAudit(workspaceId: string, userId: string | null): Row[] {
    this.getWorkspace(workspaceId, userId);
    return this.db.prepare("SELECT * FROM product_audit WHERE workspace_id=? ORDER BY sequence DESC").all(workspaceId) as Row[];
  }
}
