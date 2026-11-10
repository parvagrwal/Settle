// One visual language for the page, AG Grid, AG Studio and AG Charts.
//
// The tokens below are the product's existing palette and typography (the same
// values the stylesheets already use). Everything AG renders is themed from
// them through the supported Theming API, and the same tokens are published as
// CSS custom properties, so a component stylesheet and an AG theme cannot
// drift apart. No AG-internal class is overridden to achieve this.
import { themeQuartz } from "ag-grid-community";
import { studioTheme } from "ag-studio";
import type { AgChartTheme } from "ag-charts-community";

export const settleTokens = {
  fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
  fontSize: 14,
  ink: "#102e2a",
  muted: "#60736f",
  border: "#dce5e2",
  borderStrong: "#b7c9c4",
  surface: "#ffffff",
  surfaceSoft: "#f4f8f6",
  surfaceSunken: "#e9f1ee",
  accent: "#0b6c59",
  accentBright: "#0b8c71",
  accentSoft: "#e3f3ee",
  radius: 12,
  radiusSmall: 6,
  spacing: 7,
  rowHeight: 42,
  headerHeight: 44,
  status: {
    success: { fg: "#096044", bg: "#dff5e9" },
    warning: { fg: "#74520b", bg: "#fff0c7" },
    danger: { fg: "#972b2b", bg: "#fde5e5" },
    info: { fg: "#0b3d91", bg: "#e3f2fd" },
    neutral: { fg: "#3d514d", bg: "#e9efed" },
  },
  /** Series colours, ordered so the first four read as settled / in flight / at risk / informational. */
  chartPalette: ["#0b6c59", "#d69c25", "#b23a3a", "#2f6fb2", "#5fb8a3", "#7a5ea8", "#8a9a96", "#e07b53"],
} as const;

export const settleGridParams = {
  fontFamily: settleTokens.fontFamily,
  fontSize: settleTokens.fontSize,
  accentColor: settleTokens.accent,
  backgroundColor: settleTokens.surface,
  foregroundColor: settleTokens.ink,
  textColor: settleTokens.ink,
  subtleTextColor: settleTokens.muted,
  borderColor: settleTokens.border,
  headerBackgroundColor: settleTokens.surfaceSoft,
  headerTextColor: settleTokens.ink,
  headerFontWeight: 700,
  headerFontSize: 13,
  headerHeight: settleTokens.headerHeight,
  rowHeight: settleTokens.rowHeight,
  spacing: settleTokens.spacing,
  rowHoverColor: settleTokens.accentSoft,
  selectedRowBackgroundColor: "#d5ece5",
  oddRowBackgroundColor: "#fbfdfc",
  chromeBackgroundColor: settleTokens.surfaceSoft,
  wrapperBorderRadius: settleTokens.radius,
  borderRadius: settleTokens.radiusSmall,
  iconButtonHoverBackgroundColor: settleTokens.accentSoft,
  sideButtonSelectedUnderlineColor: settleTokens.accent,
  statusBarLabelColor: settleTokens.muted,
  statusBarValueColor: settleTokens.ink,
  valueChangeValueHighlightBackgroundColor: "#c9ebe0",
  focusShadow: { spread: 3, color: "#0b6c5959" },
} as const;

/** The single grid theme. Passed to every `AgGridReact` through the `theme` grid option. */
export const settleGridTheme = themeQuartz.withParams(settleGridParams);

const palette = settleTokens.chartPalette;
const darken = (hex: string): string => `#${[1, 3, 5].map((index) => Math.round(parseInt(hex.slice(index, index + 2), 16) * 0.78).toString(16).padStart(2, "0")).join("")}`;

