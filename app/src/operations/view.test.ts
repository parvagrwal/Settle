// The view model is the single place a ledger row becomes display text. The
// grid, the Studio data source and the widget all read it, so a label or a due
// window can never be computed two different ways.
import { describe, expect, it } from "vitest";
import { dueWindow, formatCents, recordName, studioRows, STUDIO_FIELDS, STUDIO_TO_GRID_COLUMN, toViews } from "./view.ts";
import { row, standardRows } from "../test/operationsFixtures.ts";

describe("operation view model", () => {
  it("names a record by its title, then its job, then its id", () => {
    expect(recordName(row({ title: "Landing page" }))).toBe("Landing page");
    expect(recordName(row({ title: null, jobId: "demo-waiting-1" }))).toBe("demo-waiting-1");
    expect(recordName(row({ title: null, jobId: null, operationId: "receipt/r-1" }))).toBe("receipt/r-1");
  });

  it("puts every pending record in exactly one due window and everything else in 'Not pending'", () => {
    expect(dueWindow(row({ isPendingObligation: true, dueInDays: -2 }))).toBe("Overdue");
    expect(dueWindow(row({ isPendingObligation: true, dueInDays: 0 }))).toBe("Due within 3 days");
    expect(dueWindow(row({ isPendingObligation: true, dueInDays: 3 }))).toBe("Due within 3 days");
    expect(dueWindow(row({ isPendingObligation: true, dueInDays: 4 }))).toBe("Due later");
    expect(dueWindow(row({ isPendingObligation: true, dueInDays: null, dueDate: null }))).toBe("No due date");
    expect(dueWindow(row({ isPendingObligation: false, dueInDays: -9 }))).toBe("Not pending");
  });

  it("formats money from integer cents and never invents a value for a missing one", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(null)).toBe("Not reported");
  });

  it("keeps the row's own values and adds display labels", () => {
    const [view] = toViews([row({ approvalState: "expired", verificationState: "provider_confirmed", reconciliationState: "not_reconciled", providerEnvironment: "sandbox", isDemonstration: false })]);
    expect(view.operationId).toBe("workspace/job-1");
    expect(view.approvalLabel).toBe("Approval expired");
    expect(view.verificationLabel).toBe("Confirmed by PayPal");
    expect(view.reconciliationLabel).toBe("Not reconciled");
    expect(view.environmentLabel).toBe("PayPal Sandbox");
    expect(view.recordClass).toBe("Operational");
    expect(view.sourceLabel).toBe("Fixture studio");
    const [demo] = toViews([row({ isDemonstration: true, recordOrigin: "seed", providerEnvironment: "none", verificationState: "demonstration", source: "legacy_grid", workspaceName: null })]);
    expect(demo.recordClass).toBe("Demonstration");
    expect(demo.environmentLabel).toBe("Not sent");
    expect(demo.sourceLabel).toBe("Legacy demonstration grid");
  });

  it("gives Studio one row per record with the same labels the grid filters on", () => {
    const views = toViews(standardRows());
    const rows = studioRows(views);
    expect(rows).toHaveLength(views.length);
    const failed = rows.find((entry) => entry.operationId === "workspace/failed")!;
    const view = views.find((entry) => entry.operationId === "workspace/failed")!;
    expect(failed.paymentStatus).toBe(view.paymentStatusLabel);
    expect(failed.approvalState).toBe(view.approvalLabel);
    expect(failed.verificationState).toBe(view.verificationLabel);
    expect(failed.amount).toBe(13);
    expect(failed.needsAttention).toBe(true);
    expect(failed.record).toBe("Icon set");
    for (const field of STUDIO_FIELDS) expect(Object.keys(failed), `${field.id} is present in the row`).toContain(field.id);
  });

  it("maps every mirrored Studio field to a grid column that carries the same values", () => {
    const fieldIds = new Set(STUDIO_FIELDS.map((field) => field.id));
    for (const [studioField, column] of Object.entries(STUDIO_TO_GRID_COLUMN)) {
      expect(fieldIds.has(studioField), `${studioField} is a Studio field`).toBe(true);
      expect(column.length).toBeGreaterThan(0);
    }
    expect(STUDIO_TO_GRID_COLUMN.paymentStatus).toBe("paymentStatus");
  });
});
