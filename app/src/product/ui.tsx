// The product's interface primitives.
//
// Every screen is built from these. They carry the shared tokens, the shared
// state vocabulary and the shared behaviour rules:
//
// - Status is always a word. Colour never carries meaning on its own.
// - A missing value reads as missing. It is never rendered as zero.
// - Every control has an accessible name, a visible focus ring and a disabled
//   state that still says what the control is.
import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { describeError } from "./client.ts";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "selected";

export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`pill pill-${tone}`} title={title}>{children}</span>;
}

export function Card({ children, className = "", as: Tag = "section", labelledBy }: { children: ReactNode; className?: string; as?: "section" | "div" | "article"; labelledBy?: string }) {
  return <Tag className={`card ${className}`.trim()} aria-labelledby={labelledBy}>{children}</Tag>;
}

export function CardHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <header className="card-head">
    <div className="card-head-text">
      {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {description !== undefined && <p className="card-description">{description}</p>}
    </div>
    {actions !== undefined && <div className="card-head-actions">{actions}</div>}
  </header>;
}

export function Metric({ label, value, note, tone = "neutral" }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone }) {
  return <div className={`metric metric-${tone}`}>
    <p className="metric-label">{label}</p>
    <p className="metric-value">{value}</p>
    {note !== undefined && <p className="metric-note">{note}</p>}
  </div>;
}

export function Alert({ tone = "info", title, children, actions }: { tone?: Tone; title?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return <div className={`alert alert-${tone}`} role={tone === "danger" ? "alert" : "status"}>
    <div className="alert-body">
      {title !== undefined && <strong className="alert-title">{title}</strong>}
      {children !== undefined && <div className="alert-text">{children}</div>}
    </div>
    {actions !== undefined && <div className="alert-actions">{actions}</div>}
  </div>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty">
    <p className="empty-title">{title}</p>
    {children !== undefined && <p className="empty-text">{children}</p>}
    {action !== undefined && <div className="empty-action">{action}</div>}
  </div>;
}

export function Skeleton({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return <div className="skeleton" role="status" aria-live="polite">
    <span className="visually-hidden">{label}</span>
    {Array.from({ length: rows }, (_, index) => <span className="skeleton-row" key={index} aria-hidden="true" />)}
  </div>;
}

export function Button({ variant = "secondary", busy = false, busyLabel, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean; busyLabel?: string }) {
  return <button
    type="button"
    {...rest}
    className={`btn btn-${variant} ${rest.className ?? ""}`.trim()}
    disabled={rest.disabled === true || busy}
    aria-busy={busy || undefined}
  >
    {busy ? (busyLabel ?? children) : children}
  </button>;
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string | null; children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode; id?: string }) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [hint !== undefined ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return <div className="field">
    <label className="field-label" htmlFor={fieldId}>{label}</label>
    {hint !== undefined && <p className="field-hint" id={hintId}>{hint}</p>}
    {children({ id: fieldId, describedBy, invalid: error !== undefined && error !== null })}
    {error ? <p className="field-error" id={errorId}>{error}</p> : null}
  </div>;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, className, ...rest } = props;
  return <input {...rest} className={`input ${invalid ? "input-invalid" : ""} ${className ?? ""}`.trim()} aria-invalid={invalid || undefined} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={`input select ${className ?? ""}`.trim()} />;
}

/** A labelled value row, used in every fact list. */
export function Fact({ label, value, absent = "Not recorded", mono = false }: { label: string; value: string | number | null | undefined; absent?: string; mono?: boolean }) {
  const present = value !== null && value !== undefined && value !== "";
  return <div className="fact">
    <dt>{label}</dt>
    <dd className={present ? (mono ? "mono" : "") : "absent"}>{present ? value : absent}</dd>
  </div>;
}

/** A modal dialog. Escape closes it, focus is trapped, and it restores focus. */
export function Dialog({ open, title, description, onClose, children, footer }: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const focusable = node?.querySelector<HTMLElement>("input, select, textarea, button, [href]");
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab" || node === null) return;
      const items = [...node.querySelectorAll<HTMLElement>("input, select, textarea, button, [href]")].filter((item) => !item.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      {description !== undefined && <div className="dialog-description">{description}</div>}
      <div className="dialog-body">{children}</div>
      {footer !== undefined && <div className="dialog-foot">{footer}</div>}
    </div>
  </div>;
}

/** A side panel. Escape closes it; the page behind it is inert to the pointer. */
export function Drawer({ open, title, description, onClose, children, footer }: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="overlay overlay-drawer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="drawer-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description !== undefined && <p className="drawer-description">{description}</p>}
        </div>
        <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="drawer-body">{children}</div>
      {footer !== undefined && <div className="drawer-foot">{footer}</div>}
    </aside>
  </div>;
}

/**
 * One place to run an action: it owns the busy flag, the error and the success
 * message, so no screen has to invent its own feedback vocabulary.
 */
export function useTask() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async (label: string, action: () => Promise<string | void>): Promise<boolean> => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (typeof message === "string" && message !== "") setNotice(message);
      return true;
    } catch (cause) {
      setError(describeError(cause, "The action could not be completed."));
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  const dismiss = useCallback(() => { setError(null); setNotice(null); }, []);

  return { busy, error, notice, run, dismiss, setError, setNotice };
}
