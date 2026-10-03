import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus, Receipt, SlidersHorizontal, X } from 'lucide-react';
import { EXPENSE_STATUS, dateLabel, money, type ExpenseStatus } from '@adisys/shared';
import { api } from '../lib/api';
import { Screen, ScreenHeader } from '../components/Shell';
import {
  Button, Card, EmptyState, ErrorState, SectionTitle, SegmentedControl,
  Skeleton, StatusBadge, cx,
} from '../components/ui';

type Filter = 'all' | 'pending' | 'returned' | 'approved' | 'draft';

const FILTER_STATUS: Record<Filter, string | undefined> = {
  all: undefined,
  pending: 'submitted,under_review',
  returned: 'returned',
  approved: 'approved,reimbursement_pending,paid',
  draft: 'draft',
};

/** Most recent claim first — the only order this list is ever shown in. */
const DEFAULT_SORT = { sort: 'expense_date', dir: 'desc' };

/**
 * The order the categories are offered in — claims people file daily first,
 * one-offs last. It is deliberately not the sort_order used by the "Add an
 * expense" picker, which groups by how a claim is filled in rather than by
 * how often it is chosen. Anything not listed here keeps its server order
 * and follows on the end, so a new category still appears without a change.
 */
const CATEGORY_ORDER = [
  'food', 'fuel', 'accommodation', 'purchase_bills',
  'travel', 'local_conveyance', 'materials', 'other',
];

const orderCategories = (categories: any[]): any[] =>
  [...categories].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.key);
    const bi = CATEGORY_ORDER.indexOf(b.key);
    return (ai < 0 ? CATEGORY_ORDER.length : ai) - (bi < 0 ? CATEGORY_ORDER.length : bi);
  });

/** The category's name, or a neutral fallback while lookups are still loading. */
const categoryName = (lookups: any, id: string): string =>
  (lookups?.categories ?? []).find((c: any) => c.id === id)?.name ?? 'Category';

/** One applied refinement, removable on its own. */
function AppliedChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1.5
                     text-[12px] font-medium text-brand-700 ring-1 ring-brand-200">
      {label}
      <button type="button" onClick={onClear} aria-label={`Remove ${label} filter`}
        className="tap-sm flex h-5 w-5 items-center justify-center rounded-full text-brand-700
                   active:bg-brand-100">
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

