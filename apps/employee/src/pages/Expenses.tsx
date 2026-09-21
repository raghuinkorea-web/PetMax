import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Receipt } from 'lucide-react';
import { EXPENSE_STATUS, dateLabel, money, type ExpenseStatus } from '@adisys/shared';
import { api } from '../lib/api';
import { Screen, ScreenHeader } from '../components/Shell';
import {
  Button, Card, EmptyState, ErrorState, SectionTitle, SegmentedControl, Skeleton, StatusBadge, cx,
} from '../components/ui';

type Filter = 'all' | 'pending' | 'returned' | 'approved' | 'draft';

const FILTER_STATUS: Record<Filter, string | undefined> = {
  all: undefined,
  pending: 'submitted,under_review',
  returned: 'returned',
  approved: 'approved,reimbursement_pending,paid',
  draft: 'draft',
};

export function ExpensesScreen() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');

  const summary = useQuery({ queryKey: ['expense-summary'], queryFn: () => api.get('/expenses/my-summary') });
  const query = useQuery({
    queryKey: ['my-expenses', filter],
    queryFn: () => api.get('/expenses', { queue: 'mine', status: FILTER_STATUS[filter], size: 50 }),
  });

  const items = query.data?.data ?? [];

  return (
    <>
      <ScreenHeader
        title="Expenses"
        subtitle="Purchase bills, fuel and food claims"
        action={
          <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => navigate('/expenses/new')}>
            Add
          </Button>
        }
      />

      <Screen>
        {/* --- Status tiles ------------------------------------ */}
        <div className="grid grid-cols-2 gap-2">
          <Tile label="Awaiting decision" count={summary.data?.pending?.count}
                amount={summary.data?.pending?.amount} tone="warning"
                loading={summary.isLoading} onClick={() => setFilter('pending')} />
          <Tile label="Approved" count={summary.data?.approved?.count}
                amount={summary.data?.approved?.amount} tone="success"
                loading={summary.isLoading} onClick={() => setFilter('approved')} />
          <Tile label="Needs correction" count={summary.data?.returned?.count}
                amount={summary.data?.returned?.amount} tone="danger"
                loading={summary.isLoading} onClick={() => setFilter('returned')} />
          <Tile label="Reimbursed" count={summary.data?.paid?.count}
                amount={summary.data?.paid?.amount} tone="neutral"
                loading={summary.isLoading} onClick={() => setFilter('approved')} />
        </div>

        {(summary.data?.returned?.count ?? 0) > 0 && (
          <Card className="bg-danger-soft ring-danger/30">
            <p className="text-sm font-semibold text-ink-900">
              {summary.data.returned.count} claim{summary.data.returned.count === 1 ? '' : 's'} sent back to you
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
              Open each one, make the correction your approver asked for, and resubmit.
              Your original submission and their comment are kept.
            </p>
          </Card>
        )}

        <div>
          <SegmentedControl
            options={[
              { value: 'all', label: 'All' },
              { value: 'pending', label: 'Awaiting', count: summary.data?.pending?.count },
              { value: 'returned', label: 'Returned', count: summary.data?.returned?.count },
              { value: 'approved', label: 'Approved' },
              { value: 'draft', label: 'Drafts', count: summary.data?.draft?.count },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </div>

        {query.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : query.isError ? (
          <Card><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState icon={<Receipt className="h-5 w-5" />}
              title={filter === 'all' ? 'No claims yet' : 'Nothing in this view'}
              description={filter === 'all'
                ? 'Photograph a bill and submit it in under a minute.'
                : 'Try another filter.'}
              action={filter === 'all'
                ? <Button variant="primary" onClick={() => navigate('/expenses/new')}
                          icon={<Plus className="h-4 w-4" />}>Add an expense</Button>
                : undefined} />
          </Card>
        ) : (
          <ul className="space-y-2">
            {items.map((c: any) => <ClaimCard key={c.id} claim={c} />)}
          </ul>
        )}

        {(summary.data?.byCategory ?? []).length > 0 && (
          <section>
            <SectionTitle>Last 90 days by category</SectionTitle>
            <Card>
              <ul className="space-y-2.5">
                {summary.data.byCategory.map((c: any) => (
                  <li key={c.category} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-ink-700">{c.category}</span>
                    <span className="tabular shrink-0 text-sm font-semibold text-ink-900">{money(c.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </Screen>
    </>
  );
}

/* =================================================================== */
function ClaimCard({ claim: c }: { claim: any }) {
  const meta = EXPENSE_STATUS.byValue[c.status as ExpenseStatus];
  return (
    <li>
      <Link to={`/expenses/${c.id}`}
        className="block rounded-2xl bg-card p-4 shadow-card ring-1 ring-line active:bg-ink-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="tabular text-lg font-semibold leading-tight text-ink-900">{money(c.amount)}</p>
            <p className="mt-0.5 truncate text-sm text-ink-700">{c.categoryName}</p>
            <p className="tabular mt-0.5 truncate text-xs text-ink-500">
              {c.expenseCode} · {dateLabel(c.expenseDate, { withYear: false })}
              {c.vendorName ? ` · ${c.vendorName}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            {c.attachmentCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-ink-400">
                <Receipt className="h-3 w-3" aria-hidden />{c.attachmentCount}
              </span>
            )}
          </div>
        </div>
        {c.status === 'returned' && (
          <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[11px] font-medium text-warning">
            Tap to correct and resubmit
          </p>
        )}
      </Link>
    </li>
  );
}

function Tile({ label, count, amount, tone, loading, onClick }: {
  label: string; count?: number; amount?: number;
  tone: 'warning' | 'success' | 'danger' | 'neutral'; loading?: boolean; onClick: () => void;
}) {
  const colour = {
    warning: 'text-warning', success: 'text-success', danger: 'text-danger', neutral: 'text-ink-700',
  }[tone];
  return (
    <button onClick={onClick}
      className="rounded-2xl bg-card p-3.5 text-left shadow-card ring-1 ring-line active:bg-ink-50">
      <p className="text-[11px] text-ink-500">{label}</p>
      {loading ? <Skeleton className="mt-1 h-6 w-16" /> : (
        <>
          <p className={cx('tabular mt-0.5 text-lg font-semibold', colour)}>{money(amount ?? 0, { compact: true })}</p>
          <p className="text-[11px] text-ink-400">{count ?? 0} claim{count === 1 ? '' : 's'}</p>
        </>
      )}
    </button>
  );
}
