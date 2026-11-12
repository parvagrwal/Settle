// Payments & receipts.
//
// The history of everything the studio has sent to a provider, and the evidence
// behind each one. A payment is never reduced to a single badge: the receipt
// beside it shows which of the six facts has actually been recorded.
import { useMemo, useState } from "react";
import { Alert, Button, Card, EmptyState, Pill, Select, TextInput } from "../ui.tsx";
import { useWorkspace } from "../WorkspaceProvider.tsx";
import { useRoute } from "../router.ts";
import { dateTime, money } from "../format.ts";
import { originLabel, recordLabel, sortRows, statusTone, totals, verificationLabel, verificationTone, type SortKey } from "../model.ts";
import type { PaymentOperationRow } from "../../operations/contract.ts";
import { Receipt } from "./Receipt.tsx";

type FilterKey = "payments" | "all" | "confirmed" | "awaiting" | "unreconciled" | "discrepancy";

const FILTERS: Array<{ key: FilterKey; label: string; test: (row: PaymentOperationRow) => boolean }> = [
  { key: "payments", label: "Payments only", test: (row) => row.paymentId !== null || row.paymentStatus !== "not_submitted" },
  { key: "all", label: "Every record", test: () => true },
  { key: "confirmed", label: "Confirmed by PayPal", test: (row) => row.paymentStatus === "provider_confirmed" },
  { key: "awaiting", label: "Awaiting confirmation", test: (row) => ["awaiting_confirmation", "submitted", "pending", "onhold", "reserved"].includes(row.paymentStatus) },
  { key: "unreconciled", label: "Unreconciled", test: (row) => row.isUnreconciled },
  { key: "discrepancy", label: "Discrepancies", test: (row) => row.reconciliationState === "discrepancy" },
];

export function Payments() {
  const { path, navigate } = useRoute();
  const { operations, workspace, dataStatus, dataError, refresh } = useWorkspace();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("payments");
  const [sort, setSort] = useState<SortKey>("updated");

  const parts = path.split("/").filter((part) => part !== "");
  const selectedId = parts.length >= 2 ? decodeURIComponent(parts[1]) : null;

  const workspaceId = workspace?.workspaceId ?? null;
  const rows = useMemo(() => {
    const all = (operations?.rows ?? []).filter((row) => row.source === "workspace" && (workspaceId === null || row.workspaceId === workspaceId));
    const definition = FILTERS.find((entry) => entry.key === filter) ?? FILTERS[0];
    const needle = search.trim().toLowerCase();
    return sortRows(all.filter((row) => definition.test(row)).filter((row) => {
      if (needle === "") return true;
      return `${recordLabel(row)} ${row.recipient} ${row.paymentId ?? ""} ${row.payoutItemId ?? ""}`.toLowerCase().includes(needle);
    }), sort);
  }, [operations, workspaceId, filter, search, sort]);

  const selected = useMemo(() => rows.find((row) => row.operationId === selectedId) ?? null, [rows, selectedId]);

  if (dataStatus === "loading" && operations === null) return <p className="loading-line" role="status">Reading the payment history…</p>;
  if (dataStatus === "error" && operations === null) {
    return <Alert tone="danger" title="The payment history could not be loaded" actions={<Button onClick={() => { void refresh(); }}>Try again</Button>}>{dataError}</Alert>;
  }

  const list = <Card className="payments-list-card">
    <div className="toolbar">
      <label className="toolbar-field toolbar-grow">
        <span>Search</span>
        <TextInput type="search" value={search} placeholder="Recipient, payment id or item id" onChange={(event) => setSearch(event.target.value)} />
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
          <option value="updated">Last updated</option>
          <option value="due">Due date</option>
          <option value="amount">Amount</option>
          <option value="attention">Needs attention first</option>
        </Select>
      </label>
    </div>

    {rows.length === 0 ? (
      <EmptyState title={filter === "payments" ? "No payments yet" : "No records match"}>
        {filter === "payments"
          ? "Nothing has been submitted to a provider from this workspace. Approve an obligation on the jobs screen, then submit it."
          : "No record in this workspace matches the current search and filter."}
      </EmptyState>
    ) : (
      <ul className="payment-rows">
        {rows.map((row) => (
          <li key={row.operationId}>
            <button
              type="button"
              className={`payment-row ${selected?.operationId === row.operationId ? "payment-row-selected" : ""}`.trim()}
              aria-current={selected?.operationId === row.operationId ? "true" : undefined}
              onClick={() => navigate(`/payments/${encodeURIComponent(row.operationId)}`)}
            >
              <span className="payment-row-head">
                <span className="payment-row-name">{recordLabel(row)}</span>
                <span className="payment-row-amount">{money(row.amountCents)}</span>
              </span>
              <span className="payment-row-meta">
                {row.recipient} · {originLabel(row.recordOrigin)}
                {row.lastUpdatedAt ? ` · ${dateTime(row.lastUpdatedAt)}` : ""}
              </span>
              <span className="payment-row-pills">
                <Pill tone={statusTone(row)}>{row.paymentStatusLabel}</Pill>
                <Pill tone={verificationTone(row)}>{verificationLabel(row)}</Pill>
              </span>
            </button>
          </li>
        ))}
      </ul>
    )}
    {rows.length > 0 && (
      <p className="table-foot">{totals(rows).count} record{totals(rows).count === 1 ? "" : "s"} · {money(totals(rows).amountCents)} in total.</p>
    )}
  </Card>;

  return <div className={`payments-layout ${selected === null ? "payments-layout-single" : ""}`.trim()}>
    <section className="payments-list" aria-label="Payment history">{list}</section>
    <section className="payments-detail" aria-label="Receipt">
      {selected === null ? (
        <Card className="receipt-placeholder">
          <EmptyState title="Select a payment to inspect its receipt">
            The receipt shows the six evidence stages, the provider identifiers, the fee evidence, the
            reconciliation state and the audit history. Nothing is inferred from a badge.
          </EmptyState>
        </Card>
      ) : (
        <Receipt operationId={selected.operationId} onClose={() => navigate("/payments")} />
      )}
    </section>
  </div>;
}
