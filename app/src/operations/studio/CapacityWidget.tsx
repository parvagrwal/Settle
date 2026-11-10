// Payment capacity and exceptions widget for the AG Studio operations workspace.
//
// Capacity figures come from the ledger snapshot in the shared operations store;
// exception counts come from the rows AG Studio returns for this widget, so the
// tiles and the Studio charts cannot disagree about what is exceptional. A tile
// points the operations grid at exactly its rows and cross-filters Studio to
// the same rows; pressing it again, or clearing the grid focus elsewhere,
// releases both. Money totals never include demonstration records.
import { useEffect, useState } from "react";
import type { AgWidgetApi, AgWidgetField, AgWidgetParams } from "ag-studio";
import { useOperations, type OperationsStore } from "../store.ts";
import { STUDIO_SOURCE_ID, formatCents } from "../view.ts";
import type { PaymentOperationFlag } from "../contract.ts";
import type { CapacityWidgetState } from "./registry.ts";

type StudioRow = Record<string, unknown>;

interface Category {
  flag: PaymentOperationFlag;
  label: string;
}

const CATEGORIES: readonly Category[] = [
  { flag: "isPendingObligation", label: "Pending obligations" },
  { flag: "needsApproval", label: "Awaiting approval" },
  { flag: "isUnreconciled", label: "Unreconciled" },
  { flag: "needsAttention", label: "Needs attention" },
  { flag: "isDueSoon", label: "Due soon" },
  { flag: "cannotPayWithinBudget", label: "Outside budget" },
  { flag: "hasIncompleteEvidence", label: "Incomplete provider evidence" },
];

const fieldKey = (id: string): string => `${STUDIO_SOURCE_ID}.${id}`;

function rowId(row: StudioRow): string | null {
  const value = row[fieldKey("operationId")];
  return typeof value === "string" && value !== "" ? value : null;
}

function rowFlag(row: StudioRow, flag: PaymentOperationFlag): boolean {
  return row[fieldKey(flag)] === true;
}

function rowIsDemonstration(row: StudioRow): boolean {
  return row[fieldKey("recordClass")] === "Demonstration";
}

