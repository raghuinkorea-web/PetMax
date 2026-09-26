import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileCheck2, X } from 'lucide-react';
import { LEAVE_STATUS, dateLabel, type LeaveStatus } from '@adisys/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { PageHeader } from '../components/AppShell';
import { Column, DataTable, FilterBar, FilterSelect, SearchInput } from '../components/DataTable';
import { Button, Field, Modal, StatusBadge, Textarea, useToast } from '../components/ui';

export function LeaveRequestsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();

  const [status, setStatus] = useState<string>('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<{ row: any; decision: 'approved' | 'rejected' } | null>(null);

  const query = useQuery({
    queryKey: ['leave', { status, page }],
    queryFn: () => api.get('/leave', { status: status || undefined, page, size: 25 }),
  });

  // The list is small and already scoped server-side, so the name filter is
  // applied here rather than adding a search parameter to the endpoint.
  const rows = (query.data?.data ?? []).filter((r: any) =>
    !search.trim() || `${r.employeeName} ${r.employeeCode}`.toLowerCase().includes(search.trim().toLowerCase()));

  const columns: Array<Column<any>> = [
    {
      key: 'employee', header: 'Employee',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.employeeName} fileId={r.avatarFileId} size={32} />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">{r.employeeName}</p>
            <p className="tabular truncate text-xs text-ink-500">{r.employeeCode}</p>
          </div>
        </div>
      ),
    },
    { key: 'type', header: 'Leave type', render: (r) => <span className="text-ink-800">{r.leaveTypeName}</span> },
    {
      key: 'dates', header: 'Dates',
      render: (r) => (
        <div className="min-w-0">
          <p className="text-ink-800">{dateLabel(r.fromDate)} — {dateLabel(r.toDate)}</p>
          <p className="text-xs text-ink-500">{r.totalDays} day{r.totalDays === 1 ? '' : 's'}</p>
        </div>
      ),
    },
    {
      key: 'reason', header: 'Reason', hideBelow: 'lg',
      render: (r) => <p className="max-w-xs truncate text-ink-600" title={r.reason}>{r.reason}</p>,
    },
    {
      key: 'status', header: 'Status',
      render: (r) => {
        const meta = LEAVE_STATUS.byValue[r.status as LeaveStatus];
        return (
          <div className="min-w-0">
            <StatusBadge tone={meta.tone} title={meta.description}>{meta.label}</StatusBadge>
            {r.decidedByName && (
              <p className="mt-1 truncate text-xs text-ink-500">by {r.decidedByName}</p>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions', header: 'Decision', width: '11rem', numeric: true,
      render: (r) => (
        <span className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {r.status === 'pending' && can('leave.approve') ? (
            <>
              <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />}
                      onClick={() => setDeciding({ row: r, decision: 'approved' })}>Approve</Button>
              <Button size="sm" variant="danger" icon={<X className="h-3.5 w-3.5" />}
                      onClick={() => setDeciding({ row: r, decision: 'rejected' })}>Reject</Button>
            </>
          ) : (
            <span className="text-xs text-ink-400">{r.decidedAt ? dateLabel(r.decidedAt) : '—'}</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Leave Requests"
        description="Applications from your team. Approving one marks the employee On Leave for those dates and blocks new work being assigned on them."
      />

      <div className="p-4 sm:p-6">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          page={query.data?.page}
          onPage={setPage}
          empty={{
            icon: <FileCheck2 className="h-5 w-5" />,
            title: status === 'pending' ? 'No leave requests waiting' : 'No leave requests match this filter',
            description: status === 'pending'
              ? 'Applications appear here the moment an employee submits one.'
              : 'Try a different status.',
          }}
          toolbar={
            <FilterBar active={[status, search].filter(Boolean).length}
              onReset={() => { setStatus(''); setSearch(''); setPage(1); }}>
              <SearchInput value={search} onChange={setSearch} placeholder="Employee name or ID" />
              <FilterSelect label="Status" value={status} allLabel="All statuses" className="w-44"
                onChange={(v) => { setStatus(v); setPage(1); }}
                options={LEAVE_STATUS.list.map((s) => ({ value: s.value, label: s.label }))} />
            </FilterBar>
          }
        />
      </div>

      {deciding && (
        <DecisionModal
          row={deciding.row}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['leave'] });
            void qc.invalidateQueries({ queryKey: ['employees'] });
            setDeciding(null);
          }}
        />
      )}
    </>
  );
}

/* =================================================================== */
function DecisionModal({ row, decision, onClose, onDone }: {
  row: any; decision: 'approved' | 'rejected'; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const approving = decision === 'approved';

  const decide = useMutation({
    mutationFn: () => api.post(`/leave/${row.id}/decision`, { decision, note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success(approving ? 'Leave approved' : 'Leave rejected',
        `${row.employeeName}, ${dateLabel(row.fromDate)} — ${dateLabel(row.toDate)}.`);
      onDone();
    },
    onError: (err) => toast.error('Could not record the decision', (err as Error).message),
  });

  return (
    <Modal open onClose={onClose} size="sm"
      title={approving ? 'Approve leave' : 'Reject leave'}
      description={`${row.employeeName} · ${row.leaveTypeName} · ${dateLabel(row.fromDate)} — ${dateLabel(row.toDate)} (${row.totalDays} day${row.totalDays === 1 ? '' : 's'})`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={approving ? 'success' : 'danger'} loading={decide.isPending}
                  onClick={() => decide.mutate()}>
            {approving ? 'Approve' : 'Reject'}
          </Button>
        </>
      }>
      <div className="space-y-4">
        <div className="rounded-lg bg-sunken p-3.5">
          <p className="text-xs text-ink-500">Reason given</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-800">{row.reason}</p>
        </div>

        <Field label="Note to the employee" hint="Optional. Shown with the decision in their app.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder={approving ? 'Approved — cover arranged.' : 'Why the request cannot be granted.'} />
        </Field>

        {approving && (
          <p className="text-xs leading-relaxed text-ink-600">
            These dates will show as <strong>On Leave</strong> and no work can be assigned on them.
          </p>
        )}
      </div>
    </Modal>
  );
}
