import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth, ApiRequestError } from '../lib/auth';
import { Button, Field, Input } from '../components/ui';
import { Wordmark } from '../components/Brand';

export function LoginScreen() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState(() => localStorage.getItem('adisys.field.lastId') ?? '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      // Remembering the employee ID saves re-typing it on every shift.
      localStorage.setItem('adisys.field.lastId', identifier.trim());
      const user = await signIn(identifier.trim(), password);
      navigate(user.mustChangePassword ? '/profile?changePassword=1' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err
        : new ApiRequestError(0, 'NETWORK', 'Cannot reach ADISYS. Check your mobile signal and try again.'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ink-900">
      {/* Brand panel */}
      <div className="safe-top relative flex flex-col justify-end px-6 pb-8 pt-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'linear-gradient(var(--color-brand-500) 1px, transparent 1px), linear-gradient(90deg, var(--color-brand-500) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }} />
        <div className="relative">
          <Wordmark height={30} variant="mono-light" />
          <p className="mt-5 text-xl font-semibold leading-snug text-white">
            Your work for today,<br />in your pocket.
          </p>
        </div>
      </div>

      {/* Form sheet */}
      <div className="safe-bottom flex-1 rounded-t-3xl bg-card px-6 pb-8 pt-7">
        <h1 className="text-lg font-semibold text-ink-900">Sign in</h1>
        <p className="mt-1 text-sm text-ink-500">
          Use your ADISYS employee ID or the mobile number registered with your manager.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          {error && (
            <div role="alert"
              className="rounded-xl bg-danger-soft px-4 py-3 text-sm leading-relaxed text-danger ring-1 ring-inset ring-danger/20">
              {error.message}
            </div>
          )}

          <Field label="Employee ID or mobile number" required error={error?.fieldError('identifier')}>
            <Input name="identifier" inputMode="text" autoCapitalize="characters" autoComplete="username"
                   placeholder="ADI-0005" value={identifier}
                   invalid={Boolean(error?.fieldError('identifier'))}
                   onChange={(e) => setIdentifier(e.target.value)} />
          </Field>

          <Field label="Password" required error={error?.fieldError('password')}>
            <div className="relative">
              <Input name="password" type={show ? 'text' : 'password'} autoComplete="current-password"
                     placeholder="••••••••••" className="pr-12" value={password}
                     onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-3 text-ink-400 active:bg-ink-100">
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </Field>

          <Button type="submit" variant="primary" size="lg" block loading={busy}
                  icon={<LogIn className="h-4 w-4" />}
                  disabled={!identifier.trim() || !password}>
            Sign in
          </Button>

          <button type="button" onClick={() => navigate('/forgot-password')}
            className="tap-sm w-full text-center text-sm font-medium text-brand-600">
            Forgot your password?
          </button>
        </form>

        <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-ink-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Your session stays signed in on this phone. Sign out from Profile if you hand the device to someone else.
        </p>

        {import.meta.env.DEV && (
          <div className="mt-6 rounded-xl bg-sunken p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Demo accounts</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {['ADI-0005', 'ADI-0006', 'ADI-0009', 'ADI-0012'].map((id) => (
                <button key={id} type="button"
                  onClick={() => { setIdentifier(id); setPassword('Adisys@2026'); }}
                  className="tap-sm rounded-lg bg-white px-2 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-line">
                  {id}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-400">Password: Adisys@2026</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* =================================================================== */
export function ForgotPasswordScreen() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { api } = await import('../lib/api');
    await api.post('/auth/forgot-password', { identifier: identifier.trim() }).catch(() => {});
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="safe-top safe-bottom flex min-h-dvh flex-col bg-card px-6 pt-10">
      <Wordmark height={26} />
      <h1 className="mt-8 text-lg font-semibold text-ink-900">Reset your password</h1>

      {sent ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            If that account exists, a reset link has been sent to the registered email address and
            mobile number. It is valid for 30 minutes.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-ink-500">
            Still stuck? Ask your reporting manager to issue a new temporary password from the admin portal.
          </p>
          <Button variant="primary" size="lg" block className="mt-8" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </>
      ) : (
        <form onSubmit={onSubmit} className="mt-2 space-y-5">
          <p className="text-sm leading-relaxed text-ink-600">
            Enter your employee ID or registered mobile number and we will send you a reset link.
          </p>
          <Field label="Employee ID or mobile number" required>
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                   autoCapitalize="characters" placeholder="ADI-0005" />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}
                  disabled={identifier.trim().length < 3}>
            Send reset link
          </Button>
          <Button type="button" variant="ghost" block onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </form>
      )}
    </div>
  );
}