export function ExpensesScreen() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [categoryId, setCategoryId] = useState('');

  const summary = useQuery({ queryKey: ['expense-summary'], queryFn: () => api.get('/expenses/my-summary') });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 600_000 });
  const query = useQuery({
    queryKey: ['my-expenses', filter, categoryId],
    queryFn: () => api.get('/expenses', {
      queue: 'mine', status: FILTER_STATUS[filter], size: 50,
      categoryId: categoryId || undefined,
      ...DEFAULT_SORT,
    }),
  });

  const items = query.data?.data ?? [];
  // Parent categories only: the sub-categories would make the list unwieldy
  // on a phone, and claims are searchable by their parent anyway.
  const categories = orderCategories(
    (lookups.data?.categories ?? []).filter((c: any) => !c.parentId));

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

        {/* Filter sits in the same row as the status chips, immediately after
            Drafts. The row still wraps rather than clipping if the counts run
            long, but at the sizes above it fits on one line. */}
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
          trailing={
            <CategoryFilter
              categories={categories}
              loading={lookups.isLoading}
              value={categoryId}
              onChange={setCategoryId}
            />
          }
        />

        {/* Whatever the Filter sheet is narrowing to, named in the open where
            it can be removed in one tap. Without this the list is quietly
            filtered and the only clue is a number on a button. */}
        {categoryId && (
          <div className="-mt-1 flex flex-wrap items-center gap-1.5">
            <AppliedChip label={categoryName(lookups.data, categoryId)}
                         onClear={() => setCategoryId('')} />
          </div>
        )}

        {query.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : query.isError ? (
          <Card><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState icon={<Receipt className="h-5 w-5" />}
              title={filter === 'all' && !categoryId ? 'No claims yet' : 'Nothing matches'}
              description={filter === 'all' && !categoryId
                ? 'Photograph a bill and submit it in under a minute.'
                : categoryId
                  // Say which control is hiding things, so an empty list is never a mystery.
                  ? `No ${categoryName(lookups.data, categoryId).toLowerCase()} claims to show.`
                  : 'Try another status.'}
              action={categoryId
                ? <Button onClick={() => setCategoryId('')}>Show all categories</Button>
                : filter === 'all'
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
/**
 * The Filter button and the short list it drops down. Picking a category
 * applies it and closes straight away — there is nothing to confirm, so an
 * Apply button would only add a tap.
 */
function CategoryFilter({ categories, loading, value, onChange }: {
  categories: any[]; loading: boolean; value: string; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Escape closes, and focus goes back into the list when it opens so the
  // options can be reached from a keyboard as well as by tapping.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const pick = (id: string) => { onChange(id); setOpen(false); };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-expanded={open} aria-haspopup="listbox"
        aria-label={value ? 'Filter — 1 applied' : 'Filter'}
        className={cx('tap-xs flex shrink-0 items-center gap-1 rounded-full px-2 py-1',
                      'text-xs font-medium shadow-card transition-colors',
                      // Applied state echoes the chip that names the category
                      // just below, rather than a second solid red next to the
                      // Add button.
                      value
                        ? 'bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-200'
                        : 'bg-card text-ink-600 ring-1 ring-line')}>
        <SlidersHorizontal className="h-3 w-3" aria-hidden />
        Filter
      </button>

      {open && (
        <>
          {/* Catches the tap that dismisses the list, including one on the
              page behind it — otherwise the list would stay open under a
              finger that has clearly moved on. */}
          <div className="fixed inset-0 z-40" aria-hidden onMouseDown={() => setOpen(false)} />
          <div ref={listRef} role="listbox" aria-label="Filter by category"
            className="absolute left-0 top-full z-50 mt-1.5 max-h-56 w-60 overflow-y-auto overscroll-contain
                       rounded-2xl bg-card p-1 shadow-overlay ring-1 ring-line">
            {loading ? (
              <div className="space-y-1 p-1">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
              </div>
            ) : (
              <>
                <Option label="All categories" selected={!value} onSelect={() => pick('')} />
                {categories.map((c: any) => (
                  <Option key={c.id} label={c.name} selected={value === c.id}
                    // Choosing the current one again clears it, so you are
                    // never stuck with a category picked by mistake.
                    onSelect={() => pick(value === c.id ? '' : c.id)} />
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** One row in the filter list. */
function Option({ label, selected, onSelect }: {
  label: string; selected: boolean; onSelect: () => void;
}) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onSelect}
      className={cx('flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm',
                    'transition-colors active:bg-ink-100',
                    selected ? 'bg-ink-50 font-semibold text-ink-900' : 'font-medium text-ink-700')}>
      <Check className={cx('h-3.5 w-3.5 shrink-0', !selected && 'invisible')} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
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
              <span className="flex items-center gap-1 text-[12px] text-ink-400">
                <Receipt className="h-3 w-3" aria-hidden />{c.attachmentCount}
              </span>
            )}
          </div>
        </div>
        {c.status === 'returned' && (
          <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12px] font-medium text-warning">
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
      <p className="text-[12px] text-ink-500">{label}</p>
      {loading ? <Skeleton className="mt-1 h-6 w-16" /> : (
        <>
          <p className={cx('tabular mt-0.5 text-lg font-semibold', colour)}>{money(amount ?? 0, { compact: true })}</p>
          <p className="text-[12px] text-ink-400">{count ?? 0} claim{count === 1 ? '' : 's'}</p>
        </>
      )}
    </button>
  );
}
