/**
 * Chart primitives.
 *
 * Every chart in the portal is built from these so axes, grids, tooltips
 * and colour assignment stay identical across screens. Colour is assigned
 * by the JOB the series does — approved/pending/rejected always look the
 * same wherever they appear — and the palette has been validated for
 * colour-vision separation against the white card surface.
 *
 * Two palette slots sit below 3:1 contrast on white, so charts using them
 * ship a legend AND a "View as table" fallback. That is the relief rule,
 * not an optional extra.
 */
import { useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { CardHeader, cx } from './ui';

export const CHART = {
  recorded:  'var(--color-chart-1)',
  verified:  'var(--color-chart-3)',
  approved:  'var(--color-chart-3)',
  pending:   'var(--color-chart-4)',
  rejected:  'var(--color-chart-rejected)',
  assigned:  'var(--color-chart-1)',
  completed: 'var(--color-chart-3)',
  grid:      'var(--color-chart-grid)',
  axis:      'var(--color-chart-axis)',
} as const;

/** Fixed categorical order — never cycled, never reassigned by rank. */
export const CATEGORICAL = [
  'var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)',
  'var(--color-chart-4)', 'var(--color-chart-5)', 'var(--color-chart-6)',
  'var(--color-chart-7)',
] as const;

export const AXIS_PROPS = {
  stroke: CHART.axis,
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11, fill: CHART.axis },
} as const;

export const GRID_PROPS = {
  stroke: CHART.grid,
  strokeDasharray: '0',
  vertical: false,
} as const;

/** One tooltip shell for every chart. */
export function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-ink-900 px-3 py-2 text-xs shadow-overlay">
      {label !== undefined && <p className="mb-1.5 font-medium text-white">{label}</p>}
      <ul className="space-y-1">
        {payload.map((entry: any) => (
          <li key={entry.dataKey ?? entry.name} className="flex items-center gap-2 whitespace-nowrap">
            <span className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: entry.color ?? entry.fill }} aria-hidden />
            <span className="text-white/70">{entry.name}</span>
            <span className="tabular ml-auto font-medium text-white">
              {formatter ? formatter(entry.value, entry.dataKey) : entry.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legend rendered as text + swatch — identity is never colour alone. */
export function ChartLegend({ series }: { series: Array<{ name: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5 text-xs text-ink-600">
          <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * Card wrapper that gives every chart a title, a legend and a table view.
 * The table is the accessible equivalent of the plot, not a nicety: it is
 * what a screen-reader user and a print reader actually get.
 */
export function ChartCard({
  title, subtitle, tooltip, series, action, children, table, empty,
}: {
  title: string;
  subtitle?: string;
  tooltip?: string;
  series?: Array<{ name: string; color: string }>;
  action?: ReactNode;
  children: ReactNode;
  table?: { columns: string[]; rows: Array<Array<string | number>> };
  empty?: boolean;
}) {
  const [asTable, setAsTable] = useState(false);

  return (
    <section className="rounded-card bg-card p-5 shadow-card ring-1 ring-line">
      <CardHeader
        title={title}
        subtitle={subtitle}
        tooltip={tooltip}
        action={
          <div className="flex items-center gap-1.5">
            {action}
            {table && (
              <button
                onClick={() => setAsTable((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-500
                           hover:bg-ink-100 hover:text-ink-800"
                aria-pressed={asTable}>
                {asTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
                {asTable ? 'View chart' : 'View as table'}
              </button>
            )}
          </div>
        }
      />

      {empty ? (
        <div className="flex h-56 items-center justify-center rounded-lg bg-sunken/60">
          <p className="text-xs text-ink-500">No data for the selected period.</p>
        </div>
      ) : asTable && table ? (
        <div className="max-h-72 overflow-auto rounded-lg ring-1 ring-line">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-sunken">
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c} className={cx('px-3 py-2 text-sm font-bold text-ink-600', i > 0 && 'text-right')}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} className={cx('px-3 py-1.5 text-ink-700', i > 0 && 'tabular text-right')}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {children}
          {series && series.length > 1 && <div className="mt-3"><ChartLegend series={series} /></div>}
        </>
      )}
    </section>
  );
}

/** Rounded data-end for bars, anchored to the baseline. */
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
export const BAR_RADIUS_H: [number, number, number, number] = [0, 4, 4, 0];
