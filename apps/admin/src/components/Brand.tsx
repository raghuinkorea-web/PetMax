/**
 * ADISYS wordmark.
 *
 * This is a faithful typographic reconstruction of the ADISYS logo —
 * heavy italic capitals in brand red above the "Observation Driven
 * Insights" tagline. To use the official artwork instead, drop the
 * supplied file at `public/adisys-logo.svg` and set
 * `VITE_BRAND_LOGO_URL=/adisys-logo.svg`; the <img> path below then
 * replaces the drawn mark with no other change.
 */
const OFFICIAL_LOGO = import.meta.env.VITE_BRAND_LOGO_URL as string | undefined;

export function Wordmark({ height = 28, variant = 'colour', showTagline = true }: {
  height?: number; variant?: 'colour' | 'mono-light'; showTagline?: boolean;
}) {
  if (OFFICIAL_LOGO) {
    return <img src={OFFICIAL_LOGO} alt="ADISYS" style={{ height }} className="w-auto" />;
  }

  const red = variant === 'mono-light' ? '#ffffff' : 'var(--color-brand-500)';
  const ink = variant === 'mono-light' ? 'rgba(255,255,255,0.72)' : 'var(--color-ink-900)';
  const width = height * (showTagline ? 4.35 : 3.9);

  return (
    <svg viewBox="0 0 200 46" style={{ height: showTagline ? height * 1.35 : height, width }}
         role="img" aria-label="ADISYS — Observation Driven Insights" className="shrink-0">
      <text x="0" y="27" fill={red}
        style={{
          fontFamily: 'Inter, Arial, sans-serif', fontSize: 30, fontWeight: 800,
          fontStyle: 'italic', letterSpacing: '-0.018em',
        }}>ADISYS</text>
      {showTagline && (
        <text x="1.5" y="41.5" fill={ink}
          style={{
            fontFamily: 'Inter, Arial, sans-serif', fontSize: 9.9, fontWeight: 500,
            fontStyle: 'italic', letterSpacing: '0.004em',
          }}>Observation Driven Insights</text>
      )}
    </svg>
  );
}

/** Compact square mark for collapsed navigation and the mobile header. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-ink-900 font-bold italic text-brand-500"
      style={{ height: size, width: size, fontSize: size * 0.52 }}>
      A
    </span>
  );
}

/** The product name as it appears next to the mark. */
export function ProductName({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-semibold">ADISYS</span>
      <span className="font-normal opacity-70"> FieldOps</span>
    </span>
  );
}