/** Studio carries amounts in dollars; the ledger counts in cents. */
function rowAmountCents(row: StudioRow): number {
  const value = row[fieldKey("amount")];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** The fields this widget reads, taken from the schema so Studio owns the field objects. */
function fieldsFor(widgetApi: AgWidgetApi): AgWidgetField[] {
  const wanted = new Set<string>(["operationId", "amount", "recordClass", ...CATEGORIES.map((category) => category.flag)]);
  const table = widgetApi.getSchema().find((entry) => entry.id === STUDIO_SOURCE_ID);
  return (table?.fields ?? []).filter((field) => wanted.has(String(field.fieldId).replace(`${STUDIO_SOURCE_ID}.`, "")));
}

function fieldFor(widgetApi: AgWidgetApi, id: string): AgWidgetField | undefined {
  const table = widgetApi.getSchema().find((entry) => entry.id === STUDIO_SOURCE_ID);
  return table?.fields.find((field) => field.fieldId === fieldKey(id));
}

export type CapacityWidgetProps = AgWidgetParams<CapacityWidgetState, unknown, { store: OperationsStore }>;

export function CapacityWidget(props: CapacityWidgetProps) {
  const { widgetApi } = props;
  const store = props.context.store;
  const includeDemonstration = props.format?.style?.includeDemonstration ?? true;
  const snapshot = useOperations(store, (state) => state.snapshot);
  const focus = useOperations(store, (state) => state.focus);
  const status = useOperations(store, (state) => state.status);
  const loadError = useOperations(store, (state) => state.loadError);
  const [rows, setRows] = useState<StudioRow[] | null>(null);
  const [selection, setSelection] = useState<StudioRow[]>([]);
  const [exceptionsError, setExceptionsError] = useState(false);
  const [active, setActive] = useState<PaymentOperationFlag | null>(null);
  const [showCalculation, setShowCalculation] = useState(props.format?.style?.showCalculation ?? false);

  const dataVersion = snapshot?.dataVersion;

  // Exception counts follow the Studio rows, so a new snapshot re-reads them.
  // Studio refreshes a widget by rendering it again with new params; the
  // snapshot version is what tells this widget the data moved.
  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    widgetApi.getData({ fields: fieldsFor(widgetApi) }, { crossFilter: "highlight" }).then(
      (response) => {
        if (cancelled) return;
        setRows(response.results.rows as StudioRow[]);
        setSelection((response.crossFilter?.rows as StudioRow[] | undefined) ?? []);
        setExceptionsError(false);
      },
      () => {
        if (cancelled) return;
        setExceptionsError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [widgetApi, dataVersion, snapshot]);

  // The grid focus can be cleared somewhere else (another tile, a filter being
  // removed, the rows leaving the data). When it goes, this widget's Studio
  // cross-filter goes with it, so the two never point at different rows.
  useEffect(() => {
    if (focus === null && active !== null) {
      widgetApi.resetCrossFilter();
      setActive(null);
    }
  }, [focus, active, widgetApi]);

  const inCategory = (flag: PaymentOperationFlag): StudioRow[] =>
    (rows ?? []).filter((row) => rowFlag(row, flag) && (includeDemonstration || !rowIsDemonstration(row)));
  const demoCount = (flag: PaymentOperationFlag): number =>
    (rows ?? []).filter((row) => rowFlag(row, flag) && rowIsDemonstration(row)).length;
  const operationalCents = (flag: PaymentOperationFlag): number =>
    (rows ?? [])
      .filter((row) => rowFlag(row, flag) && !rowIsDemonstration(row))
      .reduce((sum, row) => sum + rowAmountCents(row), 0);
  const selectionCount = (flag: PaymentOperationFlag): number =>
    selection.filter((row) => rowFlag(row, flag) && (includeDemonstration || !rowIsDemonstration(row))).length;

  const onTile = (category: Category): void => {
    if (active === category.flag) {
      // Second press: release the grid focus and the Studio cross-filter.
      widgetApi.resetCrossFilter();
      store.clearFocus();
      setActive(null);
      return;
    }
    const ids = inCategory(category.flag).map(rowId).filter((id): id is string => id !== null);
    store.focusPayments({ ids, label: category.label, source: "widget" });
    const field = fieldFor(widgetApi, category.flag);
    if (field) widgetApi.toggleCrossFilter({ type: "value", value: true, field, group: 0 });
    setActive(category.flag);
  };

  // No ledger at all: say so and show no figures, never zeros.
  if (status === "error" || (status !== "loading" && snapshot === null)) {
    return (
      <div role="alert">
        The financial position is unavailable: the ledger could not be loaded. No figures are shown rather than zeros.
      </div>
    );
  }
  if (snapshot === null) {
    return <p>Loading payment capacity…</p>;
  }

  const capacity = snapshot.capacity;
  const spentPercent = capacity.budgetCents > 0 ? Math.min(100, (capacity.rollingSpendCents / capacity.budgetCents) * 100) : 0;
  const reconciliationStale = !capacity.fresh || capacity.lastSuccessfulReconciliation === null;

  return (
    <section className="ops-capacity" aria-label="Payment capacity and exceptions">
      <ul className="ops-capacity-figures" aria-label="Capacity figures">
        <li>
          <span>Available budget</span> <span data-testid="figure-value">{formatCents(capacity.budgetCents)}</span>
        </li>
        <li>
          <span>Rolling expenditure</span> <span data-testid="figure-value">{formatCents(capacity.rollingSpendCents)}</span>
        </li>
        <li>
          <span>Active exposure</span> <span data-testid="figure-value">{formatCents(capacity.activeExposureCents)}</span>
        </li>
        <li>
          <span>Remaining capacity</span> <span data-testid="figure-value">{formatCents(capacity.remainingCents)}</span>
        </li>
      </ul>
      <div
        role="img"
        className="ops-capacity-meter"
        aria-label={`${formatCents(capacity.rollingSpendCents)} spent of the ${formatCents(capacity.budgetCents)} budget, ${formatCents(capacity.remainingCents)} remaining`}
      >
        <div style={{ width: `${spentPercent}%` }} />
      </div>
      {reconciliationStale && <p>Provider reconciliation is stale or has never run.</p>}
      {capacity.emergencyStop && <p>Emergency stop is engaged.</p>}
      {loadError !== null && <p>{loadError}</p>}
      {exceptionsError && <p>Exception counts could not be read. The capacity figures above are still the ledger&apos;s.</p>}
      {rows !== null && rows.length === 0 && <p>No payment obligation is recorded in this view yet.</p>}
      <div className="ops-capacity-tiles">
        {CATEGORIES.map((category) => {
          const count = exceptionsError ? null : inCategory(category.flag).length;
          const demos = includeDemonstration ? demoCount(category.flag) : 0;
          const selected = selectionCount(category.flag);
          return (
            <button
              key={category.flag}
              type="button"
              disabled={count === null || count === 0}
              aria-pressed={active === category.flag}
              onClick={() => onTile(category)}
            >
              <span>{category.label}</span> <span data-testid="tile-count">{count === null ? "—" : String(count)}</span>{" "}
              <span data-testid="tile-amount">{formatCents(operationalCents(category.flag))} operational</span>
              {demos > 0 && <span> {demos} demonstration</span>}
              {selected > 0 && <span> {selected} in the current selection</span>}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => setShowCalculation((value) => !value)}>
        How this is calculated
      </button>
      {showCalculation && (
        <section className="ops-capacity-calculation" aria-label="Calculation and sources">
          <p>{capacity.formula}</p>
          <p>
            {`${formatCents(capacity.budgetCents)} − ${formatCents(capacity.rollingSpendCents)} − ${formatCents(capacity.activeExposureCents)} = ${formatCents(capacity.remainingCents)}`}
          </p>
          <dl>
            <div>
              <dt>Budget</dt>
              <dd>{capacity.definitions.budget}</dd>
            </div>
            <div>
              <dt>Rolling expenditure</dt>
              <dd>{capacity.definitions.rollingSpend}</dd>
            </div>
            <div>
              <dt>Active exposure</dt>
              <dd>{capacity.definitions.activeExposure}</dd>
            </div>
            <div>
              <dt>Awaiting confirmation</dt>
              <dd>{capacity.definitions.awaitingConfirmation}</dd>
            </div>
            <div>
              <dt>Remaining capacity</dt>
              <dd>{capacity.definitions.remaining}</dd>
            </div>
            <div>
              <dt>Per-payment cap</dt>
              <dd>{capacity.definitions.perPaymentCap}</dd>
            </div>
          </dl>
          <p>{capacity.source}</p>
          <p>policy version {capacity.policyVersion}</p>
        </section>
      )}
    </section>
  );
}
