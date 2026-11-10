// Supplies the AG Studio licence key to every Studio instance in the app, using
// the vendor's documented React entry point. With no key configured Studio runs
// in its evaluation mode. Studio modules (the AI module) are registered per
// instance, by the one workspace that uses them, so the other Studio views keep
// the lower licence requirement.
import type { ReactNode } from "react";
import { AgStudioProvider } from "ag-studio-react";
import { licenceKeys } from "./setup.ts";

export function SettleStudioProvider({ children }: { children: ReactNode }) {
  return <AgStudioProvider licenseKey={licenceKeys.studio ?? undefined}>{children}</AgStudioProvider>;
}
