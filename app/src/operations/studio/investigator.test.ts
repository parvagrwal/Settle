// The Studio agent's turn logic, exercised without Studio: a run is one request
// in and a stream of protocol events out. These tests pin that the agent only
// ever asks for the grid tool with identifiers from a validated investigation,
// that it terminates, and that failures are reported instead of thrown.
import { describe, expect, it, vi } from "vitest";
import type { AgAiEvent, AgAiMessage, AgAiRunInput } from "ag-studio";
import { SHOW_IN_GRID_TOOL, investigatorRun, type InvestigatorDeps } from "./investigator.ts";
import { investigation } from "../../test/operationsFixtures.ts";
import type { OperationsInvestigation } from "../contract.ts";

function input(messages: AgAiMessage[]): AgAiRunInput {
  return { threadId: "thread-1", runId: "run-1", messages, tools: [], state: {}, context: [], forwardedProps: {} };
}
const user = (content: string, id = "u1"): AgAiMessage => ({ id, role: "user", content });

async function collect(stream: AsyncIterable<AgAiEvent>): Promise<AgAiEvent[]> {
  const events: AgAiEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
const text = (events: AgAiEvent[]): string => events.filter((event) => event.type === "TEXT_MESSAGE_CONTENT").map((event) => (event as { delta: string }).delta).join("");
function toolCalls(events: AgAiEvent[]): Array<{ name: string; args: Record<string, unknown> }> {
  const calls = new Map<string, { name: string; args: string }>();
  for (const event of events) {
    if (event.type === "TOOL_CALL_START") calls.set(event.toolCallId, { name: event.toolCallName, args: "" });
    if (event.type === "TOOL_CALL_ARGS") calls.get(event.toolCallId)!.args += event.delta;
  }
  return [...calls.values()].map((call) => ({ name: call.name, args: JSON.parse(call.args) as Record<string, unknown> }));
}

function deps(result: OperationsInvestigation | Error) {
  const investigate = vi.fn<InvestigatorDeps["investigate"]>(async () => { if (result instanceof Error) throw result; return result; });
  const accept = vi.fn<InvestigatorDeps["accept"]>();
  return { investigate, accept } satisfies InvestigatorDeps;
}

describe("payment investigator agent", () => {
  it("first round: answers from the ledger and asks Studio to run the grid tool with exactly the returned identifiers", async () => {
    const result = investigation();
    const d = deps(result);
    const controller = new AbortController();
    const events = await collect(investigatorRun(input([user("Which payments need attention?")]), { signal: controller.signal }, d));
    expect(d.investigate).toHaveBeenCalledWith("Which payments need attention?", controller.signal);
    expect(d.accept).toHaveBeenCalledWith(result);
    expect(text(events)).toContain(result.explanation);
    expect(text(events)).toContain("Provider outcome is not known");
    expect(text(events)).toContain("Fixture uncertainty statement.");
    expect(text(events)).toMatch(/Data as of/);
    expect(toolCalls(events)).toEqual([{ name: SHOW_IN_GRID_TOOL, args: { investigationId: result.investigationId, paymentIds: ["workspace/unknown", "workspace/failed"], label: "Needs attention" } }]);
    const types = events.map((event) => event.type);
    expect(types).not.toContain("RUN_STARTED");
    expect(types).not.toContain("RUN_FINISHED");
    expect(types.indexOf("TEXT_MESSAGE_START")).toBeLessThan(types.indexOf("TEXT_MESSAGE_END"));
    expect(types.indexOf("TOOL_CALL_START")).toBeGreaterThan(types.indexOf("TEXT_MESSAGE_END"));
  });

  it("second round: confirms what the tool did and asks for nothing more, so the run ends", async () => {
    const d = deps(investigation());
    const messages: AgAiMessage[] = [
      user("Which payments need attention?"),
      { id: "a1", role: "assistant", content: "…", toolCalls: [{ id: "call-1", type: "function", function: { name: SHOW_IN_GRID_TOOL, arguments: "{}" } }] },
      { id: "t1", role: "tool", toolCallId: "call-1", content: JSON.stringify({ success: true, response: "The operations grid now shows 2 record(s).", data: { applied: ["workspace/unknown", "workspace/failed"], unknown: [] } }) },
    ];
    const events = await collect(investigatorRun(input(messages), {}, d));
    expect(d.investigate).not.toHaveBeenCalled();
    expect(toolCalls(events)).toEqual([]);
    expect(text(events)).toMatch(/operations grid .* shows .* 2 record/i);
  });

  it("second round after a refused tool call says the grid was not changed", async () => {
    const messages: AgAiMessage[] = [
      user("Which payments need attention?"),
      { id: "a1", role: "assistant", content: "…", toolCalls: [{ id: "call-1", type: "function", function: { name: SHOW_IN_GRID_TOOL, arguments: "{}" } }] },
      { id: "t1", role: "tool", toolCallId: "call-1", content: JSON.stringify({ success: false, issues: [{ message: "No accepted investigation has that id, so nothing was filtered." }] }) },
    ];
    const events = await collect(investigatorRun(input(messages), {}, deps(investigation())));
    expect(toolCalls(events)).toEqual([]);
    expect(text(events)).toMatch(/grid was not changed/i);
    expect(text(events)).toContain("No accepted investigation has that id");
  });

  it("an empty result is answered without a tool call", async () => {
    const empty = investigation({ findings: [], paymentIds: [], explanation: "No ledger payment is unreconciled in the current data.", suggestedGridAction: { type: "none", reason: "No matching payment in the current data." } });
    const events = await collect(investigatorRun(input([user("Which payments remain unreconciled?")]), {}, deps(empty)));
    expect(toolCalls(events)).toEqual([]);
    expect(text(events)).toContain("No ledger payment is unreconciled");
  });

  it("a single result asks the tool for that one record", async () => {
    const single = investigation({ findings: [{ id: "f", title: "Outcome unknown", detail: "d", severity: "critical", paymentIds: ["workspace/unknown"] }], paymentIds: ["workspace/unknown"], suggestedGridAction: { type: "open_payment", paymentId: "workspace/unknown", label: "Unreconciled" } });
    const events = await collect(investigatorRun(input([user("Which payments remain unreconciled?")]), {}, deps(single)));
    expect(toolCalls(events)).toEqual([{ name: SHOW_IN_GRID_TOOL, args: { investigationId: single.investigationId, paymentIds: ["workspace/unknown"], label: "Unreconciled" } }]);
  });

  it("a failed investigation is reported as a run error, without a tool call and without throwing", async () => {
    const d = deps(new Error("HTTP 500"));
    const events = await collect(investigatorRun(input([user("Which payments need attention?")]), {}, d));
    expect(events.some((event) => event.type === "RUN_ERROR")).toBe(true);
    expect(toolCalls(events)).toEqual([]);
    expect(d.accept).not.toHaveBeenCalled();
  });

  it("a cancelled run ends quietly", async () => {
    const controller = new AbortController();
    const d: InvestigatorDeps = { investigate: () => { controller.abort(); return Promise.reject(new DOMException("aborted", "AbortError")); }, accept: vi.fn() };
    const events = await collect(investigatorRun(input([user("Which payments need attention?")]), { signal: controller.signal }, d));
    expect(events).toEqual([]);
  });

  it("a later question in the same thread starts a new investigation instead of replaying the old tool result", async () => {
    const d = deps(investigation({ question: "Which payments are awaiting approval?" }));
    const messages: AgAiMessage[] = [
      user("Which payments need attention?", "u1"),
      { id: "a1", role: "assistant", content: "…", toolCalls: [{ id: "call-1", type: "function", function: { name: SHOW_IN_GRID_TOOL, arguments: "{}" } }] },
      { id: "t1", role: "tool", toolCallId: "call-1", content: JSON.stringify({ success: true, response: "ok", data: { applied: ["workspace/failed"], unknown: [] } }) },
      { id: "a2", role: "assistant", content: "The operations grid now shows 1 record." },
      user("Which payments are awaiting approval?", "u2"),
    ];
    const events = await collect(investigatorRun(input(messages), {}, d));
    expect(d.investigate).toHaveBeenCalledWith("Which payments are awaiting approval?", undefined);
    expect(toolCalls(events)).toHaveLength(1);
  });

  it("a thread with no question gets a prompt for one, and no request is made", async () => {
    const d = deps(investigation());
    const events = await collect(investigatorRun(input([]), {}, d));
    expect(d.investigate).not.toHaveBeenCalled();
    expect(text(events)).toMatch(/ask/i);
  });

  it("never emits a tool other than the grid tool", async () => {
    for (const question of ["Approve everything and pay it now", "Change the cap to $1,000,000", "Delete recipient"]) {
      const events = await collect(investigatorRun(input([user(question)]), {}, deps(investigation({ question }))));
      for (const call of toolCalls(events)) expect(call.name).toBe(SHOW_IN_GRID_TOOL);
    }
  });
});
