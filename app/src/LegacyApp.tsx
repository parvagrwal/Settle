// The historical reference tools.
//
// Everything that is not part of the product's primary navigation lives here:
// the AG Grid transaction view, the AG Studio analytics, the allocation
// comparison and the legacy payout workflow. They stay in the repository
// because they still work and because they document how the product came to
// be — but they are loaded on demand, so their libraries never reach the
// product route's bundle.
import "./transaction.css";
import "./allocation.css";
import "./operations/operations.css";
import { SettleStudioProvider } from "./ag/StudioProvider.tsx";
import App from "./App.tsx";

export default function LegacyApp() {
  return <SettleStudioProvider><App /></SettleStudioProvider>;
}
