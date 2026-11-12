// The workspace shell: navigation, identity and the environment banner.
//
// The navigation is the product's information architecture. Four destinations,
// in the order the work happens:
//
//   Overview → Jobs & decisions → Payments & receipts → Controls & audit
//
// The environment banner is always visible. Settle runs against PayPal Sandbox,
// and a reader must never have to guess whether a figure is real money.
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "./Logo.tsx";
import { Pill } from "./ui.tsx";
import { useRoute } from "./router.ts";
import { useWorkspace } from "./WorkspaceProvider.tsx";

export interface NavItem {
  path: string;
  label: string;
  hint: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/overview", label: "Overview", hint: "What needs attention" },
  { path: "/jobs", label: "Jobs & decisions", hint: "Obligations and approvals" },
  { path: "/payments", label: "Payments & receipts", hint: "Evidence and outcomes" },
  { path: "/controls", label: "Controls & audit", hint: "Policy, safety and history" },
];

function NavList({ current, onNavigate }: { current: string; onNavigate: (path: string) => void }) {
  return <ul className="nav-list">
    {NAV_ITEMS.map((item) => {
      const active = current === item.path || current.startsWith(`${item.path}/`);
      return <li key={item.path}>
        <button
          type="button"
          className="nav-item"
          aria-current={active ? "page" : undefined}
          onClick={() => onNavigate(item.path)}
        >
          <span className="nav-dot" aria-hidden="true" />
          <span className="nav-text">
            <span className="nav-label">{item.label}</span>
            <span className="nav-hint">{item.hint}</span>
          </span>
        </button>
      </li>;
    })}
  </ul>;
}

export function Shell({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const { path, navigate } = useRoute();
  const { session, workspace, selectWorkspace, signOut, checkedAt } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { setMenuOpen(false); }, [path]);

  const go = (target: string) => { navigate(target); setMenuOpen(false); };
  const displayName = session?.user?.displayName ?? "Workspace owner";
  const workspaces = session?.workspaces ?? [];

  return <div className="shell">
    <a className="skip-link" href="#main">Skip to content</a>

    <aside className="sidebar">
      <button type="button" className="sidebar-brand" onClick={() => go("/overview")}>
        <Logo variant="compact" inverse />
      </button>
      <p className="sidebar-eyebrow">Studio workspace</p>
      <nav aria-label="Workspace navigation">
        <NavList current={path} onNavigate={go} />
      </nav>
      <div className="sidebar-foot">
        <p className="sidebar-foot-label">Provider</p>
        <p className="sidebar-foot-value">
          <Pill tone="warning">PayPal Sandbox</Pill>
        </p>
        <p className="sidebar-foot-note">Test money only. No real money moves.</p>
        <button type="button" className="sidebar-link" onClick={() => go("/legacy")}>Operations grid and analytics (AG Grid, AG Studio)</button>
      </div>
    </aside>

    <div className="shell-main">
      <header className="workspace-bar">
        <button type="button" className="menu-toggle" aria-expanded={menuOpen} aria-controls="mobile-nav" onClick={() => setMenuOpen((open) => !open)}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="5" x2="17" y2="5" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="3" y1="15" x2="17" y2="15" /></svg>
          <span className="visually-hidden">{menuOpen ? "Close navigation" : "Open navigation"}</span>
        </button>
        <div className="workspace-identity">
          <h1>{title}</h1>
          {subtitle !== undefined && <p className="workspace-subtitle">{subtitle}</p>}
        </div>
        <div className="workspace-actions">
          {workspaces.length > 1 && (
            <label className="workspace-switch">
              <span className="visually-hidden">Workspace</span>
              <select value={workspace?.workspaceId ?? ""} onChange={(event) => selectWorkspace(event.target.value)}>
                {workspaces.map((entry) => <option key={entry.workspaceId} value={entry.workspaceId}>{entry.name}</option>)}
              </select>
            </label>
          )}
          <Pill tone="warning" title="Settle runs against PayPal Sandbox">Sandbox only</Pill>
          {session?.authenticated === true && (
            <div className="workspace-owner">
              <span className="owner-name">{displayName}</span>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => { void signOut(); }}>Sign out</button>
            </div>
          )}
        </div>
      </header>

      {menuOpen && (
        <div className="mobile-nav" id="mobile-nav">
          <nav aria-label="Workspace navigation">
            <NavList current={path} onNavigate={go} />
          </nav>
          <button type="button" className="sidebar-link" onClick={() => go("/legacy")}>Operations grid and analytics (AG Grid, AG Studio)</button>
        </div>
      )}

      <main className="workspace-content" id="main">
        {checkedAt !== null && <p className="content-stamp">Workspace read at {new Date(checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC.</p>}
        {actions !== undefined && <div className="content-actions">{actions}</div>}
        {children}
      </main>
    </div>
  </div>;
}