export const settleStudioParams = {
  fontFamily: settleTokens.fontFamily,
  fontSize: settleTokens.fontSize,
  accentColor: settleTokens.accent,
  backgroundColor: settleTokens.surface,
  foregroundColor: settleTokens.ink,
  textColor: settleTokens.ink,
  subtleTextColor: settleTokens.muted,
  borderColor: settleTokens.border,
  borderRadius: settleTokens.radiusSmall,
  spacing: settleTokens.spacing,
  rowHoverColor: settleTokens.accentSoft,
  // Studio chrome
  studioWrapperBackgroundColor: settleTokens.surfaceSoft,
  studioWrapperBorder: { width: 1, color: settleTokens.border },
  studioWrapperBorderRadius: settleTokens.radius,
  studioPanelContainerBackgroundColor: settleTokens.surface,
  studioPanelContainerBorder: { width: 1, color: settleTokens.border },
  studioPanelContainerBorderRadius: settleTokens.radius,
  studioToggleButtonActiveBackgroundColor: settleTokens.accent,
  studioToggleButtonActiveBorderColor: settleTokens.accent,
  studioToggleButtonActiveColor: settleTokens.accent,
  // Canvas and widgets
  studioCanvasBackgroundColor: settleTokens.surfaceSoft,
  studioCanvasFontFamily: settleTokens.fontFamily,
  studioWidgetBackgroundColor: settleTokens.surface,
  studioWidgetBorder: { width: 1, color: settleTokens.border },
  studioWidgetBorderRadius: settleTokens.radius,
  studioWidgetPadding: 6,
  studioWidgetTitleFontFamily: settleTokens.fontFamily,
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: settleTokens.ink,
  studioWidgetSubtitleFontFamily: settleTokens.fontFamily,
  studioWidgetSubtitleTextColor: settleTokens.muted,
  studioWidgetCaptionFontFamily: settleTokens.fontFamily,
  studioWidgetCaptionTextColor: settleTokens.muted,
  studioValueWidgetFontSize: 30,
  studioAiPanelWidth: 380,
  studioAiPanelInputMessageBackgroundColor: settleTokens.accentSoft,
  // Grid widgets inside Studio use the same density and lines as the application grid
  gridRowHeight: settleTokens.rowHeight,
  gridRowBorder: { width: 1, color: settleTokens.border },
  gridHeaderRowBorder: { width: 1, color: settleTokens.borderStrong },
  // Chart widgets
  chartFontFamily: settleTokens.fontFamily,
  chartFontSize: 12,
  chartTextColor: settleTokens.ink,
  chartSubtleTextColor: settleTokens.muted,
  chartAxisLineColor: settleTokens.borderStrong,
  chartGridLineColor: settleTokens.border,
  chartPaletteFills1Color: palette[0],
  chartPaletteFills2Color: palette[1],
  chartPaletteFills3Color: palette[2],
  chartPaletteFills4Color: palette[3],
  chartPaletteFills5Color: palette[4],
  chartPaletteFills6Color: palette[5],
  chartPaletteFills7Color: palette[6],
  chartPaletteFills8Color: palette[7],
  chartPaletteStrokes1Color: darken(palette[0]),
  chartPaletteStrokes2Color: darken(palette[1]),
  chartPaletteStrokes3Color: darken(palette[2]),
  chartPaletteStrokes4Color: darken(palette[3]),
  chartPaletteStrokes5Color: darken(palette[4]),
  chartPaletteStrokes6Color: darken(palette[5]),
  chartPaletteStrokes7Color: darken(palette[6]),
  chartPaletteStrokes8Color: darken(palette[7]),
} as const;

/** The single Studio theme: Studio's own default theme (icons, inputs, tabs) with the Settle parameters. */
export const settleStudioTheme = studioTheme.withParams(settleStudioParams);

/** Theme for AG Charts used outside Studio. */
export const settleChartTheme: AgChartTheme = {
  baseTheme: "ag-default",
  palette: { fills: [...palette], strokes: palette.map(darken) },
  params: {
    fontFamily: settleTokens.fontFamily,
    fontSize: 12,
    accentColor: settleTokens.accent,
    textColor: settleTokens.ink,
    subtleTextColor: settleTokens.muted,
    borderColor: settleTokens.border,
    axisLineColor: settleTokens.borderStrong,
    gridLineColor: settleTokens.border,
    backgroundColor: settleTokens.surface,
  },
};

/** Publish the tokens as CSS custom properties. Called once at start-up on the document root. */
export function applyDesignTokens(element: HTMLElement = document.documentElement): void {
  const set = (name: string, value: string) => element.style.setProperty(`--settle-${name}`, value);
  set("font", settleTokens.fontFamily);
  set("font-size", `${settleTokens.fontSize}px`);
  set("ink", settleTokens.ink);
  set("muted", settleTokens.muted);
  set("border", settleTokens.border);
  set("border-strong", settleTokens.borderStrong);
  set("surface", settleTokens.surface);
  set("surface-soft", settleTokens.surfaceSoft);
  set("surface-sunken", settleTokens.surfaceSunken);
  set("accent", settleTokens.accent);
  set("accent-bright", settleTokens.accentBright);
  set("accent-soft", settleTokens.accentSoft);
  set("radius", `${settleTokens.radius}px`);
  set("radius-small", `${settleTokens.radiusSmall}px`);
  set("row-height", `${settleTokens.rowHeight}px`);
  for (const [name, tone] of Object.entries(settleTokens.status)) {
    set(`${name}-fg`, tone.fg);
    set(`${name}-bg`, tone.bg);
  }
}
