// Reporting through the PayPal Agent Toolkit — the verifier's Path 1.
// The Toolkit's list_transactions tool calls GET /v1/reporting/transactions,
// the same endpoint the direct REST path in reporting.ts calls. The reply
// is parsed by the same shared parser, so both reads produce the same shape.
// The Toolkit is used here and only here. It has no Payouts tool, so payouts,
// invoices, and everything that moves money stay direct REST. There is no
// silent REST fallback for this path: if the Toolkit call fails, this throws,
// the same as a REST failure would. A decorative integration is worse than none.
// Toolkit version 1.11.0, pinned in package.json. Tool name list_transactions
// (plural), confirmed from the installed package, not from web docs.
// Two behaviours of the tool to know, both confirmed from the installed
// package: (1) it only accepts one transaction status, D, P, S, or V, and
// defaults to S, successful only, while the REST path returns all statuses;
// the verifier only needs successful payout transactions, and the comparison
// script shows the REST path's other-status rows separately so the difference
// is visible, not hidden. (2) It calls live PayPal unless the sandbox flag
// is passed, so this module refuses to run unless sandbox is true.
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { PayPalError } from "./paypalClient.ts";
import {
  MAX_REPORTING_PAGE_SIZE,
  MAX_REPORTING_RANGE_DAYS,
  parseReportingReply,
  toRfc3339,
  type ReportingListResult,
} from "./reporting.ts";

/** The smallest surface of the Toolkit this module uses. The injected client
 * in tests implements this shape; the real client is wrapped into it below. */
export interface ToolkitListTransactionsTool {
  execute: (params: {
    start_date: string;
    end_date: string;
    page_size: number;
    transaction_status: "S";
  }) => Promise<unknown>;
}

export interface ToolkitClientLike {
  getTools: () => { list_transactions: ToolkitListTransactionsTool };
}

function buildToolkitClient(clientId: string, clientSecret: string): ToolkitClientLike {
  const toolkit = new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: {
      // Only the Reporting list action is enabled. No invoice, order,
      // dispute, or any other action is switched on.
      actions: { transactions: { list: true } },
      context: { sandbox: true },
    },
  });
  const tools = toolkit.getTools() as unknown as Record<string, unknown>;
  const tool = tools.list_transactions as { execute?: unknown } | undefined;
  if (!tool || typeof tool.execute !== "function") {
    throw new PayPalError(
      200,
      "TOOLKIT_REPORTING_FAILED",
      "PayPal Agent Toolkit did not provide a list_transactions tool",
    );
  }
  return {
    getTools: () => ({
      list_transactions: {
        execute: (params: { start_date: string; end_date: string; page_size: number; transaction_status: "S" }) =>
          (tool.execute as (p: unknown) => Promise<unknown>)(params),
      },
    }),
  };
}

/** List Reporting transactions through the Toolkit's list_transactions tool.
 * Same limits as the REST path: at most 31 days, page size 1 to 500.
 * The client is built here, only when this runs, never at import time or
 * server startup, so a missing credential cannot break server boot. */
export async function listTransactionsViaToolkit(opts: {
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
  startDate: Date;
  endDate: Date;
  pageSize?: number;
  toolkitClient?: ToolkitClientLike;
}): Promise<ReportingListResult> {
  const pageSize = opts.pageSize ?? MAX_REPORTING_PAGE_SIZE;
  if (pageSize < 1 || pageSize > MAX_REPORTING_PAGE_SIZE) {
    throw new Error(`toolkit reporting: pageSize must be between 1 and ${MAX_REPORTING_PAGE_SIZE}`);
  }
  if (opts.endDate.getTime() <= opts.startDate.getTime()) {
    throw new Error("toolkit reporting: endDate must be after startDate");
  }
  const rangeMs = opts.endDate.getTime() - opts.startDate.getTime();
  if (rangeMs > MAX_REPORTING_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error(`toolkit reporting: search range must be ${MAX_REPORTING_RANGE_DAYS} days or less`);
  }
  if (!opts.sandbox) {
    throw new Error("toolkit reporting: sandbox must be true. Live money is never used in Settle.");
  }
  const client = opts.toolkitClient ?? null;
  if (!client) {
    if (!opts.clientId) throw new Error("toolkit reporting: PAYPAL_CLIENT_ID is missing. Fill it in local .env only.");
    if (!opts.clientSecret) {
      throw new Error("toolkit reporting: PAYPAL_CLIENT_SECRET is missing. Fill it in local .env only.");
    }
  }
  const toolkitClient = client ?? buildToolkitClient(opts.clientId, opts.clientSecret);
  const tool = toolkitClient.getTools().list_transactions;
  if (!tool || typeof tool.execute !== "function") {
    throw new PayPalError(
      200,
      "TOOLKIT_REPORTING_FAILED",
      "PayPal Agent Toolkit did not provide a list_transactions tool",
    );
  }
  // The tool returns a JSON string of the raw Reporting reply. On a PayPal
  // error it returns a JSON string with an error key instead of throwing,
  // so the error must be checked here and raised loudly.
  const rawResult = await tool.execute({
    start_date: toRfc3339(opts.startDate),
    end_date: toRfc3339(opts.endDate),
    page_size: pageSize,
    transaction_status: "S",
  });
  let raw: unknown;
  if (typeof rawResult === "string") {
    try {
      raw = JSON.parse(rawResult) as unknown;
    } catch {
      throw new PayPalError(200, "TOOLKIT_REPORTING_FAILED", "Toolkit list_transactions returned text that is not JSON");
    }
  } else {
    raw = rawResult;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PayPalError(200, "TOOLKIT_REPORTING_FAILED", "Toolkit list_transactions returned no Reporting reply");
  }
  const reply = raw as Record<string, unknown>;
  if (reply.error !== undefined) {
    const error = reply.error as Record<string, unknown>;
    const message = typeof error.message === "string" ? error.message : "Toolkit list_transactions failed";
    throw new PayPalError(200, "TOOLKIT_REPORTING_FAILED", message, null, reply);
  }
  return parseReportingReply(reply);
}
