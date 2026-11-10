# Frontend element inventory (generated)

Regenerate with `node scripts/frontend-inventory.mjs`. The table lists every static JSX opening/self-closing element in non-test source, including component invocations and third-party components. Dynamic loops and branches are flagged syntactically; nested conditional logic, runtime reachability and visual states require manual review. Fragments are not visible elements. Imported test fixtures are excluded from the inventory. This is **not** a claim of complete rendered verification.

Reachability: product = imported from `main.tsx`; showcase = only from the development fixture harness; isolated = not reached from either. A product-reachable module can still contain unreachable branches. All individual elements are marked source-reviewed only; see the main matrix for the limited browser evidence.

| Source:line | Element | Reachability / branch | Styling observed | Responsive / verification |
| --- | --- | --- | --- | --- |
| `app/src/ag/StudioProvider.tsx:11` | `AgStudioProvider` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:43` | `main` | product; no local branch detected | `className="allocation-page"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:44` | `section` | product; no local branch detected | `className="allocation-hero"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:44` | `p` | product; no local branch detected | `className="eyebrow"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:44` | `h1` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:44` | `br` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:44` | `p` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:44` | `div` | product; no local branch detected | `className="allocation-actions"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:44` | `button` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:44` | `button` | product; no local branch detected | `className="secondary"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:45` | `p` | product; conditional | `className="error-text"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `section` | product; conditional | `className="context-strip"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:46` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `section` | product; conditional | `className="obligation-section"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `div` | product; conditional | `className="section-heading"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `p` | product; conditional | `className="eyebrow"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `div` | product; conditional | `className="obligation-cards"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `article` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `div` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `span` | product; conditional, repeated | `className={'priority ${row.priority}'}` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `span` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `h3` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `strong` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `p` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:47` | `small` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:49` | `section` | product; conditional | `className={'decision-status ${result.status}'}` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:49` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:49` | `p` | product; conditional | `className="eyebrow"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:49` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:49` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:49` | `span` | product; conditional | `className="no-execution"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:50` | `section` | product; conditional | `className="recommendation-detail"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:50` | `p` | product; conditional | `className="eyebrow"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:50` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:50` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:50` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:50` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:50` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:50` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:50` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:51` | `section` | product; conditional | `className="scenario-grid"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:51` | `div` | product; conditional | `className="section-heading"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:51` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:51` | `p` | product; conditional | `className="eyebrow"` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:51` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:51` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:51` | `div` | product; conditional | `className="allocation-grid"`, `style={{ height: 330 }}` | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:51` | `AgGridReact` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/AllocationPlanner.tsx:52` | `p` | product; conditional | `className="truth-note"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:245` | `div` | product; no local branch detected | `className="page"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:246` | `header` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:247` | `p` | product; no local branch detected | `className="sandbox-badge"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:248` | `h1` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:249` | `p` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:253` | `nav` | product; no local branch detected | `className="app-nav"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:254` | `button` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:255` | `button` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:256` | `button` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:257` | `button` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:259` | `p` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:263` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:268` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:274` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:281` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:296` | `main` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:297` | `section` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:298` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:299` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:304` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:313` | `section` | product; conditional | `className="sample-result"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:314` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:315` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:320` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:321` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:324` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:329` | `button` | product; conditional | `className="button button-primary"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:332` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:339` | `main` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:340` | `p` | product; conditional | `className="data-badge"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:344` | `p` | product; conditional | `className="error-text"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:346` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:353` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:358` | `section` | product; conditional | `className="kpis"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:359` | `div` | product; conditional | `className="kpi"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:360` | `div` | product; conditional | `className="kpi-value"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:361` | `div` | product; conditional | `className="kpi-label"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:362` | `div` | product; conditional | `className="kpi-note"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:367` | `div` | product; conditional | `className="kpi"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:368` | `div` | product; conditional | `className="kpi-value"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:369` | `div` | product; conditional | `className="kpi-label"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:370` | `div` | product; conditional | `className="kpi-note"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:375` | `div` | product; conditional | `className="kpi"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:376` | `div` | product; conditional | `className="kpi-value"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:377` | `div` | product; conditional | `className="kpi-label"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:378` | `div` | product; conditional | `className="kpi-note"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:383` | `div` | product; conditional | `className="kpi"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:384` | `div` | product; conditional | `className="kpi-value"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:385` | `div` | product; conditional | `className="kpi-label"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:386` | `div` | product; conditional | `className="kpi-note"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:394` | `section` | product; conditional | `className="panel"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:395` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:396` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:397` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:400` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:405` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:406` | `strong` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:411` | `li` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:414` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:418` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:424` | `FinancialControls` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:431` | `ApprovalPanel` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:449` | `StudioDashboard` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:451` | `section` | product; conditional | `className="audit-trail"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:452` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:453` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:454` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:456` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:457` | `strong` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:464` | `footer` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:465` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:466` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:468` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:469` | `code` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:474` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:475` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:483` | `WorkspaceApp` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:484` | `TransactionsDashboard` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:485` | `AllocationPlanner` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:488` | `main` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:489` | `section` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:490` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:492` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:493` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:500` | `div` | product; conditional | `className="error-text"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:501` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:502` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:506` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:507` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:516` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:519` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:520` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:521` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:526` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:533` | `code` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:534` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:542` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:543` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:545` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:558` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:559` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:561` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:562` | `strong` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:577` | `div` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:578` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:580` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:584` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:585` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/App.tsx:594` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:597` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:599` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:612` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:616` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:626` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:628` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:634` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:636` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:643` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:644` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:646` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:655` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:656` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:657` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:659` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:664` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:665` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:666` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:668` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/App.tsx:675` | `button` | product; conditional | `className="button button-primary"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:63` | `section` | product; no local branch detected | `className="panel"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:64` | `h2` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:65` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:66` | `strong` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:70` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:74` | `strong` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:76` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:83` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:90` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:97` | `div` | product; conditional | `className="approve-list"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:98` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:99` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:101` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:102` | `span` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:105` | `button` | product; conditional, repeated | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:119` | `div` | product; no local branch detected | `className="waiting-queue"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:120` | `h3` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:121` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:122` | `ul` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:128` | `li` | product; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:129` | `span` | product; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:130` | `strong` | product; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:148` | `label` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:151` | `input` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:161` | `button` | product; no local branch detected | `className="button button-primary"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:170` | `div` | product; conditional | `className="approve-list"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:171` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:172` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:173` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:177` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:178` | `label` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:179` | `input` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:194` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:204` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:206` | `code` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/ApprovalPanel.tsx:211` | `p` | product; conditional | `className="error-text"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:160` | `section` | product; no local branch detected | `className="panel"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:161` | `h2` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:162` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:165` | `strong` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:171` | `form` | product; no local branch detected | `className="approve-list"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:172` | `h3` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:173` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:174` | `label` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:176` | `input` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:186` | `label` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:188` | `input` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:198` | `label` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:200` | `input` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:211` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:212` | `button` | product; no local branch detected | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:219` | `button` | product; no local branch detected | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:228` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:233` | `div` | product; no local branch detected | `className="approve-list"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:234` | `h3` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:235` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:236` | `strong` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:241` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:242` | `label` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:244` | `input` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:253` | `button` | product; no local branch detected | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:261` | `button` | product; no local branch detected | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:270` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:275` | `div` | product; no local branch detected | `className="approve-list"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:276` | `h3` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:277` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:278` | `strong` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:282` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:283` | `strong` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:284` | `strong` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:291` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:296` | `p` | product; conditional | `className="error-text"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:300` | `div` | product; no local branch detected | `className="approve-list"` | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:301` | `h3` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:302` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:303` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:304` | `ul` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:306` | `li` | product; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/FinancialControls.tsx:307` | `strong` | product; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/GridFallback.tsx:62` | `div` | product; no local branch detected | `className="plain-grid-wrap"` | Source only; individual states and widths not certified |
| `app/src/GridFallback.tsx:63` | `div` | product; no local branch detected | `className="fallback-note"` | Source only; individual states and widths not certified |
| `app/src/GridFallback.tsx:69` | `div` | product; no local branch detected | `style={{ height: 320, width: "100%" }}` | Source only; individual states and widths not certified |
| `app/src/GridFallback.tsx:70` | `AgGridReact` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/main.tsx:12` | `StrictMode` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/main.tsx:13` | `SettleStudioProvider` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/main.tsx:14` | `App` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:30` | `section` | showcase; no local branch detected | `className="ops-investigator"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:31` | `div` | showcase; no local branch detected | `className="ops-section-heading"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:32` | `div` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:32` | `p` | showcase; no local branch detected | `className="ops-eyebrow"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:32` | `h2` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:33` | `span` | showcase; no local branch detected | `className="ops-source"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:35` | `p` | showcase; no local branch detected | `className="ops-note"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:37` | `form` | showcase; no local branch detected | `className="ops-question"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:38` | `label` | showcase; no local branch detected | `className="ops-visually-hidden"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:39` | `input` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:40` | `button` | showcase; no local branch detected | `className="ops-button ops-button-primary"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:42` | `div` | showcase; no local branch detected | `className="ops-chips"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:43` | `button` | showcase; repeated | `className="ops-chip"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:46` | `div` | showcase; no local branch detected | `className="ops-investigation-live"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:47` | `p` | showcase; conditional | `className="ops-error"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:48` | `p` | showcase; conditional | `className="ops-note"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:51` | `div` | showcase; conditional | `className="ops-result"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:52` | `p` | showcase; conditional | `className="ops-note"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:53` | `p` | showcase; conditional | `className="ops-result-question"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:54` | `p` | showcase; conditional | `className="ops-answer"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:56` | `p` | showcase; conditional | `className="ops-callout ops-callout-warning"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:56` | `button` | showcase; conditional | `className="ops-link"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:57` | `p` | showcase; conditional | `className="ops-callout ops-callout-warning"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:59` | `ul` | showcase; conditional | `className="ops-findings"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:60` | `li` | showcase; conditional, repeated | `className={'ops-finding ops-finding-${finding.severity}'}` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:61` | `div` | showcase; conditional, repeated | `className="ops-finding-head"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:62` | `strong` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:63` | `span` | showcase; conditional, repeated | `className={'ops-severity ops-severity-${finding.severity}'}` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:65` | `p` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:66` | `button` | showcase; conditional, repeated | `className="ops-link"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:72` | `div` | showcase; conditional | `className="ops-uncertainty"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:72` | `strong` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:72` | `ul` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:72` | `li` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:74` | `dl` | showcase; conditional | `className="ops-result-meta"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:75` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:75` | `dt` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:75` | `dd` | showcase; conditional | `className="ops-mono"` | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:76` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:76` | `dt` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:76` | `dd` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:76` | `time` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:77` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:77` | `dt` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:77` | `dd` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:78` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:78` | `dt` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:78` | `dd` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/InvestigationPanel.tsx:80` | `button` | showcase; conditional | `className="ops-button"` | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:33` | `span` | showcase; no local branch detected | `className="ops-record"` | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:34` | `span` | showcase; no local branch detected | `className="ops-record-name"` | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:35` | `span` | showcase; conditional | `className="ops-tag"` | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:39` | `Pill` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:42` | `Pill` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:45` | `Pill` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:49` | `Pill` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:49` | `span` | showcase; conditional | `className="ops-absent"` | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:53` | `span` | showcase; conditional | `className="ops-absent"` | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:54` | `span` | showcase; no local branch detected | `className="ops-mono"` | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:54` | `span` | showcase; conditional | `className="ops-tag"` | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:133` | `button` | showcase; conditional | `className="ops-row-action"` | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:228` | `div` | showcase; no local branch detected | `className={'ops-grid${compact ? " ops-grid-compact" : ""}'}` | Source only; individual states and widths not certified |
| `app/src/operations/OperationsGrid.tsx:229` | `AgGridReact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:20` | `span` | showcase; no local branch detected | `className={'ops-pill ops-pill-${tone}'}` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:27` | `div` | showcase; no local branch detected | `className="ops-fact"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:28` | `dt` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:29` | `dd` | showcase; no local branch detected | `className={present ? (mono ? "ops-mono" : undefined) : "ops-absent"}` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:51` | `div` | showcase; conditional | `className="ops-detail"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:53` | `div` | showcase; conditional | `className="ops-detail"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:54` | `p` | showcase; conditional | `className="ops-error"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:55` | `button` | showcase; conditional | `className="ops-button"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:65` | `section` | showcase; no local branch detected | `className="ops-detail"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:66` | `header` | showcase; no local branch detected | `className="ops-detail-header"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:67` | `div` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:68` | `p` | showcase; no local branch detected | `className="ops-eyebrow"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:69` | `h3` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:70` | `p` | showcase; no local branch detected | `className="ops-detail-sub"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:72` | `div` | showcase; no local branch detected | `className="ops-detail-pills"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:73` | `Pill` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:74` | `Pill` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:75` | `Pill` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:79` | `p` | showcase; conditional | `className="ops-callout ops-callout-info"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:80` | `div` | showcase; conditional | `className="ops-callout ops-callout-danger"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:80` | `strong` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:80` | `ul` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:80` | `li` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:81` | `p` | showcase; conditional | `className="ops-callout ops-callout-warning"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:81` | `strong` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:83` | `ol` | showcase; no local branch detected | `className="ops-timeline"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:84` | `li` | showcase; repeated | `className={'ops-step ops-step-${step.state}'}` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:85` | `span` | showcase; repeated | `className="ops-step-state"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:86` | `strong` | showcase; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:87` | `span` | showcase; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:88` | `time` | showcase; repeated, conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:92` | `div` | showcase; no local branch detected | `className="ops-detail-grid"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:93` | `section` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:94` | `h4` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:95` | `dl` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:96` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:97` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:98` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:99` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:100` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:101` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:102` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:103` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:104` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:105` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:106` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:110` | `section` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:111` | `h4` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:112` | `dl` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:113` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:114` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:115` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:116` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:117` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:118` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:119` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:120` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:122` | `div` | showcase; conditional | `className="ops-gaps"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:122` | `strong` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:122` | `ul` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:122` | `li` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:125` | `section` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:126` | `h4` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:127` | `dl` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:128` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:129` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:130` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:131` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:132` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:133` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:134` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:135` | `Fact` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:137` | `p` | showcase; no local branch detected | `className="ops-note"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:138` | `ul` | showcase; conditional | `className="ops-discrepancies"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:138` | `li` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:138` | `strong` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:138` | `br` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:138` | `span` | showcase; conditional, repeated | `className="ops-mono"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:142` | `section` | showcase; no local branch detected | `className="ops-detail-block"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:143` | `h4` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:145` | `ul` | showcase; conditional | `className="ops-stamps"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:145` | `li` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:145` | `span` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:145` | `time` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:146` | `p` | showcase; conditional | `className="ops-absent"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:149` | `section` | showcase; no local branch detected | `className="ops-detail-block"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:150` | `h4` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:152` | `div` | showcase; conditional | `className="ops-table-scroll"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:152` | `table` | showcase; conditional | `className="ops-audit"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:153` | `caption` | showcase; conditional | `className="ops-visually-hidden"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:154` | `thead` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:154` | `tr` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:154` | `th` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:154` | `th` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:154` | `th` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:154` | `th` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:154` | `th` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:155` | `tbody` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:155` | `tr` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:156` | `td` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:156` | `time` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:157` | `td` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:158` | `td` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:159` | `td` | showcase; conditional, repeated | `className="ops-mono"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:160` | `td` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:163` | `p` | showcase; conditional | `className={detail.audit.access === "owner_required" ? "ops-callout ops-callout-warning" : "ops-absent"}` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:166` | `section` | showcase; conditional | `className="ops-detail-block"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:167` | `h4` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:168` | `ul` | showcase; conditional | `className="ops-stamps"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:168` | `li` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:168` | `span` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:168` | `span` | showcase; conditional, repeated | `className="ops-mono"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:168` | `time` | showcase; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:171` | `p` | showcase; no local branch detected | `className="ops-note"` | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:182` | `div` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/PaymentDetail.tsx:182` | `PaymentDetail` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:146` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:152` | `p` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:160` | `section` | showcase; no local branch detected | `className="ops-capacity"` | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:161` | `ul` | showcase; no local branch detected | `className="ops-capacity-figures"` | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:162` | `li` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:163` | `span` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:163` | `span` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:165` | `li` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:166` | `span` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:166` | `span` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:168` | `li` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:169` | `span` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:169` | `span` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:171` | `li` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:172` | `span` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:172` | `span` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:175` | `div` | showcase; no local branch detected | `className="ops-capacity-meter"` | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:180` | `div` | showcase; no local branch detected | `style={{ width: '${spentPercent}%' }}` | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:182` | `p` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:183` | `p` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:184` | `p` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:185` | `p` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:186` | `p` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:187` | `div` | showcase; no local branch detected | `className="ops-capacity-tiles"` | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:193` | `button` | showcase; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:200` | `span` | showcase; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:200` | `span` | showcase; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:201` | `span` | showcase; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:202` | `span` | showcase; repeated, conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:203` | `span` | showcase; repeated, conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:208` | `button` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:212` | `section` | showcase; conditional | `className="ops-capacity-calculation"` | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:213` | `p` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:214` | `p` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:217` | `dl` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:218` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:219` | `dt` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:220` | `dd` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:222` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:223` | `dt` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:224` | `dd` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:226` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:227` | `dt` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:228` | `dd` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:230` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:231` | `dt` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:232` | `dd` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:234` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:235` | `dt` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:236` | `dd` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:238` | `div` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:239` | `dt` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:240` | `dd` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:243` | `p` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/operations/studio/CapacityWidget.tsx:244` | `p` | showcase; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:50` | `main` | showcase; no local branch detected | `className="page"` | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:51` | `header` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:51` | `p` | showcase; no local branch detected | `className="data-badge"` | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:51` | `h1` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:51` | `p` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:52` | `section` | showcase; no local branch detected | `className="showcase-section"` | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:52` | `h2` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:52` | `CapacityWidget` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:53` | `section` | showcase; no local branch detected | `className="showcase-section"` | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:53` | `h2` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:53` | `OperationsGrid` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:54` | `section` | showcase; no local branch detected | `className="showcase-section"` | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:54` | `InvestigationPanel` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:55` | `section` | showcase; no local branch detected | `className="showcase-section"` | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:55` | `h2` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:55` | `PaymentDetail` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/showcase.tsx:59` | `Showcase` | showcase; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioAnalytics.tsx:100` | `section` | product; no local branch detected | `className="studio-section"` | Source only; individual states and widths not certified |
| `app/src/StudioAnalytics.tsx:101` | `div` | product; no local branch detected | `className="section-heading"` | Source only; individual states and widths not certified |
| `app/src/StudioAnalytics.tsx:101` | `div` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioAnalytics.tsx:101` | `p` | product; no local branch detected | `className="eyebrow"` | Source only; individual states and widths not certified |
| `app/src/StudioAnalytics.tsx:101` | `h2` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioAnalytics.tsx:101` | `span` | product; no local branch detected | `className="save-state"` | Source only; individual states and widths not certified |
| `app/src/StudioAnalytics.tsx:102` | `p` | product; no local branch detected | `className="muted"` | Source only; individual states and widths not certified |
| `app/src/StudioAnalytics.tsx:103` | `div` | product; no local branch detected | `className="studio transaction-studio"` | Source only; individual states and widths not certified |
| `app/src/StudioAnalytics.tsx:104` | `AgStudio` | product; no local branch detected | `style={FILL}` | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:37` | `span` | product; no local branch detected | `className="studio-wrapped-cell"` | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:172` | `section` | product; no local branch detected | `className="studio-section"` | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:173` | `div` | product; no local branch detected | `className="grid-controls"` | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:174` | `label` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:175` | `select` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:180` | `option` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:182` | `option` | product; repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:187` | `button` | product; no local branch detected | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:197` | `GridFallback` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:199` | `StudioErrorBoundary` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:199` | `GridFallback` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:200` | `div` | product; conditional | `className="studio"` | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:201` | `AgStudio` | product; conditional | `style={FILL}` | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:206` | `div` | product; no local branch detected | `className="chart"` | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:207` | `h3` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:208` | `StudioErrorBoundary` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:208` | `p` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/StudioDashboard.tsx:209` | `AgCharts` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:24` | `span` | product; no local branch detected | `className={'status-pill status-${status.toLowerCase()}'}` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:149` | `button` | product; conditional | `className="row-action"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:197` | `main` | product; no local branch detected | `className="transaction-page"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:198` | `section` | product; no local branch detected | `className="transaction-hero"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:199` | `div` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:199` | `p` | product; no local branch detected | `className="eyebrow"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:199` | `h1` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:199` | `p` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:200` | `div` | product; no local branch detected | `className="connection-card"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:200` | `span` | product; no local branch detected | `className={'connection-dot ${connection.includes("interrupted") ? "offline" : ""}'}` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:200` | `span` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:200` | `strong` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:200` | `small` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:203` | `section` | product; no local branch detected | `className="kpis transaction-kpis"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:204` | `div` | product; no local branch detected | `className="kpi"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:204` | `div` | product; no local branch detected | `className="kpi-label"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:204` | `div` | product; no local branch detected | `className="kpi-value"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:205` | `div` | product; no local branch detected | `className="kpi"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:205` | `div` | product; no local branch detected | `className="kpi-label"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:205` | `div` | product; no local branch detected | `className="kpi-value"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:206` | `div` | product; no local branch detected | `className="kpi"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:206` | `div` | product; no local branch detected | `className="kpi-label"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:206` | `div` | product; no local branch detected | `className="kpi-value"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:207` | `div` | product; no local branch detected | `className="kpi"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:207` | `div` | product; no local branch detected | `className="kpi-label"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:207` | `div` | product; no local branch detected | `className="kpi-value small"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:209` | `p` | product; no local branch detected | `className="truth-note"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:211` | `div` | product; no local branch detected | `className="view-tabs"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:212` | `button` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:213` | `button` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:217` | `section` | product; conditional | `className="grid-shell"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:218` | `div` | product; conditional | `className="grid-toolbar"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:219` | `label` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:219` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:220` | `label` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:220` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:221` | `button` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:222` | `button` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:223` | `button` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:224` | `button` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:226` | `div` | product; conditional | `className="transaction-grid"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:227` | `AgGridReact` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:241` | `div` | product; conditional | `className="grid-footer"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:241` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:241` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:244` | `section` | product; conditional | `className="investigator"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:245` | `div` | product; conditional | `className="section-heading"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:245` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:245` | `p` | product; conditional | `className="eyebrow"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:245` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:245` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:246` | `div` | product; conditional | `className="question-row"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:246` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:246` | `button` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:247` | `p` | product; conditional | `className="error-text"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:248` | `div` | product; conditional | `className="investigation-result"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:248` | `p` | product; conditional | `className="answer"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:248` | `div` | product; conditional | `className="fact-list"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:248` | `div` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:248` | `span` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:248` | `strong` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:248` | `small` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:248` | `p` | product; conditional, repeated | `className="hypothesis"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:248` | `strong` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:248` | `button` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:251` | `p` | product; conditional | `className="muted"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:251` | `p` | product; conditional | `className="muted"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:254` | `aside` | product; conditional | `className={'history-drawer ${inspectedRow ? "open" : ""}'}` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:255` | `div` | product; conditional | `className="section-heading"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:255` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:255` | `p` | product; conditional | `className="eyebrow"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:255` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:255` | `button` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `div` | product; conditional | `className="identity-grid"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `div` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:256` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:257` | `div` | product; conditional | `className="history-facts"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:257` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:257` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:257` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:257` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:257` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:257` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:257` | `span` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:257` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:258` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:259` | `ol` | product; conditional | `className="timeline"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:259` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:259` | `span` | product; conditional, repeated | `className="sequence"` | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:259` | `div` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:259` | `strong` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:259` | `p` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:259` | `time` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:259` | `br` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:260` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:261` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:262` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/TransactionsDashboard.tsx:264` | `StudioAnalytics` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:82` | `main` | product; conditional | `className="workspace-page"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:82` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:82` | `p` | product; conditional | `className="error-text"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:87` | `main` | product; conditional | `className="workspace-page workspace-signin"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:88` | `h2` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:89` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:94` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:95` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:96` | `button` | product; conditional | `className="button button-primary"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:109` | `p` | product; conditional | `className="error-text"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:110` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:120` | `main` | product; no local branch detected | `className="workspace-page"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:121` | `h2` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:122` | `p` | product; no local branch detected | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:123` | `strong` | product; no local branch detected | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:124` | `button` | product; no local branch detected | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:130` | `section` | product; conditional | `className="panel"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:131` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:132` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:133` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:134` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:135` | `button` | product; conditional | `className="button button-primary"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:152` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:154` | `select` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:155` | `option` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:160` | `p` | product; conditional | `className="error-text"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:161` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:165` | `section` | product; conditional | `className="panel"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:166` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:167` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:168` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:170` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:173` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:174` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:175` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:175` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:180` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:181` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:182` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:195` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:209` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:215` | `section` | product; conditional | `className="panel"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:216` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:217` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:218` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:219` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:220` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:221` | `input` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:222` | `select` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:223` | `option` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:224` | `option` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:225` | `option` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:227` | `button` | product; conditional | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:245` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:250` | `section` | product; conditional | `className="panel"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:251` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:252` | `p` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:253` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:258` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:259` | `strong` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:265` | `button` | product; conditional, repeated | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:276` | `button` | product; conditional, repeated | `className="button button-secondary"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:289` | `button` | product; conditional, repeated | `className="button button-primary"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:304` | `div` | product; conditional, repeated | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:319` | `section` | product; conditional | `className="panel"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:320` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:322` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:323` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:323` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:331` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:332` | `strong` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:334` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:336` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:350` | `section` | product; conditional | `className="panel"` | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:351` | `h3` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:352` | `ul` | product; conditional | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:354` | `li` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:355` | `strong` | product; conditional, repeated | inherited, native, or component-owned | Source only; individual states and widths not certified |
| `app/src/WorkspaceApp.tsx:364` | `p` | product; conditional | `className="panel-line"` | Source only; individual states and widths not certified |

