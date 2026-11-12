// The Settle mark.
//
// The symbol is two descending chevrons: a studio's work settling into a
// ledger, then into a verified receipt. The colour comes from the published
// design tokens, so the mark never hardcodes a brand value and follows the
// surface it is placed on.
//
// The same geometry is published as standalone SVG files under
// `app/public/brand/` for favicons, decks and any surface that needs the
// asset outside React.
export function LogoMark({ size = 32, inverse = false, monochrome = false }: { size?: number; inverse?: boolean; monochrome?: boolean }) {
  const top = monochrome ? "var(--settle-ink)" : inverse ? "var(--settle-brand-citrus)" : "var(--settle-brand-inkberry)";
  const bottom = monochrome ? "var(--settle-ink)" : inverse ? "var(--settle-brand-haze)" : "var(--settle-brand-haze)";
  return <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Settle">
    <path d="M4 13.2 16 4l12 9.2" fill="none" stroke={top} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 21.6 16 12.4l12 9.2" fill="none" stroke={bottom} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function Logo({ variant = "full", inverse = false }: { variant?: "full" | "mark" | "compact"; inverse?: boolean }) {
  if (variant === "mark") return <LogoMark inverse={inverse} />;
  const compact = variant === "compact";
  return <span className={`logo logo-${variant}`}>
    <LogoMark size={compact ? 26 : 30} inverse={inverse} />
    <span className="logo-word" aria-hidden="true">Settle</span>
  </span>;
}
