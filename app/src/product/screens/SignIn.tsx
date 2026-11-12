// Owner sign-in.
//
// The owner token is the one secret that guards every money-moving action. It
// is typed into this page, exchanged once for a server-side session, and the
// browser keeps only an HttpOnly cookie. The token itself is never stored in
// the browser, never sent to a screen and never written to the page.
import { useState } from "react";
import { Logo } from "../Logo.tsx";
import { Alert, Button, Field, Pill, TextInput } from "../ui.tsx";
import { useRoute } from "../router.ts";
import { useWorkspace } from "../WorkspaceProvider.tsx";
import { ProductRequestError } from "../client.ts";

export function SignIn() {
  const { navigate } = useRoute();
  const { signIn, session, sessionStatus } = useWorkspace();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"credentials" | "configuration" | "network" | null>(null);

  if (sessionStatus === "loading") {
    return <div className="public public-centred">
      <p className="loading-line" role="status">Checking your session…</p>
    </div>;
  }

  if (session?.authenticated === true) {
    return <div className="public public-centred">
      <div className="signin-card">
        <Logo variant="full" />
        <h1>You are signed in</h1>
        <p className="signin-lede">Signed in as <strong>{session.user?.displayName}</strong>. The workspace keeps your session until you sign out.</p>
        <Button variant="primary" onClick={() => navigate("/overview")}>Open the overview</Button>
      </div>
    </div>;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (token.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    setErrorKind(null);
    try {
      await signIn(token.trim());
      setToken("");
      navigate("/overview");
    } catch (cause) {
      if (cause instanceof ProductRequestError && cause.status === 401) {
        setError("That owner token was not accepted. Check it and try again.");
        setErrorKind("credentials");
      } else if (cause instanceof ProductRequestError && cause.status === 503) {
        setError("Owner sign-in is not configured on this server. The operator sets SETTLE_OWNER_TOKEN in the server environment; it is never sent to the browser.");
        setErrorKind("configuration");
      } else {
        setError("The server could not be reached. Check that it is running and try again.");
        setErrorKind("network");
      }
    } finally {
      setBusy(false);
    }
  };

  return <div className="public public-centred">
    <div className="signin-card">
      <Logo variant="full" />
      <p className="eyebrow">Owner sign-in</p>
      <h1>Open the operational workspace</h1>
      <p className="signin-lede">
        The operational workspace is the only place that can submit a PayPal payment. Sign in with the owner
        token; the browser keeps an HttpOnly session cookie and never sees a PayPal credential.
      </p>
      {session?.authenticated === false && session.workspaces.length > 0 && (
        <Alert tone="info" title="You can look before you sign in">
          The demonstration workspace is readable without an account. It holds synthetic records, cannot move
          money and is never counted as operational activity.
        </Alert>
      )}
      {error !== null && <Alert tone="danger" title={errorKind === "configuration" ? "Sign-in is not configured" : errorKind === "network" ? "The server is unreachable" : "Sign-in failed"}>{error}</Alert>}
      <form className="signin-form" onSubmit={submit}>
        <Field label="Owner token" hint="Configured on the server as SETTLE_OWNER_TOKEN. It is exchanged for a session and never stored in the browser.">
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Owner token"
            />
          )}
        </Field>
        <div className="signin-actions">
          <Button type="submit" variant="primary" busy={busy} busyLabel="Signing in…">Sign in</Button>
          <Button variant="ghost" onClick={() => navigate("/overview")}>View the demonstration instead</Button>
        </div>
      </form>
      <p className="signin-foot">
        <Pill tone="info">Session</Pill>
        Sessions last 12 hours, survive a server restart and end when you sign out.
      </p>
    </div>
  </div>;
}
