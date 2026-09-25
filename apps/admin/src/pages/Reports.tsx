import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileBarChart, Info } from 'lucide-react';
import { dateLabel, money, hours, todayIso } from '@adisys/shared';
import { api, downloadCsv } from '../lib/api';
import { PageHeader } from '../components/AppShell';
import {
  Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Select, Skeleton,
  TableSkeleton, cx, useToast,
} from '../components/ui';
import { FilterSelect } from '../components/DataTable';
import { humaniseKey as humanise } from './Settings';

const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Columns that should be rendered as money or hours rather than raw numbers. */
const MONEY_KEYS = /amount|approved|pending|rejected|expense|budget|total/i;
const HOURS_KEYS = /minutes/i;
const HOUR_DECIMAL_KEYS = /hours$/i;

function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    if (HOURS_KEYS.test(key)) return hours(n);
    if (HOUR_DECIMAL_KEYS.test(key)) return `${n.toFixed(1)}h`;
    if (/pct$/i.test(key)) return `${n}%`;
    if (MONEY_KEYS.test(key)) return money(n);
    return n.toLocaleString('en-IN');
  }
  if (/date|At$/i.test(key) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return dateLabel(String(value));
  return String(value);
}



export function ReportsPage() {
  const toast = useToast();
  const [selected, setSelected] = useState('productivity/summary');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayIso());
  const [projectId, setProjectId] = useState('');
  const [employeeId, setEmployeeId] = useState('');

  const catalogue = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/reports') });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 600_000 });
  const staff = useQuery({ queryKey: ['employees', 'report-filter'],
    queryFn: () => api.get('/employees', { size: 100 }) });

  const filters = { from, to, projectId: projectId || undefined, employeeId: employeeId || undefined };

  const report = useQuery({
    queryKey: ['report', selected, filters],
    queryFn: () => api.get(`/reports/${selected}`, filters),
    enabled: Boolean(selected),
  });

  const rows: any[] = report.data?.rows ?? [];
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const current = (catalogue.data?.data ?? []).find((r: any) => r.key === selected);

  const grouped = (catalogue.data?.data ?? []).reduce((acc: Record<string, any[]>, r: any) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Reports"
        description="Every report reads from the same underlying records, so figures reconcile across views."
        actions={
          <Button variant="primary" icon={<Download className="h-4 w-4" />} disabled={!rows.length}
            onClick={() => downloadCsv(`/reports/${selected}`, filters,
              `adisys-${selected.replace('/', '-')}-${todayIso()}.csv`)
              .then(() => toast.success('Export started', 'The CSV is downloading.'))
              .catch((e) => toast.error('Export failed', e.message))}>
            Export CSV
          </Button>
        }
      />

      <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        {/* --- Report picker ------------------------------------- */}
        <div className="space-y-4">
          <Card padded={false}>
            {catalogue.isLoading ? (
              <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
            ) : (
              <div className="p-2">
                {Object.entries(grouped).map(([group, items]) => (
                  <div key={group} className="mb-2">
                    <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                      {group}
                    </p>
                    <ul>
                      {(items as any[]).map((r) => (
                        <li key={r.key}>
                          <button onClick={() => setSelected(r.key)}
                            className={cx('w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                              selected === r.key
                                ? 'bg-brand-50 font-medium text-brand-700'
                                : 'text-ink-700 hover:bg-ink-50')}>
                            {r.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Filters" />
            <div className="space-y-3">
              <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To"><Input type="date" value={to} max={todayIso()} onChange={(e) => setTo(e.target.value)} /></Field>
              <Field label="Project">
                <FilterSelect label="Project" value={projectId} onChange={setProjectId} allLabel="All projects"
                  className="w-full"
                  options={(lookups.data?.projects ?? []).map((p: any) => ({ value: p.id, label: p.name }))} />
              </Field>
              <Field label="Employee">
                <FilterSelect label="Employee" value={employeeId} onChange={setEmployeeId} allLabel="All employees"
                  className="w-full"
                  options={(staff.data?.data ?? []).map((e: any) => ({ value: e.id, label: e.fullName }))} />
              </Field>
              <div className="flex gap-1.5 pt-1">
                {[7, 30, 90, 365].map((n) => (
                  <Button key={n} size="sm" onClick={() => { setFrom(daysAgo(n)); setTo(todayIso()); }}>
                    {n === 365 ? '1y' : `${n}d`}
                  </Button>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* --- Result -------------------------------------------- */}
        <div className="space-y-4">
          {current && (
            <Card>
              <CardHeader title={current.name} subtitle={current.description} />
              <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2.5 text-xs leading-relaxed text-info ring-1 ring-inset ring-info/20">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                Scoped to what your role permits. {dateLabel(from)} – {dateLabel(to)}.
              </p>
            </Card>
          )}

          <Card padded={false} className="overflow-hidden">
            {report.isLoading ? (
              <TableSkeleton rows={10} cols={6} />
            ) : report.isError ? (
              <ErrorState error={report.error} onRetry={() => report.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState icon={<FileBarChart className="h-5 w-5" />}
                title="No data for this period"
                description="Nothing matched the selected dates and filters. Try widening the range." />
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                  <p className="tabular text-xs text-ink-500">
                    {rows.length.toLocaleString('en-IN')} row{rows.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="max-h-[calc(100dvh-24rem)] overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-sunken">
                      <tr>
                        {columns.map((c, i) => (
                          <th key={c} className={cx('whitespace-nowrap px-3 py-2.5 text-sm font-bold text-ink-600',
                            i > 0 && 'text-right')}>
                            {humanise(c)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((row, i) => (
                        <tr key={i} className="hover:bg-ink-50">
                          {columns.map((c, j) => (
                            <td key={c} className={cx('whitespace-nowrap px-3 py-2 text-ink-700',
                              j > 0 && 'tabular text-right', j === 0 && 'font-medium text-ink-900')}>
                              {formatCell(c, row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          {report.data?.definitions && (
            <Card>
              <CardHeader title="What these figures mean"
                subtitle="Every metric in ADISYS FieldOps has one definition, used identically everywhere." />
              <dl className="space-y-2.5">
                {Object.entries(report.data.definitions as Record<string, string>).map(([k, v]) => (
                  <div key={k} className="grid gap-1 sm:grid-cols-[180px_1fr]">
                    <dt className="text-xs font-medium text-ink-700">{humanise(k.replace(/_/g, ' '))}</dt>
                    <dd className="text-xs leading-relaxed text-ink-600">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
