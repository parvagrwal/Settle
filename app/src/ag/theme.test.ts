// One visual language: the grid theme, the Studio theme, the chart theme and
// the page's CSS variables are all derived from the same tokens.
import { describe, expect, it } from "vitest";
import { applyDesignTokens, componentTokens, primitives, semanticTokens, settleChartTheme, settleGridParams, settleGridTheme, settleStudioParams, settleStudioTheme, settleTokens } from "./theme.ts";

describe("Settle AG theme", () => {
  it("derives the grid theme from the product tokens", () => {
    expect(settleGridParams.fontFamily).toBe(settleTokens.fontFamily);
    expect(settleGridParams.accentColor).toBe(settleTokens.accent);
    expect(settleGridParams.foregroundColor).toBe(settleTokens.ink);
    expect(settleGridParams.borderColor).toBe(settleTokens.border);
    expect(settleGridParams.headerBackgroundColor).toBe(settleTokens.surfaceSoft);
    expect(settleGridParams.rowHeight).toBe(settleTokens.rowHeight);
    expect(typeof settleGridTheme.withParams).toBe("function");
  });

  it("gives Studio the same typography, colours, borders and density, including its grid and chart widgets", () => {
    expect(settleStudioParams.fontFamily).toBe(settleTokens.fontFamily);
    expect(settleStudioParams.accentColor).toBe(settleTokens.accent);
    expect(settleStudioParams.textColor).toBe(settleTokens.ink);
    expect(settleStudioParams.borderColor).toBe(settleTokens.border);
    expect(settleStudioParams.studioCanvasBackgroundColor).toBe(settleTokens.surfaceSoft);
    expect(settleStudioParams.studioCanvasFontFamily).toBe(settleTokens.fontFamily);
    expect(settleStudioParams.studioWidgetTitleFontFamily).toBe(settleTokens.fontFamily);
    expect(settleStudioParams.chartFontFamily).toBe(settleTokens.fontFamily);
    expect(settleStudioParams.gridRowHeight).toBe(settleTokens.rowHeight);
    expect(settleStudioParams.studioWidgetBorderRadius).toBe(settleTokens.radius);
    settleTokens.chartPalette.forEach((colour, index) => {
      expect(settleStudioParams[`chartPaletteFills${index + 1}Color` as keyof typeof settleStudioParams]).toBe(colour);
    });
    expect(typeof settleStudioTheme.withParams).toBe("function");
  });

  it("uses the same palette for standalone AG Charts", () => {
    expect(settleChartTheme.palette?.fills).toEqual([...settleTokens.chartPalette]);
    expect(settleChartTheme.params?.fontFamily).toBe(settleTokens.fontFamily);
    expect(settleChartTheme.params?.textColor).toBe(settleTokens.ink);
  });

  it("publishes the tokens to CSS so component styles cannot drift from the AG themes", () => {
    const root = document.createElement("div");
    applyDesignTokens(root);
    expect(root.style.getPropertyValue("--settle-accent")).toBe(settleTokens.accent);
    expect(root.style.getPropertyValue("--settle-ink")).toBe(settleTokens.ink);
    expect(root.style.getPropertyValue("--settle-border")).toBe(settleTokens.border);
    expect(root.style.getPropertyValue("--settle-font")).toBe(settleTokens.fontFamily);
    expect(root.style.getPropertyValue("--settle-component-button-primary")).toBe(componentTokens.button.primary);
    expect(componentTokens.button.primary).toBe(semanticTokens.action.primary);
    expect(settleGridParams.backgroundColor).toBe(semanticTokens.surface.card);
    expect(root.style.getPropertyValue("--settle-radius")).toBe(`${settleTokens.radius}px`);
    primitives.spacing.forEach((value, index) => {
      expect(root.style.getPropertyValue(`--settle-space-${index}`)).toBe(`${value}px`);
    });
  });

  it("keeps text and status colours at WCAG AA contrast on their backgrounds", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    expect(contrast(settleTokens.ink, settleTokens.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(settleTokens.muted, settleTokens.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(settleTokens.muted, settleTokens.surfaceSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", settleTokens.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(primitives.brand.inkberry, primitives.brand.citrus)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(semanticTokens.text.inverse, componentTokens.button.primaryHover)).toBeGreaterThanOrEqual(4.5);
    for (const tone of Object.values(settleTokens.status)) expect(contrast(tone.fg, tone.bg), `${tone.fg} on ${tone.bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
