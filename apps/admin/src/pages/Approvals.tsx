import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Inbox, RotateCcw, Stamp, X } from 'lucide-react';
import { dateLabel, money, relativeDays } from '@adisys/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import { Column, DataTable, FilterBar, FilterSelect } from '../components/DataTable';
import {
  Button, Card, Field, Modal, StatusBadge, Tabs, Textarea, cx, useToast,
} from '../components/ui';

type Action = 'approve' | 'reject' | 'return';

export function ApprovalsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const stages = useMemo(() => {
    const s: Array<{ key: string; label: string }> = [{ key: '', label: 'Everything awaiting me' }];
    if (can('expense.approve.manager')) s.push({ key: 'manager', label: 'Manager stage' });
    if (can('expense.approve.finance')) s.push({ key: 'finance', label: 'Finance stage' });
    return s;
  }, [can]);

  const [stage, setStage] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<Action | null>(null);

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 600_000 });

  const query = useQuery({
    queryKey: ['approvals', { stage, categoryId, page }],
    queryFn: () => api.get('/expenses', {
      queue: 'awaiting_me', stage: stage || undefined, categoryId: categoryId || undefined,
      page, size: 25, sort: 'submitted_at', dir: 'asc',
    }),
  });

  const rows = query.data?.data ?? [];

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => setSelected((prev) =>
    rows.every((r: any) => prev.has(r.id)) ? new Set() : new Set(rows.map((r: any) => r.id)));

  const selectedTotal = rows
    .filter((r: any) => selected.has(r.id))
    .reduce((sum: number, r: any) => sum + Number(r.amount), 0);

  const columns: Array<Column<any>> = [
    {
      key: 'expenseCode', header: 'Claim',
      render: (c) => (
        <div>
          <p className="tabular font-medium text-ink-900">{c.expenseCode}</p>
          <p className="text-xs text-ink-500">{dateLabel(c.expenseDate)}</p>
        </div>
      ),
    },
    {
      key: 'employee', header: 'Employee',
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate text-ink-800">{c.employeeName}</p>
          <p className="truncate text-xs text-ink-500">{c.projectName ?? 'No project'}</p>
        </div>
      ),
    },
    { key: 'category', header: 'Category', hideBelow: 'md', render: (c) => c.categoryName },
    {
      key: 'amount', header: 'Amount', numeric: true,
      render: (c) => (
        <span className={cx('font-medium', Number(c.amount) >= 15000 ? 'text-warning' : 'text-ink-900')}>
          {money(c.amount)}
        </span>
      ),
    },
    {
      key: 'waiting', header: 'Waiting', hideBelow: 'lg',
      render: (c) => {
        const days = c.submittedAt
          ? Math.floor((Date.now() - new Date(c.submittedAt).getTime()) / 86_400_000) : 0;
        return <StatusBadge tone={days > 3 ? 'danger' : days > 1 ? 'warning' : 'neutral'}>
          {days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`}
        </StatusBadge>;
      },
    },
    {
      key: 'stage', header: 'Stage',
      render: (c) => <StatusBadge tone={c.currentStage === 'finance' ? 'progress' : 'info'} dot={false}>
        {c.currentStage}
      </StatusBadge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Approval queue"
        description="Claims waiting on your decision, oldest first. Nobody can approve their own expenses."
        actions={
          selected.size > 0 && (
            <>
              <span className="tabular mr-1 text-sm text-ink-600">
                {selected.size} selected · {money(selectedTotal)}
              </span>
              <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => setBulk('return')}>Return</Button>
              <Button variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setBulk('reject')}>Reject</Button>
              <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => setBulk('approve')}>
                Approve {selected.size}
              </Button>
            </>
          )
        }>
        {stages.length > 1 && (
          <Tabs tabs={stages.map((s) => ({ key: s.key, label: s.label }))} active={stage}
                onChange={(k) => { setStage(k); setPage(1); setSelected(new Set()); }} />
        )}
      </PageHeader>

      <div className="p-4 sm:p-6">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/expenses/${c.id}`)}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          page={query.data?.page}
          onPage={(p) => { setPage(p); setSelected(new Set()); }}
          selection={{ selected, onToggle: toggle, onToggleAll: toggleAll }}
          empty={{
            icon: <Inbox className="h-5 w-5" />,
            title: 'Your approval queue is clear',
            description: 'No expense claims are waiting on a decision from you right now.',
          }}
          toolbar={
            <FilterBar active={categoryId ? 1 : 0} onReset={() => { setCategoryId(''); setPage(1); }}>
              <FilterSelect label="Category" value={categoryId} allLabel="All categories" className="w-52"
                onChange={(v) => { setCategoryId(v); setPage(1); }}
                options={(lookups.data?.categories ?? []).map((c: any) => ({ value: c.id, label: c.name }))} />
            </FilterBar>
          }
        />
      </div>

      {bulk && (
        <BulkDecisionModal
          action={bulk}
          claimIds={[...selected]}
          total={selectedTotal}
          onClose={() => setBulk(null)}
          onDone={(processed, failed) => {
            setBulk(null);
            setSelected(new Set());
            if (failed.length) {
              toast.warn(`${processed} processed, ${failed.length} could not be actioned`,
                failed[0]?.reason);
            } else {
              toast.success(`${processed} claim${processed === 1 ? '' : 's'} ${
                bulk === 'approve' ? 'approved' : bulk === 'reject' ? 'rejected' : 'returned'}`,
                'Each employee has been notified.');
            }
            void qc.invalidateQueries({ queryKey: ['approvals'] });
            void qc.invalidateQueries({ queryKey: ['expenses'] });
            void qc.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      )}
    </>
  );
}

/* =================================================================== */
function BulkDecisionModal({ action, claimIds, total, onClose, onDone }: {
  action: Action; claimIds: string[]; total: number;
  onClose: () => void; onDone: (processed: number, failed: any[]) => void;
}) {
  const [comment, setComment] = useState('');
  const toast = useToast();

  const run = useMutation({
    mutationFn: () => api.post('/expenses/decision-bulk', { claimIds, action, comment: comment || undefined }),
    onSuccess: (res) => onDone(res.count, res.failed ?? []),
    onError: (err) => toast.error('Bulk decision failed', (err as Error).message),
  });

  const needsComment = action !== 'approve';
  const verb = action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Return';

  return (
    <Modal open onClose={onClose}
      title={`${verb} ${claimIds.length} claim${claimIds.length === 1 ? '' : 's'}`}
      description={`Total value ${money(total)}. Each claim is decided independently — one you cannot action will not block the rest.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={action === 'approve' ? 'success' : action === 'reject' ? 'danger' : 'primary'}
                  loading={run.isPending}
                  disabled={needsComment && comment.trim().length < 5}
                  onClick={() => run.mutate()}>
            {verb} {claimIds.length}
          </Button>
        </>
      }>
      <Field label="Comment" required={needsComment}
        hint={needsComment
          ? 'Every affected employee will see exactly this text. Required to reject or return.'
          : 'Optional. Recorded against each claim in the approval trail.'}>
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder={action === 'return'
            ? 'e.g. Attach a clear photograph of the full bill including the GST line.'
            : action === 'reject'
              ? 'e.g. Exceeds the approved daily limit for this category.'
              : 'e.g. Verified against the site work log.'} />
      </Field>
    </Modal>
  );
}
