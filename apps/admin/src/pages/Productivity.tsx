import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { BadgeCheck, CalendarRange, CheckCheck, Download, Info, Timer, XCircle } from 'lucide-react';
import {
  METRIC_DEFINITIONS, TIME_VERIFICATION, dateLabel, decimalHours, hours, percent, todayIso,
} from '@adisys/shared';
import { api, downloadCsv } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import { Column, DataTable, FilterBar, FilterSelect } from '../components/DataTable';
import {
  Button, Card, CardHeader, Field, Input, InfoTip, Modal, StatusBadge, Tabs, Textarea,
  cx, useToast,
} from '../components/ui';
import { AXIS_PROPS, CHART, ChartCard, ChartTooltip } from '../components/charts';

const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export function ProductivityPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'summary' | 'verification'>('summary');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayIso());
  const [projectId, setProjectId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 600_000 });
  const filters = { from, to, projectId: projectId || undefined, departmentId: departmentId || undefined };

  const summary = useQuery({
    queryKey: ['productivity', 'summary', filters],
    queryFn: () => api.get('/reports/productivity/summary', filters),
  });
  const daily = useQuery({
    queryKey: ['productivity', 'daily', filters],
    queryFn: () => api.get('/reports/productivity/daily', filters),
  });

  const rows = summary.data?.rows ?? [];
  const totals = rows.reduce((acc: any, r: any) => ({
    attendance: acc.attendance + Number(r.attendanceMinutes),
    recorded: acc.recorded + Number(r.recordedMinutes),
    verified: acc.verified + Number(r.verifiedMinutes),
    unassigned: acc.unassigned + Number(r.unassignedMinutes),
  }), { attendance: 0, recorded: 0, verified: 0, unassigned: 0 });

  const columns: Array<Column<any>> = [
    {
      key: 'employee', header: 'Employee',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{r.employeeName}</p>
          <p className="tabular truncate text-xs text-ink-500">
            {r.employeeCode}{r.departmentName ? ` · ${r.departmentName}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'attendance', header: 'On duty', numeric: true, hideBelow: 'md',
      render: (r) => <span className="text-ink-600">{hours(r.attendanceMinutes)}</span>,
    },
    {
      key: 'recorded', header: 'Recorded', numeric: true,
      render: (r) => <span className="text-ink-700">{hours(r.recordedMinutes)}</span>,
    },
    {
      key: 'verified', header: 'Verified', numeric: true,
      render: (r) => <span className="font-medium text-success">{hours(r.verifiedMinutes)}</span>,
    },
    {
      key: 'unassigned', header: 'Unassigned', numeric: true, hideBelow: 'xl',
      render: (r) => Number(r.unassignedMinutes) > 0
        ? <span className="text-warning">{hours(r.unassignedMinutes)}</span>
        : <span className="text-ink-400">—</span>,
    },
    {
      key: 'plan', header: 'Planned vs recorded', numeric: true, hideBelow: 'lg',
      render: (r) => {
        const est = Number(r.estimatedMinutes);
        const rec = Number(r.recordedMinutes);
        if (!est) return <span className="text-ink-400">—</span>;
        const delta = Math.round(((rec - est) / est) * 100);
        return (
          <span className={cx(Math.abs(delta) > 25 ? 'text-warning' : 'text-ink-600')}>
            {decimalHours(est)}h → {decimalHours(rec)}h
            <span className="ml-1 text-xs">({delta > 0 ? '+' : ''}{delta}%)</span>
          </span>
        );
      },
    },
    {
      key: 'ack', header: 'Acknowledged', numeric: true, hideBelow: 'lg',
      render: (r) => <span className="text-ink-700">{percent(r.acknowledgementRatePct, 0)}</span>,
    },
    {
      key: 'completion', header: 'Completed', numeric: true,
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <span className="text-ink-800">{percent(r.completionRatePct, 0)}</span>
          <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-ink-100 sm:block">
            <span className="block h-full rounded-full bg-success"
                  style={{ width: `${Math.min(100, Number(r.completionRatePct ?? 0))}%` }} />
          </span>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Productivity"
        description="Availability, recorded time and verified productive hours — reported as three separate measures."
        actions={can('report.export') && (
          <Button icon={<Download className="h-4 w-4" />}
            onClick={() => downloadCsv('/reports/productivity/summary', filters, 'adisys-productivity.csv')
              .then(() => toast.success('Export started'))
              .catch((e) => toast.error('Export failed', e.message))}>
            Export CSV
          </Button>
        )}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From" className="w-40"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" className="w-40"><Input type="date" value={to} max={todayIso()} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Project" className="w-52">
            <FilterSelect label="Project" value={projectId} onChange={setProjectId} allLabel="All projects" className="w-52"
              options={(lookups.data?.projects ?? []).map((p: any) => ({ value: p.id, label: p.name }))} />
          </Field>
          <Field label="Department" className="w-48">
            <FilterSelect label="Department" value={departmentId} onChange={setDepartmentId} allLabel="All departments" className="w-48"
              options={(lookups.data?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))} />
          </Field>
          <div className="ml-auto flex gap-1.5">
            {[7, 30, 90].map((n) => (
              <Button key={n} size="sm" onClick={() => { setFrom(daysAgo(n)); setTo(todayIso()); }}>
                {n}d
              </Button>
            ))}
          </div>
        </div>
      </PageHeader>

      <div className="space-y-5 p-4 sm:p-6">
        {/* How the three measures relate — stated, not implied. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Measure label="On duty" value={hours(totals.attendance)} tone="neutral"
                   definition={METRIC_DEFINITIONS.attendance_hours} icon={CalendarRange} />
          <Measure label="Recorded against work" value={hours(totals.recorded)} tone="info"
                   definition={METRIC_DEFINITIONS.recorded_hours} icon={Timer} />
          <Measure label="Verified productive hours" value={hours(totals.verified)} tone="success"
                   definition={METRIC_DEFINITIONS.verified_hours} icon={BadgeCheck} />
          <Measure label="Logged without an assignment" value={hours(totals.unassigned)} tone="warning"
                   definition={METRIC_DEFINITIONS.unassigned_hours} icon={Info} />
        </div>

        <ChartCard
          title="Recorded versus verified hours"
          subtitle={`${dateLabel(from)} – ${dateLabel(to)}`}
          tooltip={METRIC_DEFINITIONS.verified_hours}
          series={[
            { name: 'Recorded', color: CHART.recorded },
            { name: 'Verified', color: CHART.verified },
          ]}
          empty={!daily.data?.rows?.length}
          table={{
            columns: ['Date', 'On duty', 'Recorded', 'Verified'],
            rows: (daily.data?.rows ?? []).map((r: any) =>
              [r.date, hours(r.attendanceMinutes), hours(r.recordedMinutes), hours(r.verifiedMinutes)]),
          }}>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={daily.data?.rows ?? []} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id="gRecorded" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.recorded} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={CHART.recorded} stopOpacity={0.01} />
                </linearGradient>
                <linearGradient id="gVerified" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.verified} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={CHART.verified} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="date" {...AXIS_PROPS} minTickGap={30}
                     tickFormatter={(v) => dateLabel(v, { withYear: false })} />
              <YAxis {...AXIS_PROPS} width={44} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
              <Tooltip content={<ChartTooltip formatter={(v: number) => hours(v)} />}
                       labelFormatter={(v) => dateLabel(String(v))} />
              <Area type="monotone" dataKey="recordedMinutes" name="Recorded" stroke={CHART.recorded}
                    strokeWidth={2} fill="url(#gRecorded)" />
              <Area type="monotone" dataKey="verifiedMinutes" name="Verified" stroke={CHART.verified}
                    strokeWidth={2} fill="url(#gVerified)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <Tabs
          tabs={[
            { key: 'summary', label: 'Per employee', count: rows.length },
            ...(can('time.verify') ? [{ key: 'verification' as const, label: 'Time awaiting verification' }] : []),
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === 'summary' ? (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.employeeCode}
            loading={summary.isLoading}
            error={summary.error}
            onRetry={() => summary.refetch()}
            empty={{
              title: 'No recorded activity in this period',
              description: 'Nobody logged time or was issued work between these dates.',
            }}
          />
        ) : (
          <VerificationQueue from={from} to={to} projectId={projectId}
            onVerified={() => {
              void qc.invalidateQueries({ queryKey: ['productivity'] });
              void qc.invalidateQueries({ queryKey: ['dashboard'] });
            }} />
        )}
      </div>
    </>
  );
}

/* =================================================================== */
function Measure({ label, value, tone, definition, icon: Icon }: {
  label: string; value: string; tone: 'neutral' | 'info' | 'success' | 'warning';
  definition: string; icon: typeof Timer;
}) {
  const colour = {
    neutral: 'text-ink-700', info: 'text-info', success: 'text-success', warning: 'text-warning',
  }[tone];
  return (
    <div className="rounded-card bg-card p-4 shadow-card ring-1 ring-line">
      <div className="flex items-start justify-between">
        <p className="flex items-center gap-1 text-xs font-medium text-ink-500">
          {label}<InfoTip text={definition} />
        </p>
        <Icon className={cx('h-4 w-4', colour)} aria-hidden />
      </div>
      <p className={cx('tabular mt-2 text-2xl font-semibold tracking-tight', colour)}>{value}</p>
    </div>
  );
}

/* =================================================================== */
function VerificationQueue({ from, to, projectId, onVerified }: {
  from: string; to: string; projectId: string; onVerified: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['time-entries', 'unverified', { from, to, projectId, page }],
    queryFn: () => api.get('/time/entries', {
      verification: 'unverified', from, to, projectId: projectId || undefined, page, size: 25,
    }),
  });

  const rows = query.data?.data ?? [];

  const act = useMutation({
    mutationFn: (decision: 'verify' | 'reject') =>
      api.post('/time/entries/verify-bulk', {
        entryIds: [...selected], decision, note: note || undefined,
      }),
    onSuccess: (res, decision) => {
      toast.success(
        `${res.count} ${decision === 'verify' ? 'verified' : 'discounted'}`,
        res.skipped > 0
          ? `${res.skipped} skipped — outside your approval scope or your own entries.`
          : decision === 'verify'
            ? 'These hours now count as productive time.'
            : 'These hours are excluded from productivity figures.');
      setSelected(new Set()); setNote(''); setRejecting(false);
      void query.refetch();
      onVerified();
    },
    onError: (err) => toast.error('Could not update the entries', (err as Error).message),
  });

  const columns: Array<Column<any>> = [
    {
      key: 'employee', header: 'Employee',
      render: (t) => <span className="text-ink-800">{t.userName}</span>,
    },
    {
      key: 'work', header: 'Recorded against',
      render: (t) => (
        <div className="min-w-0">
          <p className="truncate text-ink-800">{t.assignmentTitle ?? 'No assignment'}</p>
          <p className="tabular truncate text-xs text-ink-500">
            {t.assignmentCode ?? '—'} · {t.projectName}
          </p>
        </div>
      ),
    },
    { key: 'date', header: 'Date', render: (t) => dateLabel(t.workDate) },
    {
      key: 'duration', header: 'Duration', numeric: true,
      render: (t) => <span className="font-medium text-ink-900">{hours(t.durationMinutes)}</span>,
    },
    {
      key: 'source', header: 'Source', hideBelow: 'md',
      render: (t) => <StatusBadge tone={t.source === 'timer' ? 'info' : 'neutral'} dot={false}>{t.source}</StatusBadge>,
    },
    {
      key: 'notes', header: 'Note', hideBelow: 'xl',
      render: (t) => <span className="text-xs text-ink-500">{t.notes ?? '—'}</span>,
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        page={query.data?.page}
        onPage={setPage}
        selection={{
          selected,
          onToggle: (id) => setSelected((p) => {
            const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
          }),
          onToggleAll: () => setSelected((p) =>
            rows.every((r: any) => p.has(r.id)) ? new Set() : new Set(rows.map((r: any) => r.id))),
        }}
        empty={{
          icon: <CheckCheck className="h-5 w-5" />,
          title: 'Nothing awaiting verification',
          description: 'Every recorded entry in this period has been reviewed.',
        }}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-xs leading-relaxed text-ink-500">
              Verifying an entry is what turns recorded time into the productive hours ADISYS reports.
              Nothing else does, and you cannot verify your own entries.
            </p>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="tabular text-xs text-ink-600">{selected.size} selected</span>
                <Button size="sm" icon={<XCircle className="h-3.5 w-3.5" />}
                        onClick={() => setRejecting(true)}>Discount</Button>
                <Button size="sm" variant="success" loading={act.isPending}
                        icon={<BadgeCheck className="h-3.5 w-3.5" />}
                        onClick={() => act.mutate('verify')}>
                  Verify {selected.size}
                </Button>
              </div>
            )}
          </div>
        }
      />

      {rejecting && (
        <Modal open onClose={() => setRejecting(false)}
          title={`Discount ${selected.size} time ${selected.size === 1 ? 'entry' : 'entries'}`}
          description="Discounted time stays on the record but is excluded from productive hours."
          footer={
            <>
              <Button onClick={() => setRejecting(false)}>Cancel</Button>
              <Button variant="danger" loading={act.isPending} disabled={note.trim().length < 5}
                      onClick={() => act.mutate('reject')}>Discount</Button>
            </>
          }>
          <Field label="Reason" required hint="Recorded against each entry and visible to the employee.">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="e.g. Overlaps a second entry logged for the same hour." />
          </Field>
        </Modal>
      )}
    </>
  );
}
