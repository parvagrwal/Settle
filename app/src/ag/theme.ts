// Shared Settle primitives and adapters for CSS, AG Grid, AG Studio and AG Charts.
// AG components use their supported theming APIs; CSS properties are published at startup.
import { themeQuartz } from "ag-grid-community";
import { studioTheme } from "ag-studio";
import type { AgChartTheme } from "ag-charts-community";

// Primitive values live here. Semantic and component aliases below derive from them;
// applyDesignTokens publishes those same values for CSS before React mounts.
const brand = { inkberry: "#241e2b", haze: "#b5c0cf", citrus: "#d9e95b" } as const;
export const primitives = {
  brand,
  neutral: { white: "#ffffff", page: "#f5f6f8", soft: "#eef0f4", sunken: "#e4e7ed", border: "#d1d6df", strong: "#8793a3", muted: "#566273", inverse: "#f8f9fb", darkSoft: "#393341" },
  status: {
    success: { fg: "#096044", bg: "#dff5e9" },
    warning: { fg: "#74520b", bg: "#fff0c7" },
    danger: { fg: "#972b2b", bg: "#fde5e5" },
    info: { fg: "#0b3d91", bg: "#e3f2fd" },
    neutral: { fg: "#414d5c", bg: "#e9edf2" },
  },
  chart: [brand.inkberry, "#a66d00", "#b23a3a", "#2f6fb2", "#6a7686", "#725b86", "#487e70", "#a75e3f"],
  typography: { family: 'system-ui, "Segoe UI", Roboto, sans-serif', body: 16, compact: 14, heading1: 28, heading2: 22, heading3: 18, regular: 400, strong: 700 },
  spacing: [0, 4, 8, 12, 16, 24, 32, 48],
  size: { control: 44, gridRow: 42, gridHeader: 44 },
  borderWidth: { thin: 1, strong: 2, focus: 3 },
  elevation: { raised: "0 4px 16px rgba(36, 30, 43, 0.12)" },
  layer: { base: 0, sticky: 10, overlay: 100 },
  radius: { small: 6, medium: 12, large: 18 },
  motion: { fast: "120ms", normal: "180ms", easing: "ease-in-out" },
} as const;

// Semantic roles are shared by CSS and the AG adapters below.
export const semanticTokens = {
  surface: { page: primitives.neutral.page, card: primitives.neutral.white, elevated: primitives.neutral.white, sunken: primitives.neutral.sunken, hover: primitives.neutral.soft },
  text: { primary: primitives.brand.inkberry, secondary: primitives.neutral.muted, inverse: primitives.neutral.inverse },
  border: { default: primitives.neutral.border, strong: primitives.neutral.strong },
  action: { primary: primitives.brand.inkberry, hover: primitives.neutral.darkSoft, selected: primitives.brand.citrus },
  focus: primitives.brand.inkberry,
  status: primitives.status,
  chart: primitives.chart,
} as const;

// Component aliases only where several implementations share a meaningful role.
export const componentTokens = {
  button: { primary: semanticTokens.action.primary, primaryHover: semanticTokens.action.hover, primaryText: semanticTokens.text.inverse, height: primitives.size.control },
  input: { background: semanticTokens.surface.card, border: semanticTokens.border.strong, text: semanticTokens.text.primary, height: primitives.size.control },
  navigation: { selected: semanticTokens.action.selected, text: semanticTokens.text.primary },
  card: { background: semanticTokens.surface.card, border: semanticTokens.border.default, radius: primitives.radius.medium },
  table: { header: semanticTokens.surface.page, hover: semanticTokens.surface.hover, rowHeight: primitives.size.gridRow },
  badge: semanticTokens.status,
  overlay: { background: semanticTokens.surface.elevated, border: semanticTokens.border.default },
  metric: { text: semanticTokens.text.primary, label: semanticTokens.text.secondary },
  alert: semanticTokens.status,
  chart: semanticTokens.chart,
} as const;

export const settleTokens = {
  fontFamily: primitives.typography.family,
  fontSize: primitives.typography.compact,
  ink: semanticTokens.text.primary,
  muted: semanticTokens.text.secondary,
  border: semanticTokens.border.default,
  borderStrong: semanticTokens.border.strong,
  surface: semanticTokens.surface.card,
  surfaceSoft: semanticTokens.surface.page,
  surfaceSunken: semanticTokens.surface.sunken,
  accent: semanticTokens.action.primary,
  accentBright: semanticTokens.action.primary,
  accentSoft: semanticTokens.surface.hover,
  radius: primitives.radius.medium,
  radiusSmall: primitives.radius.small,
  spacing: 7,
  rowHeight: componentTokens.table.rowHeight,
  headerHeight: primitives.size.gridHeader,
  status: semanticTokens.status,
  chartPalette: semanticTokens.chart,
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
  set("component-button-primary", componentTokens.button.primary);
  set("component-button-primary-hover", componentTokens.button.primaryHover);
  set("component-button-primary-text", componentTokens.button.primaryText);
  set("component-control-height", `${componentTokens.input.height}px`);
  set("component-card-background", componentTokens.card.background);
  set("component-card-border", componentTokens.card.border);
  set("component-navigation-selected", componentTokens.navigation.selected);
  set("focus", semanticTokens.focus);
  set("font-body-size", `${primitives.typography.body}px`);
  set("heading-1-size", `${primitives.typography.heading1}px`);
  set("heading-2-size", `${primitives.typography.heading2}px`);
  set("heading-3-size", `${primitives.typography.heading3}px`);
  set("elevation-raised", primitives.elevation.raised);
  set("layer-sticky", String(primitives.layer.sticky));
  set("layer-overlay", String(primitives.layer.overlay));
  set("brand-inkberry", primitives.brand.inkberry);
  set("brand-haze", primitives.brand.haze);
  set("brand-citrus", primitives.brand.citrus);
  set("page", primitives.neutral.page);
  set("inverse", primitives.neutral.inverse);
  set("dark-soft", primitives.neutral.darkSoft);
  set("motion-fast", primitives.motion.fast);
  set("motion-normal", primitives.motion.normal);
  set("motion-easing", primitives.motion.easing);
  primitives.spacing.forEach((value, index) => set(`space-${index}`, `${value}px`));
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
