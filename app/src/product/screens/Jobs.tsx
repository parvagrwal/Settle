// Jobs & decisions.
//
// The obligations the studio owes, and the decisions that move them. This
// screen holds two things side by side on purpose:
//
//   left  — what is owed, who it is owed to, and what state it is in;
//   right — what the agent proposes, and the limits of that proposal.
//
// Approval and submission are separate acts, and the screen keeps them
// separate. Approving an obligation creates a payment identity and sends
// nothing. Submitting it asks PayPal, and only PayPal can confirm the result.
import { useMemo, useState } from "react";
import { Alert, Button, Card, CardHeader, Dialog, Drawer, EmptyState, Field, Pill, Select, TextInput, useTask } from "../ui.tsx";
import { useWorkspace } from "../WorkspaceProvider.tsx";
import { client } from "../client.ts";
import { date, duePhrase, money } from "../format.ts";
import {
  approvalTone, isAmbiguous, isReadyWithinPolicy, originLabel, recordLabel, sortRows, statusTone,
  totals, verificationLabel, verificationTone, type SortKey,
} from "../model.ts";
import type { PaymentOperationRow } from "../../operations/contract.ts";
import { RecommendationPanel } from "./RecommendationPanel.tsx";

type FilterKey = "all" | "needs-approval" | "ready" | "in-flight" | "attention";

const FILTERS: Array<{ key: FilterKey; label: string; test: (row: PaymentOperationRow) => boolean }> = [
  { key: "all", label: "All obligations", test: () => true },
  { key: "needs-approval", label: "Needs approval", test: (row) => row.needsApproval },
  { key: "ready", label: "Ready within policy", test: (row) => isReadyWithinPolicy(row) },
  { key: "in-flight", label: "In flight with the provider", test: (row) => row.isInFlight },
  { key: "attention", label: "Needs attention", test: (row) => row.needsAttention },
];

const EMPTY_FORM = { title: "", recipientName: "", recipientEmail: "", amount: "", dueAt: "", priority: "normal" as "high" | "normal" | "low" };

