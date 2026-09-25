import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowLeft, Download, UserMinus, UserPlus } from 'lucide-react';
import {
  METRIC_DEFINITIONS, PRIORITY, PROJECT_STATUS, WORK_STATUS, dateLabel, hours, money, percent,
  type ProjectStatus, type WorkStatus,
} from '@adisys/shared';
import { api, downloadCsv } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import {
  Button, Card, CardHeader, Checkbox, EmptyState, ErrorState, InfoTip, Modal, Skeleton,
  StatusBadge, Tabs, cx, useToast,
} from '../components/ui';
import { AXIS_PROPS, BAR_RADIUS, CATEGORICAL, CHART, ChartCard, ChartTooltip } from '../components/charts';

type Tab = 'overview' | 'team' | 'work' | 'expenses' | 'activity';

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [addMembers, setAddMembers] = useState(false);

  const query = useQuery({ queryKey: ['project', id], queryFn: () => api.get(`/projects/${id}`) });
  const p = query.data?.project;

  const work = useQuery({
    queryKey: ['project', id, 'work'],
    queryFn: () => api.get('/assignments', { projectId: id, size: 50 }),
    enabled: tab === 'work',
  });
  const activity = useQuery({
    queryKey: ['project', id, 'activity'],
    queryFn: () => api.get(`/projects/${id}/activity`, { size: 50 }),
    enabled: tab === 'activity',
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.del(`/projects/${id}/members/${userId}`),
    onSuccess: () => {
      toast.success('Removed from the project');
      void qc.invalidateQueries({ queryKey: ['project', id] });
    },
    onError: (err) => toast.error('Could not remove them', (err as Error).message),
  });

  if (query.isError) {
    return (
      <>
        <PageHeader title="Project" />
        <div className="p-6"><Card><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card></div>
      </>
    );
  }

  const statusMeta = p ? PROJECT_STATUS.byValue[p.status as ProjectStatus] : null;

  return (
    <>
      <PageHeader
        title={p?.name ?? 'Project'}
        description={p ? `${p.projectCode} · ${p.clientName}${p.clientLocation ? ` · ${p.clientLocation}` : ''}` : undefined}
        actions={
          <>
            <Button icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/projects')}>Back</Button>
            {can('report.export') && (
              <Button icon={<Download className="h-4 w-4" />}
                onClick={() => downloadCsv('/reports/expenses/detail', { projectId: id },
                  `adisys-${p?.projectCode ?? 'project'}-expenses.csv`)
                  .then(() => toast.success('Export started'))
                  .catch((e) => toast.error('Export failed', e.message))}>
                Export expenses
              </Button>
            )}
          </>
        }>
        <Tabs
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'team', label: 'Team', count: p?.memberCount },
            { key: 'work', label: 'Work', count: p?.assignmentCount },
            { key: 'expenses', label: 'Expenses' },
            { key: 'activity', label: 'Activity log' },
          ]}
          active={tab} onChange={setTab} />
      </PageHeader>

      <div className="space-y-5 p-4 sm:p-6">
        {query.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}
          </div>
        ) : p && (
          <>
            {/* --- Always-visible header stats --------------------- */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="Status" custom={statusMeta && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                  <StatusBadge tone={PRIORITY.byValue[p.priority as 'medium'].tone} dot={false}>
                    {PRIORITY.byValue[p.priority as 'medium'].label}
                  </StatusBadge>
                </div>
              )} />
              <Stat label="Completion" value={percent(p.completionPct)}
                    sub={`${p.completedCount} of ${p.assignmentCount} assignments`} />
              <Stat label="Verified hours" value={hours(p.verifiedMinutes)}
                    sub={`${hours(p.recordedMinutes)} recorded`}
                    definition={METRIC_DEFINITIONS.verified_hours} />
              <Stat label="Approved spend" value={money(p.approvedExpense, { compact: true })}
                    sub={Number(p.pendingExpense) > 0 ? `${money(p.pendingExpense, { compact: true })} awaiting` : 'Nothing pending'}
                    definition={METRIC_DEFINITIONS.approved_expense} />
              <Stat label="Budget"
                    value={p.budgetEnabled ? money(p.budgetAmount, { compact: true }) : 'Not tracked'}
                    sub={p.budgetEnabled ? `${percent(p.budgetUtilisationPct, 0)} used` : 'Billed on actuals'}
                    tone={p.budgetEnabled && Number(p.budgetUtilisationPct) > 90 ? 'danger'
                      : p.budgetEnabled && Number(p.budgetUtilisationPct) > 75 ? 'warning' : undefined}
                    definition={METRIC_DEFINITIONS.budget_utilisation} />
            </div>

            {tab === 'overview' && (
              <>
                {p.budgetEnabled && Number(p.budgetAmount) > 0 && (
                  <Card>
                    <CardHeader title="Budget utilisation"
                      tooltip={METRIC_DEFINITIONS.budget_utilisation}
                      subtitle={`${money(p.approvedExpense)} approved of ${money(p.budgetAmount)} budgeted`} />
                    <div className="h-3 overflow-hidden rounded-full bg-ink-100">
                      <div className={cx('h-full rounded-full transition-all',
                        Number(p.budgetUtilisationPct) > 90 ? 'bg-danger'
                          : Number(p.budgetUtilisationPct) > 75 ? 'bg-warning' : 'bg-success')}
                        style={{ width: `${Math.min(100, Number(p.budgetUtilisationPct ?? 0))}%` }} />
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-ink-500">
                      <span>{percent(p.budgetUtilisationPct, 1)} committed</span>
                      <span>{money(Number(p.budgetAmount) - Number(p.approvedExpense))} remaining</span>
                    </div>
                  </Card>
                )}

                <div className="grid gap-5 xl:grid-cols-2">
                  <ChartCard title="Spend by category" subtitle="Approved and pending, this project"
                    empty={!query.data?.expenses?.byCategory?.length}
                    table={{
                      columns: ['Category', 'Claims', 'Approved', 'Pending'],
                      rows: (query.data?.expenses?.byCategory ?? []).map((r: any) =>
                        [r.category, r.count, money(r.approved), money(r.pending)]),
                    }}>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart layout="vertical" data={query.data?.expenses?.byCategory ?? []}
                                margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={CHART.grid} horizontal={false} />
                        <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v) => money(v, { compact: true })} />
                        <YAxis type="category" dataKey="category" {...AXIS_PROPS} width={130} />
                        <Tooltip cursor={{ fill: 'var(--color-sunken)' }}
                                 content={<ChartTooltip formatter={(v: number) => money(v)} />} />
                        <Bar dataKey="approved" name="Approved" radius={[0, 4, 4, 0]} barSize={16}>
                          {(query.data?.expenses?.byCategory ?? []).map((_: any, i: number) => (
                            <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>

                  <ChartCard title="Monthly spend" subtitle="Approved versus pending"
                    series={[{ name: 'Approved', color: CHART.approved }, { name: 'Pending', color: CHART.pending }]}
                    empty={!query.data?.expenses?.monthly?.length}
                    table={{
                      columns: ['Month', 'Approved', 'Pending'],
                      rows: (query.data?.expenses?.monthly ?? []).map((r: any) =>
                        [r.month, money(r.approved), money(r.pending)]),
                    }}>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={query.data?.expenses?.monthly ?? []} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                        <CartesianGrid stroke={CHART.grid} vertical={false} />
                        <XAxis dataKey="month" {...AXIS_PROPS} />
                        <YAxis {...AXIS_PROPS} width={62} tickFormatter={(v) => money(v, { compact: true })} />
                        <Tooltip cursor={{ fill: 'var(--color-sunken)' }}
                                 content={<ChartTooltip formatter={(v: number) => money(v)} />} />
                        <Bar dataKey="approved" name="Approved" stackId="m" fill={CHART.approved} />
                        <Bar dataKey="pending" name="Pending" stackId="m" fill={CHART.pending} radius={BAR_RADIUS} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                  <Card>
                    <CardHeader title="Work by status" subtitle="Every assignment on this project" />
                    <ul className="space-y-2">
                      {(query.data?.workByStatus ?? []).map((s: any) => {
                        const meta = WORK_STATUS.byValue[s.status as WorkStatus];
                        const total = (query.data.workByStatus as any[]).reduce((a, x) => a + x.count, 0);
                        return (
                          <li key={s.status} className="flex items-center gap-3">
                            <StatusBadge tone={meta.tone} title={meta.description}>{meta.label}</StatusBadge>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                              <span className="block h-full rounded-full bg-ink-400"
                                    style={{ width: `${(s.count / total) * 100}%` }} />
                            </span>
                            <span className="tabular w-8 text-right text-sm text-ink-700">{s.count}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>

                  <Card>
                    <CardHeader title="Hours by employee" subtitle="Verified productive hours on this project"
                                tooltip={METRIC_DEFINITIONS.verified_hours} />
                    {(query.data?.topContributors ?? []).length === 0 ? (
                      <p className="py-6 text-center text-xs text-ink-500">No time recorded yet.</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {query.data.topContributors.map((c: any) => (
                          <li key={c.employeeCode} className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-sm text-ink-800">{c.fullName}</span>
                            <span className="tabular shrink-0 text-sm">
                              <span className="font-medium text-success">{hours(c.verifiedMinutes)}</span>
                              <span className="text-ink-400"> / {hours(c.recordedMinutes)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>
              </>
            )}

            {tab === 'team' && (
              <Card padded={false}>
                <div className="flex items-center justify-between px-5 pt-5">
                  <CardHeader title="Project team"
                    subtitle="Only active members can be issued work or book expenses to this project."
                    action={can('project.assign_members') && (
                      <Button size="sm" variant="primary" icon={<UserPlus className="h-3.5 w-3.5" />}
                              onClick={() => setAddMembers(true)}>Add members</Button>
                    )} />
                </div>
                {(query.data?.members ?? []).length === 0 ? (
                  <EmptyState title="No members assigned"
                    description="Add field staff before issuing work on this project."
                    action={can('project.assign_members')
                      ? <Button size="sm" variant="primary" onClick={() => setAddMembers(true)}>Add members</Button>
                      : undefined} />
                ) : (
                  <ul className="divide-y divide-line">
                    {query.data.members.map((m: any) => (
                      <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                        <Link to={`/employees/${m.userId}`} className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink-900 hover:text-brand-600">{m.fullName}</p>
                          <p className="tabular truncate text-xs text-ink-500">
                            {m.employeeCode}{m.designationName ? ` · ${m.designationName}` : ''}
                            {m.allocationPct ? ` · ${m.allocationPct}% allocated` : ''}
                          </p>
                        </Link>
                        <StatusBadge tone="neutral" dot={false}>{m.roleInProject}</StatusBadge>
                        {m.openAssignments > 0 && (
                          <StatusBadge tone="info">{m.openAssignments} open</StatusBadge>
                        )}
                        {can('project.assign_members') && (
                          <Button size="sm" variant="ghost" icon={<UserMinus className="h-3.5 w-3.5" />}
                                  loading={removeMember.isPending}
                                  onClick={() => removeMember.mutate(m.userId)}
                                  aria-label={`Remove ${m.fullName}`} />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {tab === 'work' && (
              <Card padded={false}>
                {work.isLoading ? (
                  <div className="space-y-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
                ) : (work.data?.data ?? []).length === 0 ? (
                  <EmptyState title="No work assigned yet"
                    description="Issue daily or weekly work to the project team to get started." />
                ) : (
                  <ul className="divide-y divide-line">
                    {work.data.data.map((a: any) => {
                      const meta = WORK_STATUS.byValue[a.status as WorkStatus];
                      return (
                        <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink-800">{a.title}</p>
                            <p className="tabular truncate text-xs text-ink-500">
                              {a.assignmentCode} · {a.assigneeName} · due {dateLabel(a.dueDate)}
                            </p>
                          </div>
                          {a.acknowledgement.changedSinceAck && <StatusBadge tone="warning">Changed</StatusBadge>}
                          <StatusBadge tone={meta.tone} title={meta.description}>{meta.label}</StatusBadge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            )}

            {tab === 'expenses' && (
              <Card padded={false}>
                <div className="px-5 pt-5">
                  <CardHeader title="Spend by employee"
                    subtitle="The same claims as the category view, grouped differently — the totals reconcile exactly." />
                </div>
                {(query.data?.expenses?.byEmployee ?? []).length === 0 ? (
                  <EmptyState title="No expenses booked to this project" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead>
                        <tr className="border-y border-line bg-sunken/60">
                          <th className="px-5 py-2.5 text-sm font-bold text-ink-600">Employee</th>
                          <th className="px-3 py-2.5 text-right text-sm font-bold text-ink-600">Claims</th>
                          <th className="px-3 py-2.5 text-right text-sm font-bold text-ink-600">Approved</th>
                          <th className="px-5 py-2.5 text-right text-sm font-bold text-ink-600">Pending</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {query.data.expenses.byEmployee.map((r: any) => (
                          <tr key={r.employeeCode}>
                            <td className="px-5 py-2.5 text-ink-800">{r.employee}</td>
                            <td className="tabular px-3 py-2.5 text-right text-ink-700">{r.count}</td>
                            <td className="tabular px-3 py-2.5 text-right font-medium text-ink-900">{money(r.approved)}</td>
                            <td className="tabular px-5 py-2.5 text-right text-warning">{money(r.pending)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-line bg-sunken/60">
                          <td className="px-5 py-2.5 text-sm font-bold text-ink-600">Total</td>
                          <td />
                          <td className="tabular px-3 py-2.5 text-right font-semibold text-ink-900">
                            {money(p.approvedExpense)}
                          </td>
                          <td className="tabular px-5 py-2.5 text-right font-semibold text-warning">
                            {money(p.pendingExpense)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {tab === 'activity' && (
              <Card>
                <CardHeader title="Activity log" subtitle="Every status change on this project's work." />
                {activity.isLoading ? (
                  <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                ) : (activity.data?.data ?? []).length === 0 ? (
                  <EmptyState title="No activity yet" />
                ) : (
                  <ol className="space-y-3 border-l border-line pl-4">
                    {activity.data.data.map((e: any) => (
                      <li key={e.id} className="relative">
                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-ink-300" aria-hidden />
                        <p className="text-sm text-ink-800">
                          <span className="font-medium">{e.assignmentCode}</span>
                          {e.toStatus && <> → {WORK_STATUS.byValue[e.toStatus as WorkStatus]?.label ?? e.toStatus}</>}
                          {e.actorName && <span className="text-ink-500"> by {e.actorName}</span>}
                        </p>
                        {e.note && <p className="mt-0.5 text-xs text-ink-500">{e.note}</p>}
                        <p className="text-[12px] text-ink-400">{new Date(e.createdAt).toLocaleString('en-IN')}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            )}
          </>
        )}
      </div>

      {addMembers && (
        <AddMembersModal projectId={id}
          existing={(query.data?.members ?? []).map((m: any) => m.userId)}
          onClose={() => setAddMembers(false)}
          onDone={() => { setAddMembers(false); void qc.invalidateQueries({ queryKey: ['project', id] }); }} />
      )}
    </>
  );
}

/* =================================================================== */
function Stat({ label, value, sub, custom, tone, definition }: {
  label: string; value?: string; sub?: string; custom?: React.ReactNode;
  tone?: 'warning' | 'danger'; definition?: string;
}) {
  const colour = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink-900';
  return (
    <div className="rounded-card bg-card p-4 shadow-card ring-1 ring-line">
      <p className="flex items-center gap-1 text-xs font-medium text-ink-500">
        {label}{definition && <InfoTip text={definition} />}
      </p>
      {custom ?? (
        <>
          <p className={`tabular mt-1.5 text-xl font-semibold tracking-tight ${colour}`}>{value}</p>
          {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
        </>
      )}
    </div>
  );
}

function AddMembersModal({ projectId, existing, onClose, onDone }: {
  projectId: string; existing: string[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [ids, setIds] = useState<string[]>([]);
  const staff = useQuery({
    queryKey: ['employees', 'all-active'],
    queryFn: () => api.get('/employees', { size: 100, status: 'active' }),
  });

  const add = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/members`, { userIds: ids }),
    onSuccess: (res) => {
      toast.success(`${res.added} added to the project`,
        res.skipped ? `${res.skipped} were already members.` : 'They have been notified.');
      onDone();
    },
    onError: (err) => toast.error('Could not add members', (err as Error).message),
  });

  const available = (staff.data?.data ?? []).filter((e: any) => !existing.includes(e.id));

  return (
    <Modal open onClose={onClose} title="Add project members"
      description="Members can be issued work on this project and book expenses to it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ids.length} loading={add.isPending}
                  onClick={() => add.mutate()}>Add {ids.length || ''}</Button>
        </>
      }>
      {available.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-500">Every active employee is already on this project.</p>
      ) : (
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg ring-1 ring-line-strong">
          {available.map((m: any) => (
            <li key={m.id} className="px-3 py-2">
              <Checkbox label={m.fullName}
                description={`${m.employeeCode}${m.designationName ? ` · ${m.designationName}` : ''}${m.departmentName ? ` · ${m.departmentName}` : ''}`}
                checked={ids.includes(m.id)}
                onChange={(e) => setIds((v) => e.target.checked ? [...v, m.id] : v.filter((i) => i !== m.id))} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
