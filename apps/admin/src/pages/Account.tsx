import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Monitor, Smartphone, Trash2 } from 'lucide-react';
import { dateTimeLabel, initials } from '@adisys/shared';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import {
  Button, Card, CardHeader, Field, Input, StatusBadge, useToast,
} from '../components/ui';

export function AccountPage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const mustChange = params.get('first') === '1' || user?.mustChangePassword;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiRequestError | null>(null);

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get('/auth/sessions') });

  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('Password changed', 'Every other device has been signed out.');
      setCurrent(''); setNext(''); setConfirm(''); setError(null);
      void refreshUser();
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => {
      setError(err as ApiRequestError);
      toast.error('Could not change the password', (err as Error).message);
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/auth/sessions/${id}`),
    onSuccess: () => {
      toast.success('Device signed out');
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const rules = [
    { ok: next.length >= 10, label: 'At least 10 characters' },
    { ok: /[A-Z]/.test(next), label: 'One uppercase letter' },
    { ok: /[a-z]/.test(next), label: 'One lowercase letter' },
    { ok: /[0-9]/.test(next), label: 'One number' },
    { ok: next.length > 0 && next === confirm, label: 'Both entries match' },
  ];
  const canSubmit = current && rules.every((r) => r.ok);

  return (
    <>
      <PageHeader title="Account & security"
        description="Your profile, password and the devices currently signed in to ADISYS FieldOps." />

      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-900 text-lg font-semibold text-white">
                {user ? initials(user.fullName) : '?'}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink-900">{user?.fullName}</p>
                <p className="truncate text-sm text-ink-500">{user?.email}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <StatusBadge tone="info" dot={false}>{user?.roleName}</StatusBadge>
                  <StatusBadge tone="neutral" dot={false}>{user?.employeeCode}</StatusBadge>
                </div>
              </div>
            </div>
            <dl className="mt-5 space-y-2.5 border-t border-line pt-4 text-sm">
              <Row term="Department" value={user?.departmentName ?? '—'} />
              <Row term="Designation" value={user?.designationName ?? '—'} />
              <Row term="Mobile" value={user?.phone ?? '—'} />
              <Row term="Permissions held" value={String(user?.permissions.length ?? 0)} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Change password"
              subtitle="Changing your password signs out every other device." />

            {mustChange && (
              <div className="mb-4 rounded-lg bg-warning-soft px-3.5 py-2.5 text-sm text-warning ring-1 ring-inset ring-warning/20">
                You are signed in with a temporary password. Choose a new one before continuing.
              </div>
            )}
            {error && (
              <div role="alert" className="mb-4 rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger ring-1 ring-inset ring-danger/20">
                {error.message}
              </div>
            )}

            <div className="space-y-4">
              <Field label="Current password" required error={error?.fieldError('currentPassword')}>
                <Input type="password" autoComplete="current-password" value={current}
                       invalid={Boolean(error?.fieldError('currentPassword'))}
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

              <ul className="space-y-1">
                {rules.map((r) => (
                  <li key={r.label} className="flex items-center gap-2 text-xs">
                    <span className={`h-1.5 w-1.5 rounded-full ${r.ok ? 'bg-success' : 'bg-ink-300'}`} aria-hidden />
                    <span className={r.ok ? 'text-success' : 'text-ink-500'}>{r.label}</span>
                  </li>
                ))}
              </ul>

              <Button variant="primary" block icon={<KeyRound className="h-4 w-4" />}
                      disabled={!canSubmit} loading={change.isPending} onClick={() => change.mutate()}>
                Change password
              </Button>
            </div>
          </Card>
        </div>

        <Card padded={false}>
          <div className="px-5 pt-5">
            <CardHeader title="Signed-in devices"
              subtitle="Sign out anything you do not recognise. This takes effect immediately." />
          </div>
          <ul className="divide-y divide-line">
            {(sessions.data?.data ?? []).map((s: any) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3.5">
                {s.client === 'web'
                  ? <Monitor className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                  : <Smartphone className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm text-ink-800">
                    <span className="capitalize">{s.client}</span>
                    {s.isCurrent && <StatusBadge tone="success" dot={false}>This device</StatusBadge>}
                  </p>
                  <p className="truncate text-xs text-ink-500">{s.deviceLabel ?? s.userAgent ?? 'Unknown device'}</p>
                  <p className="tabular text-[11px] text-ink-400">
                    {s.ipAddress ?? 'unknown IP'} · last used {dateTimeLabel(s.lastUsedAt)}
                  </p>
                </div>
                {!s.isCurrent && (
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />}
                          loading={revoke.isPending} onClick={() => revoke.mutate(s.id)}
                          aria-label="Sign out this device" />
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-500">{term}</dt>
      <dd className="truncate text-sm text-ink-800">{value}</dd>
    </div>
  );
}