Total: 744 JSX elements.

## Stylesheet selector inventory

Selectors are listed as written, with their enclosing media/support rules. Inclusion here records source coverage only, not a finding that every selector is used or responsive.

| Source:line | Selector | Context |
| --- | --- | --- |
| `app/src/allocation.css:1` | `.app-nav` | all widths |
| `app/src/allocation.css:2` | `.app-nav button` | all widths |
| `app/src/allocation.css:3` | `.allocation-page` | all widths |
| `app/src/allocation.css:4` | `.allocation-hero` | all widths |
| `app/src/allocation.css:5` | `.allocation-hero h1` | all widths |
| `app/src/allocation.css:6` | `.allocation-hero > p:not(.eyebrow)` | all widths |
| `app/src/allocation.css:7` | `.allocation-actions` | all widths |
| `app/src/allocation.css:8` | `.allocation-actions button` | all widths |
| `app/src/allocation.css:9` | `.allocation-actions button.secondary` | all widths |
| `app/src/allocation.css:10` | `.context-strip` | all widths |
| `app/src/allocation.css:11` | `.context-strip > div` | all widths |
| `app/src/allocation.css:12` | `.context-strip span` | all widths |
| `app/src/allocation.css:13` | `.context-strip strong` | all widths |
| `app/src/allocation.css:14` | `.context-strip p` | all widths |
| `app/src/allocation.css:15` | `.obligation-section, .scenario-grid` | all widths |
| `app/src/allocation.css:16` | `.obligation-cards` | all widths |
| `app/src/allocation.css:17` | `.obligation-cards article` | all widths |
| `app/src/allocation.css:18` | `.obligation-cards article > div` | all widths |
| `app/src/allocation.css:19` | `.obligation-cards h3` | all widths |
| `app/src/allocation.css:20` | `.obligation-cards article > strong` | all widths |
| `app/src/allocation.css:21` | `.obligation-cards p, .obligation-cards small` | all widths |
| `app/src/allocation.css:22` | `.priority` | all widths |
| `app/src/allocation.css:23` | `.priority.operational` | all widths |
| `app/src/allocation.css:24` | `.priority.urgent` | all widths |
| `app/src/allocation.css:25` | `.decision-status` | all widths |
| `app/src/allocation.css:26` | `.decision-status.recommendation_ready` | all widths |
| `app/src/allocation.css:27` | `.decision-status h2, .decision-status p` | all widths |
| `app/src/allocation.css:28` | `.no-execution` | all widths |
| `app/src/allocation.css:29` | `.recommendation-detail` | all widths |
| `app/src/allocation.css:30` | `.recommendation-detail h2` | all widths |
| `app/src/allocation.css:31` | `.recommendation-detail > div` | all widths |
| `app/src/allocation.css:32` | `.recommendation-detail span` | all widths |
| `app/src/allocation.css:33` | `.recommendation-detail span strong` | all widths |
| `app/src/allocation.css:34` | `.scenario-grid .section-heading` | all widths |
| `app/src/allocation.css:35` | `.selected-scenario` | all widths |
| `app/src/allocation.css:36` | `.allocation-hero` | @media (max-width: 850px) |
| `app/src/allocation.css:36` | `.context-strip` | @media (max-width: 850px) |
| `app/src/allocation.css:36` | `.obligation-cards` | @media (max-width: 850px) |
| `app/src/allocation.css:36` | `.decision-status` | @media (max-width: 850px) |
| `app/src/allocation.css:36` | `.recommendation-detail > div` | @media (max-width: 850px) |
| `app/src/allocation.css:38` | `.allocation-page` | @media (max-width: 600px) |
| `app/src/allocation.css:39` | `.allocation-hero` | @media (max-width: 600px) |
| `app/src/index.css:6` | `*, *::before, *::after` | all widths |
| `app/src/index.css:12` | `:root` | all widths |
| `app/src/index.css:18` | `body` | all widths |
| `app/src/index.css:25` | `#root` | all widths |
| `app/src/index.css:29` | `.page` | all widths |
| `app/src/index.css:35` | `h1` | all widths |
| `app/src/index.css:41` | `h2` | all widths |
| `app/src/index.css:47` | `h3` | all widths |
| `app/src/index.css:53` | `p` | all widths |
| `app/src/index.css:57` | `header p` | all widths |
| `app/src/index.css:61` | `.sandbox-badge` | all widths |
| `app/src/index.css:72` | `.data-badge` | all widths |
| `app/src/index.css:83` | `.error-text` | all widths |
| `app/src/index.css:91` | `.button` | all widths |
| `app/src/index.css:102` | `.button:disabled` | all widths |
| `app/src/index.css:107` | `.button-primary` | all widths |
| `app/src/index.css:113` | `.button-secondary` | all widths |
| `app/src/index.css:119` | `.button:focus-visible, select:focus-visible, a:focus-visible` | all widths |
| `app/src/index.css:126` | `.kpis` | all widths |
| `app/src/index.css:133` | `.kpi` | all widths |
| `app/src/index.css:140` | `.kpi-value` | all widths |
| `app/src/index.css:145` | `.kpi-label` | all widths |
| `app/src/index.css:151` | `.panel, .studio-section, .audit-trail, .sample-result` | all widths |
| `app/src/index.css:162` | `.panel-line` | all widths |
| `app/src/index.css:166` | `.approve-list ul, .waiting-queue ul, .audit-trail ul` | all widths |
| `app/src/index.css:174` | `.approve-list li, .waiting-queue li, .audit-trail li` | all widths |
| `app/src/index.css:186` | `.grid-controls` | all widths |
| `app/src/index.css:194` | `.grid-controls label` | all widths |
| `app/src/index.css:198` | `select` | all widths |
| `app/src/index.css:208` | `.studio` | all widths |
| `app/src/index.css:217` | `.studio button` | all widths |
| `app/src/index.css:221` | `.chart` | all widths |
| `app/src/index.css:225` | `.chart h3` | all widths |
| `app/src/index.css:229` | `.plain-grid-wrap` | all widths |
| `app/src/index.css:235` | `.fallback-note` | all widths |
| `app/src/index.css:243` | `footer` | all widths |
| `app/src/index.css:249` | `.page` | @media (max-width: 600px) |
| `app/src/index.css:253` | `h1` | @media (max-width: 600px) |
| `app/src/index.css:257` | `.kpis` | @media (max-width: 600px) |
| `app/src/index.css:261` | `.studio` | @media (max-width: 600px) |
| `app/src/index.css:265` | `.grid-controls` | @media (max-width: 600px) |
| `app/src/index.css:270` | `.grid-controls select, .grid-controls .button` | @media (max-width: 600px) |
| `app/src/index.css:276` | `.approve-list li, .waiting-queue li` | @media (max-width: 600px) |
| `app/src/index.css:282` | `.panel, .studio-section, .audit-trail, .sample-result` | @media (max-width: 600px) |
| `app/src/index.css:291` | `.studio-wrapped-cell` | all widths |
| `app/src/index.css:294` | `:root` | all widths |
| `app/src/index.css:295` | `body` | all widths |
| `app/src/index.css:296` | `.page` | all widths |
| `app/src/index.css:297` | `.page > header` | all widths |
| `app/src/index.css:298` | `h1, h2, h3` | all widths |
| `app/src/index.css:299` | `.kpi, .panel, .studio-section, .audit-trail, .sample-result` | all widths |
| `app/src/index.css:300` | `.kpi-value, .identity-grid strong, .fact-list strong, .context-strip strong` | all widths |
| `app/src/index.css:301` | `button, input, select, textarea` | all widths |
| `app/src/index.css:302` | `button` | all widths |
| `app/src/index.css:303` | `button:not(:disabled):hover` | all widths |
| `app/src/index.css:304` | `button:disabled` | all widths |
| `app/src/index.css:305` | `input:not([type="checkbox"]):not([type="radio"]), textarea, select` | all widths |
| `app/src/index.css:306` | `:where(button, input, select, textarea, a, [tabindex]):focus-visible` | all widths |
| `app/src/index.css:307` | `.app-nav button` | all widths |
| `app/src/index.css:308` | `.app-nav button[aria-current="page"]` | all widths |
| `app/src/index.css:310` | `.page` | @media (max-width: 600px) |
| `app/src/index.css:311` | `.page > header` | @media (max-width: 600px) |
| `app/src/index.css:312` | `.app-nav button` | @media (max-width: 600px) |
| `app/src/index.css:313` | `.transaction-page, .allocation-page` | @media (max-width: 600px) |
| `app/src/index.css:314` | `.transaction-hero, .allocation-hero` | @media (max-width: 600px) |
| `app/src/index.css:315` | `.grid-toolbar input:not([type="checkbox"])` | @media (max-width: 600px) |
| `app/src/index.css:316` | `.grid-toolbar label:first-child` | @media (max-width: 600px) |
| `app/src/index.css:317` | `.view-tabs` | @media (max-width: 600px) |
| `app/src/index.css:318` | `.view-tabs button` | @media (max-width: 600px) |
| `app/src/index.css:321` | `*, *::before, *::after` | @media (prefers-reduced-motion: reduce) |
| `app/src/index.css:324` | `.button-primary:not(:disabled):hover` | all widths |
| `app/src/index.css:327` | `.workspace-page` | all widths |
| `app/src/index.css:328` | `.workspace-signin` | all widths |
| `app/src/index.css:329` | `.workspace-signin > p` | all widths |
| `app/src/index.css:330` | `.workspace-page .panel` | all widths |
| `app/src/index.css:331` | `.workspace-page .panel h3` | all widths |
| `app/src/index.css:332` | `.workspace-page [aria-label="Create obligation"] .panel-line:first-of-type` | all widths |
| `app/src/index.css:333` | `.workspace-page [aria-label="Create obligation"] .panel-line:first-of-type input` | all widths |
| `app/src/index.css:334` | `.workspace-page [aria-label="Create obligation"] .panel-line:first-of-type .button` | all widths |
| `app/src/index.css:335` | `.workspace-page [aria-label="Obligations"] ul, .workspace-page [aria-label="Workspace audit"] ul` | all widths |
| `app/src/index.css:336` | `.workspace-page [aria-label="Obligations"] li, .workspace-page [aria-label="Workspace audit"] li` | all widths |
| `app/src/index.css:338` | `.workspace-page .panel, .workspace-signin` | @media (max-width: 600px) |
| `app/src/index.css:339` | `.workspace-page [aria-label="Create obligation"] .panel-line:first-of-type > *` | @media (max-width: 600px) |
| `app/src/operations/operations.css:2` | `.ops-detail, .ops-investigator, .ops-capacity` | all widths |
| `app/src/operations/operations.css:3` | `.ops-grid` | all widths |
| `app/src/operations/operations.css:4` | `.ops-grid-compact` | all widths |
| `app/src/operations/operations.css:5` | `.ops-detail-header, .ops-section-heading` | all widths |
| `app/src/operations/operations.css:6` | `.ops-detail-header h3, .ops-section-heading h2` | all widths |
| `app/src/operations/operations.css:7` | `.ops-eyebrow` | all widths |
| `app/src/operations/operations.css:8` | `.ops-detail-sub, .ops-note, .ops-source, .ops-absent` | all widths |
| `app/src/operations/operations.css:9` | `.ops-mono` | all widths |
| `app/src/operations/operations.css:10` | `.ops-detail-pills, .ops-chips` | all widths |
| `app/src/operations/operations.css:11` | `.ops-pill, .ops-tag, .ops-severity` | all widths |
| `app/src/operations/operations.css:12` | `.ops-pill-success` | all widths |
| `app/src/operations/operations.css:13` | `.ops-pill-warning, .ops-severity-warning` | all widths |
| `app/src/operations/operations.css:14` | `.ops-pill-danger, .ops-severity-critical` | all widths |
| `app/src/operations/operations.css:15` | `.ops-pill-info, .ops-severity-info` | all widths |
| `app/src/operations/operations.css:16` | `.ops-callout, .ops-error, .ops-uncertainty` | all widths |
| `app/src/operations/operations.css:17` | `.ops-callout-info` | all widths |
| `app/src/operations/operations.css:18` | `.ops-callout-warning, .ops-uncertainty` | all widths |
| `app/src/operations/operations.css:19` | `.ops-callout-danger, .ops-error` | all widths |
| `app/src/operations/operations.css:20` | `.ops-timeline` | all widths |
| `app/src/operations/operations.css:21` | `.ops-step` | all widths |
| `app/src/operations/operations.css:22` | `.ops-step-complete` | all widths |
| `app/src/operations/operations.css:23` | `.ops-step-missing` | all widths |
| `app/src/operations/operations.css:24` | `.ops-step-state` | all widths |
| `app/src/operations/operations.css:25` | `.ops-detail-grid` | all widths |
| `app/src/operations/operations.css:26` | `.ops-detail-grid section, .ops-detail-block` | all widths |
| `app/src/operations/operations.css:27` | `.ops-detail h4` | all widths |
| `app/src/operations/operations.css:28` | `.ops-detail dl` | all widths |
| `app/src/operations/operations.css:29` | `.ops-fact` | all widths |
| `app/src/operations/operations.css:30` | `.ops-fact dt, .ops-result-meta dt` | all widths |
| `app/src/operations/operations.css:31` | `.ops-fact dd, .ops-result-meta dd` | all widths |
| `app/src/operations/operations.css:32` | `.ops-stamps, .ops-discrepancies, .ops-findings` | all widths |
| `app/src/operations/operations.css:33` | `.ops-stamps li` | all widths |
| `app/src/operations/operations.css:34` | `.ops-table-scroll` | all widths |
| `app/src/operations/operations.css:35` | `.ops-audit` | all widths |
| `app/src/operations/operations.css:36` | `.ops-audit th, .ops-audit td` | all widths |
| `app/src/operations/operations.css:37` | `.ops-visually-hidden` | all widths |
| `app/src/operations/operations.css:38` | `.ops-button, .ops-chip, .ops-row-action, .ops-capacity button` | all widths |
| `app/src/operations/operations.css:39` | `.ops-button-primary` | all widths |
| `app/src/operations/operations.css:40` | `.ops-row-action` | all widths |
| `app/src/operations/operations.css:41` | `.ops-link` | all widths |
| `app/src/operations/operations.css:42` | `.ops-question` | all widths |
| `app/src/operations/operations.css:43` | `.ops-question input` | all widths |
| `app/src/operations/operations.css:44` | `.ops-result` | all widths |
| `app/src/operations/operations.css:45` | `.ops-findings` | all widths |
| `app/src/operations/operations.css:46` | `.ops-finding` | all widths |
| `app/src/operations/operations.css:47` | `.ops-finding-head` | all widths |
| `app/src/operations/operations.css:48` | `.ops-result-meta` | all widths |
| `app/src/operations/operations.css:49` | `.ops-capacity-figures` | all widths |
| `app/src/operations/operations.css:50` | `.ops-capacity-figures li` | all widths |
| `app/src/operations/operations.css:51` | `.ops-capacity-figures [data-testid="figure-value"]` | all widths |
| `app/src/operations/operations.css:52` | `.ops-capacity-meter` | all widths |
| `app/src/operations/operations.css:53` | `.ops-capacity-meter > div` | all widths |
| `app/src/operations/operations.css:54` | `.ops-capacity-tiles` | all widths |
| `app/src/operations/operations.css:55` | `.ops-capacity-tiles button` | all widths |
| `app/src/operations/operations.css:56` | `.ops-capacity-tiles button[aria-pressed="true"]` | all widths |
| `app/src/operations/operations.css:57` | `.ops-capacity-tiles [data-testid="tile-count"]` | all widths |
| `app/src/operations/operations.css:58` | `.ops-capacity-tiles [data-testid="tile-amount"]` | all widths |
| `app/src/operations/operations.css:59` | `.ops-capacity-calculation` | all widths |
| `app/src/operations/operations.css:60` | `.ops-cell-danger` | all widths |
| `app/src/operations/operations.css:61` | `.ops-cell-warning` | all widths |
| `app/src/operations/operations.css:62` | `.ops-detail-grid` | @media (max-width: 850px) |
| `app/src/operations/operations.css:63` | `.ops-detail, .ops-investigator, .ops-capacity` | @media (max-width: 600px) |
| `app/src/operations/operations.css:63` | `.ops-detail-header, .ops-section-heading, .ops-question` | @media (max-width: 600px) |
| `app/src/operations/operations.css:63` | `.ops-question input, .ops-question button` | @media (max-width: 600px) |
| `app/src/operations/operations.css:64` | `.showcase-section` | all widths |
| `app/src/transaction.css:1` | `.transaction-page` | all widths |
| `app/src/transaction.css:2` | `.transaction-hero` | all widths |
| `app/src/transaction.css:3` | `.transaction-hero h1` | all widths |
| `app/src/transaction.css:4` | `.transaction-hero p` | all widths |
| `app/src/transaction.css:5` | `.eyebrow` | all widths |
| `app/src/transaction.css:6` | `.connection-card` | all widths |
| `app/src/transaction.css:7` | `.connection-card strong, .connection-card small` | all widths |
| `app/src/transaction.css:8` | `.connection-dot` | all widths |
| `app/src/transaction.css:9` | `.connection-dot.offline` | all widths |
| `app/src/transaction.css:10` | `.transaction-kpis` | all widths |
| `app/src/transaction.css:11` | `.kpi-value.small` | all widths |
| `app/src/transaction.css:12` | `.truth-note` | all widths |
| `app/src/transaction.css:13` | `.view-tabs` | all widths |
| `app/src/transaction.css:14` | `.view-tabs button` | all widths |
| `app/src/transaction.css:15` | `.view-tabs button[aria-selected="true"]` | all widths |
| `app/src/transaction.css:16` | `.grid-shell` | all widths |
| `app/src/transaction.css:17` | `.grid-toolbar` | all widths |
| `app/src/transaction.css:18` | `.grid-toolbar label` | all widths |
| `app/src/transaction.css:19` | `.grid-toolbar label:first-child` | all widths |
| `app/src/transaction.css:20` | `.grid-toolbar input:not([type="checkbox"])` | all widths |
| `app/src/transaction.css:21` | `.grid-toolbar button, .question-row button, .investigation-result button, .history-drawer button` | all widths |
| `app/src/transaction.css:22` | `.grid-toolbar button:hover, .question-row button:hover, .investigation-result button:hover` | all widths |
| `app/src/transaction.css:23` | `.transaction-grid` | all widths |
| `app/src/transaction.css:24` | `.grid-footer` | all widths |
| `app/src/transaction.css:25` | `.row-action` | all widths |
| `app/src/transaction.css:26` | `.status-pill` | all widths |
| `app/src/transaction.css:27` | `.status-success, .status-completed` | all widths |
| `app/src/transaction.css:28` | `.status-failed, .status-denied` | all widths |
| `app/src/transaction.css:29` | `.status-pending, .status-unclaimed` | all widths |
| `app/src/transaction.css:30` | `.investigator` | all widths |
| `app/src/transaction.css:31` | `.section-heading` | all widths |
| `app/src/transaction.css:32` | `.section-heading h2` | all widths |
| `app/src/transaction.css:33` | `.section-heading > span` | all widths |
| `app/src/transaction.css:34` | `.question-row` | all widths |
| `app/src/transaction.css:35` | `.question-row input` | all widths |
| `app/src/transaction.css:36` | `.question-row button` | all widths |
| `app/src/transaction.css:37` | `.answer` | all widths |
| `app/src/transaction.css:38` | `.fact-list` | all widths |
| `app/src/transaction.css:39` | `.fact-list > div` | all widths |
| `app/src/transaction.css:40` | `.fact-list span, .fact-list small` | all widths |
| `app/src/transaction.css:41` | `.fact-list strong` | all widths |
| `app/src/transaction.css:42` | `.hypothesis` | all widths |
| `app/src/transaction.css:43` | `.muted` | all widths |
| `app/src/transaction.css:44` | `.history-drawer` | all widths |
| `app/src/transaction.css:45` | `.history-drawer:not(.open)` | all widths |
| `app/src/transaction.css:46` | `.identity-grid` | all widths |
| `app/src/transaction.css:47` | `.identity-grid > div` | all widths |
| `app/src/transaction.css:48` | `.identity-grid span` | all widths |
| `app/src/transaction.css:49` | `.identity-grid strong` | all widths |
| `app/src/transaction.css:50` | `.history-facts` | all widths |
| `app/src/transaction.css:51` | `.timeline` | all widths |
| `app/src/transaction.css:52` | `.timeline li` | all widths |
| `app/src/transaction.css:53` | `.timeline p, .timeline time` | all widths |
| `app/src/transaction.css:54` | `.sequence` | all widths |
| `app/src/transaction.css:55` | `.transaction-studio` | all widths |
| `app/src/transaction.css:56` | `.save-state` | all widths |
| `app/src/transaction.css:57` | `.transaction-hero` | @media (max-width: 850px) |
| `app/src/transaction.css:57` | `.transaction-kpis` | @media (max-width: 850px) |
| `app/src/transaction.css:57` | `.identity-grid` | @media (max-width: 850px) |
| `app/src/transaction.css:57` | `.grid-footer` | @media (max-width: 850px) |
| `app/src/transaction.css:57` | `.question-row` | @media (max-width: 850px) |
| `app/src/transaction.css:59` | `.transaction-page` | @media (max-width: 600px) |
| `app/src/transaction.css:60` | `.transaction-hero` | @media (max-width: 600px) |
| `app/src/transaction.css:61` | `.grid-toolbar input:not([type="checkbox"])` | @media (max-width: 600px) |
| `app/src/transaction.css:62` | `.grid-toolbar label:first-child` | @media (max-width: 600px) |
| `app/src/transaction.css:63` | `.view-tabs` | @media (max-width: 600px) |
| `app/src/transaction.css:64` | `.view-tabs button` | @media (max-width: 600px) |
| `app/src/transaction.css:67` | `.question-row button:not(:disabled):hover` | all widths |

Total: 258 stylesheet rules.
