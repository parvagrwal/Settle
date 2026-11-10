// Payment investigator: a custom agent on the AG Studio Agent Framework.
//
// How it is wired (all of it is the framework's public surface in ag-studio 3.0):
//
//   AgStudio `ai`  ──▶  createAiHarness(api, builder)       Studio's own harness: threads, chat panel
//                        └─ clientToolRunner({ run, tools })  a turn comes from `run`; Studio executes the tools
//                             ├─ run   = investigatorRun      asks the read-only ledger endpoint, no model in the loop
//                             └─ tools = [show_payments_in_grid]   built with api.defineAiTool; runs in the browser
//
// The agent has exactly one tool, and that tool can only filter the operations
// grid to identifiers of an investigation the dashboard has already validated.
// There is no tool that approves, pays, edits or queries anything else, so the
// agent cannot be talked into doing so.
import { clientToolRunner, createAiHarness } from "ag-studio";
import type { AgAiEvent, AgAiEventStream, AgAiHarness, AgAiMessage, AgAiRunInput, AgStudioApi } from "ag-studio";
import type { OperationsInvestigation } from "../contract.ts";
import { SUPPORTED_QUESTIONS } from "../questions.ts";
import type { OperationsStore } from "../store.ts";
import { formatDateTime } from "../view.ts";

export const INVESTIGATOR_AGENT_ID = "settle-payment-investigator";
export const SHOW_IN_GRID_TOOL = "show_payments_in_grid";

export interface InvestigatorDeps {
  /** Validated, read-only investigation over the ledger projection. */
  investigate(question: string, signal: AbortSignal | undefined): Promise<OperationsInvestigation>;
  /** Hand the validated result to the shared store, so the grid tool can refer to it by id. */
  accept(result: OperationsInvestigation): void;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function* say(messageId: string, paragraphs: string[]): Generator<AgAiEvent> {
  yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
  // One delta per paragraph, so the panel streams the answer instead of showing it in one block.
  for (const [index, paragraph] of paragraphs.entries()) yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: index === 0 ? paragraph : `\n\n${paragraph}` };
  yield { type: "TEXT_MESSAGE_END", messageId };
}

function describeResult(result: OperationsInvestigation): string[] {
  const paragraphs = [result.explanation];
  for (const finding of result.findings) paragraphs.push(`**${finding.title}** (${finding.paymentIds.length})\n${finding.detail}`);
  if (result.uncertainty.length > 0) paragraphs.push(`**Limits of this answer**\n${result.uncertainty.map((line) => `- ${line}`).join("\n")}`);
  paragraphs.push(`Data as of ${formatDateTime(result.dataTimestamp)} · investigation ${result.investigationId} · read-only`);
  return paragraphs;
}

interface ToolOutcome { success: boolean; response?: string; data?: { applied?: string[]; unknown?: string[] }; issues?: Array<{ message?: string }> }

function parseToolOutcome(content: string): ToolOutcome | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null && typeof (parsed as { success?: unknown }).success === "boolean" ? parsed as ToolOutcome : null;
  } catch {
    // Not JSON: treat the tool result as unreadable rather than guessing what it says.
    return null;
  }
}

/**
 * One round of the agent. Studio calls it again after executing any tool the
 * round asked for, so it branches on the history: with no tool result since the
 * last question it investigates; with one, it reports what the tool did and
 * asks for nothing more, which ends the run.
 */
