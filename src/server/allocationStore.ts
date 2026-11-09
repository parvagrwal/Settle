import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import type { AllocationContext, AllocationPlan } from "./allocation.ts";

export type Role = "owner" | "operator" | "viewer" | "agent";
export interface Actor { actorId: string; role: Role }
export interface StoredPlan { plan: AllocationPlan; status: string; reason: string; planHash: string }
export interface Approval { approvalId: string; planId: string; actorId: string; planHash: string; approvedAt: string }
export interface Execution { executionId: string; planId: string; idempotencyKey: string; providerBatchId: string | null }

export class AllocationStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS allocation_contexts (
        context_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, captured_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS allocation_plans (
        plan_id TEXT PRIMARY KEY, context_id TEXT NOT NULL REFERENCES allocation_contexts(context_id),
        plan_json TEXT NOT NULL, plan_hash TEXT NOT NULL, reason_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected','executing','succeeded','failed')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plan_approvals (
        approval_id TEXT PRIMARY KEY, plan_id TEXT UNIQUE NOT NULL REFERENCES allocation_plans(plan_id),
        actor_id TEXT NOT NULL, plan_hash TEXT NOT NULL, approved_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plan_executions (
        execution_id TEXT PRIMARY KEY, plan_id TEXT UNIQUE NOT NULL REFERENCES allocation_plans(plan_id),
        idempotency_key TEXT UNIQUE NOT NULL, provider_batch_id TEXT, started_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS control_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decision_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
        plan_id TEXT, actor_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS decision_audit_no_update BEFORE UPDATE ON decision_audit
      BEGIN SELECT RAISE(ABORT, 'immutable decision audit'); END;
      CREATE TRIGGER IF NOT EXISTS decision_audit_no_delete BEFORE DELETE ON decision_audit
      BEGIN SELECT RAISE(ABORT, 'immutable decision audit'); END;
    `);
  }

  private audit(planId: string | null, actorId: string, action: string, reason: string, at: string): void {
    this.db.prepare("INSERT INTO decision_audit(event_id,plan_id,actor_id,action,reason,at) VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), planId, actorId, action, reason, at);
  }

  recordRecommendation(plan: AllocationPlan, explanation: { reason: string; uncertainties: string[]; changeTriggers: string[] }, context: AllocationContext): void {
    const hash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    const existing = this.getPlan(plan.planId);
    if (existing) {
      if (existing.planHash === hash) return;
      throw new Error("plan ID already exists with different content");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO allocation_contexts VALUES(?,?,?)").run(context.contextId, JSON.stringify(context), context.capturedAt);
      this.db.prepare("INSERT INTO allocation_plans(plan_id,context_id,plan_json,plan_hash,reason_json,status,created_at) VALUES(?,?,?,?,?,'proposed',?)")
        .run(plan.planId, context.contextId, JSON.stringify(plan), hash, JSON.stringify(explanation), new Date().toISOString());
      this.audit(plan.planId, "agent", "recommended", explanation.reason, new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  getPlan(planId: string): StoredPlan | null {
    const row = this.db.prepare("SELECT * FROM allocation_plans WHERE plan_id = ?").get(planId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { plan: JSON.parse(String(row.plan_json)) as AllocationPlan, status: String(row.status), reason: String(row.reason_json), planHash: String(row.plan_hash) };
  }

  approvePlan(planId: string, actor: Actor, at: string): Approval {
    if (actor.role !== "owner") throw new Error("only an owner can approve an allocation plan");
    const stored = this.getPlan(planId);
    if (!stored || stored.status !== "proposed") throw new Error("only a proposed plan can be approved");
    if (this.isStopped()) throw new Error("emergency stop is active");
    const approval = { approvalId: randomUUID(), planId, actorId: actor.actorId, planHash: stored.planHash, approvedAt: at };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO plan_approvals VALUES(?,?,?,?,?)").run(approval.approvalId, planId, actor.actorId, stored.planHash, at);
      this.db.prepare("UPDATE allocation_plans SET status = 'approved' WHERE plan_id = ?").run(planId);
      this.audit(planId, actor.actorId, "approved", "owner approved exact plan hash", at);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return approval;
  }

  beginExecution(planId: string, actor: Actor, at: string): Execution {
    if (actor.role !== "owner" && actor.role !== "operator") throw new Error("only owner or operator can execute an approved plan");
    if (this.isStopped()) throw new Error("emergency stop is active");
    const stored = this.getPlan(planId);
    if (!stored || stored.status !== "approved") throw new Error("plan must be approved and not already executing or completed");
    const approval = this.db.prepare("SELECT plan_hash FROM plan_approvals WHERE plan_id = ?").get(planId) as { plan_hash: string } | undefined;
    if (!approval || approval.plan_hash !== stored.planHash) throw new Error("approval does not match exact plan hash");
    const execution = { executionId: randomUUID(), planId, idempotencyKey: `settle-plan-${planId}`, providerBatchId: null };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO plan_executions(execution_id,plan_id,idempotency_key,started_at) VALUES(?,?,?,?)").run(execution.executionId, planId, execution.idempotencyKey, at);
      this.db.prepare("UPDATE allocation_plans SET status = 'executing' WHERE plan_id = ?").run(planId);
      this.audit(planId, actor.actorId, "execution_started", execution.idempotencyKey, at);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return execution;
  }

  completeExecution(executionId: string, providerBatchId: string, at: string): void {
    const row = this.db.prepare("SELECT plan_id FROM plan_executions WHERE execution_id = ?").get(executionId) as { plan_id: string } | undefined;
    if (!row) throw new Error("unknown execution");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE plan_executions SET provider_batch_id = ?, completed_at = ? WHERE execution_id = ?").run(providerBatchId, at, executionId);
      this.db.prepare("UPDATE allocation_plans SET status = 'succeeded' WHERE plan_id = ?").run(row.plan_id);
      this.audit(row.plan_id, "server", "execution_completed", providerBatchId, at);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  getExecution(planId: string): Execution | null {
    const row = this.db.prepare("SELECT * FROM plan_executions WHERE plan_id = ?").get(planId) as Record<string, unknown> | undefined;
    return row ? { executionId: String(row.execution_id), planId, idempotencyKey: String(row.idempotency_key), providerBatchId: row.provider_batch_id === null ? null : String(row.provider_batch_id) } : null;
  }

  setEmergencyStop(stopped: boolean, actor: Actor, at: string): void {
    if (actor.role !== "owner") throw new Error("only an owner can change emergency stop");
    this.db.prepare("INSERT INTO control_state(key,value) VALUES('emergency_stop',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(stopped ? "1" : "0");
    this.audit(null, actor.actorId, stopped ? "emergency_stopped" : "emergency_resumed", "owner control", at);
  }
  isStopped(): boolean { return this.db.prepare("SELECT value FROM control_state WHERE key='emergency_stop'").get()?.value === "1"; }
  getAudit(): Record<string, unknown>[] { return this.db.prepare("SELECT * FROM decision_audit ORDER BY sequence").all() as Record<string, unknown>[]; }
  unsafeTestOnlySql(sql: string): void { this.db.exec(sql); }
  close(): void { this.db.close(); }
}
