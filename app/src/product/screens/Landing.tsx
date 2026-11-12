// The public experience.
//
// A visitor must learn four things in the first few seconds: what Settle does,
// who it is for, what the agent contributes, and what the owner controls. The
// page is written in that order, and every claim on it is something the
// product actually does.
//
// There is no invented customer count, no invented result and no invented
// testimonial. The figures on this page are shapes, not data.
import { Logo } from "../Logo.tsx";
import { Pill } from "../ui.tsx";
import { useRoute } from "../router.ts";
import { useWorkspace } from "../WorkspaceProvider.tsx";

const JOURNEY = [
  { step: "01", title: "Create the obligation", body: "Record the work, the recipient, the amount and the due date. Nothing is sent anywhere." },
  { step: "02", title: "The agent proposes", body: "Settle ranks owner-approved work against the policy and returns a recommendation with its reasoning and its limits." },
  { step: "03", title: "You authorise", body: "You approve each obligation. Approval creates a permanent payment identity and nothing else." },
  { step: "04", title: "Policy enforces", body: "The financial engine checks the per-payment cap, the rolling cap and provider freshness before a single byte reaches PayPal." },
  { step: "05", title: "You verify the receipt", body: "Every payment carries a six-stage evidence trail, from obligation to independent reconciliation." },
];

const SAFETY = [
  { title: "Caps that hold", body: "A per-payment cap and a rolling cap are configured by the owner and enforced by the server on every submission. An amount over the cap waits for a human, with the reason on screen.", marker: "Policy" },
  { title: "An emergency stop", body: "One control halts every reservation and submission at once. It is prominent, it states why it was engaged, and it is in the audit trail.", marker: "Control" },
  { title: "Independent re-reads", body: "A PayPal acknowledgement is not a confirmation, and a confirmation is not a reconciliation. Each receipt shows which of those three facts it actually holds.", marker: "Evidence" },
];

const AGENT_CAN = [
  "Rank owner-approved obligations by priority and due date",
  "Fit an allocation inside the owner's per-payment and rolling caps",
  "Explain what it recommended, what it held back and why",
  "Point at the exact records that need a decision",
];

const AGENT_CANNOT = [
  "Approve an obligation on the owner's behalf",
  "Authorise, reserve or submit a payment",
  "Change the financial policy or the caps",
  "Edit a recipient, or mark a payment as confirmed",
];

