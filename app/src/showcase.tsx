// Development-only review harness. It is not linked from the product or included
// in the production build. All data and APIs here are local, read-only fixtures.
import './ag/setup.ts';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgWidgetParams } from 'ag-studio';
import './index.css';
import './operations/operations.css';
import { OperationsGrid } from './operations/OperationsGrid.tsx';
import { PaymentDetail } from './operations/PaymentDetail.tsx';
import { InvestigationPanel } from './operations/InvestigationPanel.tsx';
import { CapacityWidget } from './operations/studio/CapacityWidget.tsx';
import type { CapacityWidgetState } from './operations/studio/registry.ts';
import { createOperationsStore } from './operations/store.ts';
import { STUDIO_FIELDS, STUDIO_SOURCE_ID, studioRows, toViews } from './operations/view.ts';
import { detail, investigation, snapshot, standardRows } from './test/operationsFixtures.ts';

const rows = standardRows();
const fixtureSnapshot = snapshot(rows);
const store = createOperationsStore({ api: {
  snapshot: async () => fixtureSnapshot,
  detail: async (id) => detail(rows.find((entry) => entry.operationId === id) ?? rows[0]),
  investigate: async (question) => investigation({ question, dataVersion: fixtureSnapshot.dataVersion }),
} });
const key = (id: string) => `${STUDIO_SOURCE_ID}.${id}`;
// Minimal stand-in for the documented Studio widget API. It does not contact a provider.
const fields = STUDIO_FIELDS.map((entry) => ({ fieldId: key(entry.id), key: key(entry.id), name: entry.name, type: 'column' }));
const widgetApi = {
  getSchema: () => [{ id: STUDIO_SOURCE_ID, name: 'Payment operations', type: 'table', fields }],
  getData: async () => ({ results: { rows: studioRows(toViews(rows)).map((entry) => Object.fromEntries(Object.entries(entry).map(([id, value]) => [key(id), value]))) } }),
  setDisplayState: () => {}, toggleCrossFilter: () => {}, resetCrossFilter: () => {}, getCrossFilterSelections: () => undefined,
};
const widgetProps: AgWidgetParams<CapacityWidgetState> = { widgetId: 'capacity', widgetType: 'settle-capacity', format: { style: { includeDemonstration: true } }, dataMapping: {}, sort: undefined, config: {} as never, widgetApi: widgetApi as never, api: {} as never, context: { store } };
const detailState = new URLSearchParams(location.search).get('detail') ?? 'unknown';
const detailRow = detailState === 'demo' ? rows[5] : rows[2];
const loadDetail = async () => {
  if (detailState === 'loading') return new Promise<ReturnType<typeof detail>>(() => {});
  if (detailState === 'error') throw new Error('Fixture-only unavailable record');
  if (detailState === 'demo') return detail(detailRow, {
    sensitiveAccess: false,
    identity: { operationId: detailRow.operationId, paymentId: null, jobId: detailRow.jobId, workspaceId: null, workspaceName: null, recipient: detailRow.recipient, recipientEmail: null, idempotencyKey: null },
    fees: { state: 'not_applicable', estimate: null, provider: null, consistent: null, explanation: 'No ledger payment exists for this demonstration record, so there is no fee evidence.' },
    audit: { access: 'not_applicable', note: 'This demonstration record has no ledger payment or ledger audit trail.', events: [] },
  });
  return detail(detailRow);
};

function Showcase() {
  useEffect(() => { store.start(); return () => store.stop(); }, []);
  return <main className="page">
    <header><p className="data-badge">DESIGN REVIEW FIXTURES — NOT LIVE PAYMENT DATA</p><h1>Operations component review</h1><p>Isolated, read-only components. No API requests or payments are made.</p></header>
    <section className="showcase-section"><h2>Capacity and exceptions</h2><CapacityWidget {...widgetProps} /></section>
    <section className="showcase-section"><h2>Operations grid</h2><OperationsGrid store={store} rows={toViews(rows)} search="" compact={false} /></section>
    <section className="showcase-section"><InvestigationPanel store={store} /></section>
    <section className="showcase-section"><h2>Payment detail · {detailState}</h2><PaymentDetail operationId={detailRow.operationId} version="fixture" load={loadDetail} /></section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Showcase />);
