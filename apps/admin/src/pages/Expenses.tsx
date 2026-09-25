import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeIndianRupee, Download, Paperclip, Receipt } from 'lucide-react';
import { EXPENSE_STATUS, dateLabel, money, type ExpenseStatus } from '@adisys/shared';
import { api, downloadCsv } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import { Column, DataTable, FilterBar, FilterSelect, SearchInput } from '../components/DataTable';
import { Button, Input, StatusBadge, useToast } from '../components/ui';

export function ExpensesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'expense_date', dir: 'desc' });

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 600_000 });

  const filters = {
    search: search || undefined, status: status || undefined,
    categoryId: categoryId || undefined, projectId: projectId || undefined,
    from: from || undefined, to: to || undefined,
  };

  const query = useQuery({
    queryKey: ['expenses', { ...filters, page, sort }],
    queryFn: () => api.get('/expenses', { ...filters, page, size: 25, sort: sort.key, dir: sort.dir }),
  });

  const activeFilters = Object.values(filters).filter(Boolean).length;
  const totals = query.data?.totals;

  const columns: Array<Column<any>> = [
    {
      key: 'expenseCode', header: 'Claim',
      render: (c) => (
        <div className="min-w-0">
          <p className="tabular font-medium text-ink-900">{c.expenseCode}</p>
          <p className="truncate text-xs text-ink-500">{dateLabel(c.expenseDate)}</p>
        </div>
      ),
    },
    {
      key: 'employee', header: 'Employee', hideBelow: 'md',
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate text-ink-800">{c.employeeName}</p>
          <p className="tabular truncate text-xs text-ink-500">{c.employeeCode}</p>
        </div>
      ),
    },
    {
      key: 'category', header: 'Category',
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate text-ink-800">{c.categoryName}</p>
          {c.subcategoryName && <p className="truncate text-xs text-ink-500">{c.subcategoryName}</p>}
        </div>
      ),
    },
    {
      key: 'project', header: 'Project', hideBelow: 'lg',
      render: (c) => c.projectName
        ? <span className="text-ink-700">{c.projectName}</span>
        : <span className="text-xs text-ink-400">Not booked to a project</span>,
    },
    {
      key: 'amount', header: 'Amount', numeric: true, sortable: true,
      render: (c) => <span className="font-medium text-ink-900">{money(c.amount)}</span>,
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (c) => {
        const meta = EXPENSE_STATUS.byValue[c.status as ExpenseStatus];
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge tone={meta.tone} title={meta.description}>{meta.label}</StatusBadge>
            {c.currentStage && (
              <span className="text-[12px] text-ink-500">with {c.currentStage}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'receipt', header: 'Receipt', hideBelow: 'xl',
      render: (c) => c.attachmentCount > 0
        ? <span className="inline-flex items-center gap-1 text-xs text-ink-600">
            <Paperclip className="h-3.5 w-3.5" />{c.attachmentCount}
          </span>
        : <span className="text-xs text-ink-400">None</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Purchase bills, fuel and food allowances and other claims, with their approval state."
        actions={can('report.export') && (
          <Button icon={<Download className="h-4 w-4" />}
            onClick={() => downloadCsv('/reports/expenses/detail', filters, 'adisys-expenses.csv')
              .then(() => toast.success('Export started', 'The CSV is downloading.'))
              .catch((e) => toast.error('Export failed', e.message))}>
            Export CSV
          </Button>
        )}>
        {totals && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Claims in view" value={totals.count.toLocaleString('en-IN')} />
            <Tile label="Total value" value={money(totals.totalAmount, { compact: true })} />
            <Tile label="Approved" value={money(totals.approvedAmount, { compact: true })} tone="success" />
            <Tile label="Awaiting decision" value={money(totals.pendingAmount, { compact: true })} tone="warning" />
          </div>
        )}
      </PageHeader>

      <div className="p-4 sm:p-6">
        <DataTable
          columns={columns}
          rows={query.data?.data ?? []}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/expenses/${c.id}`)}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          sort={sort}
          onSort={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
          page={query.data?.page}
          onPage={setPage}
          empty={{
            icon: <Receipt className="h-5 w-5" />,
            title: activeFilters ? 'No claims match these filters' : 'No expense claims yet',
            description: activeFilters
              ? 'Try widening the date range or clearing a filter.'
              : 'Claims submitted from the employee app will appear here.',
          }}
          toolbar={
            <FilterBar active={activeFilters} onReset={() => {
              setSearch(''); setStatus(''); setCategoryId(''); setProjectId(''); setFrom(''); setTo(''); setPage(1);
            }}>
              <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }}
                           placeholder="Code, vendor, invoice or employee" />
              <FilterSelect label="Status" value={status} allLabel="All statuses"
                onChange={(v) => { setStatus(v); setPage(1); }}
                options={EXPENSE_STATUS.list.map((s) => ({ value: s.value, label: s.label }))} />
              <FilterSelect label="Category" value={categoryId} allLabel="All categories" className="w-48"
                onChange={(v) => { setCategoryId(v); setPage(1); }}
                options={(lookups.data?.categories ?? []).map((c: any) => ({ value: c.id, label: c.name }))} />
              <FilterSelect label="Project" value={projectId} allLabel="All projects" className="w-48"
                onChange={(v) => { setProjectId(v); setPage(1); }}
                options={(lookups.data?.projects ?? []).map((p: any) => ({ value: p.id, label: p.name }))} />
              <div className="flex items-end gap-1.5">
                <Input type="date" value={from} aria-label="From date" className="w-36"
                       onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
                <span className="pb-2.5 text-xs text-ink-400">to</span>
                <Input type="date" value={to} aria-label="To date" className="w-36"
                       onChange={(e) => { setTo(e.target.value); setPage(1); }} />
              </div>
            </FilterBar>
          }
        />
      </div>
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' }) {
  const colour = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-ink-900';
  return (
    <div className="rounded-lg bg-sunken px-3.5 py-2.5">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`tabular mt-0.5 text-lg font-semibold ${colour}`}>{value}</p>
    </div>
  );
}
