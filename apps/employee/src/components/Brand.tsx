/**
 * ADISYS wordmark for the field app.
 *
 * The official artwork ships in `public/`: `adisys-logo.png` is the full
 * lockup, `adisys-wordmark.png` the lettering alone. Override either with
 * VITE_BRAND_LOGO_URL / VITE_BRAND_WORDMARK_URL. Callers pass the same
 * `height` the drawn mark took: the full lockup renders at
 * height * LOCKUP_RATIO so it occupies the space the layouts expect, and
 * without the tagline `height` is the height of the lettering itself.
 */
const OFFICIAL_LOGO = (import.meta.env.VITE_BRAND_LOGO_URL ?? '/adisys-logo.png') as string;
const OFFICIAL_WORDMARK = (import.meta.env.VITE_BRAND_WORDMARK_URL ?? '/adisys-wordmark.png') as string;

/** Matches the drawn mark's footprint (its svg rendered at height * 1.35). */
const LOCKUP_RATIO = 1.35;

export function Wordmark({ height = 30, variant = 'colour', showTagline = true }: {
  height?: number; variant?: 'colour' | 'mono-light'; showTagline?: boolean;
}) {
  const official = showTagline ? OFFICIAL_LOGO : OFFICIAL_WORDMARK;
  if (official) {
    return (
      <img
        src={official}
        alt="ADISYS — Observation Driven Insights"
        style={{
          height: showTagline ? height * LOCKUP_RATIO : height,
          // Red-on-near-black artwork vanishes against the dark panels, so
          // knock it out to white exactly as the drawn mono-light mark does.
          filter: variant === 'mono-light' ? 'brightness(0) invert(1)' : undefined,
        }}
        className="w-auto shrink-0"
      />
    );
  }

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
