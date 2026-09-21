/**
 * Display formatting shared by the admin portal, the employee app and
 * every exported report — so a rupee, an hour and a date look the same
 * everywhere ADISYS shows them.
 */
export const CURRENCY = { code: 'INR', symbol: '₹', locale: 'en-IN' } as const;

export const money = (amount: number | string | null | undefined, opts?: { compact?: boolean }): string => {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return `${CURRENCY.symbol}0`;
  if (opts?.compact && Math.abs(n) >= 100_000) {
    // Indian numbering: "₹12.50 L" reads far faster than "₹12,50,000".
    if (Math.abs(n) >= 10_000_000) return `${CURRENCY.symbol}${(n / 10_000_000).toFixed(2)} Cr`;
    return `${CURRENCY.symbol}${(n / 100_000).toFixed(2)} L`;
  }
  return new Intl.NumberFormat(CURRENCY.locale, {
    style: 'currency', currency: CURRENCY.code, maximumFractionDigits: 0,
  }).format(n);
};

/** Minutes rendered as operational hours: "6h 45m". */
export const hours = (minutes: number | string | null | undefined): string => {
  const m = Math.max(0, Math.round(Number(minutes ?? 0)));
  if (m === 0) return '0h';
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h === 0 ? `${rest}m` : rest === 0 ? `${h}h` : `${h}h ${rest}m`;
};

export const decimalHours = (minutes: number | null | undefined): string =>
  (Number(minutes ?? 0) / 60).toFixed(1);

const toDate = (iso: string): Date =>
  new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);

export const dateLabel = (iso: string | null | undefined, opts?: { withYear?: boolean }): string => {
  if (!iso) return '—';
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', ...(opts?.withYear === false ? {} : { year: 'numeric' }),
  });
};

export const dateTimeLabel = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, ${
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
};

export const timeLabel = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';

/** "Today", "Tomorrow", "3 days ago" — used for due dates and approval ageing. */
export const relativeDays = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const target = toDate(iso);
  if (Number.isNaN(target.getTime())) return '—';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `In ${days} days` : `${Math.abs(days)} days ago`;
};

export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export const addDaysIso = (iso: string, days: number): string => {
  const d = toDate(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Monday of the week containing `iso` — the ADISYS week starts on Monday. */
export const mondayOf = (iso: string): string => {
  const d = toDate(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

export const percent = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined ? '—' : `${Number(value).toFixed(digits)}%`;