export function Landing() {
  const { navigate } = useRoute();
  const { session, sessionStatus } = useWorkspace();
  const signedIn = session?.authenticated === true;

  return <div className="public">
    <header className="public-bar">
      <button type="button" className="public-brand" onClick={() => navigate("/")}>
        <Logo variant="full" />
      </button>
      <nav className="public-nav" aria-label="Public pages">
        <a href="#how-it-works">How it works</a>
        <a href="#financial-safety">Financial safety</a>
        <a href="#agent-boundary">What the agent does</a>
      </nav>
      <div className="public-actions">
        <Pill tone="warning">PayPal Sandbox</Pill>
        <button type="button" className="btn btn-secondary" onClick={() => navigate("/signin")}>{signedIn ? "Open workspace" : "Sign in"}</button>
        <button type="button" className="btn btn-primary" onClick={() => navigate(signedIn ? "/overview" : "/signin")}>
          {signedIn ? "Go to overview" : "Open the workspace"}
        </button>
      </div>
    </header>

    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow eyebrow-inverse">Payment operations for a small studio</p>
        <h1>The agent proposes.<br />You authorise.<br />The ledger proves it.</h1>
        <p className="hero-lead">
          Settle turns approved freelance work into reviewed, capped and independently verified payouts.
          It removes the Friday afternoon of matching invoices to payments — without ever taking the
          decision to move money away from the studio owner.
        </p>
        <div className="hero-actions">
          <button type="button" className="btn btn-citrus" onClick={() => navigate(signedIn ? "/overview" : "/signin")}>
            {signedIn ? "Open your workspace" : "Sign in to your workspace"}
          </button>
          <button type="button" className="btn btn-inverse" onClick={() => navigate("/overview")}>
            Explore the demonstration workspace
          </button>
        </div>
        <p className="hero-note">
          {sessionStatus === "loading"
            ? "Checking your session…"
            : signedIn
              ? "You are signed in. Opening the workspace keeps your session."
              : "The demonstration workspace is readable without an account. It holds synthetic records and cannot move money."}
        </p>
      </div>

      <aside className="hero-evidence" aria-label="The evidence chain Settle keeps for every payment">
        <p className="eyebrow eyebrow-inverse">Every payment carries six facts</p>
        <ol className="chain">
          {["Obligation", "Owner approval", "Submission", "Provider response", "Provider confirmation", "Independent reconciliation"].map((stage, index) => (
            <li key={stage} className={index === 0 ? "chain-step" : "chain-step"}>
              <span className="chain-index">{index + 1}</span>
              <span className="chain-label">{stage}</span>
              <span className="chain-state">{index === 0 ? "Recorded" : index === 3 ? "Acknowledged" : index === 5 ? "Re-read" : "Verified separately"}</span>
            </li>
          ))}
        </ol>
        <p className="hero-note">
          A stage is only shown as recorded when the ledger holds it. A missing fee is reported as unknown,
          never as zero.
        </p>
      </aside>
    </section>

    <section className="public-section" id="how-it-works">
      <header className="section-head">
        <p className="eyebrow">How Settle works</p>
        <h2>One journey, from obligation to verifiable receipt</h2>
        <p>Nothing in this list is a suggestion. Each step is a screen in the product and a record in the ledger.</p>
      </header>
      <ol className="journey">
        {JOURNEY.map((entry) => (
          <li key={entry.step} className="journey-step">
            <span className="journey-number">{entry.step}</span>
            <h3>{entry.title}</h3>
            <p>{entry.body}</p>
          </li>
        ))}
      </ol>
    </section>

    <section className="public-section" id="financial-safety">
      <header className="section-head">
        <p className="eyebrow">Financial safety</p>
        <h2>The limits are the product, not a setting</h2>
        <p>Three controls sit between an obligation and a payment. Each one belongs to the owner, and each one is visible.</p>
      </header>
      <div className="safety-grid">
        {SAFETY.map((entry) => (
          <article key={entry.title} className="safety-card">
            <p className="safety-marker">{entry.marker}</p>
            <h3>{entry.title}</h3>
            <p>{entry.body}</p>
          </article>
        ))}
      </div>
    </section>

    <section className="public-section public-section-split" id="agent-boundary">
      <div className="split-panel">
        <p className="eyebrow">The agent recommends</p>
        <h2>What Settle's agent will do</h2>
        <ul className="check-list">
          {AGENT_CAN.map((line) => <li key={line}><span className="check-mark" aria-hidden="true">✓</span>{line}</li>)}
        </ul>
      </div>
      <div className="split-panel split-panel-negative">
        <p className="eyebrow">The owner authorises</p>
        <h2>What it will never do</h2>
        <ul className="check-list">
          {AGENT_CANNOT.map((line) => <li key={line}><span className="check-mark" aria-hidden="true">×</span>{line}</li>)}
        </ul>
      </div>
    </section>

    <section className="public-section">
      <div className="disclosure">
        <div>
          <h2>Environment disclosure</h2>
          <p>
            Settle runs against <strong>PayPal Sandbox</strong>. Every amount in the product is test money and no
            real money moves. Provider evidence shown in a receipt is read from the sandbox provider and is
            labelled as such; records that are only historical references say so, and demonstration records are
            never counted as operational payments.
          </p>
        </div>
        <dl className="disclosure-facts">
          <div><dt>Provider</dt><dd>PayPal Sandbox</dd></div>
          <div><dt>Currency</dt><dd>USD</dd></div>
          <div><dt>Receipt evidence</dt><dd>Six stages, each marked recorded, missing or historical</dd></div>
          <div><dt>Investigation</dt><dd>Read-only. It cannot approve, pay or change a policy</dd></div>
        </dl>
      </div>
    </section>

    <footer className="public-foot">
      <p><strong>Settle</strong> — payment operations for a small studio. Sandbox only; test money only.</p>
      <p className="public-foot-links">
        <button type="button" className="link-button" onClick={() => navigate("/signin")}>Owner sign-in</button>
        <button type="button" className="link-button" onClick={() => navigate("/overview")}>Demonstration workspace</button>
        <button type="button" className="link-button" onClick={() => navigate("/legacy")}>Reference tools</button>
      </p>
    </footer>
  </div>;
}
