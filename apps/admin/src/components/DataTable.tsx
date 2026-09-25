import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { Card, EmptyState, ErrorState, Input, Pagination, Select, TableSkeleton, cx } from './ui';

export interface Column<T> {
  key: string;
  header: string;
  /** Right-align numeric columns so figures line up. */
  numeric?: boolean;
  sortable?: boolean;
  width?: string;
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: { title: string; description?: string; icon?: ReactNode; action?: ReactNode };
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  page?: { number: number; size: number; total: number; totalPages: number };
  onPage?: (page: number) => void;
  selection?: { selected: Set<string>; onToggle: (id: string) => void; onToggleAll: () => void };
  toolbar?: ReactNode;
  footer?: ReactNode;
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, loading, error, onRetry, empty,
  sort, onSort, page, onPage, selection, toolbar, footer,
}: DataTableProps<T>) {
  if (error) return <Card padded={false}><ErrorState error={error} onRetry={onRetry} /></Card>;

  const allSelected = selection ? rows.length > 0 && rows.every((r) => selection.selected.has(rowKey(r))) : false;

  return (
    <Card padded={false} className="overflow-hidden">
      {toolbar && <div className="border-b border-line px-4 py-3">{toolbar}</div>}

      {loading ? (
        <TableSkeleton cols={Math.min(columns.length, 6)} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={empty?.icon}
          title={empty?.title ?? 'Nothing to show'}
          description={empty?.description}
          action={empty?.action}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-sunken/60">
                {selection && (
                  <th className="w-10 px-3 py-2.5">
                    <input type="checkbox" checked={allSelected} onChange={selection.onToggleAll}
                      aria-label="Select all rows on this page"
                      className="h-4 w-4 rounded border-line-strong accent-[var(--color-brand-500)]" />
                  </th>
                )}
                {columns.map((col) => (
                  <th key={col.key} scope="col" style={{ width: col.width }}
                    className={cx('px-3 py-2.5 text-sm font-bold text-ink-600',
                      col.numeric && 'text-right', col.hideBelow && HIDE[col.hideBelow])}>
                    {col.sortable && onSort ? (
                      <button onClick={() => onSort(col.key)}
                        className={cx('inline-flex items-center gap-1 hover:text-ink-900',
                          col.numeric && 'flex-row-reverse')}>
                        {col.header}
                        {sort?.key === col.key
                          ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                          : <span className="h-3 w-3 opacity-0">•</span>}
                      </button>
                    ) : col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const id = rowKey(row);
                const selected = selection?.selected.has(id) ?? false;
                return (
                  <tr key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cx('transition-colors',
                      selected ? 'bg-brand-50/60' : 'hover:bg-ink-50',
                      onRowClick && 'cursor-pointer')}>
                    {selection && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected} onChange={() => selection.onToggle(id)}
                          aria-label="Select row"
                          className="h-4 w-4 rounded border-line-strong accent-[var(--color-brand-500)]" />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key}
                        className={cx('px-3 py-2.5 align-middle text-ink-700',
                          col.numeric && 'tabular text-right', col.hideBelow && HIDE[col.hideBelow])}>
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {footer}
      {page && onPage && !loading && rows.length > 0 && (
        <Pagination page={page.number} totalPages={page.totalPages} total={page.total}
                    size={page.size} onPage={onPage} />
      )}
    </Card>
  );
}

/* =================================================================== */
export function FilterBar({ children, onReset, active }: {
  children: ReactNode; onReset?: () => void; active?: number;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      {children}
      {onReset && (active ?? 0) > 0 && (
        <button onClick={onReset}
          className="flex h-9.5 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-800">
          <X className="h-3.5 w-3.5" /> Clear {active} filter{active === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className={cx('relative', className ?? 'w-full sm:w-64')}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
             className="pl-9" aria-label={placeholder} />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-400 hover:text-ink-700">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options, allLabel = 'All', className }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>; allLabel?: string; className?: string;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}
            aria-label={label} className={className ?? 'w-44'}>
      <option value="">{allLabel}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}
