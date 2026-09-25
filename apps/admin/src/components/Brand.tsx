/**
 * ADISYS wordmark.
 *
 * The official artwork ships in `public/`: `adisys-logo.png` is the full
 * lockup, `adisys-wordmark.png` the lettering on its own for places too
 * short to carry the tagline. Either can be overridden with
 * VITE_BRAND_LOGO_URL / VITE_BRAND_WORDMARK_URL. The drawn mark below is
 * the fallback — a typographic reconstruction used only if both are
 * explicitly blanked.
 *
 * Sizing note: callers pass the same `height` the drawn mark took, and the
 * full lockup renders at height * LOCKUP_RATIO so it occupies exactly the
 * vertical space the drawn mark did — the layouts are tuned around that.
 * Because the real artwork gives more of its height to the lettering, the
 * letters come out slightly larger than the reconstruction at the same
 * setting, which is the point. Without the tagline, `height` is the height
 * of the lettering itself.
 */
const OFFICIAL_LOGO = (import.meta.env.VITE_BRAND_LOGO_URL ?? '/adisys-logo.png') as string;
const OFFICIAL_WORDMARK = (import.meta.env.VITE_BRAND_WORDMARK_URL ?? '/adisys-wordmark.png') as string;

/** Matches the drawn mark's footprint (its svg rendered at height * 1.35). */
const LOCKUP_RATIO = 1.35;

export function Wordmark({ height = 28, variant = 'colour', showTagline = true }: {
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
          // The artwork is red on near-black. On dark surfaces that tagline
          // would disappear, so knock the whole mark out to white, which is
          // what the drawn mono-light variant does too.
          filter: variant === 'mono-light' ? 'brightness(0) invert(1)' : undefined,
        }}
        className="w-auto shrink-0"
      />
    );
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

/**
 * Compact mark for the collapsed navigation rail, where the full lockup does
 * not fit: the "A" of the official wordmark, cropped from the same artwork so
 * it is the real letterform rather than a drawn stand-in. `height` is the
 * letter's height, matching what `Wordmark` means by it.
 */
const OFFICIAL_MARK = (import.meta.env.VITE_BRAND_MARK_URL ?? '/adisys-mark.png') as string;

export function BrandMark({ height = 22, variant = 'colour' }: {
  height?: number; variant?: 'colour' | 'mono-light';
}) {
  return (
    <img
      src={OFFICIAL_MARK}
      alt="ADISYS"
      style={{
        height,
        filter: variant === 'mono-light' ? 'brightness(0) invert(1)' : undefined,
      }}
      className="w-auto shrink-0"
    />
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
