import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ApiRequestError } from '../lib/api';
import { Button, Field, Input } from '../components/ui';
import { Wordmark } from '../components/Brand';

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

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,38%)]">
      {/* Brand panel — hidden on small screens so the form owns the viewport. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(var(--color-brand-500) 1px, transparent 1px), linear-gradient(90deg, var(--color-brand-500) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />
        <Wordmark height={32} variant="mono-light" />

        <div className="relative max-w-lg">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            On-field operations,<br />
            <span className="text-brand-400">observed end to end.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Assign daily and weekly work, confirm your field team has received it, record the
            hours that went into it, and settle purchase bills and allowances — from one place.
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6">
            {[
              ['Work', 'Assign, acknowledge, complete'],
              ['Time', 'Recorded and verified separately'],
              ['Spend', 'Bills, fuel and food, per project'],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="text-xs font-semibold uppercase tracking-wider text-brand-400">{term}</dt>
                <dd className="mt-1 text-xs leading-relaxed text-white/50">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-xs text-white/30">
          © {new Date().getFullYear()} ADISYS Technologies · adisystech.com
        </p>
      </div>

      {/* Sign-in form */}
      <div className="flex items-center justify-center bg-card px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden"><Wordmark height={30} /></div>

          <h2 className="mt-8 text-xl font-semibold tracking-tight text-ink-900 lg:mt-0">Sign in</h2>
          <p className="mt-1 text-sm text-ink-500">
            Use your ADISYS employee ID, email address or registered mobile number.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
            {error && (
              <div role="alert"
                className="rounded-lg bg-danger-soft px-3.5 py-3 text-sm text-danger ring-1 ring-inset ring-danger/20">
                {error.message}
              </div>
            )}

            <Field label="Employee ID, email or mobile" htmlFor="identifier" required
                   error={error?.fieldError('identifier')}>
              <Input id="identifier" name="identifier" autoComplete="username" autoFocus
                placeholder="ADI-0005" value={identifier} invalid={Boolean(error?.fieldError('identifier'))}
                onChange={(e) => setIdentifier(e.target.value)} />
            </Field>

            <Field label="Password" htmlFor="password" required error={error?.fieldError('password')}>
              <div className="relative">
                <Input id="password" name="password" type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password" placeholder="••••••••••"
                  className="pr-10" value={password}
                  invalid={Boolean(error?.fieldError('password'))}
                  onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            <div className="flex justify-end">
              <a href="/forgot-password" className="text-xs font-medium text-brand-600 hover:text-brand-700">
                Forgot password?
              </a>
            </div>

            <Button type="submit" variant="primary" size="lg" block loading={submitting}
                    icon={<LogIn className="h-4 w-4" />}
                    disabled={!identifier.trim() || !password}>
              Sign in
            </Button>
          </form>

          <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-ink-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
            Sessions expire automatically and every sign-in is recorded in the ADISYS audit log.
          </p>

          {import.meta.env.DEV && (
            <div className="mt-8 rounded-lg bg-sunken p-3.5 ring-1 ring-line">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Demonstration accounts
              </p>
              <ul className="mt-2 space-y-1">
                {[
                  ['ADI-0001', 'Super Admin'],
                  ['ADI-0002', 'Operations Manager'],
                  ['ADI-0004', 'Finance Manager'],
                  ['ADI-0005', 'Field Employee'],
                ].map(([id, role]) => (
                  <li key={id}>
                    <button type="button"
                      onClick={() => { setIdentifier(id); setPassword('Adisys@2026'); }}
                      className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-xs
                                 text-ink-600 hover:bg-white">
                      <span className="tabular font-medium text-ink-800">{id}</span>
                      <span>{role}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 px-1.5 text-[11px] text-ink-400">Password: Adisys@2026</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
