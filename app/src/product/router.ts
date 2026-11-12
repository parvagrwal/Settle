// A small path router.
//
// The server serves `index.html` for every extension-less path, so the browser
// can own the route without a server rewrite. Navigation is history-based, so a
// screen can be linked to and reloaded.
import { useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();
let current = typeof window === "undefined" ? "/" : window.location.pathname;

function emit(): void {
  for (const listener of [...listeners]) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    current = window.location.pathname;
    emit();
  });
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  if (options.replace) window.history.replaceState({}, "", to);
  else window.history.pushState({}, "", to);
  current = to;
  emit();
}

export function useRoute(): { path: string; navigate: (to: string, options?: { replace?: boolean }) => void } {
  const path = useSyncExternalStore(subscribe, () => current, () => current);
  return { path, navigate };
}

/** Split a path into its parts, ignoring empty ones. */
export function segments(path: string): string[] {
  return path.split("/").filter((part) => part !== "");
}
