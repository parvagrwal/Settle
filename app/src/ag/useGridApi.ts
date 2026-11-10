// Grid API ownership.
//
// The API of an AG Grid instance stops being usable the moment that grid is
// destroyed. Holding it in a `useRef` that is set in `onGridReady` and never
// cleared is how the dashboard ended up calling `forEachNode()` and
// `applyTransaction()` on a destroyed grid after a tab switch.
//
// This hook keeps the API in React state instead: it is set when a grid is
// ready and set back to `null` in `onGridPreDestroyed`. Effects that need the
// API list it as a dependency, so they run when a grid exists and are cleaned
// up when it goes away; event handlers read `null` instead of a stale object.
import { useCallback, useState } from "react";
import type { GridApi, GridPreDestroyedEvent, GridReadyEvent } from "ag-grid-community";

export interface GridApiHandle<TData> {
  /** The live API, or `null` when no grid is mounted. */
  api: GridApi<TData> | null;
  onGridReady: (event: GridReadyEvent<TData>) => void;
  onGridPreDestroyed: (event: GridPreDestroyedEvent<TData>) => void;
}

export function useGridApi<TData>(): GridApiHandle<TData> {
  const [api, setApi] = useState<GridApi<TData> | null>(null);
  const onGridReady = useCallback((event: GridReadyEvent<TData>) => setApi(event.api), []);
  // Compare before clearing: in Strict Mode a first grid can be destroyed after a second one is already ready.
  const onGridPreDestroyed = useCallback((event: GridPreDestroyedEvent<TData>) => setApi((current) => (current === event.api ? null : current)), []);
  return { api, onGridReady, onGridPreDestroyed };
}
