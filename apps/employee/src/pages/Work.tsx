import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, CheckCheck, ClipboardList, Info } from 'lucide-react';
import { addDaysIso, dateLabel, mondayOf, todayIso } from '@adisys/shared';
import { api } from '../lib/api';
import { deviceLabel } from '../lib/auth';
import { Screen, ScreenHeader } from '../components/Shell';
import { TaskCard } from './Home';
import {
  Button, Card, EmptyState, ErrorState, SegmentedControl, Sheet, Skeleton, StatusBadge, cx, useToast,
} from '../components/ui';

type View = 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'pending_ack' | 'completed' | 'all';

const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'this_week', label: 'This week' },
  { value: 'next_week', label: 'Next week' },
  { value: 'pending_ack', label: 'To acknowledge' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

export function WorkScreen() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();

  const [view, setView] = useState<View>((params.get('view') as View) ?? 'today');
  const [ackScope, setAckScope] = useState<'day' | 'week' | null>(
    params.get('acknowledge') === '1' ? 'day' : null);

  const query = useQuery({
    queryKey: ['assignments', view],
    queryFn: () => api.get('/assignments', {
      view: view === 'completed' ? 'all' : view,
      status: view === 'completed' ? 'completed' : undefined,
      size: 60, sort: view === 'completed' ? 'assignment_date' : 'due_date',
      dir: view === 'completed' ? 'desc' : 'asc',
    }),
  });

  const day = useQuery({ queryKey: ['my-day'], queryFn: () => api.get('/dashboard/my-day') });
  const items = query.data?.data ?? [];
  const pendingAck = items.filter((a: any) => !a.acknowledgement.isCurrent
    && !['completed', 'cancelled'].includes(a.status));

  return (
    <>
      <ScreenHeader
        title="My work"
        subtitle={`${day.data?.work?.weekTotal ?? 0} assignment${day.data?.work?.weekTotal === 1 ? '' : 's'} this week`}
        action={
          <Button size="sm" variant="primary" icon={<CalendarCheck className="h-3.5 w-3.5" />}
                  onClick={() => setAckScope('week')}>
            Acknowledge
          </Button>
        }
      />

      <div className="sticky top-[4.4rem] z-20 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <SegmentedControl
            options={VIEWS.map((v) => ({
              ...v,
              count: v.value === 'pending_ack' ? day.data?.work?.pendingAckTotal : undefined,
            }))}
            value={view}
            onChange={(v) => { setView(v); setParams(v === 'today' ? {} : { view: v }); }}
          />
        </div>
      </div>

      <Screen>
        {pendingAck.length > 0 && view !== 'completed' && (
          <Card className="bg-warning-soft ring-warning/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">
                  {pendingAck.length} to acknowledge in this view
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
                  Confirm you have received and read them. This does not mark the work complete.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="primary" size="sm" onClick={() => setAckScope('day')}>
                    Acknowledge today
                  </Button>
                  <Button size="sm" onClick={() => setAckScope('week')}>This week</Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {query.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : query.isError ? (
          <Card><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState icon={<ClipboardList className="h-5 w-5" />}
              title={emptyTitle(view)} description={emptyBody(view)} />
          </Card>
        ) : (
          <ul className="space-y-2">
            {items.map((a: any) => (
              <TaskCard key={a.id} assignment={a}
                        showDate={['this_week', 'next_week', 'all', 'completed'].includes(view)} />
            ))}
          </ul>
        )}
      </Screen>

      {ackScope && (
        <BulkAcknowledgeSheet
          scope={ackScope}
          onClose={() => { setAckScope(null); setParams(view === 'today' ? {} : { view }); }}
          onDone={() => {
            setAckScope(null);
            void qc.invalidateQueries({ queryKey: ['assignments'] });
            void qc.invalidateQueries({ queryKey: ['my-day'] });
            void qc.invalidateQueries({ queryKey: ['my-week'] });
          }}
        />
      )}
    </>
  );
}

/* ===================================================================
   Bulk acknowledgement.
   The confirmation screen lists exactly what is about to be acknowledged
   and states plainly that this is not a completion. Nothing is acknowledged
   until the employee confirms.
   =================================================================== */
function BulkAcknowledgeSheet({ scope, onClose, onDone }: {
  scope: 'day' | 'week'; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(todayIso());

  const preview = useQuery({
    queryKey: ['ack-preview', scope, date],
    queryFn: () => api.get('/assignments/acknowledge-bulk/preview', { scope, date }),
  });

  const acknowledge = useMutation({
    mutationFn: () => api.post('/assignments/acknowledge-bulk', {
      scope, date, deviceLabel: deviceLabel(),
    }),
    onSuccess: (res) => {
      if (res.count === 0) toast.info('Nothing left to acknowledge', res.message);
      else toast.success(`${res.count} acknowledged`,
        'Your manager can see you have received this work. It still needs to be completed.');
      onDone();
    },
    onError: (err) => toast.error('Could not acknowledge', (err as Error).message),
  });

  const pending = preview.data?.pending ?? [];
  const weekStart = mondayOf(date);

  return (
    <Sheet
      open onClose={onClose}
      title={scope === 'day' ? 'Acknowledge today\'s work' : 'Acknowledge this week\'s work'}
      description={scope === 'day'
        ? dateLabel(date)
        : `${dateLabel(weekStart)} – ${dateLabel(addDaysIso(weekStart, 6))}`}
      footer={
        <div className="space-y-2">
          <Button variant="primary" size="lg" block
                  loading={acknowledge.isPending}
                  disabled={preview.isLoading || pending.length === 0}
                  icon={<CheckCheck className="h-4 w-4" />}
                  onClick={() => acknowledge.mutate()}>
            {pending.length === 0
              ? 'Nothing to acknowledge'
              : `Acknowledge ${pending.length} assignment${pending.length === 1 ? '' : 's'}`}
          </Button>
          <Button variant="ghost" block onClick={onClose}>Cancel</Button>
        </div>
      }>
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl bg-info-soft p-3 ring-1 ring-inset ring-info/20">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <p className="text-xs leading-relaxed text-ink-700">
            Acknowledging confirms you have <strong>received and read</strong> these assignments.
            It does <strong>not</strong> mark them as completed — you still start, work on and submit
            each one separately.
          </p>
        </div>

        {scope === 'day' && (
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="mt-1.5 h-12 w-full rounded-xl bg-white px-3.5 text-base ring-1 ring-inset ring-line-strong" />
          </label>
        )}

        {preview.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Summary label="To acknowledge" value={preview.data?.pendingCount ?? 0} tone="warning" />
              <Summary label="Already done" value={preview.data?.alreadyAcknowledged ?? 0} tone="success" />
              <Summary label="Planned hours"
                       value={Number(preview.data?.totalEstimatedHours ?? 0).toFixed(1)} />
            </dl>

            {(preview.data?.changedSinceAck ?? 0) > 0 && (
              <p className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-xs leading-relaxed text-warning ring-1 ring-inset ring-warning/20">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {preview.data.changedSinceAck} of these changed after you last acknowledged them.
                Read them again before confirming.
              </p>
            )}

            {pending.length === 0 ? (
              <EmptyState icon={<CheckCheck className="h-5 w-5" />}
                title="Everything here is acknowledged"
                description="There is nothing left to confirm for this period." />
            ) : (
              <ul className="space-y-2">
                {pending.map((a: any) => (
                  <li key={a.id} className="rounded-xl bg-sunken p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-ink-900">{a.title}</p>
                      {a.acknowledgement.changedSinceAck && (
                        <StatusBadge tone="warning" dot={false}>Changed</StatusBadge>
                      )}
                    </div>
                    <p className="tabular mt-0.5 truncate text-xs text-ink-500">
                      {a.assignmentCode} · {a.projectName}
                    </p>
                    <p className="mt-1 text-[12px] text-ink-500">
                      {dateLabel(a.assignmentDate, { withYear: false })} · due {dateLabel(a.dueDate, { withYear: false })}
                      {a.estimatedHours ? ` · ${a.estimatedHours}h planned` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function Summary({ label, value, tone }: { label: string; value: number | string; tone?: 'warning' | 'success' }) {
  const colour = tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-ink-900';
  return (
    <div className="rounded-xl bg-sunken px-2 py-2.5">
      <dt className="text-[12px] leading-tight text-ink-500">{label}</dt>
      <dd className={cx('tabular mt-0.5 text-lg font-semibold', colour)}>{value}</dd>
    </div>
  );
}

const emptyTitle = (v: View) => ({
  today: 'Nothing assigned for today',
  tomorrow: 'Nothing assigned for tomorrow yet',
  this_week: 'No work this week',
  next_week: 'Next week is not planned yet',
  pending_ack: 'Everything is acknowledged',
  completed: 'No completed work yet',
  all: 'No work assigned yet',
}[v]);

const emptyBody = (v: View) => ({
  today: 'Your manager has not issued work for today.',
  tomorrow: 'Check back later — weekly plans are usually issued the evening before.',
  this_week: 'Nothing has been scheduled for you this week.',
  next_week: 'Your manager has not published next week\'s plan.',
  pending_ack: 'You are up to date. Every assignment has been confirmed.',
  completed: 'Work you finish and your manager accepts will be listed here.',
  all: 'Once your manager assigns work, it will appear here.',
}[v]);
