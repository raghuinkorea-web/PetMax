import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CalendarX2, Plus } from 'lucide-react';
import { LEAVE_STATUS, dateLabel, todayIso, type LeaveStatus } from '@adisys/shared';
import { api, ApiRequestError } from '../lib/api';
import { Screen, ScreenHeader } from '../components/Shell';
import {
  Button, Card, EmptyState, Field, Input, SectionTitle, Select, Sheet, Skeleton,
  StatusBadge, Textarea, cx, useToast,
} from '../components/ui';

/** Pending first — it is the thing an employee checks back for. */
const TABS: Array<{ value: LeaveStatus; label: string }> = [
  { value: 'pending',  label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export function LeaveScreen() {
  const [tab, setTab] = useState<LeaveStatus>('pending');
  const [applyOpen, setApplyOpen] = useState(false);

  const mine = useQuery({ queryKey: ['my-leave'], queryFn: () => api.get('/leave/mine') });
  const rows = (mine.data?.data ?? []).filter((r: any) => r.status === tab);
  const counts = mine.data?.counts ?? {};

  return (
    <>
      <ScreenHeader title="Leave"
        action={
          <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />}
                  onClick={() => setApplyOpen(true)}>Apply</Button>
        } />

      <Screen>
        {/* Status tabs double as a summary: the count is the useful part. */}
        <div className="flex gap-2" role="tablist" aria-label="Leave status">
          {TABS.map((t) => (
            <button key={t.value} type="button" role="tab" aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cx('flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                tab === t.value
                  ? 'bg-ink-900 text-white'
                  : 'bg-card text-ink-600 ring-1 ring-line active:bg-ink-50')}>
              {t.label}
              {(counts[t.value] ?? 0) > 0 && (
                <span className={cx('tabular ml-1.5 text-xs',
                                    tab === t.value ? 'text-white/70' : 'text-ink-500')}>
                  {counts[t.value]}
                </span>
              )}
            </button>
          ))}
        </div>

        <section>
          {mine.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState icon={<CalendarX2 className="h-5 w-5" />}
                title={`No ${LEAVE_STATUS.byValue[tab].label.toLowerCase()} leave`}
                description={tab === 'pending'
                  ? 'Apply for leave and it goes to your manager straight away.'
                  : `Requests appear here once they are ${LEAVE_STATUS.byValue[tab].label.toLowerCase()}.`} />
            </Card>
          ) : (
            <ul className="space-y-2">
              {rows.map((r: any) => <LeaveCard key={r.id} leave={r} />)}
            </ul>
          )}
        </section>
      </Screen>

      {applyOpen && <ApplySheet onClose={() => setApplyOpen(false)} />}
    </>
  );
}

/* =================================================================== */
function LeaveCard({ leave }: { leave: any }) {
  const meta = LEAVE_STATUS.byValue[leave.status as LeaveStatus];
  const toast = useToast();
  const qc = useQueryClient();

  const cancel = useMutation({
    mutationFn: () => api.post(`/leave/${leave.id}/cancel`),
    onSuccess: () => {
      toast.success('Request withdrawn');
      void qc.invalidateQueries({ queryKey: ['my-leave'] });
    },
    onError: (err) => toast.error('Could not withdraw the request', (err as Error).message),
  });

  return (
    <li>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-900">{leave.leaveTypeName}</p>
            <p className="tabular mt-0.5 text-xs text-ink-500">
              {dateLabel(leave.fromDate)} — {dateLabel(leave.toDate)} · {leave.totalDays} day{leave.totalDays === 1 ? '' : 's'}
            </p>
          </div>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>

        <p className="mt-2.5 text-sm leading-relaxed text-ink-700">{leave.reason}</p>

        {leave.decisionNote && (
          <p className="mt-2.5 rounded-xl bg-sunken p-3 text-xs leading-relaxed text-ink-600">
            <span className="font-semibold text-ink-800">{leave.decidedByName}: </span>
            {leave.decisionNote}
          </p>
        )}

        {leave.status === 'pending' && (
          <Button className="mt-3" size="sm" variant="ghost" loading={cancel.isPending}
                  onClick={() => cancel.mutate()}>Withdraw request</Button>
        )}
      </Card>
    </li>
  );
}

/* =================================================================== */
function ApplySheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ leaveTypeId: '', fromDate: todayIso(), toDate: todayIso(), reason: '' });
  const [error, setError] = useState<ApiRequestError | null>(null);

  const types = useQuery({ queryKey: ['leave-types'], queryFn: () => api.get('/leave/types'), staleTime: 600_000 });

  const apply = useMutation({
    mutationFn: () => api.post('/leave', form),
    onSuccess: () => {
      toast.success('Leave applied', 'Your manager can see it now.');
      void qc.invalidateQueries({ queryKey: ['my-leave'] });
      onClose();
    },
    onError: (err) => {
      setError(err as ApiRequestError);
      toast.error('Could not apply for leave', (err as Error).message);
    },
  });

  const set = (k: keyof typeof form) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Validate here as well as on the server so the button explains itself.
  const localError =
    !form.leaveTypeId ? 'Choose a leave type'
    : form.toDate < form.fromDate ? 'The last day is before the first day'
    : form.reason.trim().length < 5 ? 'Give a short reason'
    : null;

  const days = form.toDate >= form.fromDate
    ? Math.round((Date.parse(form.toDate) - Date.parse(form.fromDate)) / 86_400_000) + 1
    : 0;

  return (
    <Sheet open onClose={onClose} title="Apply for leave"
      description="Your manager sees the request immediately."
      footer={
        <Button block variant="primary" loading={apply.isPending} disabled={Boolean(localError)}
                icon={<CalendarPlus className="h-4 w-4" />} onClick={() => apply.mutate()}>
          {localError ?? `Apply for ${days} day${days === 1 ? '' : 's'}`}
        </Button>
      }>
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger ring-1 ring-inset ring-danger/20">
            {error.message}
          </div>
        )}

        <Field label="Leave type" required error={error?.fieldError('leaveTypeId')}>
          <Select value={form.leaveTypeId} onChange={set('leaveTypeId')}>
            <option value="">Select…</option>
            {(types.data?.data ?? []).map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}{t.isPaid ? '' : ' (unpaid)'}</option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="From" required error={error?.fieldError('fromDate')}>
            <Input type="date" value={form.fromDate}
              onChange={(e) => setForm((f) => ({
                ...f, fromDate: e.target.value,
                // Keep the range valid rather than letting the user submit a
                // backwards one and be told off afterwards.
                toDate: f.toDate < e.target.value ? e.target.value : f.toDate,
              }))} />
          </Field>
          <Field label="To" required error={error?.fieldError('toDate')}>
            <Input type="date" value={form.toDate} min={form.fromDate} onChange={set('toDate')} />
          </Field>
        </div>

        <Field label="Reason" required error={error?.fieldError('reason')}
               hint="A line is enough — your manager sees this.">
          <Textarea rows={3} value={form.reason} onChange={set('reason')}
                    placeholder="Family function at home" />
        </Field>
      </div>
    </Sheet>
  );
}