export function Jobs() {
  const { snapshot, operations, workspace, applySnapshot, refresh } = useWorkspace();
  const task = useTask();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("attention");
  const [selected, setSelected] = useState<PaymentOperationRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [declineReason, setDeclineReason] = useState("");
  const [payOutcome, setPayOutcome] = useState<string | null>(null);

  const workspaceId = workspace?.workspaceId ?? null;
  const rows = useMemo(() => {
    const all = (operations?.rows ?? []).filter((row) => row.source === "workspace" && (workspaceId === null || row.workspaceId === workspaceId));
    const definition = FILTERS.find((entry) => entry.key === filter) ?? FILTERS[0];
    const needle = search.trim().toLowerCase();
    const filtered = all.filter((row) => definition.test(row)).filter((row) => {
      if (needle === "") return true;
      return `${recordLabel(row)} ${row.recipient} ${row.jobId ?? ""}`.toLowerCase().includes(needle);
    });
    return sortRows(filtered, sort);
  }, [operations, workspaceId, filter, search, sort]);

  const capabilities = snapshot?.capabilities;
  const canEdit = capabilities?.canEdit === true;
  const canApprove = capabilities?.canApprove === true;
  const canPay = capabilities?.canPay === true;

  const approve = async (row: PaymentOperationRow) => {
    if (workspaceId === null) return;
    await task.run(`approve-${row.operationId}`, async () => {
      const next = await client.approve(workspaceId, row.jobId ?? "");
      applySnapshot(next);
      setSelected(null);
      return `${row.title ?? row.jobId} approved. A payment identity now exists; nothing has been sent to PayPal.`;
    });
  };

  const decline = async () => {
    if (workspaceId === null || selected === null) return;
    const reason = declineReason.trim();
    if (reason === "") { setFormErrors({ decline: "A decline needs a reason. It is written to the audit trail." }); return; }
    await task.run("decline", async () => {
      const next = await client.decline(workspaceId, selected.jobId ?? "", reason);
      applySnapshot(next);
      setDeclineOpen(false);
      setSelected(null);
      setDeclineReason("");
      return "Obligation declined. The reason is in the audit trail.";
    });
  };

  const pay = async () => {
    if (workspaceId === null || selected === null) return;
    await task.run("pay", async () => {
      const outcome = await client.pay(workspaceId, selected.jobId ?? "");
      applySnapshot(outcome.workspace);
      setPayOpen(false);
      if (outcome.outcomeUnknown) {
        setPayOutcome(`The provider outcome is unknown. Reconcile with PayPal before any retry; never resubmit blindly.${outcome.executionRunId ? ` Run ${outcome.executionRunId}.` : ""}`);
      } else if (outcome.status === "provider_confirmed") {
        setPayOutcome(`PayPal confirmed this payment.${outcome.executionRunId ? ` Run ${outcome.executionRunId}.` : ""}`);
      } else {
        setPayOutcome(`Submitted. The provider state is "${outcome.status}". An acknowledgement is not a confirmation: the receipt shows what has been proven.`);
      }
      return undefined;
    });
  };

  const createJob = async () => {
    if (workspaceId === null) return;
    const errors: Record<string, string> = {};
    if (form.title.trim().length < 2) errors.title = "Name the work in at least two characters.";
    if (form.recipientName.trim().length < 2) errors.recipientName = "Name the recipient in at least two characters.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.recipientEmail.trim())) errors.recipientEmail = "Enter a valid recipient email address.";
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Enter an amount above zero.";
    else if (amount > 10_000) errors.amount = "Enter an amount below $10,000.00.";
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    await task.run("create", async () => {
      await client.createJob(workspaceId, {
        title: form.title.trim(),
        recipientName: form.recipientName.trim(),
        recipientEmail: form.recipientEmail.trim(),
        amountCents: Math.round(amount * 100),
        dueAt: form.dueAt === "" ? null : new Date(`${form.dueAt}T00:00:00.000Z`).toISOString(),
        priority: form.priority,
      });
      setForm(EMPTY_FORM);
      setCreateOpen(false);
      return "Obligation stored. Nothing has been sent to PayPal and no approval exists yet.";
    });
  };

  const generateRecommendation = async () => {
    if (workspaceId === null) return false;
    try {
      await client.recommend(workspaceId);
      await refresh();
      return true;
    } catch {
      return false;
    }
  };

  return <div className="jobs-layout">
    <section className="jobs-main" aria-label="Obligations">
      <Card>
        <CardHeader
          eyebrow="Obligations"
          title="What the studio owes"
          description="Search, filter and sort the obligations in this workspace. Every state below is the server's own classification."
          actions={canEdit ? <Button variant="primary" onClick={() => setCreateOpen(true)}>Create obligation</Button> : undefined}
        />

        <div className="toolbar">
          <label className="toolbar-field toolbar-grow">
            <span>Search</span>
            <TextInput type="search" value={search} placeholder="Work, recipient or job id" onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className="toolbar-field">
            <span>Show</span>
            <Select value={filter} onChange={(event) => setFilter(event.target.value as FilterKey)}>
              {FILTERS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </Select>
          </label>
          <label className="toolbar-field">
            <span>Order by</span>
            <Select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
              <option value="attention">Needs attention first</option>
              <option value="due">Due date</option>
              <option value="amount">Amount</option>
              <option value="priority">Priority</option>
              <option value="updated">Last updated</option>
            </Select>
          </label>
        </div>

        {task.error !== null && <Alert tone="danger" title="The action could not be completed">{task.error}</Alert>}
        {task.notice !== null && <Alert tone="success" title={task.notice} />}
        {payOutcome !== null && <Alert tone="info" title="Payment result" actions={<Button onClick={() => setPayOutcome(null)}>Dismiss</Button>}>{payOutcome}</Alert>}

        {rows.length === 0 ? (
          <EmptyState
            title={search === "" && filter === "all" ? "No obligations yet" : "No obligations match"}
            action={canEdit && search === "" && filter === "all" ? <Button variant="primary" onClick={() => setCreateOpen(true)}>Create the first obligation</Button> : undefined}
          >
            {search === "" && filter === "all"
              ? "Record the work, the recipient and the amount. Nothing is sent anywhere until you approve it."
              : "No record in this workspace matches the current search and filter."}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="data-table data-table-jobs">
              <caption className="visually-hidden">Obligations in this workspace</caption>
              <thead>
                <tr>
                  <th scope="col">Obligation</th>
                  <th scope="col" className="numeric">Amount</th>
                  <th scope="col">Due</th>
                  <th scope="col">Approval</th>
                  <th scope="col">Payment state</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.operationId} className={row.needsAttention ? "row-attention" : undefined}>
                    <th scope="row">
                      <button type="button" className="row-link" onClick={() => { setSelected(row); task.dismiss(); }}>{recordLabel(row)}</button>
                      <span className="row-meta">
                        {row.recipient} · {originLabel(row.recordOrigin)}
                        {row.priority !== null ? ` · ${row.priority} priority` : ""}
                      </span>
                    </th>
                    <td className="numeric">{money(row.amountCents)}</td>
                    <td className="nowrap">{row.dueDate ? <>{date(row.dueDate)}<span className="row-meta">{duePhrase(row.dueDate)}</span></> : <span className="absent">No due date</span>}</td>
                    <td><Pill tone={approvalTone(row)}>{row.approvalState === "approved" ? "Approved" : row.approvalState === "expired" ? "Approval expired" : "Not approved"}</Pill></td>
                    <td><Pill tone={statusTone(row)}>{row.paymentStatusLabel}</Pill></td>
                    <td className="cell-actions">
                      <Button variant="ghost" onClick={() => { setSelected(row); task.dismiss(); }}>Open</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <p className="table-foot">
            {totals(rows).count} obligation{totals(rows).count === 1 ? "" : "s"} · {money(totals(rows).amountCents)} in total.
            Demonstration records are excluded from this list.
          </p>
        )}
      </Card>
    </section>

    <aside className="jobs-side" aria-label="Agent recommendation">
      <RecommendationPanel snapshot={snapshot} operations={operations} busy={task.busy !== null} onGenerate={generateRecommendation} />
    </aside>

    <Drawer
      open={selected !== null}
      title={selected === null ? "" : recordLabel(selected)}
      description={selected === null ? undefined : `${money(selected.amountCents)} to ${selected.recipient}`}
      onClose={() => { setSelected(null); task.dismiss(); }}
      footer={selected === null ? undefined : (
        <div className="drawer-actions">
          {canApprove && selected.approvalState !== "approved" && selected.paymentStatus === "not_submitted" && (
            <>
              <Button variant="primary" busy={task.busy === `approve-${selected.operationId}`} busyLabel="Approving…" onClick={() => { void approve(selected); }}>Approve</Button>
              <Button variant="secondary" onClick={() => setDeclineOpen(true)}>Decline</Button>
            </>
          )}
          {canPay && selected.approvalState === "approved" && selected.paymentStatus === "approved" && (
            <Button variant="primary" onClick={() => setPayOpen(true)}>Submit to PayPal Sandbox</Button>
          )}
          {selected.paymentStatus !== "not_submitted" && selected.paymentStatus !== "approved" && (
            <p className="drawer-note">This obligation has already been authorised. Its current state is on the receipt, not here.</p>
          )}
        </div>
      )}
    >
      {selected !== null && (
        <div className="drawer-body-content">
          {task.error !== null && <Alert tone="danger" title="The action could not be completed">{task.error}</Alert>}
          <div className="pill-row">
            <Pill tone={statusTone(selected)}>{selected.paymentStatusLabel}</Pill>
            <Pill tone={approvalTone(selected)}>{selected.approvalState === "approved" ? "Approved by the owner" : selected.approvalState === "expired" ? "Approval expired" : "Not approved"}</Pill>
            <Pill tone={verificationTone(selected)}>{verificationLabel(selected)}</Pill>
          </div>
          <dl className="fact-list">
            <div><dt>Amount</dt><dd>{money(selected.amountCents)}</dd></div>
            <div><dt>Due</dt><dd>{selected.dueDate ? date(selected.dueDate) : "No due date"}</dd></div>
            <div><dt>Priority</dt><dd>{selected.priority ?? "Not set"}</dd></div>
            <div><dt>Record origin</dt><dd>{originLabel(selected.recordOrigin)}</dd></div>
            <div><dt>Job id</dt><dd className="mono">{selected.jobId ?? "None recorded"}</dd></div>
            <div><dt>Payment identity</dt><dd className="mono">{selected.paymentId ?? "None — no owner approval yet"}</dd></div>
          </dl>
          {selected.attentionReasons.length > 0 && (
            <Alert tone="danger" title="Needs attention">
              <ul>{selected.attentionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </Alert>
          )}
          {selected.evidenceGaps.length > 0 && (
            <Alert tone="warning" title="Evidence gaps">
              <ul>{selected.evidenceGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
            </Alert>
          )}
          {isAmbiguous(selected) && (
            <Alert tone="danger" title="The provider outcome is unknown">
              This submission may or may not have reached PayPal. Reconcile with PayPal before any retry.
            </Alert>
          )}
          <p className="drawer-note">
            Approving creates a permanent payment identity for this obligation and sends nothing. Submitting it
            asks PayPal Sandbox; only PayPal can confirm the outcome.
          </p>
        </div>
      )}
    </Drawer>

    <Dialog
      open={createOpen}
      title="Create an obligation"
      description="Recording an obligation is bookkeeping. Nothing is sent to PayPal and no approval exists yet."
      onClose={() => { setCreateOpen(false); setFormErrors({}); }}
      footer={<>
        <Button variant="primary" busy={task.busy === "create"} busyLabel="Storing…" onClick={() => { void createJob(); }}>Store obligation</Button>
        <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
      </>}
    >
      <div className="form-grid">
        <Field label="Work" error={formErrors.title}>
          {({ id, describedBy, invalid }) => <TextInput id={id} aria-describedby={describedBy} invalid={invalid} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Brand identity — milestone 2" />}
        </Field>
        <Field label="Recipient name" error={formErrors.recipientName}>
          {({ id, describedBy, invalid }) => <TextInput id={id} aria-describedby={describedBy} invalid={invalid} value={form.recipientName} onChange={(event) => setForm({ ...form, recipientName: event.target.value })} placeholder="Maya Chen" />}
        </Field>
        <Field label="Recipient email" error={formErrors.recipientEmail} hint="The address PayPal Sandbox pays. The server verifies it before any reservation.">
          {({ id, describedBy, invalid }) => <TextInput id={id} aria-describedby={describedBy} invalid={invalid} type="email" value={form.recipientEmail} onChange={(event) => setForm({ ...form, recipientEmail: event.target.value })} placeholder="recipient@example.test" />}
        </Field>
        <Field label="Amount (USD)" error={formErrors.amount}>
          {({ id, describedBy, invalid }) => <TextInput id={id} aria-describedby={describedBy} invalid={invalid} type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="420.00" />}
        </Field>
        <Field label="Due date" hint="Optional. The agent uses it to rank work that is close to its deadline.">
          {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} type="date" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} />}
        </Field>
        <Field label="Priority">
          {({ id }) => <Select id={id} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as "high" | "normal" | "low" })}>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </Select>}
        </Field>
      </div>
      {task.error !== null && <Alert tone="danger" title="The obligation could not be stored">{task.error}</Alert>}
    </Dialog>

    <Dialog
      open={declineOpen}
      title="Decline this obligation"
      description="The reason is written to the audit trail with your identity and the time."
      onClose={() => setDeclineOpen(false)}
      footer={<>
        <Button variant="danger" busy={task.busy === "decline"} busyLabel="Recording…" onClick={() => { void decline(); }}>Decline obligation</Button>
        <Button variant="ghost" onClick={() => setDeclineOpen(false)}>Cancel</Button>
      </>}
    >
      <Field label="Reason" error={formErrors.decline}>
        {({ id, describedBy, invalid }) => <TextInput id={id} aria-describedby={describedBy} invalid={invalid} value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} placeholder="Work was invoiced to the studio account" />}
      </Field>
    </Dialog>

    <Dialog
      open={payOpen}
      title="Submit this payment to PayPal Sandbox"
      description="This is the point where money moves in the sandbox. Review it once."
      onClose={() => setPayOpen(false)}
      footer={<>
        <Button variant="primary" busy={task.busy === "pay"} busyLabel="Submitting…" onClick={() => { void pay(); }}>Submit to PayPal Sandbox</Button>
        <Button variant="ghost" onClick={() => setPayOpen(false)}>Cancel</Button>
      </>}
    >
      {selected !== null && (
        <>
          <dl className="fact-list">
            <div><dt>Recipient</dt><dd>{selected.recipient}</dd></div>
            <div><dt>Amount</dt><dd>{money(selected.amountCents)}</dd></div>
            <div><dt>Obligation</dt><dd>{recordLabel(selected)}</dd></div>
            <div><dt>Approved by</dt><dd>{selected.approvedBy ?? "The workspace owner"}</dd></div>
          </dl>
          <Alert tone="warning" title="What this does and does not do">
            The server checks the per-payment cap, the rolling cap and provider freshness before it contacts
            PayPal. A PayPal acknowledgement is not a confirmation: the receipt records exactly which of those
            facts has been proven, and an unknown outcome is never reported as a success.
          </Alert>
        </>
      )}
    </Dialog>
  </div>;
}
