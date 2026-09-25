import {
  createContext, forwardRef, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Info, Loader2, X, XCircle } from 'lucide-react';
import type { Tone } from '@adisys/shared';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export const TONE_CLASS: Record<Tone, string> = {
  neutral:  'bg-muted-soft text-muted ring-muted/20',
  info:     'bg-info-soft text-info ring-info/20',
  progress: 'bg-progress-soft text-progress ring-progress/20',
  warning:  'bg-warning-soft text-warning ring-warning/20',
  success:  'bg-success-soft text-success ring-success/20',
  danger:   'bg-danger-soft text-danger ring-danger/20',
};

export function StatusBadge({ tone = 'neutral', children, dot = true, className }: {
  tone?: Tone; children: ReactNode; dot?: boolean; className?: string;
}) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
      'whitespace-nowrap ring-1 ring-inset', TONE_CLASS[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

/* =================================================================== */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const VARIANT: Record<Variant, string> = {
  primary:   'bg-brand-500 text-white active:bg-brand-700 disabled:bg-brand-300',
  secondary: 'bg-white text-ink-800 ring-1 ring-inset ring-line-strong active:bg-ink-100',
  ghost:     'text-ink-600 active:bg-ink-100',
  danger:    'bg-danger text-white active:brightness-90',
  success:   'bg-success text-white active:brightness-90',
};

const SIZE = {
  sm: 'h-9 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-13 px-5 text-base gap-2 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: keyof typeof SIZE; loading?: boolean; icon?: ReactNode; block?: boolean;
}>(function Button({ variant = 'secondary', size = 'md', loading, icon, block, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.99]',
        VARIANT[variant], SIZE[size], block && 'w-full', className)}
      {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* =================================================================== */
export function Card({ children, className, padded = true, as: As = 'div' }: {
  children: ReactNode; className?: string; padded?: boolean; as?: any;
}) {
  return (
    <As className={cx('rounded-2xl bg-card shadow-card ring-1 ring-line', padded && 'p-4', className)}>
      {children}
    </As>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
      <h2 className="text-base font-semibold text-ink-900">{children}</h2>
      {action}
    </div>
  );
}

/* =================================================================== */
export function Field({ label, error, hint, required, children, className }: {
  label: string; error?: string; hint?: string; required?: boolean;
  children: ReactNode; className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {/* The control is nested inside the <label>, which associates the two
          implicitly — no id juggling, and tapping the text focuses the field. */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-700">
          {label}{required && <span className="ml-0.5 text-danger">*</span>}
        </span>
        {children}
      </label>
      {error
        ? <p className="flex items-start gap-1 text-xs text-danger">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{error}
          </p>
        : hint && <p className="text-xs leading-relaxed text-ink-500">{hint}</p>}
    </div>
  );
}

// 16px font size on inputs: anything smaller makes iOS Safari zoom on focus.
const CONTROL = 'w-full rounded-xl bg-white px-3.5 text-base text-ink-900 ring-1 ring-inset ring-line-strong ' +
  'placeholder:text-ink-400 focus:ring-2 focus:ring-ink-800 disabled:bg-ink-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined}
      className={cx(CONTROL, 'h-12', invalid && 'ring-2 ring-danger focus:ring-danger', className)} {...rest} />;
  });

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined}
      className={cx(CONTROL, 'py-3 leading-relaxed', invalid && 'ring-2 ring-danger', className)} {...rest} />;
  });

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select ref={ref} aria-invalid={invalid || undefined}
          className={cx(CONTROL, 'h-12 appearance-none pr-10', invalid && 'ring-2 ring-danger', className)}
          {...rest}>{children}</select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
      </div>
    );
  });

/** Large tappable option list — easier than a native select with gloves on. */
export function OptionGrid<T extends string>({ value, onChange, options, columns = 2 }: {
  value: T | ''; onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode; hint?: string }>;
  columns?: 1 | 2 | 3;
}) {
  return (
    <div className={cx('grid gap-2', columns === 1 ? 'grid-cols-1' : columns === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx('flex flex-col items-start gap-1 rounded-xl px-3 py-3 text-left transition-colors',
            value === o.value
              ? 'bg-brand-50 ring-2 ring-brand-500'
              : 'bg-white ring-1 ring-line-strong active:bg-ink-50')}>
          {o.icon && <span className={value === o.value ? 'text-brand-600' : 'text-ink-400'}>{o.icon}</span>}
          <span className={cx('text-sm font-medium', value === o.value ? 'text-brand-700' : 'text-ink-800')}>
            {o.label}
          </span>
          {o.hint && <span className="text-[12px] leading-tight text-ink-500">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/* =================================================================== */
export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-ink-800">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <XCircle className="h-8 w-8 text-danger" aria-hidden />
      <p className="text-sm text-ink-700">{message}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export const Skeleton = ({ className }: { className?: string }) =>
  <div className={cx('skeleton rounded-xl', className)} aria-hidden />;

/* ===================================================================
   Bottom sheet — the mobile equivalent of a modal. Slides from the
   bottom so it stays within thumb reach.
   =================================================================== */
export function Sheet({ open, onClose, title, description, children, footer }: {
  open: boolean; onClose: () => void; title: string; description?: string;
  children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 sm:items-center sm:p-6"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="animate-sheet-up flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-card
                   shadow-overlay sm:max-w-md sm:rounded-3xl">
        <header className="shrink-0 border-b border-line px-5 pb-3 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-200 sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
              {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{description}</p>}
            </div>
            <button onClick={onClose} aria-label="Close"
              className="-mr-1.5 -mt-1 rounded-lg p-2 text-ink-400 active:bg-ink-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="safe-bottom shrink-0 border-t border-line bg-card px-5 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}

/* =================================================================== */
interface Toast { id: number; tone: Tone; title: string; body?: string }
const ToastContext = createContext<{ push: (t: Omit<Toast, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), t.tone === 'danger' ? 7000 : 4000);
  };
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="safe-top pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col gap-2 p-3">
        {toasts.map((t) => (
          <div key={t.id} role="status"
            className="animate-fade-up pointer-events-auto flex items-start gap-2.5 rounded-xl bg-card p-3.5
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
              className="tap-sm rounded p-1 text-ink-400" aria-label="Dismiss">
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
export function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-0.5" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx('tap-sm flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
            value === o.value ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 ring-1 ring-line-strong')}>
          {o.label}
          {o.count !== undefined && o.count > 0 && (
            <span className={cx('tabular rounded-full px-1.5 text-[12px] font-semibold',
              value === o.value ? 'bg-white/20' : 'bg-ink-100')}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Non-blocking banner shown while the device has no connectivity. */
export function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="bg-warning px-4 py-1.5 text-center text-xs font-medium text-white">
      No connection — showing your last synced data
    </div>
  );
}
