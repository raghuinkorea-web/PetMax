import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, UserPlus, Users } from 'lucide-react';
import { EMPLOYEE_STATUS, dateLabel, initials, type EmployeeStatus } from '@adisys/shared';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import { Column, DataTable, FilterBar, FilterSelect, SearchInput } from '../components/DataTable';
import {
  Button, Field, Input, Modal, Select, StatusBadge, cx, useToast,
} from '../components/ui';

export function EmployeesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'full_name', dir: 'asc' });
  const [addOpen, setAddOpen] = useState(false);

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 600_000 });

  const query = useQuery({
    queryKey: ['employees', { search, status, departmentId, roleId, page, sort }],
    queryFn: () => api.get('/employees', {
      search: search || undefined, status: status || undefined,
      departmentId: departmentId || undefined, roleId: roleId || undefined,
      page, size: 25, sort: sort.key, dir: sort.dir,
    }),
  });

  const activeFilters = [search, status, departmentId, roleId].filter(Boolean).length;

  const columns: Array<Column<any>> = [
    {
      key: 'full_name', header: 'Employee', sortable: true,
      render: (e) => (
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">
            {initials(e.fullName)}
            {e.onDuty && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white"
                    title="On duty" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">{e.fullName}</p>
            <p className="tabular truncate text-xs text-ink-500">{e.employeeCode}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role', header: 'Role & designation', hideBelow: 'md',
      render: (e) => (
        <div className="min-w-0">
          <p className="truncate text-ink-800">{e.designationName ?? e.roleName}</p>
          <p className="truncate text-xs text-ink-500">{e.departmentName ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'contact', header: 'Contact', hideBelow: 'lg',
      render: (e) => (
        <div className="min-w-0">
          <p className="tabular truncate text-ink-700">{e.phone}</p>
          <p className="truncate text-xs text-ink-500">{e.email}</p>
        </div>
      ),
    },
    {
      key: 'manager', header: 'Reports to', hideBelow: 'xl',
      render: (e) => e.reportingManagerName ?? <span className="text-ink-400">—</span>,
    },
    {
      key: 'workload', header: 'Open work', numeric: true,
      render: (e) => (
        <div className="flex items-center justify-end gap-1.5">
          <span className="text-ink-800">{e.openAssignmentCount}</span>
          {e.pendingAckCount > 0 && (
            <StatusBadge tone="warning" dot={false}>{e.pendingAckCount} unack.</StatusBadge>
          )}
        </div>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (e) => {
        const meta = EMPLOYEE_STATUS.byValue[e.status as EmployeeStatus];
        return <StatusBadge tone={meta.tone} title={meta.description}>{meta.label}</StatusBadge>;
      },
    },
    {
      key: 'lastLogin', header: 'Last sign-in', hideBelow: 'xl',
      render: (e) => e.lastLoginAt
        ? <span className="text-xs text-ink-600">{dateLabel(e.lastLoginAt)}</span>
        : <span className="text-xs text-ink-400">Never</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Employees"
        description="Field staff, supervisors and office users, with their current workload and access state."
        actions={can('employee.create') && (
          <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
            Add employee
          </Button>
        )}
      />

      <div className="p-4 sm:p-6">
        <DataTable
          columns={columns}
          rows={query.data?.data ?? []}
          rowKey={(e) => e.id}
          onRowClick={(e) => navigate(`/employees/${e.id}`)}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          sort={sort}
          onSort={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}
          page={query.data?.page}
          onPage={setPage}
          empty={{
            icon: <Users className="h-5 w-5" />,
            title: activeFilters ? 'No employees match these filters' : 'No employees yet',
            description: activeFilters ? 'Try clearing a filter.' : 'Add your first employee to start assigning work.',
          }}
          toolbar={
            <FilterBar active={activeFilters}
              onReset={() => { setSearch(''); setStatus(''); setDepartmentId(''); setRoleId(''); setPage(1); }}>
              <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }}
                           placeholder="Name, ID, email or mobile" />
              <FilterSelect label="Department" value={departmentId} allLabel="All departments" className="w-48"
                onChange={(v) => { setDepartmentId(v); setPage(1); }}
                options={(lookups.data?.departments ?? []).map((d: any) => ({ value: d.id, label: d.name }))} />
              <FilterSelect label="Role" value={roleId} allLabel="All roles" className="w-52"
                onChange={(v) => { setRoleId(v); setPage(1); }}
                options={(lookups.data?.roles ?? []).map((r: any) => ({ value: r.id, label: r.name }))} />
              <FilterSelect label="Status" value={status} allLabel="All statuses" className="w-36"
                onChange={(v) => { setStatus(v); setPage(1); }}
                options={EMPLOYEE_STATUS.list.map((s) => ({ value: s.value, label: s.label }))} />
            </FilterBar>
          }
        />
      </div>

      {addOpen && (
        <AddEmployeeModal lookups={lookups.data} onClose={() => setAddOpen(false)}
          onCreated={() => { void qc.invalidateQueries({ queryKey: ['employees'] }); }} />
      )}
    </>
  );
}

/* =================================================================== */
function AddEmployeeModal({ lookups, onClose, onCreated }: {
  lookups: any; onClose: () => void; onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', roleId: '', departmentId: '',
    designationId: '', baseLocationId: '', reportingManagerId: '',
    dateOfJoining: '', employeeCode: '',
  });
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [credentials, setCredentials] = useState<{ employeeCode: string; temporaryPassword: string } | null>(null);

  const managers = useQuery({
    queryKey: ['employees', 'managers'],
    queryFn: () => api.get('/employees', { size: 100, status: 'active' }),
  });

  const create = useMutation({
    mutationFn: () => api.post('/employees', {
      ...form,
      employeeCode: form.employeeCode || undefined,
      departmentId: form.departmentId || undefined,
      designationId: form.designationId || undefined,
      baseLocationId: form.baseLocationId || undefined,
      reportingManagerId: form.reportingManagerId || undefined,
      dateOfJoining: form.dateOfJoining || undefined,
    }),
    onSuccess: (res) => {
      setCredentials({ employeeCode: res.employeeCode, temporaryPassword: res.temporaryPassword });
      onCreated();
    },
    onError: (err) => {
      setError(err as ApiRequestError);
      toast.error('Could not create the employee', (err as Error).message);
    },
  });

  const set = (k: keyof typeof form) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSubmit = form.fullName.trim() && form.email.trim() && /^[6-9]\d{9}$/.test(form.phone) && form.roleId;

  if (credentials) {
    return (
      <Modal open onClose={onClose} size="sm" title="Employee created"
        description="Share these credentials over a secure channel. They must be changed at first sign-in."
        footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <dl className="space-y-3">
          <div className="rounded-lg bg-sunken p-3.5">
            <dt className="text-xs text-ink-500">Employee ID</dt>
            <dd className="tabular mt-0.5 text-lg font-semibold text-ink-900">{credentials.employeeCode}</dd>
          </div>
          <div className="rounded-lg bg-sunken p-3.5">
            <dt className="text-xs text-ink-500">Temporary password</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-lg font-semibold text-ink-900">{credentials.temporaryPassword}</span>
              <button onClick={() => {
                void navigator.clipboard?.writeText(credentials.temporaryPassword);
                toast.info('Copied to the clipboard');
              }} className="rounded p-1 text-ink-400 hover:bg-white hover:text-ink-700" aria-label="Copy password">
                <Copy className="h-4 w-4" />
              </button>
            </dd>
          </div>
        </dl>
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-500">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          This password is shown once and is not recoverable. If it is lost, issue a new one from the
          employee's profile.
        </p>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Add employee"
      description="Creates the account and issues a one-time password."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} disabled={!canSubmit}
                  onClick={() => create.mutate()}>Create employee</Button>
        </>
      }>
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger ring-1 ring-inset ring-danger/20">
            {error.message}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={error?.fieldError('fullName')}>
            <Input value={form.fullName} onChange={set('fullName')} placeholder="Arun Prakash"
                   invalid={Boolean(error?.fieldError('fullName'))} />
          </Field>
          <Field label="Employee ID" error={error?.fieldError('employeeCode')}
                 hint="Leave blank to generate the next ADISYS ID automatically.">
            <Input value={form.employeeCode} onChange={set('employeeCode')} placeholder="ADI-0016"
                   invalid={Boolean(error?.fieldError('employeeCode'))} />
          </Field>
          <Field label="Email address" required error={error?.fieldError('email')}>
            <Input type="email" value={form.email} onChange={set('email')}
                   placeholder="arun.prakash@adisystech.com"
                   invalid={Boolean(error?.fieldError('email'))} />
          </Field>
          <Field label="Mobile number" required error={error?.fieldError('phone')}
                 hint="10 digits, used to sign in to the field app.">
            <Input inputMode="numeric" maxLength={10} value={form.phone}
                   onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))}
                   placeholder="9100000016"
                   invalid={Boolean(error?.fieldError('phone'))} />
          </Field>
          <Field label="Role" required error={error?.fieldError('roleId')}
                 hint="Determines what this person can see and do.">
            <Select value={form.roleId} onChange={set('roleId')} invalid={Boolean(error?.fieldError('roleId'))}>
              <option value="">Select a role…</option>
              {(lookups?.roles ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Reporting manager" error={error?.fieldError('reportingManagerId')}>
            <Select value={form.reportingManagerId} onChange={set('reportingManagerId')}>
              <option value="">Not set</option>
              {(managers.data?.data ?? []).map((m: any) => (
                <option key={m.id} value={m.id}>{m.fullName} ({m.employeeCode})</option>
              ))}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={form.departmentId} onChange={set('departmentId')}>
              <option value="">Not set</option>
              {(lookups?.departments ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Designation">
            <Select value={form.designationId} onChange={set('designationId')}>
              <option value="">Not set</option>
              {(lookups?.designations ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Base location">
            <Select value={form.baseLocationId} onChange={set('baseLocationId')}>
              <option value="">Not set</option>
              {(lookups?.locations ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Date of joining">
            <Input type="date" value={form.dateOfJoining} onChange={set('dateOfJoining')} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
