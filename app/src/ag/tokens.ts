// Settle design tokens — the single source of truth for colour, type, space,
// size, elevation, radius and motion.
//
// This module deliberately imports nothing: it holds no rendering-library code,
// so the product route can publish the tokens without pulling a chart, grid or
// studio library into its bundle. `theme.ts` adapts these same values to the
// AG APIs, and `applyDesignTokens` publishes them to CSS before React mounts.
//
// Rules:
// - Primitive values live here. Semantic and component aliases derive from them.
// - Change a shared colour in `primitives`, never in an individual screen.
// - Reuse an existing role before adding a primitive. Add a component alias only
//   when it expresses a real component-specific decision.
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
  elevation: { raised: "0 4px 16px rgba(36, 30, 43, 0.12)", soft: "0 1px 2px rgba(36, 30, 43, 0.06)" },
  scrim: "rgba(36, 30, 43, 0.45)",
  layer: { base: 0, sticky: 10, overlay: 100 },
  radius: { small: 6, medium: 12, large: 18 },
  motion: { fast: "120ms", normal: "180ms", easing: "ease-in-out" },
} as const;

// Semantic roles are shared by CSS and the AG adapters.
//
// The tertiary text role deliberately reuses the muted neutral rather than the
// strong one. The strong neutral (#8793a3) is a *border* colour: at the small
// sizes supporting text is read at, it only reaches about 2.9:1 against the
// page and fails WCAG AA. Supporting text uses the muted neutral (about
// 5.7:1) instead, and hierarchy is carried by size and weight, not by a
// colour that cannot be read.
export const semanticTokens = {
  surface: { page: primitives.neutral.page, card: primitives.neutral.white, elevated: primitives.neutral.white, sunken: primitives.neutral.sunken, hover: primitives.neutral.soft, inverse: primitives.brand.inkberry },
  text: { primary: primitives.brand.inkberry, secondary: primitives.neutral.muted, tertiary: primitives.neutral.muted, inverse: primitives.neutral.inverse },
  border: { default: primitives.neutral.border, strong: primitives.neutral.strong, inverse: primitives.brand.haze },
  action: { primary: primitives.brand.inkberry, hover: primitives.neutral.darkSoft, selected: primitives.brand.citrus },
  focus: primitives.brand.inkberry,
  status: primitives.status,
  chart: primitives.chart,
} as const;

// Component aliases only where several implementations share a meaningful role.
export const componentTokens = {
  button: { primary: semanticTokens.action.primary, primaryHover: semanticTokens.action.hover, primaryText: semanticTokens.text.inverse, height: primitives.size.control },
  input: { background: semanticTokens.surface.card, border: semanticTokens.border.strong, text: semanticTokens.text.primary, height: primitives.size.control },
  navigation: { selected: semanticTokens.action.selected, text: semanticTokens.text.primary, surface: semanticTokens.surface.inverse },
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
  set("font-compact-size", `${primitives.typography.compact}px`);
  set("heading-1-size", `${primitives.typography.heading1}px`);
  set("heading-2-size", `${primitives.typography.heading2}px`);
  set("heading-3-size", `${primitives.typography.heading3}px`);
  set("elevation-raised", primitives.elevation.raised);
  set("elevation-soft", primitives.elevation.soft);
  set("scrim", primitives.scrim);
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
  set("text-tertiary", semanticTokens.text.tertiary);
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
