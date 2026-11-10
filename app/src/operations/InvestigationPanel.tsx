// Ask the ledger: the investigation panel beside the operations grid.
//
// It sends a question to the read-only investigation endpoint, shows the
// validated answer with its evidence and limits, and the store filters the grid
// to exactly the rows the answer named. The same store state is used when the
// question was asked in the Studio AI Assistant, so there is one current
// investigation, not two.
import { useState, type FormEvent } from "react";
import { useOperations, type OperationsStore } from "./store.ts";
import { SUPPORTED_QUESTIONS } from "./questions.ts";
import { formatDateTime } from "./view.ts";

const SEVERITY_LABEL = { critical: "Critical", warning: "Warning", info: "Information" } as const;

export function InvestigationPanel({ store }: { store: OperationsStore }) {
  const investigation = useOperations(store, (state) => state.investigation);
  const focus = useOperations(store, (state) => state.focus);
  const [question, setQuestion] = useState(SUPPORTED_QUESTIONS[0].question);
  const running = investigation.status === "running";
  const result = investigation.result;

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || running) return;
    setQuestion(trimmed);
    void store.investigate(trimmed, "panel");
  };
  const submit = (event: FormEvent) => { event.preventDefault(); ask(question); };

  return <section className="ops-investigator" aria-label="Payment investigation">
    <div className="ops-section-heading">
      <div><p className="ops-eyebrow">Investigation agent · read-only</p><h2>Ask the ledger</h2></div>
      <span className="ops-source">{result ? result.source : "Deterministic ledger projection"}</span>
    </div>
    <p className="ops-note">The investigator reads recorded state and points at rows. It cannot approve, pay, change a policy or edit a recipient.</p>

    <form className="ops-question" onSubmit={submit}>
      <label htmlFor="ops-question-input" className="ops-visually-hidden">Investigation question</label>
      <input id="ops-question-input" value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder="Which payments need attention?" />
      <button type="submit" className="ops-button ops-button-primary" disabled={running || question.trim().length < 3}>{running ? "Investigating…" : "Investigate"}</button>
    </form>
    <div className="ops-chips" role="group" aria-label="Supported questions">
      {SUPPORTED_QUESTIONS.map((entry) => <button key={entry.label} type="button" className="ops-chip" disabled={running} onClick={() => ask(entry.question)}>{entry.label}</button>)}
    </div>

    <div aria-live="polite" className="ops-investigation-live">
      {investigation.status === "error" && <p role="alert" className="ops-error">{investigation.error}</p>}
      {running && <p role="status" className="ops-note">Reading the ledger projection…</p>}
    </div>

    {result && investigation.status !== "running" && <div className="ops-result" data-testid="investigation-result">
      {investigation.origin === "studio-agent" && <p className="ops-note">Asked in the AG Studio AI Assistant.</p>}
      <p className="ops-result-question">“{result.question}”</p>
      <p className="ops-answer">{result.explanation}</p>

      {investigation.dataChanged && <p className="ops-callout ops-callout-warning" role="status">The data has changed since this investigation was computed. <button type="button" className="ops-link" onClick={() => ask(result.question)}>Run it again</button></p>}
      {investigation.unknownIds.length > 0 && <p className="ops-callout ops-callout-warning" role="status">{investigation.unknownIds.length} referenced record(s) are not in the current data and were left out of the grid filter.</p>}

      {result.findings.length > 0 && <ul className="ops-findings">
        {result.findings.map((finding) => <li key={finding.id} className={`ops-finding ops-finding-${finding.severity}`}>
          <div className="ops-finding-head">
            <strong>{finding.title}</strong>
            <span className={`ops-severity ops-severity-${finding.severity}`}>{SEVERITY_LABEL[finding.severity]}</span>
          </div>
          <p>{finding.detail}</p>
          <button type="button" className="ops-link" onClick={() => store.focusPayments({ ids: finding.paymentIds, label: finding.title, source: "investigation", investigationId: result.investigationId })}>
            Show {finding.paymentIds.length === 1 ? "this record" : `these ${finding.paymentIds.length} records`} in the grid
          </button>
        </li>)}
      </ul>}

      {result.uncertainty.length > 0 && <div className="ops-uncertainty"><strong>Limits of this answer</strong><ul>{result.uncertainty.map((line) => <li key={line}>{line}</li>)}</ul></div>}

      <dl className="ops-result-meta">
        <div><dt>Investigation</dt><dd className="ops-mono">{result.investigationId}</dd></div>
        <div><dt>Data as of</dt><dd><time dateTime={result.dataTimestamp}>{formatDateTime(result.dataTimestamp)}</time></dd></div>
        <div><dt>Records named</dt><dd>{result.paymentIds.length}</dd></div>
        <div><dt>Grid</dt><dd>{focus?.investigationId === result.investigationId ? `Filtered to ${focus.ids.length} record${focus.ids.length === 1 ? "" : "s"}` : result.suggestedGridAction.type === "none" ? "No filter applied" : "Filter not applied"}</dd></div>
      </dl>
      <button type="button" className="ops-button" onClick={() => store.clearInvestigation()}>Clear investigation</button>
    </div>}
  </section>;
}
