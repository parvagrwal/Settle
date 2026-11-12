// Shared Settle primitives and adapters for CSS, AG Grid, AG Studio and AG Charts.
//
// The token values themselves live in `tokens.ts`, which imports nothing, so the
// product route can publish them without loading a rendering library. This file
// adapts those same values to the AG APIs: the grid, studio and chart themes
// below are derived from the identical roles the CSS uses.
//
// AG components use their supported theming APIs; CSS properties are published
// at startup by `applyDesignTokens`.
import { themeQuartz } from "ag-grid-community";
import { studioTheme } from "ag-studio";
import type { AgChartTheme } from "ag-charts-community";
import { primitives, settleTokens } from "./tokens.ts";

// The token source is re-exported here so `theme.ts` stays the one import path
// for the design system.
export { primitives, semanticTokens, componentTokens, settleTokens, applyDesignTokens } from "./tokens.ts";

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
  selectedRowBackgroundColor: primitives.neutral.sunken,
  oddRowBackgroundColor: primitives.neutral.white,
  chromeBackgroundColor: settleTokens.surfaceSoft,
  wrapperBorderRadius: settleTokens.radius,
  borderRadius: settleTokens.radiusSmall,
  iconButtonHoverBackgroundColor: settleTokens.accentSoft,
  sideButtonSelectedUnderlineColor: settleTokens.accent,
  statusBarLabelColor: settleTokens.muted,
  statusBarValueColor: settleTokens.ink,
  valueChangeValueHighlightBackgroundColor: primitives.neutral.sunken,
  focusShadow: { spread: 3, color: primitives.brand.inkberry },
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
  studioToggleButtonActiveColor: primitives.neutral.inverse,
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
  studioWidgetSubtitleFontSize: 12,
  studioWidgetSubtitleTextColor: settleTokens.muted,
  studioWidgetCaptionFontFamily: settleTokens.fontFamily,
  studioWidgetCaptionFontSize: 11,
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
