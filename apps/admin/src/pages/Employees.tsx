import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Pencil, Trash2, Upload, UserPlus, Users } from 'lucide-react';
import { EMPLOYEE_STATUS, dateLabel, type EmployeeStatus } from '@adisys/shared';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { PageHeader } from '../components/AppShell';
import { Column, DataTable, FilterBar, FilterSelect, SearchInput } from '../components/DataTable';
import {
  Button, Field, Input, Modal, Select, StatusBadge, cx, useToast,
} from '../components/ui';

export function EmployeesPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'full_name', dir: 'asc' });
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  // Editing employee records from the directory is reserved to the Super Admin.
  // This gates on the role rather than on employee.update, so granting that
  // permission to an individual through an override does not put the Edit
  // column back in front of them.
  const isSuperAdmin = user?.roleKey === 'super_admin';

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
          <span className="relative shrink-0">
            <Avatar name={e.fullName} fileId={e.avatarFileId} size={32} />
            {e.onDuty && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-card"
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
          {e.email
            ? <p className="truncate text-xs text-ink-500">{e.email}</p>
            : <p className="text-xs text-ink-400">No email on record</p>}
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

  if (isSuperAdmin) {
    columns.push({
      key: 'actions', header: 'Edit', width: '4.5rem', numeric: true,
      // The cell stops propagation so editing never also triggers the row's
      // navigation to the employee's profile.
      render: (e) => (
        <span className="flex justify-end" onClick={(ev) => ev.stopPropagation()}>
          <button type="button" onClick={() => setEditing(e)}
            title={`Edit ${e.fullName}`} aria-label={`Edit ${e.fullName}`}
            className="rounded p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900">
            <Pencil className="h-4 w-4" />
          </button>
        </span>
      ),
    });
  }

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

      {editing && (
        <EditEmployeeModal employee={editing} lookups={lookups.data}
          onClose={() => setEditing(null)}
          onSaved={() => { void qc.invalidateQueries({ queryKey: ['employees'] }); setEditing(null); }}
          /* The photo saves on its own, so the table refreshes without closing the dialog. */
          onAvatarChanged={() => { void qc.invalidateQueries({ queryKey: ['employees'] }); }} />
      )}
    </>
  );
}

/* =================================================================== */
/**
 * Profile photo, uploaded on choosing a file rather than on Save.
 *
 * It is a separate endpoint from the rest of the form — a multipart upload
 * cannot ride along with the JSON PATCH — so it applies immediately and the
 * dialog's Save button stays about the text fields. The file is checked here
 * for type and size to fail fast, and again on the server, which sniffs the
 * real type from the bytes rather than trusting what the browser declares.
 */
