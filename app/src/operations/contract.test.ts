// The dashboard does not act on a response it has not checked. These tests pin
// what is accepted and, more importantly, what is refused.
import { describe, expect, it } from "vitest";
import { ContractError, matchToRows, parseDetail, parseInvestigation, parseSnapshot } from "./contract.ts";
import { detail, investigation, row, snapshot, standardRows } from "../test/operationsFixtures.ts";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("operations snapshot contract", () => {
  it("accepts a well-formed snapshot unchanged", () => {
    const input = snapshot(standardRows());
    expect(parseSnapshot(clone(input))).toEqual(input);
  });

  it.each([
    ["rows is not an array", (value: any) => { value.rows = {}; }],
    ["a row without an operationId", (value: any) => { delete value.rows[0].operationId; }],
    ["two rows with the same operationId", (value: any) => { value.rows[1].operationId = value.rows[0].operationId; }],
    ["a fractional amount", (value: any) => { value.rows[0].amountCents = 12.5; }],
    ["a negative amount", (value: any) => { value.rows[0].amountCents = -1; }],
    ["a flag that is not a boolean", (value: any) => { value.rows[0].needsAttention = "yes"; }],
    ["an identifier of the wrong type", (value: any) => { value.rows[0].payoutBatchId = 42; }],
    ["an unknown payment status", (value: any) => { value.rows[0].paymentStatus = "paid_in_full"; }],
    ["a capacity figure that is not a whole number of cents", (value: any) => { value.capacity.remainingCents = "lots"; }],
    ["a missing data version", (value: any) => { delete value.dataVersion; }],
    ["an unreadable timestamp", (value: any) => { value.generatedAt = "yesterday"; }],
    ["an exception bucket naming a row that is not in the snapshot", (value: any) => { value.exceptions.needsAttention.operationIds.push("workspace/ghost"); }],
  ])("refuses %s", (_name, mutate) => {
    const value = clone(snapshot(standardRows()));
    mutate(value);
    expect(() => parseSnapshot(value)).toThrow(ContractError);
  });
});

describe("investigation contract", () => {
  it("accepts a well-formed investigation", () => {
    const input = investigation();
    expect(parseInvestigation(clone(input))).toEqual(input);
  });

  it.each([
    ["an unknown contract version", (value: any) => { value.contractVersion = 2; }],
    ["a missing investigation id", (value: any) => { value.investigationId = ""; }],
    ["an unknown intent", (value: any) => { value.intent = "execute_payment"; }],
    ["a response that is not read-only", (value: any) => { value.readOnly = false; }],
    ["payment ids that are not strings", (value: any) => { value.paymentIds = [1, 2]; }],
    ["duplicate payment ids", (value: any) => { value.paymentIds = ["workspace/unknown", "workspace/unknown", "workspace/failed"]; }],
    ["a finding that references an id outside the id list", (value: any) => { value.findings[0].paymentIds = ["workspace/else"]; }],
    ["an id list with an id no finding supports", (value: any) => { value.paymentIds.push("workspace/ready"); }],
    ["a filter action for ids outside the id list", (value: any) => { value.suggestedGridAction = { type: "filter_payments", paymentIds: ["workspace/ready"], label: "x" }; }],
    ["an open action for an id outside the id list", (value: any) => { value.suggestedGridAction = { type: "open_payment", paymentId: "workspace/ready", label: "x" }; }],
    ["an unknown action type", (value: any) => { value.suggestedGridAction = { type: "approve_payments", paymentIds: ["workspace/failed"] }; }],
    ["a filter expression instead of ids", (value: any) => { value.suggestedGridAction = { type: "filter_payments", filter: "status = 'failed'", label: "x" }; }],
    ["an unknown severity", (value: any) => { value.findings[0].severity = "catastrophic"; }],
    ["a missing explanation", (value: any) => { value.explanation = ""; }],
    ["an unreadable data timestamp", (value: any) => { value.dataTimestamp = "now"; }],
    ["uncertainty that is not a list of strings", (value: any) => { value.uncertainty = "none"; }],
    ["an unknown source", (value: any) => { value.source = "A language model"; }],
    ["something that is not an object", (value: any) => { for (const key of Object.keys(value)) delete value[key]; }],
  ])("refuses %s", (_name, mutate) => {
    const value = clone(investigation());
    mutate(value);
    expect(() => parseInvestigation(value)).toThrow(ContractError);
  });

  it("accepts an empty result with a 'none' action", () => {
    const empty = investigation({ findings: [], paymentIds: [], suggestedGridAction: { type: "none", reason: "No matching payment in the current data." } });
    expect(parseInvestigation(clone(empty)).paymentIds).toEqual([]);
  });

  it("separates identifiers that exist in the current rows from those that do not", () => {
    const rows = standardRows();
    const result = investigation({ paymentIds: ["workspace/unknown", "workspace/failed"] });
    expect(matchToRows(result.paymentIds, rows)).toEqual({ known: ["workspace/unknown", "workspace/failed"], unknown: [] });
    expect(matchToRows(["workspace/failed", "workspace/ghost", "legacy/also-missing"], rows)).toEqual({ known: ["workspace/failed"], unknown: ["workspace/ghost", "legacy/also-missing"] });
    expect(matchToRows([], rows)).toEqual({ known: [], unknown: [] });
  });
});

describe("payment detail contract", () => {
  it("accepts a well-formed detail and refuses a malformed one", () => {
    const input = detail(row());
    expect(parseDetail(clone(input))).toEqual(input);
    const noRow = clone(input) as any; delete noRow.row;
    expect(() => parseDetail(noRow)).toThrow(ContractError);
    const badAccess = clone(input) as any; badAccess.audit.access = "everyone";
    expect(() => parseDetail(badAccess)).toThrow(ContractError);
    const badEvents = clone(input) as any; badEvents.audit.events = "none";
    expect(() => parseDetail(badEvents)).toThrow(ContractError);
  });
});
