import {
  createContext, forwardRef, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Info, Loader2, X, XCircle } from 'lucide-react';
import type { Tone } from '@adisys/shared';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/* ===================================================================
   Status tone — one mapping from domain meaning to colour, used by
   every badge, dot and chart in the portal.
   =================================================================== */
export const TONE_CLASS: Record<Tone, string> = {
  neutral:  'bg-muted-soft  text-muted  ring-muted/20',
  info:     'bg-info-soft     text-info     ring-info/20',
  progress: 'bg-progress-soft text-progress ring-progress/20',
  warning:  'bg-warning-soft  text-warning  ring-warning/20',
  success:  'bg-success-soft  text-success  ring-success/20',
  danger:   'bg-danger-soft   text-danger   ring-danger/20',
};

export const TONE_HEX: Record<Tone, string> = {
  neutral: '#55606e', info: '#1a55bd', progress: '#0b6c86',
  warning: '#96590a', success: '#06703f', danger: '#ad2027',
};

export function StatusBadge({ tone = 'neutral', children, title, dot = true }: {
  tone?: Tone; children: ReactNode; title?: string; dot?: boolean;
}) {
  return (
    <span title={title}
      className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        TONE_CLASS[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

/* =================================================================== */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:   'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm disabled:bg-brand-300',
  secondary: 'bg-white text-ink-800 ring-1 ring-inset ring-line-strong hover:bg-ink-50 active:bg-ink-100',
  ghost:     'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
  danger:    'bg-danger text-white hover:brightness-110 active:brightness-95 shadow-sm',
  success:   'bg-success text-white hover:brightness-110 active:brightness-95 shadow-sm',
};

const BUTTON_SIZE = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9.5 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, block, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANT[variant], BUTTON_SIZE[size], block && 'w-full', className)}
      {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* =================================================================== */
export function Card({ children, className, padded = true }: {
  children: ReactNode; className?: string; padded?: boolean;
}) {
  return (
    <section className={cx('rounded-card bg-card shadow-card',
      'ring-1 ring-line', padded && 'p-5', className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action, tooltip }: {
  title: ReactNode; subtitle?: ReactNode; action?: ReactNode; tooltip?: string;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-ink-900">
          {title}
          {tooltip && <InfoTip text={tooltip} />}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/** Explains what a metric actually counts — every figure is defined. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <Info className="h-3.5 w-3.5 cursor-help text-ink-400" aria-hidden />
      <span className="sr-only">{text}</span>
      <span role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-64 -translate-x-1/2 rounded-lg
                   bg-ink-900 px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-overlay
                   transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

/* =================================================================== */
export function Field({ label, htmlFor, error, hint, required, children, className }: {
  label: string; htmlFor?: string; error?: string; hint?: string;
  required?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {/* The control is nested inside the <label>, which associates the two
          implicitly — no id juggling, and clicking the text focuses the field. */}
      <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-700">
          {label}{required && <span className="ml-0.5 text-danger">*</span>}
        </span>
        {children}
      </label>
      {error
        ? <p className="flex items-start gap-1 text-xs text-danger">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{error}
          </p>
        : hint && <p className="text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

const CONTROL = 'w-full rounded-lg bg-white px-3 text-sm text-ink-900 ring-1 ring-inset ring-line-strong ' +
  'placeholder:text-ink-400 focus:ring-2 focus:ring-ink-800 disabled:bg-ink-50 disabled:text-ink-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined}
      className={cx(CONTROL, 'h-9.5', invalid && 'ring-2 ring-danger focus:ring-danger', className)} {...rest} />;
  });

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined}
      className={cx(CONTROL, 'py-2 leading-relaxed', invalid && 'ring-2 ring-danger focus:ring-danger', className)} {...rest} />;
  });

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select ref={ref} aria-invalid={invalid || undefined}
          className={cx(CONTROL, 'h-9.5 appearance-none pr-9', invalid && 'ring-2 ring-danger focus:ring-danger', className)}
          {...rest}>{children}</select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
      </div>
    );
  });

export function Checkbox({ label, description, ...rest }: InputHTMLAttributes<HTMLInputElement> & {
  label: string; description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input id={id} type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-line-strong text-brand-500 accent-[--color-brand-500]" {...rest} />
      <label htmlFor={id} className="cursor-pointer select-none">
        <span className="block text-sm text-ink-800">{label}</span>
        {description && <span className="block text-xs text-ink-500">{description}</span>}
      </label>
    </div>
  );
}

/* =================================================================== */
export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-100 text-ink-400">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-ink-800">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  const requestId = (error as any)?.requestId as string | undefined;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <XCircle className="h-8 w-8 text-danger" aria-hidden />
      <div>
        <p className="text-sm font-medium text-ink-800">{message}</p>
        {requestId && <p className="mt-1 font-mono text-[12px] text-ink-400">Reference {requestId.slice(0, 8)}</p>}
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export const Skeleton = ({ className }: { className?: string }) =>
  <div className={cx('skeleton rounded', className)} aria-hidden />;

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cx('h-8', c === 0 ? 'w-1/4' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* =================================================================== */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; description?: string;
  children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 sm:p-8"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={cx('animate-fade-up my-auto w-full rounded-xl bg-card shadow-overlay outline-none', width)}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="-m-1 rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line bg-ink-50/60 px-5 py-3.5">{footer}</footer>}
      </div>
    </div>
  );
}

/* ===================================================================
   Toasts — every mutation reports its outcome.
   =================================================================== */
interface Toast { id: number; tone: Tone; title: string; body?: string }
const ToastContext = createContext<{ push: (t: Omit<Toast, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.tone === 'danger' ? 8000 : 4500);
  };
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status"
            className="animate-fade-up pointer-events-auto flex items-start gap-3 rounded-lg bg-card p-3.5
                       shadow-overlay ring-1 ring-line">
            <span className={cx('mt-0.5 rounded-full p-1', TONE_CLASS[t.tone])}>
              {t.tone === 'danger' ? <XCircle className="h-3.5 w-3.5" />
                : t.tone === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" />
                : <Info className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-900">{t.title}</p>
              {t.body && <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{t.body}</p>}
            </div>
            <button onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
              className="rounded p-0.5 text-ink-400 hover:text-ink-700" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return {
    success: (title: string, body?: string) => ctx.push({ tone: 'success', title, body }),
    error:   (title: string, body?: string) => ctx.push({ tone: 'danger', title, body }),
    info:    (title: string, body?: string) => ctx.push({ tone: 'info', title, body }),
    warn:    (title: string, body?: string) => ctx.push({ tone: 'warning', title, body }),
  };
}

/* =================================================================== */
export function Pagination({ page, totalPages, total, size, onPage }: {
  page: number; totalPages: number; total: number; size: number; onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <p className="tabular text-xs text-ink-500">
        Showing <span className="font-medium text-ink-700">{from}–{to}</span> of{' '}
        <span className="font-medium text-ink-700">{total.toLocaleString('en-IN')}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="tabular px-2 text-xs text-ink-500">Page {page} of {totalPages}</span>
        <Button size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: Array<{ key: T; label: string; count?: number }>; active: T; onChange: (key: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={active === t.key} onClick={() => onChange(t.key)}
          className={cx('-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
            active === t.key
              ? 'border-brand-500 text-ink-900'
              : 'border-transparent text-ink-500 hover:border-ink-200 hover:text-ink-800')}>
          {t.label}
          {t.count !== undefined && (
            <span className={cx('tabular rounded-full px-1.5 py-0.5 text-[12px] font-semibold',
              active === t.key ? 'bg-brand-50 text-brand-600' : 'bg-ink-100 text-ink-500')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
