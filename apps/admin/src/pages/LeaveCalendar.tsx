import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { LEAVE_STATUS, dateLabel, type LeaveStatus } from '@adisys/shared';
import { api } from '../lib/api';
import { PageHeader } from '../components/AppShell';
import { Card, ErrorState, Skeleton, StatusBadge, cx } from '../components/ui';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthKey = (d: Date) => iso(d).slice(0, 7);

/** Whole weeks covering the month, Monday-first, so the grid is always rectangular. */
function gridFor(month: string): Date[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y!, m! - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));   // back to Monday
  const last = new Date(y!, m!, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (7 - ((last.getDay() + 6) % 7) - 1));
  const days: Date[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  return days;
}

export function LeaveCalendarPage() {
  const [month, setMonth] = useState(monthKey(new Date()));

  const query = useQuery({
    queryKey: ['leave', 'calendar', month],
    queryFn: () => api.get('/leave/calendar', { month }),
  });

  const days = useMemo(() => gridFor(month), [month]);

  /** date -> the leaves covering it. A request spans its whole range. */
  const byDate = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const leave of query.data?.data ?? []) {
      for (const d = new Date(`${leave.fromDate}T00:00:00`);
           d <= new Date(`${leave.toDate}T00:00:00`);
           d.setDate(d.getDate() + 1)) {
        const key = iso(d);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(leave);
      }
    }
    return map;
  }, [query.data]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    setMonth(monthKey(new Date(y!, m! - 1 + delta, 1)));
  };

  const title = new Date(`${month}-01T00:00:00`)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const today = iso(new Date());

  return (
    <>
      <PageHeader
        title="Leave Calendar"
        description="Approved and pending leave across your team. Pending entries are outlined; approved entries are filled."
        actions={
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month"
              className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[10rem] text-center text-sm font-semibold text-ink-900">{title}</span>
            <button onClick={() => shiftMonth(1)} aria-label="Next month"
              className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        }
      />

      <div className="space-y-5 p-4 sm:p-6">
        {query.isError ? (
          <Card padded={false}><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card>
        ) : query.isLoading ? (
          <Card><Skeleton className="h-96" /></Card>
        ) : (
          <>
            <Card padded={false} className="overflow-hidden">
              <div className="grid grid-cols-7 border-b border-line bg-sunken/60">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="px-2 py-2 text-center text-xs font-bold text-ink-600">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((d) => {
                  const key = iso(d);
                  const inMonth = key.slice(0, 7) === month;
                  const entries = byDate.get(key) ?? [];
                  return (
                    <div key={key}
                      className={cx('min-h-[6.5rem] border-b border-r border-line p-1.5 last:border-r-0',
                                    !inMonth && 'bg-sunken/40',
                                    key === today && 'ring-1 ring-inset ring-brand-500')}>
                      <div className={cx('tabular mb-1 px-0.5 text-xs',
                                         inMonth ? 'font-semibold text-ink-700' : 'text-ink-400')}>
                        {d.getDate()}
                      </div>
                      <ul className="space-y-1">
                        {entries.slice(0, 3).map((e) => (
                          <li key={e.id}>
                            <div title={`${e.employeeName} · ${e.leaveTypeName} · ${dateLabel(e.fromDate)} — ${dateLabel(e.toDate)} · ${LEAVE_STATUS.byValue[e.status as LeaveStatus].label}`}
                              className={cx('truncate rounded px-1.5 py-0.5 text-[12px] leading-tight',
                                e.status === 'approved'
                                  ? 'bg-success-soft font-medium text-success'
                                  : 'border border-dashed border-warning/50 bg-warning-soft/60 text-warning')}>
                              {e.employeeName}
                            </div>
                          </li>
                        ))}
                        {entries.length > 3 && (
                          <li className="px-1.5 text-[12px] text-ink-500">+{entries.length - 3} more</li>
                        )}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* The calendar cells only have room for a name, so the full detail
                the brief asks for is listed beneath it. */}
            <Card padded={false}>
              <div className="border-b border-line px-5 py-3.5">
                <h2 className="text-base font-semibold text-ink-900">Leave in {title}</h2>
              </div>
              {(query.data?.data ?? []).length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
                  <CalendarDays className="h-5 w-5 text-ink-400" aria-hidden />
                  <p className="text-sm font-medium text-ink-800">No leave this month</p>
                  <p className="text-xs text-ink-500">Approved and pending requests appear here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line bg-sunken/60">
                        <th className="px-5 py-2.5 text-sm font-bold text-ink-600">Employee</th>
                        <th className="px-3 py-2.5 text-sm font-bold text-ink-600">Leave type</th>
                        <th className="px-3 py-2.5 text-sm font-bold text-ink-600">From</th>
                        <th className="px-3 py-2.5 text-sm font-bold text-ink-600">To</th>
                        <th className="px-5 py-2.5 text-sm font-bold text-ink-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {(query.data?.data ?? []).map((e: any) => {
                        const meta = LEAVE_STATUS.byValue[e.status as LeaveStatus];
                        return (
                          <tr key={e.id} className="hover:bg-ink-50">
                            <td className="px-5 py-2.5">
                              <p className="font-medium text-ink-900">{e.employeeName}</p>
                              <p className="tabular text-xs text-ink-500">{e.employeeCode}</p>
                            </td>
                            <td className="px-3 py-2.5 text-ink-800">{e.leaveTypeName}</td>
                            <td className="px-3 py-2.5 text-ink-800">{dateLabel(e.fromDate)}</td>
                            <td className="px-3 py-2.5 text-ink-800">{dateLabel(e.toDate)}</td>
                            <td className="px-5 py-2.5">
                              <StatusBadge tone={meta.tone} title={meta.description}>{meta.label}</StatusBadge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
