import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlarmClock, ArrowRight, BadgeIndianRupee, CalendarClock, CheckCircle2, ClipboardList,
  FolderKanban, Stamp, TimerReset, TrendingUp, Users,
} from 'lucide-react';
import { METRIC_DEFINITIONS, WORK_STATUS, dateLabel, hours, money, relativeDays } from '@adisys/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import {
  Button, Card, CardHeader, EmptyState, ErrorState, InfoTip, Select, Skeleton,
  StatusBadge, TONE_HEX, cx,
} from '../components/ui';
import {
  AXIS_PROPS, BAR_RADIUS, BAR_RADIUS_H, CATEGORICAL, CHART, ChartCard, ChartTooltip,
} from '../components/charts';

/* =================================================================== */
function Kpi({ label, value, sub, icon: Icon, tone = 'neutral', to, definition }: {
  label: string; value: string; sub?: string; icon: typeof Users;
  tone?: 'neutral' | 'warning' | 'danger' | 'success'; to?: string; definition?: string;
}) {
  const accent = {
    neutral: 'text-ink-400', warning: 'text-warning', danger: 'text-danger', success: 'text-success',
  }[tone];

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1 text-xs font-medium text-ink-500">
          {label}
          {definition && <InfoTip text={definition} />}
        </p>
        <Icon className={cx('h-4 w-4 shrink-0', accent)} aria-hidden />
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
      {sub && <p className={cx('mt-0.5 text-xs', tone === 'neutral' ? 'text-ink-500' : accent)}>{sub}</p>}
    </>
  );

  return to
    ? <Link to={to} className="rounded-card bg-card p-4 shadow-card ring-1 ring-line transition-shadow hover:shadow-raised">{body}</Link>
    : <div className="rounded-card bg-card p-4 shadow-card ring-1 ring-line">{body}</div>;
}

