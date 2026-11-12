// Ask the ledger — the read-only investigation surface.
//
// The investigator reads recorded state and points at records. It cannot
// approve, pay, change a policy or edit a recipient. Its findings carry the
// exact record identifiers they are about, so a reader can open the record and
// check the claim themselves.
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardHeader, EmptyState, Pill, TextInput } from "../ui.tsx";
import { client, describeError } from "../client.ts";
import { dateTime } from "../format.ts";
import type { OperationsInvestigation } from "../../operations/contract.ts";
import { useRoute } from "../router.ts";

const SUGGESTED = [
  { label: "Needs attention", question: "Which payments need attention?" },
  { label: "Approaching deadlines", question: "Which payments are approaching deadlines?" },
  { label: "Unreconciled", question: "Which payments remain unreconciled?" },
  { label: "Awaiting approval", question: "Which payments are awaiting approval?" },
  { label: "Outside budget", question: "Which payments cannot be paid within the current budget?" },
  { label: "Incomplete evidence", question: "Which payments have incomplete provider evidence?" },
];

const SEVERITY: Record<string, { label: string; tone: "danger" | "warning" | "info" }> = {
  critical: { label: "Critical", tone: "danger" },
  warning: { label: "Warning", tone: "warning" },
  info: { label: "Information", tone: "info" },
};

export function Investigation() {
  const { navigate } = useRoute();
  const [question, setQuestion] = useState(SUGGESTED[0].question);
  const [result, setResult] = useState<OperationsInvestigation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await client.investigate(trimmed));
    } catch (cause) {
      setError(describeError(cause, "The investigation could not be completed."));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void ask(question); };

  return <Card className="investigation-card">
    <CardHeader
      eyebrow="Investigation agent · read-only"
      title="Ask the ledger"
      description="The investigator reads recorded state and points at the exact records behind its answer. It cannot approve, pay, change a policy or edit a recipient."
      actions={result === null ? undefined : <Pill tone="info">{result.source}</Pill>}
    />

    <form className="investigation-form" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="investigation-question">Investigation question</label>
      <TextInput id="investigation-question" maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Which payments need attention?" />
      <Button type="submit" variant="primary" busy={busy} busyLabel="Investigating…">Investigate</Button>
    </form>

    <div className="chip-row" role="group" aria-label="Suggested questions">
      {SUGGESTED.map((entry) => (
        <button key={entry.label} type="button" className="chip" disabled={busy} onClick={() => { setQuestion(entry.question); void ask(entry.question); }}>{entry.label}</button>
      ))}
    </div>

    {error !== null && <Alert tone="danger" title="The investigation could not be completed">{error}</Alert>}

    {result === null && !busy && (
      <EmptyState title="No investigation has been run yet">
        Ask a question, or pick one of the suggestions. The answer names records that exist in the current
        data, and says what it cannot tell you.
      </EmptyState>
    )}

    {busy && <p className="loading-line" role="status">Reading the ledger projection…</p>}

    {result !== null && !busy && (
      <div className="investigation-result">
        <p className="investigation-question">“{result.question}”</p>
        <p className="investigation-answer">{result.explanation}</p>

        {result.findings.length === 0 ? (
          <EmptyState title="Nothing to report">
            The investigator found no record in the current data that answers that question.
          </EmptyState>
        ) : (
          <ul className="finding-list">
            {result.findings.map((finding) => {
              const severity = SEVERITY[finding.severity] ?? SEVERITY.info;
              return <li key={finding.id} className={`finding finding-${finding.severity}`}>
                <div className="finding-head">
                  <strong>{finding.title}</strong>
                  <Pill tone={severity.tone}>{severity.label}</Pill>
                </div>
                <p>{finding.detail}</p>
                <div className="finding-actions">
                  {finding.paymentIds.slice(0, 6).map((id) => (
                    <button key={id} type="button" className="chip chip-link" onClick={() => navigate(`/payments/${encodeURIComponent(id)}`)}>{id}</button>
                  ))}
                  {finding.paymentIds.length > 6 && <span className="row-meta">and {finding.paymentIds.length - 6} more</span>}
                </div>
              </li>;
            })}
          </ul>
        )}

        {result.uncertainty.length > 0 && (
          <div className="investigation-limits">
            <h3>Limits of this answer</h3>
            <ul>{result.uncertainty.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        )}

        <dl className="fact-list investigation-meta">
          <div><dt>Investigation</dt><dd className="mono">{result.investigationId}</dd></div>
          <div><dt>Data as of</dt><dd>{dateTime(result.dataTimestamp)}</dd></div>
          <div><dt>Records named</dt><dd>{result.paymentIds.length}</dd></div>
          <div><dt>Source</dt><dd>{result.source}</dd></div>
          <div><dt>Boundary</dt><dd>Read-only</dd></div>
        </dl>
      </div>
    )}
  </Card>;
}
