import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, BadgeCheck, Copy, KeyRound, Mail, MapPin, Phone, Power, Timer, UserCog,
} from 'lucide-react';
import {
  EMPLOYEE_STATUS, METRIC_DEFINITIONS, WORK_STATUS, dateLabel, hours, initials, money,
  type EmployeeStatus, type WorkStatus,
} from '@adisys/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import {
  Button, Card, CardHeader, ErrorState, InfoTip, Modal, Select, Skeleton, StatusBadge,
  Tabs, Textarea, Field, useToast,
} from '../components/ui';

export function EmployeeDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'work' | 'projects' | 'expenses'>('work');
  const [statusOpen, setStatusOpen] = useState(false);
  const [credentials, setCredentials] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['employee', id], queryFn: () => api.get(`/employees/${id}`) });
  const e = query.data?.employee;

  const expenses = useQuery({
    queryKey: ['employee', id, 'expenses'],
    queryFn: () => api.get('/expenses', { userId: id, size: 15 }),
    enabled: tab === 'expenses',
  });

  const resetCredentials = useMutation({
    mutationFn: () => api.post(`/employees/${id}/reset-credentials`),
    onSuccess: (res) => {
      setCredentials(res.temporaryPassword);
      toast.success('New password issued', 'All existing sessions were signed out.');
    },
    onError: (err) => toast.error('Could not reset the password', (err as Error).message),
  });

  if (query.isError) {
    return (
      <>
        <PageHeader title="Employee" />
        <div className="p-6"><Card><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card></div>
      </>
    );
  }

  const statusMeta = e ? EMPLOYEE_STATUS.byValue[e.status as EmployeeStatus] : null;
  const p30 = query.data?.productivity30d;
  const x90 = query.data?.expenses90d;

  return (
    <>
      <PageHeader
        title={e?.fullName ?? 'Employee'}
        description={e ? `${e.employeeCode}${e.designationName ? ` · ${e.designationName}` : ''}${e.departmentName ? ` · ${e.departmentName}` : ''}` : undefined}
        actions={
          <>
            <Button icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/employees')}>Back</Button>
            {can('employee.update') && e && e.id !== user?.id && (
              <Button icon={<KeyRound className="h-4 w-4" />} loading={resetCredentials.isPending}
                      onClick={() => resetCredentials.mutate()}>
                Issue new password
              </Button>
            )}
            {can('employee.deactivate') && e && e.id !== user?.id && (
              <Button variant={e.status === 'active' ? 'danger' : 'success'}
                      icon={<Power className="h-4 w-4" />} onClick={() => setStatusOpen(true)}>
                {e.status === 'active' ? 'Deactivate' : 'Activate'}
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* --- Profile ------------------------------------------- */}
        <div className="space-y-5">
          <Card>
            {query.isLoading ? (
              <div className="space-y-3"><Skeleton className="h-16 w-16 rounded-full" /><Skeleton className="h-4 w-32" /></div>
            ) : e && (
              <>
                <div className="flex items-center gap-3">
                  <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-ink-900 text-lg font-semibold text-white">
                    {initials(e.fullName)}
                    {e.onDuty && <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-success ring-2 ring-white" />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-900">{e.fullName}</p>
                    <p className="tabular text-xs text-ink-500">{e.employeeCode}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {statusMeta && <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>}
                      {e.onDuty && <StatusBadge tone="success">On duty</StatusBadge>}
                      {e.timerRunning && <StatusBadge tone="progress">Timer running</StatusBadge>}
                    </div>
                  </div>
                </div>

                <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
                  <Row icon={<Mail className="h-3.5 w-3.5" />} term="Email" value={e.email} />
                  <Row icon={<Phone className="h-3.5 w-3.5" />} term="Mobile" value={e.phone} />
                  <Row icon={<UserCog className="h-3.5 w-3.5" />} term="Role" value={e.roleName} />
                  <Row icon={<MapPin className="h-3.5 w-3.5" />} term="Base location" value={e.baseLocationName ?? '—'} />
                  <Row term="Reports to" value={e.reportingManagerName ?? 'No manager set'} />
                  <Row term="Joined" value={dateLabel(e.dateOfJoining)} />
                  <Row term="Last sign-in" value={e.lastLoginAt ? dateLabel(e.lastLoginAt) : 'Never'} />
                </dl>
              </>
            )}
          </Card>

          <Card>
            <CardHeader title="Last 30 days" subtitle="Time recorded and verified" />
            {p30 && (
              <dl className="space-y-2.5">
                <Metric label="Recorded against work" value={hours(p30.recordedMinutes)}
                        definition={METRIC_DEFINITIONS.recorded_hours} />
                <Metric label="Verified productive hours" value={hours(p30.verifiedMinutes)} tone="success"
                        definition={METRIC_DEFINITIONS.verified_hours} />
                <Metric label="Logged without an assignment" value={hours(p30.unassignedMinutes)}
                        tone={Number(p30.unassignedMinutes) > 0 ? 'warning' : undefined}
                        definition={METRIC_DEFINITIONS.unassigned_hours} />
              </dl>
            )}
          </Card>

          <Card>
            <CardHeader title="Last 90 days" subtitle="Expense claims" />
            {x90 && (
              <dl className="space-y-2.5">
                <Metric label="Claims submitted" value={String(x90.count)} />
                <Metric label="Approved value" value={money(x90.approved)} tone="success" />
                <Metric label="Awaiting decision" value={money(x90.pending)}
                        tone={Number(x90.pending) > 0 ? 'warning' : undefined} />
              </dl>
            )}
          </Card>
        </div>

        {/* --- Activity ------------------------------------------ */}
        <div className="space-y-4">
          <Tabs
            tabs={[
              { key: 'work', label: 'Recent work', count: query.data?.recentWork?.length },
              { key: 'projects', label: 'Projects', count: query.data?.projects?.length },
              { key: 'expenses', label: 'Expenses' },
            ]}
            active={tab} onChange={setTab} />

          {tab === 'work' && (
            <Card padded={false}>
              {(query.data?.recentWork ?? []).length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-ink-500">No work has been assigned yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {query.data.recentWork.map((w: any) => {
                    const meta = WORK_STATUS.byValue[w.status as WorkStatus];
                    return (
                      <li key={w.id} className="flex items-center gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink-800">{w.title}</p>
                          <p className="tabular truncate text-xs text-ink-500">
                            {w.assignmentCode} · {w.projectName} · due {dateLabel(w.dueDate)}
                          </p>
                        </div>
                        <StatusBadge tone={meta.tone} title={meta.description}>{meta.label}</StatusBadge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          {tab === 'projects' && (
            <Card padded={false}>
              {(query.data?.projects ?? []).length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-ink-500">
                  Not assigned to any project. They cannot be given work or submit claims until they are.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {query.data.projects.map((p: any) => (
                    <li key={p.projectId}>
                      <Link to={`/projects/${p.projectId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink-800">{p.name}</p>
                          <p className="tabular truncate text-xs text-ink-500">
                            {p.projectCode} · {p.roleInProject}
                            {p.allocationPct ? ` · ${p.allocationPct}% allocated` : ''}
                          </p>
                        </div>
                        <StatusBadge tone={p.status === 'active' ? 'success' : 'neutral'}>{p.status}</StatusBadge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {tab === 'expenses' && (
            <Card padded={false}>
              {expenses.isLoading ? (
                <div className="space-y-2 p-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : (expenses.data?.data ?? []).length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-ink-500">No expense claims in the period.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {expenses.data.data.map((c: any) => (
                    <li key={c.id}>
                      <Link to={`/expenses/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink-800">
                            {money(c.amount)} · {c.categoryName}
                          </p>
                          <p className="tabular truncate text-xs text-ink-500">
                            {c.expenseCode} · {dateLabel(c.expenseDate)}
                          </p>
                        </div>
                        <StatusBadge tone={c.status === 'approved' || c.status === 'paid' ? 'success'
                          : c.status === 'rejected' ? 'danger' : 'warning'}>{c.status.replace('_', ' ')}</StatusBadge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>

      {statusOpen && e && (
        <StatusModal employee={e} onClose={() => setStatusOpen(false)}
          onDone={() => {
            setStatusOpen(false);
            void qc.invalidateQueries({ queryKey: ['employee', id] });
            void qc.invalidateQueries({ queryKey: ['employees'] });
          }} />
      )}

      {credentials && (
        <Modal open onClose={() => setCredentials(null)} size="sm" title="New temporary password"
          description="Share this over a secure channel. It is shown once."
          footer={<Button variant="primary" onClick={() => setCredentials(null)}>Done</Button>}>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-sunken p-3.5">
            <span className="font-mono text-lg font-semibold text-ink-900">{credentials}</span>
            <button onClick={() => { void navigator.clipboard?.writeText(credentials); toast.info('Copied'); }}
                    className="rounded p-1 text-ink-400 hover:bg-white hover:text-ink-700" aria-label="Copy">
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* =================================================================== */
function StatusModal({ employee, onClose, onDone }: { employee: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState(employee.status === 'active' ? 'inactive' : 'active');
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: () => api.post(`/employees/${employee.id}/status`, { status, reason: reason || undefined }),
    onSuccess: () => {
      toast.success(`${employee.fullName} is now ${status}`,
        status !== 'active' ? 'All their sessions have been signed out.' : 'They can sign in again.');
      onDone();
    },
    onError: (err) => toast.error('Could not change the status', (err as Error).message),
  });

  return (
    <Modal open onClose={onClose} size="sm" title={`Change status — ${employee.fullName}`}
      description="Deactivating signs the employee out of every device immediately."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={status === 'active' ? 'success' : 'danger'} loading={save.isPending}
                  onClick={() => save.mutate()}>Apply</Button>
        </>
      }>
      <div className="space-y-4">
        <Field label="New status" required>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {EMPLOYEE_STATUS.list.filter((s) => s.value !== 'invited').map((s) => (
              <option key={s.value} value={s.value}>{s.label} — {s.description}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reason" hint="Recorded in the audit log.">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {employee.openAssignmentCount > 0 && status !== 'active' && (
          <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-xs leading-relaxed text-warning ring-1 ring-inset ring-warning/20">
            This employee still has {employee.openAssignmentCount} open assignment(s). Reassign or cancel
            them first — the change will be refused otherwise.
          </p>
        )}
      </div>
    </Modal>
  );
}

function Row({ icon, term, value }: { icon?: React.ReactNode; term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex items-center gap-1.5 shrink-0 text-xs text-ink-500">{icon}{term}</dt>
      <dd className="truncate text-right text-sm text-ink-800">{value}</dd>
    </div>
  );
}

function Metric({ label, value, tone, definition }: {
  label: string; value: string; tone?: 'success' | 'warning'; definition?: string;
}) {
  const colour = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-ink-900';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex items-center gap-1 text-xs text-ink-500">
        {label}{definition && <InfoTip text={definition} />}
      </dt>
      <dd className={`tabular text-sm font-semibold ${colour}`}>{value}</dd>
    </div>
  );
}
