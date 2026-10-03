import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, FileCheck2, X } from 'lucide-react';
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
  const [deciding, setDeciding] = useState<{ row: any; decision: Decision } | null>(null);

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
      // Pending can go three ways; an approved request can still be called
      // off; a rejected one is final and offers nothing.
      key: 'actions', header: 'Actions', width: '15rem', numeric: true,
      render: (r) => {
        const mayDecide = can('leave.approve');
        return (
          <span className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            {r.status === 'pending' && mayDecide && (
              <>
                <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />}
                        onClick={() => setDeciding({ row: r, decision: 'approved' })}>Approve</Button>
                <Button size="sm" variant="danger" icon={<X className="h-3.5 w-3.5" />}
                        onClick={() => setDeciding({ row: r, decision: 'rejected' })}>Reject</Button>
                <Button size="sm" icon={<Ban className="h-3.5 w-3.5" />}
                        onClick={() => setDeciding({ row: r, decision: 'cancelled' })}>Cancel</Button>
              </>
            )}
            {r.status === 'approved' && mayDecide && (
              <Button size="sm" icon={<Ban className="h-3.5 w-3.5" />}
                      onClick={() => setDeciding({ row: r, decision: 'cancelled' })}>Cancel</Button>
            )}
            {(r.status === 'rejected' || r.status === 'cancelled' || !mayDecide) && (
              <span className="text-xs text-ink-400">
                {r.decidedAt ? dateLabel(r.decidedAt) : '—'}
              </span>
            )}
          </span>
        );
      },
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
type Decision = 'approved' | 'rejected' | 'cancelled';

const COPY: Record<Decision, {
  title: string; verb: string; variant: 'success' | 'danger' | 'secondary';
  placeholder: string; consequence?: string;
}> = {
  approved: {
    title: 'Approve leave', verb: 'Approve', variant: 'success',
    placeholder: 'Approved — cover arranged.',
    consequence: 'These dates will show as On Leave and no work can be assigned on them.',
  },
  rejected: {
    title: 'Reject leave', verb: 'Reject', variant: 'danger',
    placeholder: 'Why the request cannot be granted.',
    consequence: 'The employee stays available for work on these dates. A rejected request is final.',
  },
  cancelled: {
    title: 'Cancel leave', verb: 'Cancel leave', variant: 'secondary',
    placeholder: 'Why the leave is being called off.',
  },
};

function DecisionModal({ row, decision, onClose, onDone }: {
  row: any; decision: Decision; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const copy = COPY[decision];
  const cancelling = decision === 'cancelled';
  const wasApproved = row.status === 'approved';

  const decide = useMutation({
    // Cancelling is its own endpoint: it is a withdrawal, not a verdict, and
    // it is the only action allowed on a request that was already approved.
    mutationFn: () => cancelling
      ? api.post(`/leave/${row.id}/cancel`, { note: note.trim() || undefined })
      : api.post(`/leave/${row.id}/decision`, { decision, note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success(
        cancelling ? 'Leave cancelled' : decision === 'approved' ? 'Leave approved' : 'Leave rejected',
        `${row.employeeName}, ${dateLabel(row.fromDate)} — ${dateLabel(row.toDate)}.`);
      onDone();
    },
    onError: (err) => toast.error(`Could not ${copy.verb.toLowerCase()}`, (err as Error).message),
  });

  return (
    <Modal open onClose={onClose} size="sm"
      title={copy.title}
      description={`${row.employeeName} · ${row.leaveTypeName} · ${dateLabel(row.fromDate)} — ${dateLabel(row.toDate)} (${row.totalDays} day${row.totalDays === 1 ? '' : 's'})`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant={copy.variant} loading={decide.isPending} onClick={() => decide.mutate()}>
            {copy.verb}
          </Button>
        </>
      }>
      <div className="space-y-4">
        <div className="rounded-lg bg-sunken p-3.5">
          <p className="text-xs text-ink-500">Reason given</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-800">{row.reason}</p>
        </div>

        <Field label="Note to the employee"
               hint={cancelling
                 ? 'Optional, but worth giving — the employee had planned around these dates.'
                 : 'Optional. Shown with the decision in their app.'}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                    placeholder={copy.placeholder} />
        </Field>

        {copy.consequence && (
          <p className="text-xs leading-relaxed text-ink-600">{copy.consequence}</p>
        )}

        {cancelling && wasApproved && (
          <p className="rounded-lg bg-warning-soft px-3.5 py-2.5 text-xs leading-relaxed text-warning
                        ring-1 ring-inset ring-warning/20">
            This leave is already approved. Cancelling releases those dates: the employee stops
            showing as <strong>On Leave</strong>, work can be assigned on them again, and they are
            notified.
          </p>
        )}
      </div>
    </Modal>
  );
}
