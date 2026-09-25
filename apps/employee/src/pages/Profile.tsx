import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera, ChevronRight, KeyRound, LogOut, MapPin, Shield, Smartphone, Info,
} from 'lucide-react';
import { dateTimeLabel, hours } from '@adisys/shared';
import { Avatar } from '../components/Avatar';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Screen, ScreenHeader } from '../components/Shell';
import {
  Button, Card, Field, Input, SectionTitle, Sheet, Skeleton, StatusBadge, cx, useToast,
} from '../components/ui';

/**
 * The employee's own photo, with an edit affordance on the avatar itself —
 * tapping the camera badge opens the device's picker, which on a phone offers
 * the camera directly. `capture` is deliberately not set: replacing a photo
 * from the gallery is as common as taking a new one.
 *
 * The upload applies immediately, then refreshUser() re-reads /auth/me so the
 * new face also appears in the home header without a reload.
 */
function PhotoEditor({ userId, name, fileId }: {
  userId?: string; name: string; fileId?: string | null;
}) {
  const { refreshUser } = useAuth();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const MAX_MB = 10;
  const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

  const choose = async (file: File | undefined) => {
    if (!file || !userId) return;
    if (!ACCEPT.includes(file.type)) {
      toast.error('Unsupported image', 'Use a JPG, PNG or WEBP photo.');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error('Photo too large', `Photos must be ${MAX_MB} MB or smaller.`);
      return;
    }
    const body = new FormData();
    body.append('avatar', file);
    setBusy(true);
    try {
      await api.upload(`/employees/${userId}/avatar`, body);
      await refreshUser();
      toast.success('Photo updated');
    } catch (err) {
      toast.error('Could not upload the photo', (err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await api.del(`/employees/${userId}/avatar`);
      await refreshUser();
      toast.success('Photo removed');
    } catch (err) {
      toast.error('Could not remove the photo', (err as Error).message);
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  return (
    <>
      <div className="relative shrink-0">
        <Avatar name={name} fileId={fileId} size={56} className={busy ? 'opacity-50' : undefined} />
        <button type="button" disabled={busy}
          onClick={() => (fileId ? setConfirmRemove(true) : inputRef.current?.click())}
          aria-label={fileId ? 'Change or remove your photo' : 'Add a photo'}
          className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full
                     bg-brand-500 text-white ring-2 ring-card active:brightness-90">
          <Camera className="h-3.5 w-3.5" aria-hidden />
        </button>
        <input ref={inputRef} type="file" accept={ACCEPT.join(',')} className="sr-only"
               onChange={(e) => void choose(e.target.files?.[0])} />
      </div>

      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Profile photo">
        <div className="space-y-2.5">
          <Button block onClick={() => { setConfirmRemove(false); inputRef.current?.click(); }}>
            Choose a new photo
          </Button>
          <Button block variant="danger" loading={busy} onClick={remove}>
            Remove photo
          </Button>
        </div>
      </Sheet>
    </>
  );
}

export function ProfileScreen() {
  const { user, signOut, refreshUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState<'password' | 'logout' | 'location' | null>(
    params.get('changePassword') === '1' ? 'password' : null);

  const day = useQuery({ queryKey: ['my-day'], queryFn: () => api.get('/dashboard/my-day') });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get('/auth/sessions') });

  const consent = useMutation({
    mutationFn: (granted: boolean) => api.post('/time/attendance/location-consent', { granted }),
    onSuccess: (res) => {
      toast.success(res.granted ? 'Location sharing on' : 'Location sharing off',
        res.granted
          ? 'Your site location is recorded at check-in and check-out only.'
          : 'Check-ins will no longer record where you are.');
      void refreshUser();
      setSheet(null);
    },
    onError: (err) => toast.error('Could not update the setting', (err as Error).message),
  });

  return (
    <>
      <ScreenHeader title="Profile" />

      <Screen>
        <Card>
          <div className="flex items-center gap-3">
            <PhotoEditor userId={user?.id} name={user?.fullName ?? '?'} fileId={user?.avatarFileId} />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-ink-900">{user?.fullName}</p>
              <p className="tabular truncate text-xs text-ink-500">{user?.employeeCode}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <StatusBadge tone="info" dot={false}>{user?.designationName ?? user?.roleName}</StatusBadge>
              </div>
            </div>
          </div>

          <dl className="mt-4 space-y-2.5 border-t border-line pt-3.5">
            <Row term="Email" value={user?.email ?? '—'} />
            <Row term="Mobile" value={user?.phone ?? '—'} />
            <Row term="Department" value={user?.departmentName ?? '—'} />
          </dl>
        </Card>

        <section>
          <SectionTitle>This week</SectionTitle>
          <Card>
            {day.isLoading ? <Skeleton className="h-16" /> : (
              <dl className="grid grid-cols-2 gap-3 text-center">
                <div>
                  <dt className="text-[12px] text-ink-500">Recorded</dt>
                  <dd className="tabular mt-0.5 text-lg font-semibold text-ink-900">
                    {hours(day.data?.time?.recordedMinutesThisWeek)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-500">Verified</dt>
                  <dd className="tabular mt-0.5 text-lg font-semibold text-success">
                    {hours(day.data?.time?.verifiedMinutesThisWeek)}
                  </dd>
                </div>
              </dl>
            )}
            <p className="mt-3 border-t border-line pt-2.5 text-[12px] leading-relaxed text-ink-500">
              Verified hours are the ones your manager has confirmed. Recorded hours that have not been
              verified yet are not counted as productive time.
            </p>
          </Card>
        </section>

        <section>
          <SectionTitle>Settings</SectionTitle>
          <Card padded={false}>
            <ul className="divide-y divide-line">
              <ActionRow icon={<KeyRound className="h-4 w-4" />} label="Change password"
                hint={user?.mustChangePassword ? 'You are using a temporary password' : undefined}
                tone={user?.mustChangePassword ? 'warning' : undefined}
                onClick={() => setSheet('password')} />
              <ActionRow icon={<MapPin className="h-4 w-4" />} label="Location at check-in"
                hint={user?.locationConsentAt ? 'On — recorded at check-in and check-out only' : 'Off'}
                onClick={() => setSheet('location')} />
              <ActionRow icon={<Smartphone className="h-4 w-4" />} label="Signed-in devices"
                hint={`${sessions.data?.data?.length ?? 0} active`}
                onClick={() => navigate('/profile/devices')} />
            </ul>
          </Card>
        </section>

        <Button variant="secondary" block size="lg" icon={<LogOut className="h-4 w-4" />}
                className="text-danger" onClick={() => setSheet('logout')}>
          Sign out
        </Button>

        <p className="pb-2 text-center text-[12px] text-ink-400">
          ADISYS FieldOps v1.0 · Observation Driven Insights
        </p>
      </Screen>

      {sheet === 'password' && (
        <ChangePasswordSheet mustChange={Boolean(user?.mustChangePassword)}
          onClose={() => { setSheet(null); setParams({}); }}
          onDone={() => { setSheet(null); setParams({}); void refreshUser(); }} />
      )}

      {sheet === 'location' && (
        <Sheet open onClose={() => setSheet(null)} title="Location at check-in"
          description="ADISYS only ever records your location at the moment you check in and check out."
          footer={
            <div className="space-y-2">
              <Button variant={user?.locationConsentAt ? 'danger' : 'primary'} size="lg" block
                      loading={consent.isPending}
                      onClick={() => consent.mutate(!user?.locationConsentAt)}>
                {user?.locationConsentAt ? 'Turn location sharing off' : 'Turn location sharing on'}
              </Button>
              <Button variant="ghost" block onClick={() => setSheet(null)}>Close</Button>
            </div>
          }>
          <ul className="space-y-3 text-sm leading-relaxed text-ink-700">
            <li className="flex gap-2.5"><Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
              Your position is captured <strong>only</strong> when you tap Check in or Check out. There is no
              background or continuous tracking.</li>
            <li className="flex gap-2.5"><Shield className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
              Only your reporting manager and ADISYS administrators can see it, and it is deleted after the
              configured retention period.</li>
            <li className="flex gap-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
              You can turn this off at any time. Check-in still works — it simply records no location.</li>
          </ul>
          {user?.locationConsentAt && (
            <p className="mt-4 rounded-xl bg-sunken p-3 text-xs text-ink-600">
              You agreed to this on {dateTimeLabel(user.locationConsentAt)}.
            </p>
          )}
        </Sheet>
      )}

      {sheet === 'logout' && (
        <Sheet open onClose={() => setSheet(null)} title="Sign out?"
          description="You will need your employee ID and password to sign back in."
          footer={
            <div className="space-y-2">
              <Button variant="danger" size="lg" block icon={<LogOut className="h-4 w-4" />}
                      onClick={() => { void signOut().then(() => navigate('/login', { replace: true })); }}>
                Sign out
              </Button>
              <Button variant="ghost" block onClick={() => setSheet(null)}>Stay signed in</Button>
            </div>
          }>
          <p className="text-sm leading-relaxed text-ink-600">
            Any timer you have running will keep running until you or your manager stops it. Check out
            first if you have finished for the day.
          </p>
        </Sheet>
      )}
    </>
  );
}

/* =================================================================== */
export function DevicesScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get('/auth/sessions') });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/auth/sessions/${id}`),
    onSuccess: () => {
      toast.success('Device signed out');
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  return (
    <>
      <ScreenHeader title="Signed-in devices"
        subtitle="Sign out anything you do not recognise"
        action={<Button size="sm" onClick={() => navigate('/profile')}>Back</Button>} />
      <Screen>
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {(sessions.data?.data ?? []).map((s: any) => (
              <li key={s.id} className="flex items-center gap-3 p-4">
                <Smartphone className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm capitalize text-ink-800">
                    {s.client}
                    {s.isCurrent && <StatusBadge tone="success" dot={false}>This device</StatusBadge>}
                  </p>
                  <p className="truncate text-xs text-ink-500">{s.deviceLabel ?? 'Unknown device'}</p>
                  <p className="tabular text-[12px] text-ink-400">Last used {dateTimeLabel(s.lastUsedAt)}</p>
                </div>
                {!s.isCurrent && (
                  <Button size="sm" loading={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </Screen>
    </>
  );
}

/* =================================================================== */
function ChangePasswordSheet({ mustChange, onClose, onDone }: {
  mustChange: boolean; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiRequestError | null>(null);

  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('Password changed', 'Your other devices have been signed out.');
      onDone();
    },
    onError: (err) => { setError(err as ApiRequestError); toast.error('Could not change it', (err as Error).message); },
  });

  const rules = [
    { ok: next.length >= 10, label: 'At least 10 characters' },
    { ok: /[A-Z]/.test(next) && /[a-z]/.test(next), label: 'Upper and lower case letters' },
    { ok: /[0-9]/.test(next), label: 'At least one number' },
    { ok: next.length > 0 && next === confirm, label: 'Both entries match' },
  ];

  return (
    <Sheet open onClose={mustChange ? () => {} : onClose} title="Change your password"
      description={mustChange
        ? 'You are signed in with a temporary password. Choose your own before continuing.'
        : 'Your other devices will be signed out.'}
      footer={
        <Button variant="primary" size="lg" block loading={change.isPending}
                disabled={!current || !rules.every((r) => r.ok)} onClick={() => change.mutate()}>
          Change password
        </Button>
      }>
      <div className="space-y-4">
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger ring-1 ring-inset ring-danger/20">
            {error.message}
          </p>
        )}
        <Field label="Current password" required error={error?.fieldError('currentPassword')}>
          <Input type="password" autoComplete="current-password" value={current}
                 onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" required error={error?.fieldError('newPassword')}>
          <Input type="password" autoComplete="new-password" value={next}
                 onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm new password" required>
          <Input type="password" autoComplete="new-password" value={confirm}
                 invalid={Boolean(confirm) && confirm !== next}
                 onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <ul className="space-y-1.5">
          {rules.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-xs">
              <span className={cx('h-1.5 w-1.5 rounded-full', r.ok ? 'bg-success' : 'bg-ink-300')} aria-hidden />
              <span className={r.ok ? 'text-success' : 'text-ink-500'}>{r.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-ink-500">{term}</dt>
      <dd className="truncate text-right text-sm text-ink-800">{value}</dd>
    </div>
  );
}

function ActionRow({ icon, label, hint, tone, onClick }: {
  icon: React.ReactNode; label: string; hint?: string; tone?: 'warning'; onClick: () => void;
}) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 p-4 text-left active:bg-ink-50">
        <span className={cx('shrink-0', tone === 'warning' ? 'text-warning' : 'text-ink-400')}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink-800">{label}</span>
          {hint && <span className={cx('block text-xs', tone === 'warning' ? 'text-warning' : 'text-ink-500')}>{hint}</span>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />
      </button>
    </li>
  );
}
