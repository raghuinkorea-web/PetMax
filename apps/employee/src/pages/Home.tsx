import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, CalendarCheck, CheckCircle2, ChevronRight, LogIn, LogOut,
  MapPin, Pause, Play, Plus, Receipt, Timer,
} from 'lucide-react';
import {
  METRIC_DEFINITIONS, WORK_STATUS, dateLabel, hours, money, todayIso, type WorkStatus,
} from '@adisys/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { Screen, ScreenHeader } from '../components/Shell';
import {
  Button, Card, EmptyState, SectionTitle, Skeleton, StatusBadge, cx, useToast,
} from '../components/ui';

export function HomeScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const day = useQuery({ queryKey: ['my-day'], queryFn: () => api.get('/dashboard/my-day') });
  const week = useQuery({ queryKey: ['my-week', todayIso()], queryFn: () => api.get('/assignments/my-week') });

  const today = (week.data?.days ?? []).find((d: any) => d.date === todayIso());
  const todayItems = today?.items ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['my-day'] });
    void qc.invalidateQueries({ queryKey: ['my-week'] });
    void qc.invalidateQueries({ queryKey: ['timer'] });
  };

  const checkIn = useMutation({
    mutationFn: async () => {
      // Location is only sent when the employee has consented; the server
      // discards coordinates otherwise.
      const coords = user?.locationConsentAt ? await currentPosition() : null;
      return api.post('/time/attendance/check-in', coords ?? {});
    },
    onSuccess: (res) => {
      toast.success('Checked in', res.locationRecorded
        ? 'Your site location was recorded with your consent.'
        : 'Attendance recorded.');
      invalidate();
    },
    onError: (err) => toast.error('Could not check in', (err as Error).message),
  });

  const checkOut = useMutation({
    mutationFn: async () => {
      const coords = user?.locationConsentAt ? await currentPosition() : null;
      return api.post('/time/attendance/check-out', coords ?? {});
    },
    onSuccess: (res) => {
      toast.success('Checked out', `On duty for ${hours(res.durationMinutes)}.`);
      invalidate();
    },
    onError: (err) => toast.error('Could not check out', (err as Error).message),
  });

  const onDuty = day.data?.attendance?.onDuty;
  const firstName = user?.fullName.split(' ')[0] ?? '';

  return (
    <>
      <ScreenHeader
        title={`${greeting()}, ${firstName}`}
        subtitle={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        action={
          <Link to="/profile" aria-label="Profile">
            <Avatar name={user?.fullName ?? '?'} fileId={user?.avatarFileId} size={40} />
          </Link>
        }
      />

      <Screen>
        {/* --- On duty / timer ---------------------------------- */}
        <Card className={cx('transition-colors', onDuty && 'ring-2 ring-success/30')}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-ink-500">
                {onDuty ? 'On duty since' : 'Not checked in'}
              </p>
              <p className="tabular mt-0.5 text-xl font-semibold text-ink-900">
                {onDuty
                  ? new Date(day.data.attendance.checkInAt).toLocaleTimeString('en-IN',
                      { hour: '2-digit', minute: '2-digit', hour12: true })
                  : '—'}
              </p>
            </div>
            <Button
              variant={onDuty ? 'secondary' : 'success'}
              loading={checkIn.isPending || checkOut.isPending}
              icon={onDuty ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              onClick={() => (onDuty ? checkOut : checkIn).mutate()}>
              {onDuty ? 'Check out' : 'Check in'}
            </Button>
          </div>

          <TimerStrip onChange={invalidate} />
        </Card>

        {/* --- Today's numbers ---------------------------------- */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Assigned" value={day.data?.work?.todayTotal ?? 0} loading={day.isLoading} />
          <Stat label="In progress" value={day.data?.work?.todayInProgress ?? 0} loading={day.isLoading} tone="progress" />
          <Stat label="Completed" value={day.data?.work?.todayCompleted ?? 0} loading={day.isLoading} tone="success" />
        </div>

        {/* --- Acknowledgement prompt --------------------------- */}
        {(day.data?.work?.pendingAckTotal ?? 0) > 0 && (
          <Card className="bg-warning-soft ring-warning/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">
                  {day.data.work.pendingAckTotal} assignment{day.data.work.pendingAckTotal === 1 ? '' : 's'} need your acknowledgement
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
                  Acknowledging confirms you have received and read the work. It does not mark it complete.
                </p>
                <Button variant="primary" size="sm" className="mt-3"
                        icon={<CalendarCheck className="h-3.5 w-3.5" />}
                        onClick={() => navigate('/work?acknowledge=1')}>
                  Review and acknowledge
                </Button>
              </div>
            </div>
          </Card>
        )}

        {(day.data?.work?.overdue ?? 0) > 0 && (
          <Card className="bg-danger-soft ring-danger/30">
            <Link to="/work?view=overdue" className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden />
              <p className="min-w-0 flex-1 text-sm font-medium text-ink-900">
                {day.data.work.overdue} assignment{day.data.work.overdue === 1 ? ' is' : 's are'} past the due date
              </p>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            </Link>
          </Card>
        )}

        {/* --- Today's work ------------------------------------- */}
        <section>
          <SectionTitle action={
            <Link to="/work" className="tap-sm flex items-center gap-1 text-xs font-medium text-brand-600">
              All work <ArrowRight className="h-3 w-3" />
            </Link>
          }>
            Today's work
          </SectionTitle>

          {week.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
          ) : todayItems.length === 0 ? (
            <Card>
              <EmptyState icon={<CheckCircle2 className="h-5 w-5" />}
                title="Nothing assigned for today"
                description="Your manager has not issued work for today. Check the week view for what is coming up." />
            </Card>
          ) : (
            <ul className="space-y-2">
              {todayItems.map((a: any) => <TaskCard key={a.id} assignment={a} />)}
            </ul>
          )}
        </section>

        {/* --- Expenses summary --------------------------------- */}
        <section>
          <SectionTitle action={
            <Link to="/expenses" className="tap-sm flex items-center gap-1 text-xs font-medium text-brand-600">
              All claims <ArrowRight className="h-3 w-3" />
            </Link>
          }>
            Your expenses
          </SectionTitle>
          <Card>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-[12px] text-ink-500">Awaiting decision</dt>
                <dd className="tabular mt-0.5 text-lg font-semibold text-warning">{day.data?.expenses?.pending ?? 0}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-500">Needs correction</dt>
                <dd className="tabular mt-0.5 text-lg font-semibold text-danger">{day.data?.expenses?.returned ?? 0}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-500">Awaiting payment</dt>
                <dd className="tabular mt-0.5 text-lg font-semibold text-success">
                  {money(day.data?.expenses?.awaitingPayment ?? 0, { compact: true })}
                </dd>
              </div>
            </dl>
            <Button variant="primary" block className="mt-4" icon={<Plus className="h-4 w-4" />}
                    onClick={() => navigate('/expenses/new')}>
              Add an expense
            </Button>
          </Card>
        </section>

        {/* --- This week's hours -------------------------------- */}
        <section>
          <SectionTitle>This week</SectionTitle>
          <Card>
            <dl className="space-y-3">
              <Line label="Recorded against work" value={hours(day.data?.time?.recordedMinutesThisWeek)}
                    hint={METRIC_DEFINITIONS.recorded_hours} />
              <Line label="Verified by your manager" value={hours(day.data?.time?.verifiedMinutesThisWeek)}
                    tone="success" hint={METRIC_DEFINITIONS.verified_hours} />
            </dl>
            <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-500">
              Only hours your manager has verified count as productive time in ADISYS reports.
            </p>
          </Card>
        </section>
      </Screen>
    </>
  );
}

/* =================================================================== */
export function TaskCard({ assignment: a, showDate }: { assignment: any; showDate?: boolean }) {
  const meta = WORK_STATUS.byValue[a.status as WorkStatus];
  return (
    <li>
      <Link to={`/work/${a.id}`}
        className="block rounded-2xl bg-card p-4 shadow-card ring-1 ring-line active:bg-ink-50">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug text-ink-900">{a.title}</p>
            <p className="tabular mt-0.5 truncate text-xs text-ink-500">
              {a.assignmentCode} · {a.projectName}
            </p>
          </div>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>

        {a.acknowledgement.changedSinceAck && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12px] font-medium text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Changed since you acknowledged it — please review again
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-500">
          {a.locationText && (
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{a.locationText}</span>
            </span>
          )}
          {a.estimatedHours && (
            <span className="flex items-center gap-1"><Timer className="h-3 w-3" aria-hidden />{a.estimatedHours}h planned</span>
          )}
          <span className={cx('flex items-center gap-1', a.isOverdue && 'font-medium text-danger')}>
            Due {dateLabel(a.dueDate, { withYear: false })}
          </span>
          {showDate && <span>· {dateLabel(a.assignmentDate, { withYear: false })}</span>}
        </div>

        {a.progressPct > 0 && a.status !== 'completed' && (
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-progress" style={{ width: `${a.progressPct}%` }} />
          </div>
        )}
      </Link>
    </li>
  );
}

/* =================================================================== */
function TimerStrip({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [elapsed, setElapsed] = useState('0:00');

  const timer = useQuery({
    queryKey: ['timer'],
    queryFn: () => api.get('/time/timer'),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!timer.data?.running || !timer.data.startedAt) return;
    const tick = () => {
      const ms = Date.now() - new Date(timer.data.startedAt).getTime();
      const m = Math.floor(ms / 60000);
      setElapsed(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [timer.data?.running, timer.data?.startedAt]);

  const pause = useMutation({
    mutationFn: () => api.post('/time/timer/pause'),
    onSuccess: (res) => {
      toast.success('Timer paused', `${hours(res.durationMinutes)} recorded on this stretch.`);
      void qc.invalidateQueries({ queryKey: ['timer'] });
      onChange();
    },
    onError: (err) => toast.error('Could not pause the timer', (err as Error).message),
  });

  if (timer.isLoading) return <Skeleton className="mt-3 h-14" />;

  if (!timer.data?.running) {
    return (
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <div>
          <p className="text-xs text-ink-500">Recorded today</p>
          <p className="tabular text-sm font-semibold text-ink-800">
            {hours(timer.data?.recordedMinutesToday ?? 0)}
          </p>
        </div>
        <p className="text-right text-[12px] leading-tight text-ink-400">
          Open a task to<br />start its timer
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl bg-progress-soft p-3 ring-1 ring-inset ring-progress/20">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-progress opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-progress" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-progress">Working on {timer.data.assignmentCode}</p>
        <p className="tabular text-lg font-semibold leading-tight text-ink-900">{elapsed}</p>
      </div>
      <Button size="sm" loading={pause.isPending} icon={<Pause className="h-3.5 w-3.5" />}
              onClick={() => pause.mutate()}>Pause</Button>
    </div>
  );
}

/* =================================================================== */
function Stat({ label, value, loading, tone }: {
  label: string; value: number; loading?: boolean; tone?: 'progress' | 'success';
}) {
  const colour = tone === 'progress' ? 'text-progress' : tone === 'success' ? 'text-success' : 'text-ink-900';
  return (
    <div className="rounded-2xl bg-card p-3 text-center shadow-card ring-1 ring-line">
      <p className="text-[12px] text-ink-500">{label}</p>
      {loading
        ? <Skeleton className="mx-auto mt-1 h-6 w-8" />
        : <p className={cx('tabular mt-0.5 text-xl font-semibold', colour)}>{value}</p>}
    </div>
  );
}

function Line({ label, value, tone, hint }: { label: string; value: string; tone?: 'success'; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-600" title={hint}>{label}</dt>
      <dd className={cx('tabular text-sm font-semibold', tone === 'success' ? 'text-success' : 'text-ink-900')}>
        {value}
      </dd>
    </div>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Best-effort GPS fix; never blocks the action if it fails or is denied. */
async function currentPosition(): Promise<{ latitude: number; longitude: number; accuracyM: number } | null> {
  if (!('geolocation' in navigator)) return null;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeout);
        resolve({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracyM: Math.round(pos.coords.accuracy),
        });
      },
      () => { clearTimeout(timeout); resolve(null); },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30_000 });
  });
}