export async function* investigatorRun(input: AgAiRunInput, ctx: { signal?: AbortSignal }, deps: InvestigatorDeps): AgAiEventStream {
  const messages: AgAiMessage[] = input.messages;
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") { lastUser = index; break; }
  }
  const messageId = `${input.runId}-m${messages.length}`;

  if (lastUser === -1) {
    yield* say(messageId, [`Ask about the recorded state of payments, for example: ${SUPPORTED_QUESTIONS.map((entry) => entry.question).join(" ")}`]);
    return;
  }

  const toolResults = messages.slice(lastUser + 1).filter((message) => message.role === "tool");
  if (toolResults.length > 0) {
    const outcome = parseToolOutcome(toolResults[toolResults.length - 1].content);
    if (outcome?.success) {
      const applied = outcome.data?.applied?.length ?? 0;
      const unknown = outcome.data?.unknown?.length ?? 0;
      yield* say(messageId, [
        `The operations grid below now shows exactly ${applied === 1 ? "that 1 record" : `those ${applied} records`}${applied === 1 ? ", with its payment record open" : ""}.${unknown > 0 ? ` ${unknown} referenced record(s) are not in the current data and were left out.` : ""} Remove the filter from the grid toolbar when you are done. Nothing was approved, paid or changed.`,
      ]);
    } else {
      const reason = outcome?.issues?.map((issue) => issue.message).filter(Boolean).join(" ") || "the grid tool returned an unreadable result";
      yield* say(messageId, [`The grid was not changed: ${reason}`]);
    }
    return;
  }

  const question = String((messages[lastUser] as { content?: unknown }).content ?? "").trim();
  let result: OperationsInvestigation;
  try {
    result = await deps.investigate(question, ctx.signal);
  } catch (error) {
    if (isAbort(error) || ctx.signal?.aborted) return;
    // Report, never throw: the panel shows the failure and the thread stays usable.
    yield { type: "RUN_ERROR", message: "The investigation could not be completed, so nothing was filtered. Try again." };
    return;
  }
  if (ctx.signal?.aborted) return;
  deps.accept(result);
  yield* say(messageId, describeResult(result));

  const action = result.suggestedGridAction;
  if (action.type === "none") return;
  const paymentIds = action.type === "open_payment" ? [action.paymentId] : action.paymentIds;
  const toolCallId = `${input.runId}-call${messages.length}`;
  yield { type: "TOOL_CALL_START", toolCallId, toolCallName: SHOW_IN_GRID_TOOL };
  yield { type: "TOOL_CALL_ARGS", toolCallId, delta: JSON.stringify({ investigationId: result.investigationId, paymentIds, label: action.label }) };
  yield { type: "TOOL_CALL_END", toolCallId };
}

/**
 * Build the harness for one Studio instance. Passed to `AgStudio` as
 * `ai={({ api }) => createInvestigatorHarness(api, store)}`.
 */
export function createInvestigatorHarness(api: AgStudioApi, store: OperationsStore): AgAiHarness {
  // The tool is defined once and bound to this Studio instance. Its argument shape is declared with the
  // framework's shape builder, so Studio validates a call against it before `execute` runs.
  const showInGrid = api.defineAiTool({
    name: SHOW_IN_GRID_TOOL,
    description: "Filter the Settle operations grid to exactly the payment records one investigation returned. Read-only: it changes which rows are shown, never a payment, an approval, a policy or a recipient.",
    params: (s) => s.object({
      investigationId: s.string({ description: "The id of the investigation whose records should be shown." }),
      paymentIds: s.array(s.string(), { description: "Record ids returned by that investigation." }),
      label: s.string({ description: "Short name of the selection, shown on the grid's filter chip." }),
    }),
    execute: (args: { investigationId: string; paymentIds: string[]; label: string }, ctx) => {
      // Defence in depth: the store only accepts ids that belong to an investigation it validated.
      const outcome = store.applyInvestigation(args.investigationId, args.paymentIds);
      if (!outcome.ok) return ctx.error(outcome.error);
      return ctx.success(`The operations grid now shows ${outcome.applied.length} record(s).`, { applied: outcome.applied, unknown: outcome.unknown, label: args.label });
    },
  });

  const deps: InvestigatorDeps = {
    investigate: (question, signal) => store.api.investigate(question, signal ?? new AbortController().signal),
    accept: (result) => store.acceptInvestigation(result, "studio-agent"),
  };

  return createAiHarness(api, () => ({
    agents: [
      clientToolRunner({
        id: INVESTIGATOR_AGENT_ID,
        name: "Payment investigator",
        description: "Answers questions about the recorded state of payments from the Settle ledger and shows the matching records in the operations grid. Read-only.",
        tools: () => [showInGrid],
        // A question is answered in two rounds at most; the cap is a backstop, not a budget.
        maxTurns: 4,
        run: (input, ctx) => investigatorRun(input, ctx, deps),
      }),
    ],
    primary: INVESTIGATOR_AGENT_ID,
    promptStarters: SUPPORTED_QUESTIONS.map((entry) => ({ label: entry.label, prompt: entry.question })),
  }));
}