function AvatarField({ employee, onChanged }: { employee: any; onChanged: () => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileId, setFileId] = useState<string | null>(employee.avatarFileId ?? null);
  const [busy, setBusy] = useState(false);

  const MAX_MB = 10;
  const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

  const choose = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.includes(file.type)) {
      toast.error('Unsupported image', 'Use a JPG, PNG or WEBP file.');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error('Image too large', `Photos must be ${MAX_MB} MB or smaller.`);
      return;
    }
    const body = new FormData();
    body.append('avatar', file);
    setBusy(true);
    try {
      const res = await api.upload<{ avatarFileId: string }>(`/employees/${employee.id}/avatar`, body);
      setFileId(res.avatarFileId);
      toast.success('Photo updated');
      onChanged();
    } catch (err) {
      toast.error('Could not upload the photo', (err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';   // allow re-picking the same file
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/employees/${employee.id}/avatar`);
      setFileId(null);
      toast.success('Photo removed');
      onChanged();
    } catch (err) {
      toast.error('Could not remove the photo', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4 rounded-lg bg-sunken p-3.5">
      <Avatar name={employee.fullName} fileId={fileId} size={56} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-900">Profile photo</p>
        <p className="mt-0.5 text-xs text-ink-500">
          JPG, PNG or WEBP, up to {MAX_MB} MB. Shown wherever this employee appears.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button icon={<Upload className="h-4 w-4" />} loading={busy}
                  onClick={() => inputRef.current?.click()}>
            {fileId ? 'Replace photo' : 'Upload photo'}
          </Button>
          {fileId && (
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} disabled={busy} onClick={remove}>
              Remove
            </Button>
          )}
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT.join(',')} className="sr-only"
               onChange={(e) => void choose(e.target.files?.[0])} />
      </div>
    </div>
  );
}

/* =================================================================== */
/**
 * Edit an existing employee.
 *
 * Only the fields the user actually changed are sent, so the audit trail
 * records real edits rather than a rewrite of every column. "Not set" on an
 * optional association sends null, which the API reads as "clear it".
 *
 * Employee ID is shown but not editable — the API refuses to change it, since
 * it is the identifier people sign in with. Status is not here either: that
 * runs through Deactivate/Activate on the employee's profile, which needs the
 * separate employee.deactivate permission and records a reason.
 */
function EditEmployeeModal({ employee, lookups, onClose, onSaved, onAvatarChanged }: {
  employee: any; lookups: any; onClose: () => void; onSaved: () => void; onAvatarChanged: () => void;
}) {
  const toast = useToast();

  const initial = {
    fullName: employee.fullName ?? '',
    email: employee.email ?? '',
    phone: employee.phone ?? '',
    roleId: employee.roleId ?? '',
    departmentId: employee.departmentId ?? '',
    designationId: employee.designationId ?? '',
    baseLocationId: employee.baseLocationId ?? '',
    reportingManagerId: employee.reportingManagerId ?? '',
    dateOfJoining: employee.dateOfJoining ? String(employee.dateOfJoining).slice(0, 10) : '',
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const managers = useQuery({
    queryKey: ['employees', 'managers'],
    queryFn: () => api.get('/employees', { size: 100, status: 'active' }),
  });

  /** Always carry a value; everything else sends null when left blank. */
  const REQUIRED = ['fullName', 'phone', 'roleId'] as const;
  /** Free text, so trim before comparing and sending. */
  const TEXT = ['fullName', 'email', 'phone'] as const;

  const changedKeys = (Object.keys(initial) as Array<keyof typeof initial>)
    .filter((k) => form[k] !== initial[k]);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      for (const k of changedKeys) {
        const v = (TEXT as readonly string[]).includes(k) ? form[k].trim() : form[k];
        payload[k] = (REQUIRED as readonly string[]).includes(k) ? v : (v || null);
      }
      return api.patch(`/employees/${employee.id}`, payload);
    },
    onSuccess: () => {
      toast.success('Employee updated', `${form.fullName.trim()} has been saved.`);
      onSaved();
    },
    onError: (err) => {
      setError(err as ApiRequestError);
      toast.error('Could not save the changes', (err as Error).message);
    },
  });

  const set = (k: keyof typeof form) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Validate in the form as well as on the server, so a disabled Save button
  // always has a visible reason. This is not theoretical: staff imported from
  // the spreadsheet can carry a placeholder phone number that the API rejects,
  // and without this the button would simply refuse to work.
  const localErrors = {
    fullName: form.fullName.trim().length >= 2 ? undefined : 'Enter the full name',
    // Optional: many staff have no address on record. Only validate the shape
    // once something has actually been typed.
    email: form.email.trim() === '' || /^\S+@\S+\.\S+$/.test(form.email.trim())
      ? undefined : 'Enter a valid email address',
    phone: /^[6-9]\d{9}$/.test(form.phone) ? undefined : 'Enter a 10-digit Indian mobile number',
    roleId: form.roleId ? undefined : 'Choose a role',
  };
  const fieldError = (k: keyof typeof localErrors) => error?.fieldError(k) ?? localErrors[k];
  const valid = Object.values(localErrors).every((v) => v === undefined);

  return (
    <Modal open onClose={onClose} size="lg" title={`Edit ${employee.fullName}`}
      description="Changes take effect immediately and are written to the audit log."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending}
                  disabled={!valid || changedKeys.length === 0}
                  onClick={() => save.mutate()}>
            {changedKeys.length === 0 ? 'No changes' : 'Save changes'}
          </Button>
        </>
      }>
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger ring-1 ring-inset ring-danger/20">
            {error.message}
          </div>
        )}

        <AvatarField employee={employee} onChanged={onAvatarChanged} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={fieldError('fullName')}>
            <Input value={form.fullName} onChange={set('fullName')}
                   invalid={Boolean(fieldError('fullName'))} />
          </Field>
          <Field label="Employee ID" hint="Issued at creation and used to sign in — it cannot be changed.">
            <Input value={employee.employeeCode} readOnly disabled />
          </Field>
          <Field label="Email address" required error={fieldError('email')}>
            <Input type="email" value={form.email} onChange={set('email')}
                   invalid={Boolean(fieldError('email'))} />
          </Field>
          <Field label="Mobile number" required error={fieldError('phone')}
                 hint="10 digits, used to sign in to the field app.">
            <Input inputMode="numeric" maxLength={10} value={form.phone}
                   onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))}
                   invalid={Boolean(fieldError('phone'))} />
          </Field>
          <Field label="Role" required error={fieldError('roleId')}
                 hint="Determines what this person can see and do.">
            <Select value={form.roleId} onChange={set('roleId')} invalid={Boolean(fieldError('roleId'))}>
              {(lookups?.roles ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Reporting manager" error={error?.fieldError('reportingManagerId')}>
            <Select value={form.reportingManagerId} onChange={set('reportingManagerId')}>
              <option value="">Not set</option>
              {(managers.data?.data ?? [])
                .filter((m: any) => m.id !== employee.id)   /* nobody reports to themselves */
                .map((m: any) => (
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
  // Email is optional — staff are identified by employee code and mobile.
  const canSubmit = form.fullName.trim() && /^[6-9]\d{9}$/.test(form.phone) && form.roleId;

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
