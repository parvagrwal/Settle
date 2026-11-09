import type { TransactionRecord } from "./transactionStore.ts";

export interface InvestigationFact { label: string; value: string; evidence: string[] }
export interface Investigation {
  question: string;
  answer: string;
  facts: InvestigationFact[];
  hypotheses: string[];
  supportingTransactionIds: string[];
  gridFilter: { transactionIds: string[] };
  generatedAt: string;
  source: "Deterministic transaction query" | "Groq narration over deterministic transaction query";
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function investigateTransactions(rows: TransactionRecord[], question: string): Investigation {
  const generatedAt = new Date().toISOString();
  const empty: Investigation = { question, answer: "No verified transactions are available to investigate.", facts: [], hypotheses: [], supportingTransactionIds: [], gridFilter: { transactionIds: [] }, generatedAt, source: "Deterministic transaction query" };
  if (rows.length === 0) return empty;
  const ids = rows.map((row) => row.rowKey);
  const success = rows.filter((row) => row.status === "SUCCESS" || row.status === "COMPLETED");
  const attention = rows.filter((row) => !success.includes(row));
  const attentionIds = attention.map((row) => row.rowKey);
  const gross = rows.reduce((sum, row) => sum + (row.grossCents ?? 0), 0);
  const fees = rows.reduce((sum, row) => sum + (row.feeCents ?? 0), 0);
  const currency = rows.every((row) => row.currency === rows[0].currency) ? (rows[0].currency ?? "USD") : "mixed currencies";
  const facts: InvestigationFact[] = [
    { label: "Verified transaction records", value: String(rows.length), evidence: ids },
    { label: "Terminal success", value: String(success.length), evidence: success.map((row) => row.rowKey) },
    { label: "Requires attention", value: String(attention.length), evidence: attentionIds },
    { label: "Gross volume", value: currency === "mixed currencies" ? "Not summed across mixed currencies" : money(gross, currency), evidence: ids },
    { label: "Reported fees", value: currency === "mixed currencies" ? "Not summed across mixed currencies" : money(fees, currency), evidence: rows.filter((row) => row.feeCents !== null).map((row) => row.rowKey) },
  ];
  if (currency !== "mixed currencies") {
    facts.push({ label: "Attention gross USD", value: money(attention.reduce((sum, row) => sum + (row.grossCents ?? 0), 0), currency), evidence: attentionIds });
  }
  const causal = /why|cause|increase|decrease|driver|reason/i.test(question);
  const asksAttention = /investigat|attention|fail|pending|anomal|unusual|issue|risk/i.test(question);
  const supporting = asksAttention ? attention : causal ? success : rows;
  const supportingIds = supporting.map((row) => row.rowKey);
  let answer: string;
  let hypotheses: string[] = [];
  if (causal) {
    answer = "The ledger cannot establish an increase or its cause from the current transaction snapshot; no comparison period or external cause evidence was supplied.";
  } else if (asksAttention) {
    answer = attention.length === 0
      ? "All verified transactions in this snapshot are terminal successes."
      : `${attention.length} records require investigation: ${attention.map((row) => `${row.rowKey} (${row.status})`).join(", ")}. This identifies the recorded status only.`;
    if (attention.some((row) => row.status === "PENDING")) hypotheses.push("A pending record may be awaiting a later PayPal lifecycle event; inspect its full history.");
  } else {
    answer = `${rows.length} verified records contain ${success.length} terminal successes and ${attention.length} records requiring attention.`;
  }
  return { question, answer, facts, hypotheses, supportingTransactionIds: supportingIds, gridFilter: { transactionIds: supportingIds }, generatedAt, source: "Deterministic transaction query" };
}

export async function narrateInvestigation(analysis: Investigation, apiKey: string, fetchFn: typeof fetch = fetch): Promise<Investigation> {
  try {
    const response = await fetchFn("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "Rewrite the supplied financial analysis concisely. Preserve every record ID, amount, status and uncertainty statement. Do not add facts or causes. Return plain text only." },
          { role: "user", content: JSON.stringify({ question: analysis.question, answer: analysis.answer, facts: analysis.facts, hypotheses: analysis.hypotheses, supportingTransactionIds: analysis.supportingTransactionIds }) },
        ],
        temperature: 0,
        max_tokens: 400,
      }),
    });
    if (!response.ok) return analysis;
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const answer = data.choices?.[0]?.message?.content?.trim();
    return answer ? { ...analysis, answer, source: "Groq narration over deterministic transaction query" } : analysis;
  } catch { return analysis; }
}
