// Read-only product provenance inspection. Does not print sessions, users,
// operational recipients, tokens or provider responses.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const dbPath = process.argv[2] ?? "data/settle.db";
const output = process.argv[3] ?? "evidence/database/product-inspection.json";
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = (sql: string) => db.prepare(sql).all() as unknown[];
const report = {
  inspectedAt: new Date().toISOString(),
  database: dbPath,
  method: "Direct read-only SQLite inspection, not a product API status",
  tables: rows("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'product_%' OR name IN ('payments','payout_items','reconciliation_runs')) ORDER BY name"),
  demoJobs: rows("SELECT job_id,workspace_id,origin,provider_environment,approval_state FROM product_jobs WHERE workspace_id='demo' ORDER BY job_id"),
  demoReceipts: rows("SELECT receipt_id,workspace_id,payment_id,origin,provider_environment,verification_state,payout_batch_id,payout_item_id,transaction_id,last_reconciled_at,reconciliation_run_id FROM product_receipts WHERE workspace_id='demo'"),
  demoLedgerContamination: rows("SELECT COUNT(*) AS linked_demo_payments FROM product_receipts WHERE workspace_id='demo' AND payment_id IS NOT NULL"),
  isolationTriggers: rows("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'demo_%' OR name='operational_receipt_origin') ORDER BY name"),
  reconciliationSchema: rows("SELECT sql FROM sqlite_master WHERE type='table' AND name='reconciliation_runs'"),
};
db.close();
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
