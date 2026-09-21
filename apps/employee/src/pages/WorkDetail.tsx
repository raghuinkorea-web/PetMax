import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CheckCheck, CircleHelp, Clock, MapPin, Pause, Play, Send, Timer,
} from 'lucide-react';
import {
  PRIORITY, WORK_STATUS, dateLabel, dateTimeLabel, hours, relativeDays, type WorkStatus,
} from '@adisys/shared';
import { api } from '../lib/api';
import { deviceLabel } from '../lib/auth';
import {
  Button, Card, ErrorState, Field, SectionTitle, Sheet, Skeleton, StatusBadge, Textarea, cx, useToast,
} from '../components/ui';

export function WorkDetailScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<'clarify' | 'submit' | 'progress' | null>(null);

  const query = useQuery({ queryKey: ['assignment', id], queryFn: () => api.get(`/assignments/${id}`) });
  const timer = useQuery({ queryKey: ['timer'], queryFn: () => api.get('/time/timer') });
  const a = query.data?.assignment;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['assignment', id] });
    void qc.invalidateQueries({ queryKey: ['assignments'] });
    void qc.invalidateQueries({ queryKey: ['timer'] });
    void qc.invalidateQueries({ queryKey: ['my-day'] });
    void qc.invalidateQueries({ queryKey: ['my-week'] });
  };

  const acknowledge = useMutation({
    mutationFn: () => api.post(`/assignments/${id}/acknowledge`, {
      decision: 'acknowledged', deviceLabel: deviceLabel(),
    }),
    onSuccess: () => {
      toast.success('Acknowledged',
        'Your manager can see you have received this. It still needs to be completed.');
      invalidate();
    },
    onError: (err) => toast.error('Could not acknowledge', (err as Error).message),
  });

  const startTimer = useMutation({
    mutationFn: () => api.post('/time/timer/start', { assignmentId: id }),
    onSuccess: () => { toast.success('Timer started', 'Recording time against this assignment.'); invalidate(); },
    onError: (err) => toast.error('Could not start the timer', (err as Error).message),
  });

  const pauseTimer = useMutation({
    mutationFn: () => api.post('/time/timer/pause'),
    onSuccess: (res) => { toast.success('Timer paused', `${hours(res.durationMinutes)} recorded.`); invalidate(); },
    onError: (err) => toast.error('Could not pause the timer', (err as Error).message),
  });

  if (query.isLoading) {
    return (
      <div className="safe-top space-y-3 p-4">
        <Skeleton className="h-8 w-24" /><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (query.isError || !a) {
    return (
      <div className="safe-top p-4">
        <Card><ErrorState error={query.error ?? new Error('Assignment not found')}
                          onRetry={() => query.refetch()} /></Card>
        <Button block className="mt-3" onClick={() => navigate('/work')}>Back to my work</Button>
      </div>
    );
  }

  const meta = WORK_STATUS.byValue[a.status as WorkStatus];
  const priority = PRIORITY.byValue[a.priority as 'medium'];
  const acknowledged = a.acknowledgement.isCurrent;
  const runningHere = timer.data?.running && timer.data.assignmentId === id;
  const closed = ['completed', 'cancelled'].includes(a.status);

  return (
    <>
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-card px-4 pb-3 pt-3">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <button onClick={() => navigate(-1)} aria-label="Back"
            className="-ml-2 rounded-lg p-2 text-ink-600 active:bg-ink-100">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="tabular truncate text-xs text-ink-500">{a.assignmentCode}</p>
            <p className="truncate text-sm font-semibold text-ink-900">{a.projectName}</p>
          </div>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>
      </header>

      <div className="mx-auto max-w-lg space-y-4 p-4 pb-40">
        {/* --- Title and facts -------------------------------- */}
        <Card>
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-lg font-semibold leading-snug text-ink-900">{a.title}</h1>
            <StatusBadge tone={priority.tone} dot={false}>{priority.label}</StatusBadge>
          </div>

          {a.description && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-600">{a.description}</p>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3.5">
            <Fact icon={<Clock className="h-3.5 w-3.5" />} term="Due"
                  value={`${dateLabel(a.dueDate, { withYear: false })} · ${relativeDays(a.dueDate)}`}
                  tone={a.isOverdue ? 'danger' : undefined} />
            <Fact icon={<Timer className="h-3.5 w-3.5" />} term="Planned"
                  value={a.estimatedHours ? `${a.estimatedHours} hours` : 'Not estimated'} />
            <Fact term="Recorded so far" value={hours(a.recordedMinutes)} />
            <Fact term="Assigned by" value={a.assignedByName} />
            {a.locationText && (
              <Fact icon={<MapPin className="h-3.5 w-3.5" />} term="Site" value={a.locationText} span />
            )}
          </dl>
        </Card>

        {/* --- Acknowledgement state -------------------------- */}
        {!closed && (
          <Card className={cx(acknowledged ? 'ring-success/30' : 'bg-warning-soft ring-warning/30')}>
            {acknowledged ? (
              <div className="flex items-start gap-2.5">
                <CheckCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-ink-900">You acknowledged this</p>
                  <p className="mt-0.5 text-xs text-ink-600">
                    {dateTimeLabel(a.acknowledgement.acknowledgedAt)} · version {a.acknowledgement.acknowledgedVersion}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">
                      {a.acknowledgement.changedSinceAck
                        ? 'This assignment changed'
                        : 'Please acknowledge this assignment'}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
                      {a.acknowledgement.changedSinceAck
                        ? `You acknowledged version ${a.acknowledgement.acknowledgedVersion}; it is now version ${a.version}. Read it again and confirm.`
                        : 'Confirming tells your manager you have received and read it. It does not mark the work as done.'}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="primary" className="flex-1" loading={acknowledge.isPending}
                          icon={<CheckCheck className="h-4 w-4" />}
                          onClick={() => acknowledge.mutate()}>
                    Acknowledge
                  </Button>
                  <Button icon={<CircleHelp className="h-4 w-4" />} onClick={() => setSheet('clarify')}>
                    Ask
                  </Button>
                </div>
              </>
            )}
          </Card>
        )}

        {/* --- Site instructions ------------------------------ */}
        {a.instructions && (
          <Card>
            <SectionTitle>Site instructions</SectionTitle>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{a.instructions}</p>
          </Card>
        )}

        {/* --- Manager's review ------------------------------- */}
        {a.reviewComment && (
          <Card className={cx(a.status === 'completed' ? 'bg-success-soft ring-success/30' : 'bg-warning-soft ring-warning/30')}>
            <SectionTitle>{a.status === 'completed' ? 'Accepted by your manager' : 'Your manager needs more information'}</SectionTitle>
            <p className="text-sm leading-relaxed text-ink-700">{a.reviewComment}</p>
            {a.reviewedByName && (
              <p className="mt-1.5 text-xs text-ink-500">{a.reviewedByName} · {dateTimeLabel(a.reviewedAt)}</p>
            )}
          </Card>
        )}

        {/* --- Your progress ---------------------------------- */}
        {!closed && acknowledged && (
          <Card>
            <SectionTitle action={
              <button onClick={() => setSheet('progress')}
                      className="tap-sm text-xs font-medium text-brand-600">Update</button>
            }>
              Progress
            </SectionTitle>
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-progress transition-all"
                     style={{ width: `${a.progressPct}%` }} />
              </div>
              <span className="tabular text-sm font-semibold text-ink-900">{a.progressPct}%</span>
            </div>
          </Card>
        )}

        {/* --- Time log --------------------------------------- */}
        {(query.data?.timeEntries ?? []).length > 0 && (
          <Card>
            <SectionTitle>Time you recorded</SectionTitle>
            <ul className="space-y-2">
              {query.data.timeEntries.map((t: any) => (
                <li key={t.id} className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="tabular text-sm text-ink-800">
                      {new Date(t.startedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      {t.endedAt && ` – ${new Date(t.endedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                    <p className="text-[11px] text-ink-500">{dateLabel(t.startedAt, { withYear: false })}</p>
                    {t.verificationNote && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-danger">{t.verificationNote}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-sm font-semibold text-ink-900">{hours(t.durationMinutes)}</p>
                    <StatusBadge dot={false}
                      tone={t.verificationStatus === 'verified' ? 'success'
                        : t.verificationStatus === 'rejected' ? 'danger' : 'info'}>
                      {t.verificationStatus === 'verified' ? 'Verified'
                        : t.verificationStatus === 'rejected' ? 'Discounted' : 'Recorded'}
                    </StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-relaxed text-ink-500">
              Recorded time becomes productive hours once your manager verifies it.
            </p>
          </Card>
        )}
      </div>

      {/* --- Action bar ------------------------------------- */}
      {!closed && acknowledged && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 py-3">
          <div className="mx-auto flex max-w-lg gap-2">
            {runningHere ? (
              <Button className="flex-1" size="lg" loading={pauseTimer.isPending}
                      icon={<Pause className="h-4 w-4" />} onClick={() => pauseTimer.mutate()}>
                Pause timer
              </Button>
            ) : (
              <Button className="flex-1" size="lg" variant={a.status === 'in_progress' ? 'secondary' : 'primary'}
                      loading={startTimer.isPending} icon={<Play className="h-4 w-4" />}
                      onClick={() => startTimer.mutate()}>
                {a.status === 'in_progress' ? 'Resume' : 'Start work'}
              </Button>
            )}
            {['in_progress', 'on_hold'].includes(a.status) && (
              <Button className="flex-1" size="lg" variant="success" icon={<Send className="h-4 w-4" />}
                      onClick={() => setSheet('submit')}>
                Mark done
              </Button>
            )}
          </div>
        </div>
      )}

      {sheet === 'clarify' && (
        <ClarifySheet id={id} onClose={() => setSheet(null)} onDone={() => { setSheet(null); invalidate(); }} />
      )}
      {sheet === 'submit' && (
        <SubmitSheet id={id} onClose={() => setSheet(null)}
                     onDone={() => { setSheet(null); invalidate(); navigate('/work'); }} />
      )}
      {sheet === 'progress' && (
        <ProgressSheet id={id} current={a.progressPct} onClose={() => setSheet(null)}
                       onDone={() => { setSheet(null); invalidate(); }} />
      )}
    </>
  );
}

/* =================================================================== */
function Fact({ icon, term, value, tone, span }: {
  icon?: React.ReactNode; term: string; value: string; tone?: 'danger'; span?: boolean;
}) {
  return (
    <div className={span ? 'col-span-2' : undefined}>
      <dt className="flex items-center gap-1 text-[11px] text-ink-500">{icon}{term}</dt>
      <dd className={cx('mt-0.5 text-sm', tone === 'danger' ? 'font-medium text-danger' : 'text-ink-800')}>
        {value}
      </dd>
    </div>
  );
}

function ClarifySheet({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const ask = useMutation({
    mutationFn: () => api.post(`/assignments/${id}/acknowledge`, {
      decision: 'clarification_requested', reason, deviceLabel: deviceLabel(),
    }),
    onSuccess: () => {
      toast.success('Sent to your manager', 'They have been notified and will get back to you.');
      onDone();
    },
    onError: (err) => toast.error('Could not send', (err as Error).message),
  });

  return (
    <Sheet open onClose={onClose} title="Ask for clarification"
      description="Your project manager is notified straight away."
      footer={
        <Button variant="primary" size="lg" block loading={ask.isPending}
                disabled={reason.trim().length < 5} onClick={() => ask.mutate()}>
          Send question
        </Button>
      }>
      <Field label="What do you need to know?" required
             hint="Be specific — it saves a phone call. For example, which drawing revision applies.">
        <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
                  placeholder="The drawing revision in the instructions is not on site — which one should I use?" />
      </Field>
    </Sheet>
  );
}

function SubmitSheet({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const submit = useMutation({
    mutationFn: () => api.post(`/assignments/${id}/status`, { status: 'submitted', note }),
    onSuccess: () => {
      toast.success('Submitted for review',
        'Your manager will accept it or come back with questions.');
      onDone();
    },
    onError: (err) => toast.error('Could not submit', (err as Error).message),
  });

  return (
    <Sheet open onClose={onClose} title="Submit for review"
      description="Your manager checks the work before it is marked complete."
      footer={
        <Button variant="success" size="lg" block loading={submit.isPending}
                icon={<Send className="h-4 w-4" />} onClick={() => submit.mutate()}>
          Submit for review
        </Button>
      }>
      <div className="space-y-4">
        <p className="rounded-xl bg-info-soft p-3 text-xs leading-relaxed text-ink-700 ring-1 ring-inset ring-info/20">
          Any running timer on this task is stopped automatically when you submit.
        </p>
        <Field label="Completion note" hint="What you did, and anything your manager should know.">
          <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} autoFocus
                    placeholder="Panel earthing verified on all four bays. Readings recorded on the job card, signed by the client engineer." />
        </Field>
      </div>
    </Sheet>
  );
}

function ProgressSheet({ id, current, onClose, onDone }: {
  id: string; current: number; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [pct, setPct] = useState(current);
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: () => api.post(`/assignments/${id}/progress`, { progressPct: pct, note: note || undefined }),
    onSuccess: () => { toast.success('Progress updated'); onDone(); },
    onError: (err) => toast.error('Could not update progress', (err as Error).message),
  });

  return (
    <Sheet open onClose={onClose} title="Update progress"
      footer={
        <Button variant="primary" size="lg" block loading={save.isPending} onClick={() => save.mutate()}>
          Save progress
        </Button>
      }>
      <div className="space-y-5">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-ink-700">Percent complete</span>
            <span className="tabular text-2xl font-semibold text-ink-900">{pct}%</span>
          </div>
          <input type="range" min={0} max={100} step={5} value={pct}
                 onChange={(e) => setPct(Number(e.target.value))}
                 aria-label="Percent complete"
                 className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-ink-100 accent-[var(--color-brand-500)]" />
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {[0, 25, 50, 75, 100].map((v) => (
              <button key={v} type="button" onClick={() => setPct(v)}
                className={cx('tap-sm rounded-lg py-1.5 text-xs font-medium',
                  pct === v ? 'bg-ink-900 text-white' : 'bg-sunken text-ink-600')}>
                {v}%
              </button>
            ))}
          </div>
        </div>
        <Field label="Note" hint="Optional. Visible to your manager in the activity log.">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Two of four bays done; waiting on a permit for the rest." />
        </Field>
      </div>
    </Sheet>
  );
}
