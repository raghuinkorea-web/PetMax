import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CalendarPlus, CheckCheck, ClipboardList, Clock, MapPin, RotateCcw, Send,
} from 'lucide-react';
import {
  PRIORITY, WORK_STATUS, dateLabel, hours, relativeDays, type WorkStatus,
} from '@adisys/shared';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import { Column, DataTable, FilterBar, FilterSelect, SearchInput } from '../components/DataTable';
import {
  Button, Card, Checkbox, Field, Input, Modal, Select, StatusBadge, Tabs, Textarea,
  cx, useToast,
} from '../components/ui';

const VIEWS = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
  { key: 'next_week', label: 'Next week' },
  { key: 'pending_ack', label: 'Awaiting acknowledgement' },
  { key: 'overdue', label: 'Overdue' },
] as const;

export function WorkPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const [view, setView] = useState<(typeof VIEWS)[number]['key']>(
    (params.get('view') as any) ?? 'all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [projectId, setProjectId] = useState('');
  const [priority, setPriority] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'assignment_date', dir: 'desc' });
  const [detailId, setDetailId] = useState<string | null>(params.get('id'));
  const [assignOpen, setAssignOpen] = useState(false);

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 600_000 });

  const query = useQuery({
    queryKey: ['assignments', { view, search, status, projectId, priority, page, sort }],
    queryFn: () => api.get('/assignments', {
      view, search: search || undefined, status: status || undefined,
      projectId: projectId || undefined, priority: priority || undefined,
      page, size: 25, sort: sort.key, dir: sort.dir,
    }),
  });

  const activeFilters = [search, status, projectId, priority].filter(Boolean).length;

  const columns: Array<Column<any>> = [
    {
      key: 'title', header: 'Assignment', sortable: false,
      render: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{a.title}</p>
          <p className="tabular truncate text-xs text-ink-500">{a.assignmentCode} · {a.projectName}</p>
        </div>
      ),
    },
    {
      key: 'assignee', header: 'Assigned to', hideBelow: 'md',
      render: (a) => (
        <div className="min-w-0">
          <p className="truncate text-ink-800">{a.assigneeName}</p>
          <p className="tabular truncate text-xs text-ink-500">{a.assigneeCode}</p>
        </div>
      ),
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (a) => {
        const meta = WORK_STATUS.byValue[a.status as WorkStatus];
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge tone={meta.tone} title={meta.description}>{meta.label}</StatusBadge>
            {a.acknowledgement.changedSinceAck && (
              <span className="flex items-center gap-1 text-[12px] font-medium text-warning">
                <AlertTriangle className="h-3 w-3" /> Changed since acknowledged
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'priority', header: 'Priority', sortable: true, hideBelow: 'lg',
      render: (a) => {
        const meta = PRIORITY.byValue[a.priority as keyof typeof PRIORITY.byValue];
        return <StatusBadge tone={meta.tone} dot={false}>{meta.label}</StatusBadge>;
      },
    },
    {
      key: 'due_date', header: 'Due', sortable: true,
      render: (a) => (
        <div>
          <p className={cx('text-ink-800', a.isOverdue && 'font-medium text-danger')}>{dateLabel(a.dueDate)}</p>
          <p className={cx('text-xs', a.isOverdue ? 'text-danger' : 'text-ink-500')}>{relativeDays(a.dueDate)}</p>
        </div>
      ),
    },
    {
      key: 'hours', header: 'Planned / recorded', numeric: true, hideBelow: 'xl',
      render: (a) => (
        <span className="text-ink-700">
          {a.estimatedHours ? `${a.estimatedHours}h` : '—'}
          <span className="text-ink-400"> / </span>
          <span className="font-medium">{hours(a.recordedMinutes)}</span>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Work assignments"
        description="Daily and weekly work issued to field staff, with acknowledgement and completion state."
        actions={can('work.create') && (
          <Button variant="primary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setAssignOpen(true)}>
            Assign work
          </Button>
        )}>
        <Tabs tabs={VIEWS.map((v) => ({ key: v.key, label: v.label }))} active={view}
              onChange={(k) => { setView(k); setPage(1); setParams(k === 'all' ? {} : { view: k }); }} />
      </PageHeader>

      <div className="space-y-4 p-4 sm:p-6">
        <DataTable
          columns={columns}
          rows={query.data?.data ?? []}
          rowKey={(a) => a.id}
          onRowClick={(a) => setDetailId(a.id)}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          sort={sort}
          onSort={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
          page={query.data?.page}
          onPage={setPage}
          empty={{
            icon: <ClipboardList className="h-5 w-5" />,
            title: activeFilters ? 'No assignments match these filters' : 'No work assigned yet',
            description: activeFilters
              ? 'Try widening the date range or clearing a filter.'
              : 'Assign daily or weekly work to your field staff to get started.',
            action: can('work.create') && !activeFilters
              ? <Button variant="primary" size="sm" onClick={() => setAssignOpen(true)}>Assign work</Button>
              : undefined,
          }}
          toolbar={
            <FilterBar active={activeFilters} onReset={() => {
              setSearch(''); setStatus(''); setProjectId(''); setPriority(''); setPage(1);
            }}>
              <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }}
                           placeholder="Search title, code or project" />
              <FilterSelect label="Project" value={projectId} allLabel="All projects" className="w-52"
                onChange={(v) => { setProjectId(v); setPage(1); }}
                options={(lookups.data?.projects ?? []).map((p: any) => ({ value: p.id, label: p.name }))} />
              <FilterSelect label="Status" value={status} allLabel="All statuses"
                onChange={(v) => { setStatus(v); setPage(1); }}
                options={WORK_STATUS.list.map((s) => ({ value: s.value, label: s.label }))} />
              <FilterSelect label="Priority" value={priority} allLabel="Any priority" className="w-36"
                onChange={(v) => { setPriority(v); setPage(1); }}
                options={PRIORITY.list.map((p) => ({ value: p.value, label: p.label }))} />
            </FilterBar>
          }
        />
      </div>

      {assignOpen && (
        <AssignWorkModal
          lookups={lookups.data}
          onClose={() => setAssignOpen(false)}
          onCreated={(count) => {
            setAssignOpen(false);
            toast.success(`${count} assignment${count === 1 ? '' : 's'} issued`,
              'The employee has been notified and must acknowledge receipt.');
            void qc.invalidateQueries({ queryKey: ['assignments'] });
            void qc.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      )}

      {detailId && <AssignmentDrawer id={detailId} onClose={() => { setDetailId(null); setParams({}); }} />}
    </>
  );
}

/* =================================================================== */
function AssignWorkModal({ lookups, onClose, onCreated }: {
  lookups: any; onClose: () => void; onCreated: (count: number) => void;
}) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    projectId: '', title: '', description: '', workTypeId: '', priority: 'medium',
    assignmentDate: today, dueDate: today, estimatedHours: '', locationText: '',
    instructions: '', repeatUntil: '',
  });
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [repeat, setRepeat] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const members = useQuery({
    queryKey: ['assignable', form.projectId],
    queryFn: () => api.get('/lookups/assignable-employees', { projectId: form.projectId }),
    enabled: Boolean(form.projectId),
  });

  const create = useMutation({
    mutationFn: () => api.post('/assignments', {
      ...form,
      assigneeIds,
      estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : undefined,
      workTypeId: form.workTypeId || undefined,
      description: form.description || undefined,
      locationText: form.locationText || undefined,
      instructions: form.instructions || undefined,
      repeatUntil: repeat && form.repeatUntil ? form.repeatUntil : undefined,
    }),
    onSuccess: (res) => onCreated(res.count),
    onError: (err) => {
      setError(err as ApiRequestError);
      toast.error('Could not issue the assignment', (err as Error).message);
    },
  });

  const set = (k: keyof typeof form) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSubmit = form.projectId && form.title.trim().length >= 3 && assigneeIds.length > 0;

  return (
    <Modal open onClose={onClose} size="lg"
      title="Assign work"
      description="The employee is notified immediately and must acknowledge receipt before starting."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} disabled={!canSubmit}
                  icon={<Send className="h-4 w-4" />} onClick={() => create.mutate()}>
            Issue assignment{assigneeIds.length > 1 ? `s (${assigneeIds.length})` : ''}
          </Button>
        </>
      }>
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger ring-1 ring-inset ring-danger/20">
            {error.message}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project" required error={error?.fieldError('projectId')}>
            <Select value={form.projectId} onChange={(e) => { set('projectId')(e); setAssigneeIds([]); }}>
              <option value="">Select a project…</option>
              {(lookups?.projects ?? []).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} — {p.clientName}</option>
              ))}
            </Select>
          </Field>

          <Field label="Work type" error={error?.fieldError('workTypeId')}>
            <Select value={form.workTypeId} onChange={set('workTypeId')}>
              <option value="">Not specified</option>
              {(lookups?.workTypes ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Task title" required error={error?.fieldError('title')}
               hint="What the employee will see first on their phone.">
          <Input value={form.title} onChange={set('title')} maxLength={180}
                 placeholder="e.g. Verify panel earthing at Bay 7" />
        </Field>

        <Field label="Description" error={error?.fieldError('description')}>
          <Textarea rows={3} value={form.description} onChange={set('description')}
                    placeholder="What needs doing, and what counts as done." />
        </Field>

        <Field label={`Assign to${assigneeIds.length ? ` — ${assigneeIds.length} selected` : ''}`} required
               error={error?.fieldError('assigneeIds')}
               hint={form.projectId
                 ? 'Only active members of the selected project can be assigned work on it.'
                 : 'Select a project first.'}>
          <div className="max-h-44 overflow-y-auto rounded-lg ring-1 ring-line-strong">
            {!form.projectId ? (
              <p className="px-3 py-6 text-center text-xs text-ink-500">Select a project to list its members.</p>
            ) : members.isLoading ? (
              <p className="px-3 py-6 text-center text-xs text-ink-500">Loading members…</p>
            ) : (members.data?.data ?? []).length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-ink-500">
                This project has no active members yet. Add members from the project page first.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {members.data.data.map((m: any) => (
                  <li key={m.id} className="px-3 py-2">
                    <Checkbox
                      label={m.fullName}
                      description={`${m.employeeCode}${m.designationName ? ` · ${m.designationName}` : ''}`}
                      checked={assigneeIds.includes(m.id)}
                      onChange={(e) => setAssigneeIds((ids) =>
                        e.target.checked ? [...ids, m.id] : ids.filter((i) => i !== m.id))} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Assignment date" required error={error?.fieldError('assignmentDate')}>
            <Input type="date" value={form.assignmentDate} onChange={set('assignmentDate')} />
          </Field>
          <Field label="Due date" required error={error?.fieldError('dueDate')}>
            <Input type="date" value={form.dueDate} min={form.assignmentDate} onChange={set('dueDate')} />
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={set('priority')}>
              {PRIORITY.list.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Estimated hours" error={error?.fieldError('estimatedHours')}>
            <Input type="number" min="0.5" max="24" step="0.5" value={form.estimatedHours}
                   onChange={set('estimatedHours')} placeholder="3" />
          </Field>
        </div>

        <Field label="Site / location" error={error?.fieldError('locationText')}>
          <Input value={form.locationText} onChange={set('locationText')}
                 placeholder="e.g. Miyapur Depot, Bay 7" />
        </Field>

        <Field label="Site instructions" error={error?.fieldError('instructions')}
               hint="Permits, drawings, safety notes — shown on the employee's phone.">
          <Textarea rows={2} value={form.instructions} onChange={set('instructions')} />
        </Field>

        <div className="rounded-lg bg-sunken p-3.5">
          <Checkbox label="Repeat on every working day until…"
                    description="Creates one assignment per working day (Sundays excluded), each acknowledged separately."
                    checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
          {repeat && (
            <div className="mt-3 max-w-xs">
              <Input type="date" value={form.repeatUntil} min={form.assignmentDate}
                     onChange={set('repeatUntil')} aria-label="Repeat until" />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* =================================================================== */
function AssignmentDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');

  const query = useQuery({ queryKey: ['assignment', id], queryFn: () => api.get(`/assignments/${id}`) });
  const a = query.data?.assignment;

  const review = useMutation({
    mutationFn: (decision: 'accept' | 'return') =>
      api.post(`/assignments/${id}/review`, { decision, comment: comment || undefined }),
    onSuccess: (_res, decision) => {
      toast.success(decision === 'accept' ? 'Work accepted' : 'Returned to the employee',
        decision === 'accept' ? 'Marked complete and the employee has been notified.'
                              : 'The employee has been asked for clarification.');
      void qc.invalidateQueries({ queryKey: ['assignment', id] });
      void qc.invalidateQueries({ queryKey: ['assignments'] });
      setComment('');
    },
    onError: (err) => toast.error('Could not record the review', (err as Error).message),
  });

  const statusMeta = a ? WORK_STATUS.byValue[a.status as WorkStatus] : null;

  return (
    <Modal open onClose={onClose} size="lg"
      title={a ? a.title : 'Assignment'}
      description={a ? `${a.assignmentCode} · ${a.projectName}` : undefined}
      footer={
        a?.status === 'submitted' && can('work.review') ? (
          <>
            <Button variant="danger" loading={review.isPending}
                    icon={<RotateCcw className="h-4 w-4" />}
                    disabled={comment.trim().length < 5}
                    onClick={() => review.mutate('return')}>
              Return for clarification
            </Button>
            <Button variant="success" loading={review.isPending}
                    icon={<CheckCheck className="h-4 w-4" />}
                    onClick={() => review.mutate('accept')}>
              Accept as complete
            </Button>
          </>
        ) : <Button onClick={onClose}>Close</Button>
      }>
      {query.isLoading ? (
        <p className="py-8 text-center text-sm text-ink-500">Loading…</p>
      ) : !a ? (
        <p className="py-8 text-center text-sm text-ink-500">This assignment is no longer available.</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {statusMeta && <StatusBadge tone={statusMeta.tone} title={statusMeta.description}>{statusMeta.label}</StatusBadge>}
            <StatusBadge tone={PRIORITY.byValue[a.priority as 'medium'].tone} dot={false}>
              {PRIORITY.byValue[a.priority as 'medium'].label} priority
            </StatusBadge>
            {a.isOverdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
            {a.timerRunning && <StatusBadge tone="progress">Timer running</StatusBadge>}
          </div>

          {a.acknowledgement.changedSinceAck && (
            <div className="flex gap-2.5 rounded-lg bg-warning-soft p-3 text-xs leading-relaxed text-warning ring-1 ring-inset ring-warning/20">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" aria-hidden />
              <p>
                This assignment was edited after {a.assigneeName} acknowledged it
                (they confirmed version {a.acknowledgement.acknowledgedVersion}, it is now version {a.version}).
                They have been asked to acknowledge the change.
              </p>
            </div>
          )}

          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail term="Assigned to" value={`${a.assigneeName} (${a.assigneeCode})`} />
            <Detail term="Assigned by" value={a.assignedByName} />
            <Detail term="Assignment date" value={dateLabel(a.assignmentDate)} />
            <Detail term="Due" value={`${dateLabel(a.dueDate)} · ${relativeDays(a.dueDate)}`} />
            <Detail term="Estimated" value={a.estimatedHours ? `${a.estimatedHours} hours` : 'Not estimated'} />
            <Detail term="Recorded" value={hours(a.recordedMinutes)} />
            {a.locationText && <Detail term="Site" value={a.locationText} icon={<MapPin className="h-3.5 w-3.5" />} />}
            {a.workTypeName && <Detail term="Work type" value={a.workTypeName} />}
          </dl>

          {a.description && (
            <section>
              <h3 className="text-sm font-medium text-ink-700">Description</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-600">{a.description}</p>
            </section>
          )}

          {a.instructions && (
            <section className="rounded-lg bg-sunken p-3.5">
              <h3 className="text-sm font-medium text-ink-700">Site instructions</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-600">{a.instructions}</p>
            </section>
          )}

          {a.completionNotes && (
            <section className="rounded-lg bg-info-soft p-3.5 ring-1 ring-inset ring-info/20">
              <h3 className="text-sm font-medium text-info">Employee's completion note</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{a.completionNotes}</p>
            </section>
          )}

          {a.status === 'submitted' && can('work.review') && (
            <Field label="Review comment"
                   hint="Required when returning the work. Optional when accepting it.">
              <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)}
                        placeholder="What still needs clarifying?" />
            </Field>
          )}

          <section>
            <h3 className="mb-2 text-sm font-medium text-ink-700">Acknowledgement history</h3>
            {(query.data?.acknowledgements ?? []).length === 0 ? (
              <p className="rounded-lg bg-sunken px-3 py-2.5 text-xs text-ink-500">
                Not acknowledged yet — the employee has not confirmed receipt.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {query.data.acknowledgements.map((ack: any) => (
                  <li key={ack.id} className="flex items-start gap-2.5 rounded-lg bg-sunken px-3 py-2">
                    <StatusBadge tone={ack.decision === 'acknowledged' ? 'success' : 'warning'} dot={false}>
                      v{ack.assignmentVersion}
                    </StatusBadge>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-ink-700">
                        {ack.decision === 'acknowledged' ? 'Acknowledged' : 'Clarification requested'} by {ack.userName}
                        {ack.mode !== 'individual' && ` (${ack.mode.replace('_', ' ')})`}
                      </p>
                      {ack.reason && <p className="mt-0.5 text-xs text-ink-500">{ack.reason}</p>}
                      <p className="mt-0.5 text-[12px] text-ink-400">
                        {new Date(ack.acknowledgedAt).toLocaleString('en-IN')}
                        {ack.deviceLabel && ` · ${ack.deviceLabel}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-ink-700">Activity</h3>
            <ol className="space-y-2 border-l border-line pl-4">
              {(query.data?.events ?? []).map((e: any) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-ink-300" aria-hidden />
                  <p className="text-xs text-ink-700">
                    {e.toStatus
                      ? <>Status → <span className="font-medium">{WORK_STATUS.byValue[e.toStatus as WorkStatus]?.label ?? e.toStatus}</span></>
                      : e.eventType.replace('_', ' ')}
                    {e.actorName && <span className="text-ink-500"> by {e.actorName}</span>}
                  </p>
                  {e.note && <p className="mt-0.5 text-xs text-ink-500">{e.note}</p>}
                  <p className="text-[12px] text-ink-400">{new Date(e.createdAt).toLocaleString('en-IN')}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Modal>
  );
}

function Detail({ term, value, icon }: { term: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{term}</dt>
      <dd className="flex items-center gap-1.5 text-sm text-ink-800">{icon}{value}</dd>
    </div>
  );
}
