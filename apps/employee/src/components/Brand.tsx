/**
 * ADISYS wordmark for the field app.
 * Drop the official artwork at `public/adisys-logo.svg` and set
 * VITE_BRAND_LOGO_URL to use it instead of this typographic mark.
 */
const OFFICIAL_LOGO = import.meta.env.VITE_BRAND_LOGO_URL as string | undefined;

export function Wordmark({ height = 30, variant = 'colour', showTagline = true }: {
  height?: number; variant?: 'colour' | 'mono-light'; showTagline?: boolean;
}) {
  if (OFFICIAL_LOGO) return <img src={OFFICIAL_LOGO} alt="ADISYS" style={{ height }} className="w-auto" />;

  const red = variant === 'mono-light' ? '#ffffff' : 'var(--color-brand-500)';
  const ink = variant === 'mono-light' ? 'rgba(255,255,255,0.7)' : 'var(--color-ink-900)';

  return (
    <svg viewBox="0 0 200 46" style={{ height: showTagline ? height * 1.35 : height }}
         role="img" aria-label="ADISYS — Observation Driven Insights" className="w-auto shrink-0">
      <text x="0" y="27" fill={red}
        style={{ fontFamily: 'Inter, Arial, sans-serif', fontSize: 30, fontWeight: 800,
                 fontStyle: 'italic', letterSpacing: '-0.018em' }}>ADISYS</text>
      {showTagline && (
        <text x="1.5" y="41.5" fill={ink}
          style={{ fontFamily: 'Inter, Arial, sans-serif', fontSize: 9.9, fontWeight: 500,
                   fontStyle: 'italic' }}>Observation Driven Insights</text>
      )}
    </svg>
  );
}

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-xl bg-ink-900 font-bold italic text-brand-500"
      style={{ height: size, width: size, fontSize: size * 0.52 }}>
      A
    </span>
  );
}
