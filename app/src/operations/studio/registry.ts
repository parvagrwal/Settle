// Studio registry for the operations workspace: the default widgets plus the
// Settle capacity widget. Typing the registry lets the report state, the widget
// definition and the component agree on the widget's `format` at compile time.
import type { AgDefaultRegistry, AgWidgetData, AgWidgetDataFormat } from "ag-studio";
import type { AgRegistry, AgWidgetDefinition } from "ag-studio-react";

export const CAPACITY_WIDGET_TYPE = "settle-capacity";

export interface CapacityWidgetStyle {
  /** Open the "How this is calculated" section when the widget first renders. */
  showCalculation?: boolean;
  /** Count demonstration records in the exception tiles. Money totals never include them. */
  includeDemonstration?: boolean;
}

export interface CapacityWidgetState extends AgWidgetData<Record<never, never>, AgWidgetDataFormat<CapacityWidgetStyle>> {
  type: typeof CAPACITY_WIDGET_TYPE;
}

export type CapacityWidgetDefinition = AgWidgetDefinition<typeof CAPACITY_WIDGET_TYPE, CapacityWidgetState>;

export interface SettleRegistry extends AgRegistry {
  widgets: readonly (AgDefaultRegistry["widgets"][number] | CapacityWidgetDefinition)[];
}
