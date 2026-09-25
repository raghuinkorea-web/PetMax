import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ApiRequestError } from '../lib/api';

/** The four registration marks that frame a blueprint object. */
function Corners() {
  return (
    <>
      <i className="corner tl" aria-hidden /><i className="corner tr" aria-hidden />
      <i className="corner bl" aria-hidden /><i className="corner br" aria-hidden />
    </>
  );
}

const PILLARS: Array<[string, string]> = [
  ['Work', 'Assign, acknowledge, complete'],
  ['Time', 'Recorded and verified separately'],
  ['Spend', 'Bills, fuel and food, per project'],
];

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await signIn(identifier.trim(), password);
      navigate(user.mustChangePassword ? '/account?first=1' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err
        : new ApiRequestError(0, 'NETWORK', 'Cannot reach the ADISYS server. Check your connection.'));
    } finally {
      setSubmitting(false);
    }
  }

  /*
   * The sign-in screen follows the "Industry" design system rather than the
   * product's: a flat #f2f2f3 ground, Barlow Condensed headings, a slate-blue
   * accent, and components drawn as wireframe objects — square, hairline,
   * with registration marks at the corners. Everything is scoped under
   * `.industry` (see styles.css) so none of it reaches the app behind it.
   *
   * The two columns wrap and centre rather than splitting the viewport, so on
   * a narrow screen the copy stacks above the form instead of disappearing.
   */
  return (
    // Light blue fills the viewport; the sign-in itself is a compact panel
    // centred on it, about half the screen wide, so the page reads as one
    // object rather than two columns adrift in empty space.
    <main
      className="industry"
      style={{
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        padding: 'var(--i-space-6) var(--i-space-4)',
        background: 'var(--color-signin)',
      }}>
      <div className="blueprint" style={{
        width: 'clamp(300px, 58vw, 1000px)',
        background: 'var(--i-bg)',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        justifyContent: 'center',
        gap: 'calc(var(--i-space-8) * 1.6)',
        padding: 'calc(var(--i-space-8) * 1.3)',
      }}>
        <Corners />

      {/* --- The three things the product does ------------------------- */}
      <ul style={{
        listStyle: 'none', margin: 0, padding: 0,
        display: 'flex', flexDirection: 'column', gap: 'var(--i-space-4)',
        width: 270, maxWidth: '100%',
      }}>
        <li>
          {/* Two block lines rather than a <br>: the break is structural, so it
              always falls between the two phrases. `text-wrap: balance` is
              deliberately not used here — it redistributes words across a
              forced break, which is what pulled "observed" onto line one. */}
          <p style={{
            margin: 0, fontFamily: 'var(--i-heading)', fontSize: 30, fontWeight: 600,
            lineHeight: 1.1,
          }}>
            <span style={{ display: 'block' }}>On-field operations,</span>
            <span style={{ display: 'block', color: 'var(--i-accent-700)' }}>observed end to end.</span>
          </p>
        </li>
        {/* Small tracked caps over a quiet line of detail: the three pillars
            support the headline rather than competing with it. */}
        {PILLARS.map(([term, detail], i) => (
          <li key={term} style={{
            display: 'flex', flexDirection: 'column', gap: 5,
            paddingTop: 'var(--i-space-4)',
            borderTop: i === 0 ? '1px solid var(--i-divider)' : 'none',
            marginTop: i === 0 ? 'var(--i-space-2)' : 0,
          }}>
            <span style={{
              fontFamily: 'var(--i-heading)', fontSize: 13, fontWeight: 600,
              letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--i-accent-700)',
            }}>{term}</span>
            <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--i-neutral-700)' }}>{detail}</span>
          </li>
        ))}
      </ul>

      {/* --- Logo above the sign-in form ------------------------------- */}
      {/* No frame of its own: the panel around everything already carries one,
          and nesting a second would read as clutter rather than structure. */}
      <div style={{
        width: '100%', maxWidth: 330, display: 'flex', flexDirection: 'column',
        alignItems: 'stretch', gap: 'var(--i-space-6)',
      }}>
        <img src="/adisys-logo.png" alt="ADISYS — Observation Driven Insights"
             style={{ width: 184, maxWidth: '62%', height: 'auto', display: 'block',
                      alignSelf: 'center' }} />

        <form onSubmit={onSubmit} noValidate
          style={{
            width: '100%', display: 'flex', flexDirection: 'column',
            gap: 'var(--i-space-4)',
          }}>
          <h1 style={{
            margin: '0 0 var(--i-space-1)', fontFamily: 'var(--i-heading)', fontSize: 19,
            fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.22em',
            textAlign: 'center', textIndent: '0.22em',
          }}>Sign in</h1>

          {error && (
            <div role="alert" style={{
              fontSize: 13, lineHeight: 1.5, padding: 'var(--i-space-3)',
              color: '#ad2027', border: '1px solid #ad2027',
            }}>
              {error.message}
            </div>
          )}

          <div className="i-field">
            <label htmlFor="identifier">Employee ID, email or mobile</label>
            <input id="identifier" name="identifier" className="i-input" type="text"
              autoComplete="username" autoFocus placeholder="ADI-0001"
              aria-invalid={Boolean(error?.fieldError('identifier')) || undefined}
              value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
            {error?.fieldError('identifier') && (
              <p style={{ margin: '5px 0 0', fontSize: 12, color: '#ad2027' }}>
                {error.fieldError('identifier')}
              </p>
            )}
          </div>

          {/* Flex column so the "Forgot password?" link can sit flush right,
              which is what the design's align-self:flex-end asks for. */}
          <div className="i-field" style={{ display: 'flex', flexDirection: 'column' }}>
            <label htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <input id="password" name="password" className="i-input"
                type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                placeholder="••••••••" style={{ paddingRight: 36 }}
                aria-invalid={Boolean(error?.fieldError('password')) || undefined}
                value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  display: 'flex', padding: 4, border: 0, background: 'transparent',
                  cursor: 'pointer', color: 'var(--i-neutral-700)',
                }}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error?.fieldError('password') && (
              <p style={{ margin: '5px 0 0', fontSize: 12, color: '#ad2027' }}>
                {error.fieldError('password')}
              </p>
            )}
            <a href="/forgot-password"
               style={{
                 alignSelf: 'flex-end', marginTop: 9, fontSize: 13,
                 textDecoration: 'none', whiteSpace: 'nowrap',
               }}>
              Forgot password?
            </a>
          </div>

          <button type="submit" className="i-btn i-btn-primary i-btn-block"
                  disabled={submitting || !identifier.trim() || !password}>
            {submitting && <Loader2 size={14} className="animate-spin" aria-hidden />}
            Sign in
          </button>
        </form>
      </div>
      </div>
    </main>
  );
}