function KpiSkeleton() {
  return (
    <div className="rounded-card bg-card p-4 shadow-card ring-1 ring-line">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}

/* =================================================================== */
export function DashboardPage() {
  const { user, can } = useAuth();
  const [days, setDays] = useState(30);
  const [projectId, setProjectId] = useState('');

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 600_000 });
  const kpis = useQuery({
    queryKey: ['dashboard', projectId],
    queryFn: () => api.get('/dashboard', { projectId: projectId || undefined }),
  });
  const charts = useQuery({
    queryKey: ['dashboard', 'charts', days, projectId],
    queryFn: () => api.get('/dashboard/charts', { days, projectId: projectId || undefined }),
  });
  const attention = useQuery({
    queryKey: ['dashboard', 'attention'],
    queryFn: () => api.get('/dashboard/attention'),
  });

  const k = kpis.data?.kpis;
  const firstName = user?.fullName.split(' ')[0] ?? '';

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${firstName}`}
        description="Today's field operations across the projects you are responsible for."
        actions={
          <>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}
                    className="w-56" aria-label="Filter by project">
              <option value="">All projects</option>
              {lookups.data?.projects?.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}
                    className="w-36" aria-label="Chart period">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </Select>
          </>
        }
      />

      <div className="space-y-5 p-4 sm:p-6">
        {/* ---- KPI row ------------------------------------------------ */}
        {kpis.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => <KpiSkeleton key={i} />)}
          </div>
        ) : kpis.isError ? (
          <Card><ErrorState error={kpis.error} onRetry={() => kpis.refetch()} /></Card>
        ) : k && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Kpi label="Employees" value={String(k.totalEmployees)} icon={Users}
                 sub={`${k.activeEmployees} active · ${k.onDutyNow} on duty now`} to="/employees" />
            <Kpi label="Active projects" value={String(k.activeProjects)} icon={FolderKanban}
                 sub={`${k.totalProjects} total${k.onHoldProjects ? ` · ${k.onHoldProjects} on hold` : ''}`} to="/projects" />
            <Kpi label="Work assigned today" value={String(k.workAssignedToday)} icon={ClipboardList}
                 sub={`${k.workCompletedToday} completed today`} to="/work" />
            <Kpi label="Pending acknowledgement" value={String(k.pendingAcknowledgements)} icon={CalendarClock}
                 tone={k.pendingAcknowledgements > 0 ? 'warning' : 'neutral'}
                 sub={k.pendingAcknowledgements > 0 ? 'Field staff have not confirmed receipt' : 'All confirmed'}
                 to="/work?view=pending_ack"
                 definition={METRIC_DEFINITIONS.acknowledgement_rate} />
            <Kpi label="Overdue work" value={String(k.overdueAssignments)} icon={AlarmClock}
                 tone={k.overdueAssignments > 0 ? 'danger' : 'success'}
                 sub={k.overdueAssignments > 0 ? 'Past the due date' : 'Nothing overdue'}
                 to="/work?view=overdue" />

            <Kpi label="Verified hours today" value={hours(k.verifiedMinutesToday)} icon={CheckCircle2}
                 sub={`${hours(k.recordedMinutesToday)} recorded`} to="/productivity"
                 definition={METRIC_DEFINITIONS.verified_hours} />
            <Kpi label="Time awaiting verification" value={String(k.entriesAwaitingVerification)} icon={TimerReset}
                 tone={k.entriesAwaitingVerification > 0 ? 'warning' : 'neutral'}
                 sub="Entries a manager has not reviewed" to="/productivity"
                 definition={METRIC_DEFINITIONS.recorded_hours} />
            <Kpi label="Expenses this month" value={money(k.expensesThisMonth, { compact: true })}
                 icon={BadgeIndianRupee} sub="Approved and settled" to="/expenses"
                 definition={METRIC_DEFINITIONS.approved_expense} />
            <Kpi label="Pending approvals" value={String(k.pendingExpenseApprovals)} icon={Stamp}
                 tone={k.pendingExpenseApprovals > 0 ? 'warning' : 'neutral'}
                 sub={money(k.pendingExpenseAmount, { compact: true })} to="/approvals"
                 definition={METRIC_DEFINITIONS.pending_expense} />
            <Kpi label="Total project expense" value={money(k.totalProjectExpense, { compact: true })}
                 icon={TrendingUp}
                 sub={k.totalBudget > 0 ? `of ${money(k.totalBudget, { compact: true })} budgeted` : 'No budgets configured'}
                 to="/reports" definition={METRIC_DEFINITIONS.budget_utilisation} />
          </div>
        )}

        {/* ---- Charts -------------------------------------------------- */}
        <div className="grid gap-5 xl:grid-cols-2">
          <ChartCard
            title="Expense trend"
            subtitle="Last 12 months, by decision outcome"
            tooltip={METRIC_DEFINITIONS.approved_expense}
            series={[
              { name: 'Approved', color: CHART.approved },
              { name: 'Pending', color: CHART.pending },
              { name: 'Rejected', color: CHART.rejected },
            ]}
            empty={!charts.data?.expenseTrend?.length}
            table={{
              columns: ['Month', 'Approved', 'Pending', 'Rejected'],
              rows: (charts.data?.expenseTrend ?? []).map((r: any) =>
                [r.month, money(r.approved), money(r.pending), money(r.rejected)]),
            }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={charts.data?.expenseTrend ?? []} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid {...{ stroke: CHART.grid, vertical: false }} />
                <XAxis dataKey="month" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={(v) => money(v, { compact: true })} width={64} />
                <Tooltip cursor={{ fill: 'var(--color-sunken)' }}
                         content={<ChartTooltip formatter={(v: number) => money(v)} />} />
                <Bar dataKey="approved" name="Approved" stackId="a" fill={CHART.approved} />
                <Bar dataKey="pending"  name="Pending"  stackId="a" fill={CHART.pending} />
                <Bar dataKey="rejected" name="Rejected" stackId="a" fill={CHART.rejected} radius={BAR_RADIUS} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Work completion"
            subtitle={`Assigned versus completed, last ${days} days`}
            tooltip={METRIC_DEFINITIONS.task_completion_rate}
            series={[
              { name: 'Assigned', color: CHART.assigned },
              { name: 'Completed', color: CHART.completed },
            ]}
            empty={!charts.data?.workCompletion?.length}
            table={{
              columns: ['Date', 'Assigned', 'Completed'],
              rows: (charts.data?.workCompletion ?? []).map((r: any) => [r.date, r.assigned, r.completed]),
            }}>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={charts.data?.workCompletion ?? []} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid {...{ stroke: CHART.grid, vertical: false }} />
                <XAxis dataKey="date" {...AXIS_PROPS}
                       tickFormatter={(v) => dateLabel(v, { withYear: false })} minTickGap={28} />
                <YAxis {...AXIS_PROPS} width={40} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />}
                         labelFormatter={(v) => dateLabel(String(v))} />
                <Line type="monotone" dataKey="assigned" name="Assigned" stroke={CHART.assigned}
                      strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                <Line type="monotone" dataKey="completed" name="Completed" stroke={CHART.completed}
                      strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Expense by category"
            subtitle={`Approved spend, last ${days} days`}
            empty={!charts.data?.expenseByCategory?.length}
            table={{
              columns: ['Category', 'Claims', 'Approved'],
              rows: (charts.data?.expenseByCategory ?? []).map((r: any) => [r.category, r.count, money(r.approved)]),
            }}>
            <ResponsiveContainer width="100%" height={Math.max(200, (charts.data?.expenseByCategory?.length ?? 3) * 34)}>
              <BarChart layout="vertical" data={(charts.data?.expenseByCategory ?? []).slice(0, 7)}
                        margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} horizontal={false} />
                <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v) => money(v, { compact: true })} />
                <YAxis type="category" dataKey="category" {...AXIS_PROPS} width={132} />
                <Tooltip cursor={{ fill: 'var(--color-sunken)' }}
                         content={<ChartTooltip formatter={(v: number) => money(v)} />} />
                <Bar dataKey="approved" name="Approved" radius={BAR_RADIUS_H} barSize={16}>
                  {(charts.data?.expenseByCategory ?? []).slice(0, 7).map((_: any, i: number) => (
                    <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Productive hours by employee"
            subtitle={`Verified versus awaiting verification, last ${days} days`}
            tooltip={METRIC_DEFINITIONS.verified_hours}
            series={[
              { name: 'Verified', color: CHART.verified },
              { name: 'Awaiting verification', color: CHART.recorded },
            ]}
            empty={!charts.data?.productivityByEmployee?.length}
            table={{
              columns: ['Employee', 'Verified', 'Awaiting verification'],
              rows: (charts.data?.productivityByEmployee ?? []).map((r: any) =>
                [r.employee, hours(r.verifiedMinutes), hours(r.unverifiedMinutes)]),
            }}>
            <ResponsiveContainer width="100%" height={Math.max(200, (charts.data?.productivityByEmployee?.length ?? 3) * 30)}>
              <BarChart layout="vertical" data={charts.data?.productivityByEmployee ?? []}
                        margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} horizontal={false} />
                <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                <YAxis type="category" dataKey="employee" {...AXIS_PROPS} width={124} />
                <Tooltip cursor={{ fill: 'var(--color-sunken)' }}
                         content={<ChartTooltip formatter={(v: number) => hours(v)} />} />
                <Bar dataKey="verifiedMinutes" name="Verified" stackId="h" fill={CHART.verified} barSize={14} />
                <Bar dataKey="unverifiedMinutes" name="Awaiting verification" stackId="h"
                     fill={CHART.recorded} barSize={14} radius={BAR_RADIUS_H} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* ---- Needs attention ---------------------------------------- */}
        <div className="grid gap-5 xl:grid-cols-3">
          <AttentionList
            title="Overdue work"
            subtitle="Past the due date and not completed"
            to="/work?view=overdue"
            loading={attention.isLoading}
            items={attention.data?.overdue ?? []}
            render={(a: any) => ({
              key: a.id,
              href: `/work?id=${a.id}`,
              primary: a.title,
              secondary: `${a.assignmentCode} · ${a.assigneeName} · ${a.projectName}`,
              right: <StatusBadge tone="danger">{a.daysOverdue}d late</StatusBadge>,
            })}
            emptyTitle="Nothing overdue"
            emptyBody="Every assignment is either on schedule or complete." />

          <AttentionList
            title="Awaiting acknowledgement"
            subtitle="Sent to field staff, not yet confirmed"
            to="/work?view=pending_ack"
            loading={attention.isLoading}
            items={attention.data?.pendingAck ?? []}
            render={(a: any) => ({
              key: a.id,
              href: `/work?id=${a.id}`,
              primary: a.title,
              secondary: `${a.assignmentCode} · ${a.assigneeName}`,
              right: <StatusBadge tone="warning">{relativeDays(a.assignmentDate)}</StatusBadge>,
            })}
            emptyTitle="All acknowledged"
            emptyBody="Every issued assignment has been confirmed by the employee." />

          <AttentionList
            title="Expenses awaiting decision"
            subtitle="Oldest first"
            to="/approvals"
            loading={attention.isLoading}
            items={attention.data?.pendingApprovals ?? []}
            render={(c: any) => ({
              key: c.id,
              href: `/expenses/${c.id}`,
              primary: `${money(c.amount)} · ${c.categoryName}`,
              secondary: `${c.expenseCode} · ${c.employeeName}`,
              right: (
                <StatusBadge tone={c.daysWaiting > 3 ? 'danger' : 'warning'}>
                  {c.daysWaiting > 0 ? `${c.daysWaiting}d` : 'Today'}
                </StatusBadge>
              ),
            })}
            emptyTitle="Approval queue is clear"
            emptyBody="No expense claims are waiting for a decision." />
        </div>
      </div>
    </>
  );
}

/* =================================================================== */
function AttentionList({ title, subtitle, to, items, loading, render, emptyTitle, emptyBody }: {
  title: string; subtitle: string; to: string; items: any[]; loading: boolean;
  render: (item: any) => { key: string; href: string; primary: string; secondary: string; right: React.ReactNode };
  emptyTitle: string; emptyBody: string;
}) {
  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader
          title={title}
          subtitle={subtitle}
          action={
            <Link to={to} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
      </div>

      {loading ? (
        <div className="space-y-2 px-5 pb-5">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title={emptyTitle} description={emptyBody} />
      ) : (
        <ul className="divide-y divide-line">
          {items.slice(0, 6).map((item) => {
            const r = render(item);
            return (
              <li key={r.key}>
                <Link to={r.href} className="flex items-center gap-3 px-5 py-2.5 hover:bg-ink-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-800">{r.primary}</p>
                    <p className="truncate text-xs text-ink-500">{r.secondary}</p>
                  </div>
                  {r.right}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
};
