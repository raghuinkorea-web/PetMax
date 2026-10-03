import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, FolderKanban, FolderPlus } from 'lucide-react';
import { PROJECT_STATUS, PRIORITY, dateLabel, hours, money, percent, type ProjectStatus } from '@adisys/shared';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import { Column, DataTable, FilterBar, FilterSelect, SearchInput } from '../components/DataTable';
import { Button, Checkbox, Field, Input, Modal, Select, StatusBadge, Textarea, cx, useToast } from '../components/ui';

/** An unfilled seat on a project — stalled work, not a blank cell. */
function Unassigned() {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-warning">
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Not assigned
    </span>
  );
}

export function ProjectsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'start_date', dir: 'desc' });
  const [createOpen, setCreateOpen] = useState(false);

  const query = useQuery({
    queryKey: ['projects', { search, status, page, sort }],
    queryFn: () => api.get('/projects', {
      search: search || undefined, status: status || undefined,
      page, size: 25, sort: sort.key, dir: sort.dir,
    }),
  });

  const columns: Array<Column<any>> = [
    {
      key: 'name', header: 'Project', sortable: true,
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{p.name}</p>
          <p className="tabular truncate text-xs text-ink-500">{p.projectCode} · {p.clientName}</p>
        </div>
      ),
    },
    {
      key: 'salesManager', header: 'Sales manager', hideBelow: 'xl',
      render: (p) => p.salesManagerName ?? <Unassigned />,
    },
    {
      key: 'manager', header: 'Project manager', hideBelow: 'lg',
      // An empty seat is stalled work, not merely a blank cell — so it is
      // named as such rather than shown as "—".
      render: (p) => p.managerName ?? <Unassigned />,
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (p) => {
        const meta = PROJECT_STATUS.byValue[p.status as ProjectStatus];
        return <StatusBadge tone={meta.tone} title={meta.description}>{meta.label}</StatusBadge>;
      },
    },
    {
      key: 'progress', header: 'Progress', numeric: true,
      render: (p) => (
        <div className="flex items-center justify-end gap-2">
          <span className="text-ink-800">{percent(p.completionPct)}</span>
          <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-ink-100 sm:block">
            <span className="block h-full rounded-full bg-success" style={{ width: `${p.completionPct}%` }} />
          </span>
        </div>
      ),
    },
    {
      key: 'team', header: 'Team', numeric: true, hideBelow: 'md',
      render: (p) => <span className="text-ink-700">{p.memberCount}</span>,
    },
    {
      key: 'hours', header: 'Verified hours', numeric: true, hideBelow: 'xl',
      render: (p) => <span className="text-ink-700">{hours(p.verifiedMinutes)}</span>,
    },
    {
      key: 'approved_expense', header: 'Approved spend', numeric: true, sortable: true,
      render: (p) => (
        <div>
          <p className="font-medium text-ink-900">{money(p.approvedExpense, { compact: true })}</p>
          {p.budgetEnabled && p.budgetAmount > 0 && (
            <p className={cx('text-xs',
              Number(p.budgetUtilisationPct) > 90 ? 'text-danger'
                : Number(p.budgetUtilisationPct) > 75 ? 'text-warning' : 'text-ink-500')}>
              {percent(p.budgetUtilisationPct, 0)} of budget
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'dates', header: 'Timeline', hideBelow: 'xl',
      render: (p) => (
        <div className="text-xs text-ink-600">
          <p>{dateLabel(p.startDate, { withYear: false })} → {p.expectedEndDate ? dateLabel(p.expectedEndDate, { withYear: false }) : 'open'}</p>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Projects"
        description="Client engagements, the field staff assigned to them, and what each has cost so far."
        actions={can('project.create') && (
          <Button variant="primary" icon={<FolderPlus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            Create project
          </Button>
        )}
      />

      <div className="p-4 sm:p-6">
        <DataTable
          columns={columns}
          rows={query.data?.data ?? []}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/projects/${p.id}`)}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          sort={sort}
          onSort={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
          page={query.data?.page}
          onPage={setPage}
          empty={{
            icon: <FolderKanban className="h-5 w-5" />,
            title: search || status ? 'No projects match these filters' : 'No projects yet',
            description: 'Create a project, assign field staff to it, and you can start issuing work.',
            action: can('project.create')
              ? <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>Create project</Button>
              : undefined,
          }}
          toolbar={
            <FilterBar active={[search, status].filter(Boolean).length}
              onReset={() => { setSearch(''); setStatus(''); setPage(1); }}>
              <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }}
                           placeholder="Project, code or client" />
              <FilterSelect label="Status" value={status} allLabel="All statuses"
                onChange={(v) => { setStatus(v); setPage(1); }}
                options={PROJECT_STATUS.list.map((s) => ({ value: s.value, label: s.label }))} />
            </FilterBar>
          }
        />
      </div>

      {createOpen && (
        <CreateProjectModal onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            void qc.invalidateQueries({ queryKey: ['projects'] });
            navigate(`/projects/${id}`);
          }} />
      )}
    </>
  );
}

/* =================================================================== */
function CreateProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  // The Project Manager and the team belong to later steps and the server
  // rejects them here; the Sales Manager is the Admin's to choose.
  const [form, setForm] = useState({
    name: '', clientName: '', clientLocation: '', description: '', projectTypeId: '',
    salesManagerId: '', startDate: today, expectedEndDate: '', status: 'draft',
    priority: 'medium', budgetAmount: '', notes: '',
  });
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 600_000 });
  const staff = useQuery({
    queryKey: ['employees', 'all-active'],
    queryFn: () => api.get('/employees', { size: 100, status: 'active' }),
  });
  const salesManagers = (staff.data?.data ?? []).filter((e: any) => e.roleKey === 'sales_manager');

  const create = useMutation({
    mutationFn: () => api.post('/projects', {
      ...form,
      budgetEnabled,
      budgetAmount: budgetEnabled && form.budgetAmount ? Number(form.budgetAmount) : null,
      expectedEndDate: form.expectedEndDate || undefined,
      projectTypeId: form.projectTypeId || undefined,
      clientLocation: form.clientLocation || undefined,
      description: form.description || undefined,
      notes: form.notes || undefined,
      salesManagerId: form.salesManagerId || undefined,
    }),
    onSuccess: (res) => {
      toast.success('Project created', `${res.projectCode} — a Sales Manager assigns the Project Manager next.`);
      onCreated(res.id);
    },
    onError: (err) => {
      setError(err as ApiRequestError);
      toast.error('Could not create the project', (err as Error).message);
    },
  });

  const set = (k: keyof typeof form) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSubmit = form.name.trim().length >= 3 && form.clientName.trim().length >= 2;

  return (
    <Modal open onClose={onClose} size="lg" title="Create project"
      description="Only active project members can be assigned work or book expenses to a project."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} disabled={!canSubmit}
                  onClick={() => create.mutate()}>Create project</Button>
        </>
      }>
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger ring-1 ring-inset ring-danger/20">
            {error.message}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name" required error={error?.fieldError('name')}>
            <Input value={form.name} onChange={set('name')} placeholder="Metro Rail Signalling Retrofit" />
          </Field>
          <Field label="Client" required error={error?.fieldError('clientName')}>
            <Input value={form.clientName} onChange={set('clientName')} placeholder="Hyderabad Metro Rail Ltd" />
          </Field>
          <Field label="Client location">
            <Input value={form.clientLocation} onChange={set('clientLocation')} placeholder="Miyapur Depot, Hyderabad" />
          </Field>
          <Field label="Project type">
            <Select value={form.projectTypeId} onChange={set('projectTypeId')}>
              <option value="">Not specified</option>
              {(lookups.data?.projectTypes ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Sales manager" error={error?.fieldError('salesManagerId')}
                 hint={salesManagers.length
                   ? 'Owns the hand-over to a Project Manager. Can be set later.'
                   : 'Nobody holds the Sales Manager role yet — set one on the Employees screen.'}>
            <Select value={form.salesManagerId} onChange={set('salesManagerId')}
                    disabled={!salesManagers.length}>
              <option value="">Assign later</option>
              {salesManagers.map((m: any) => (
                <option key={m.id} value={m.id}>{m.fullName} ({m.employeeCode})</option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={set('priority')}>
              {PRIORITY.list.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Start date" required error={error?.fieldError('startDate')}>
            <Input type="date" value={form.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="Expected end date" error={error?.fieldError('expectedEndDate')}>
            <Input type="date" value={form.expectedEndDate} min={form.startDate} onChange={set('expectedEndDate')} />
          </Field>
        </div>

        <Field label="Description">
          <Textarea rows={2} value={form.description} onChange={set('description')}
                    placeholder="Scope, deliverables and hand-over expectations." />
        </Field>

        <div className="rounded-lg bg-sunken p-3.5">
          <Checkbox label="Track a budget for this project"
                    description="Enables budget-versus-actual reporting. Leave off if the client is billed on actuals."
                    checked={budgetEnabled} onChange={(e) => setBudgetEnabled(e.target.checked)} />
          {budgetEnabled && (
            <div className="mt-3 max-w-xs">
              <Input type="number" min="1" step="1000" value={form.budgetAmount} onChange={set('budgetAmount')}
                     placeholder="4800000" aria-label="Budget amount in rupees" />
            </div>
          )}
        </div>

        {/* Neither the manager nor the team is chosen here any more: this
            screen is step 1 of three, and saying so is clearer than leaving
            a gap where two fields used to be. */}
        <div className="rounded-lg bg-info-soft px-3.5 py-3 text-sm text-ink-700 ring-1 ring-inset ring-info/20">
          <p className="font-semibold text-ink-900">What happens next</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 leading-relaxed">
            <li>The <strong>Sales Manager</strong> hands this project to a Project Manager.</li>
            <li>That <strong>Project Manager</strong> adds the technicians and assigns their activities.</li>
          </ol>
        </div>

        <Field label="Initial status"
               hint="Field staff only see Active and On hold projects.">
          <Select value={form.status} onChange={set('status')}>
            {PROJECT_STATUS.list.filter((s) => ['draft', 'active'].includes(s.value)).map((s) => (
              <option key={s.value} value={s.value}>{s.label} — {s.description}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
