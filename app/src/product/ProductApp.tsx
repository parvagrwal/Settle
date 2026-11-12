// The product entry point.
//
// One route table, one shell, one data context. The public landing and the
// sign-in page stand outside the shell; the four workspace destinations share
// it. The historical reference tools are lazy-loaded, so the grid, chart and
// studio libraries never reach the product route's bundle.
import { Suspense, lazy, useState, type ReactNode } from "react";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceProvider.tsx";
import { useRoute } from "./router.ts";
import { ensureAgModules } from "../ag/setup.ts";
import { Shell } from "./Shell.tsx";
import { Alert, Button, Card, EmptyState, Field, TextInput, useTask } from "./ui.tsx";
import { Landing } from "./screens/Landing.tsx";
import { SignIn } from "./screens/SignIn.tsx";
import { Overview } from "./screens/Overview.tsx";
import { Jobs } from "./screens/Jobs.tsx";
import { Payments } from "./screens/Payments.tsx";
import { Controls } from "./screens/Controls.tsx";
import { client } from "./client.ts";

// The reference tools create grids, charts and Studio instances, so the AG
// modules are registered before the lazy bundle resolves — otherwise the
// legacy route would render with no modules registered. The product route
// itself never loads these libraries.
const LegacyApp = lazy(() => ensureAgModules().then(() => import("../LegacyApp.tsx")));

function WorkspaceGate({ children }: { children: ReactNode }) {
  const { session, sessionStatus, workspace, refresh } = useWorkspace();
  const task = useTask();
  const [name, setName] = useState("");

  if (sessionStatus === "loading") return <p className="loading-line" role="status">Reading your session…</p>;

  // A signed-in owner without an operational workspace needs one before the
  // product can hold real obligations. The demonstration workspace is still
  // available, and says so.
  if (session?.authenticated === true && session.workspaces.some((entry) => entry.kind === "operational") === false) {
    return <div className="gate">
      <Card>
        <h2>Create your studio workspace</h2>
        <p className="panel-note">
          An operational workspace holds real obligations and is the only place a payment can be submitted.
          The demonstration workspace below is synthetic and cannot move money.
        </p>
        {task.error !== null && <Alert tone="danger" title="The workspace could not be created">{task.error}</Alert>}
        <form onSubmit={(event) => { event.preventDefault(); void task.run("create-workspace", async () => { await client.createWorkspace(name.trim()); await refresh(); return "Workspace created."; }); }}>
          <Field label="Studio name" hint="Two to one hundred characters.">
            {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} value={name} onChange={(event) => setName(event.target.value)} placeholder="Northlight Studio" />}
          </Field>
          <Button type="submit" variant="primary" busy={task.busy === "create-workspace"} busyLabel="Creating…">Create workspace</Button>
        </form>
      </Card>
      <Card>
        <h2>Demonstration workspace</h2>
        <p className="panel-note">
          Synthetic obligations, no provider calls and no operational ledger activity. Read-only without an
          owner session.
        </p>
        <Button onClick={() => { window.location.assign("/overview"); }}>Open the demonstration</Button>
      </Card>
    </div>;
  }

  if (session?.authenticated !== true && workspace === null) {
    return <Card>
      <EmptyState title="Sign in to open the workspace" action={<Button variant="primary" onClick={() => { window.location.assign("/signin"); }}>Go to sign in</Button>}>
        The operational workspace needs the owner token. The demonstration workspace is readable without one.
      </EmptyState>
    </Card>;
  }

  return <>{children}</>;
}

function NotFound() {
  const { navigate } = useRoute();
  return <div className="public public-centred">
    <div className="signin-card">
      <h1>That page does not exist</h1>
      <p className="signin-lede">The workspace has four destinations: overview, jobs and decisions, payments and receipts, and controls and audit.</p>
      <Button variant="primary" onClick={() => navigate("/overview")}>Go to the overview</Button>
    </div>
  </div>;
}

function Routes() {
  const { path } = useRoute();

  if (path === "/") return <Landing />;
  if (path === "/signin") return <SignIn />;
  if (path.startsWith("/legacy")) {
    return <Suspense fallback={<p className="loading-line" role="status">Loading the reference tools…</p>}>
      <LegacyApp />
    </Suspense>;
  }
  if (path === "/overview") return <Shell title="Overview" subtitle="Your payment operations, with every decision and provider fact visible."><WorkspaceGate><Overview /></WorkspaceGate></Shell>;
  if (path === "/jobs") return <Shell title="Jobs & decisions" subtitle="The agent proposes. You decide. The ledger enforces."><WorkspaceGate><Jobs /></WorkspaceGate></Shell>;
  if (path === "/payments" || path.startsWith("/payments/")) return <Shell title="Payments & receipts" subtitle="Six lifecycle stages, three evidence domains, and nothing collapsed into one badge."><WorkspaceGate><Payments /></WorkspaceGate></Shell>;
  if (path === "/controls") return <Shell title="Controls & audit" subtitle="Policy, the emergency stop, provider freshness and the immutable history."><WorkspaceGate><Controls /></WorkspaceGate></Shell>;
  return <NotFound />;
}

export default function ProductApp() {
  return <WorkspaceProvider><Routes /></WorkspaceProvider>;
}
