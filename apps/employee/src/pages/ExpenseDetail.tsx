import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Camera, FileText, Send, Trash2, X } from 'lucide-react';
import { EXPENSE_STATUS, dateLabel, dateTimeLabel, money, type ExpenseStatus } from '@adisys/shared';
import { api, fileObjectUrl } from '../lib/api';
import {
  Button, Card, ErrorState, SectionTitle, Skeleton, StatusBadge, cx, useToast,
} from '../components/ui';

export function ExpenseDetailScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const query = useQuery({ queryKey: ['expense', id], queryFn: () => api.get(`/expenses/${id}`) });
  const c = query.data?.claim;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['expense', id] });
    void qc.invalidateQueries({ queryKey: ['my-expenses'] });
    void qc.invalidateQueries({ queryKey: ['expense-summary'] });
  };

  const resubmit = useMutation({
    mutationFn: () => api.post(`/expenses/${id}/submit`),
    onSuccess: (res) => {
      toast.success(res.wasReturned ? 'Resubmitted' : 'Submitted',
        `Now with your ${res.stage ?? 'approver'} for a decision.`);
      invalidate();
    },
    onError: (err) => toast.error('Could not submit', (err as Error).message),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/expenses/${id}/cancel`),
    onSuccess: () => { toast.success('Claim cancelled'); invalidate(); navigate('/expenses'); },
    onError: (err) => toast.error('Could not cancel', (err as Error).message),
  });

  if (query.isLoading) {
    return <div className="safe-top space-y-3 p-4"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>;
  }
  if (query.isError || !c) {
    return (
      <div className="safe-top p-4">
        <Card><ErrorState error={query.error ?? new Error('Not found')} onRetry={() => query.refetch()} /></Card>
        <Button block className="mt-3" onClick={() => navigate('/expenses')}>Back to expenses</Button>
      </div>
    );
  }

  const meta = EXPENSE_STATUS.byValue[c.status as ExpenseStatus];
  const editable = ['draft', 'returned'].includes(c.status);

  return (
    <>
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-card px-4 pb-3 pt-3">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <button onClick={() => navigate('/expenses')} aria-label="Back"
            className="-ml-2 rounded-lg p-2 text-ink-600 active:bg-ink-100">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <p className="tabular min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{c.expenseCode}</p>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>
      </header>

      <div className={cx('mx-auto max-w-lg space-y-4 p-4', editable && 'pb-36')}>
        <Card>
          <p className="tabular text-3xl font-semibold tracking-tight text-ink-900">{money(c.amount)}</p>
          <p className="mt-1 text-sm text-ink-700">{c.description}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3.5">
            <Fact term="Category" value={c.subcategoryName ? `${c.categoryName} · ${c.subcategoryName}` : c.categoryName} />
            <Fact term="Date" value={dateLabel(c.expenseDate)} />
            <Fact term="Project" value={c.projectName ?? 'No project'} />
            <Fact term="Paid by" value={(c.paymentMethod ?? '—').replace('_', ' ')} />
            {c.vendorName && <Fact term="Vendor" value={c.vendorName} />}
            {c.invoiceNumber && <Fact term="Invoice" value={c.invoiceNumber} />}
            {c.vehicleNumber && <Fact term="Vehicle" value={c.vehicleNumber} />}
            {c.fuelQuantity && <Fact term="Fuel" value={`${c.fuelQuantity} L ${c.fuelType ?? ''}`} />}
            {c.mealType && <Fact term="Meal" value={c.mealType} />}
            <Fact term="Submitted" value={c.submittedAt ? dateTimeLabel(c.submittedAt) : 'Not yet submitted'} span />
          </dl>
        </Card>

        {c.status === 'rejected' && c.rejectionReason && (
          <Card className="bg-danger-soft ring-danger/30">
            <SectionTitle>Why this was rejected</SectionTitle>
            <p className="text-sm leading-relaxed text-ink-700">{c.rejectionReason}</p>
          </Card>
        )}

        {c.status === 'returned' && (
          <Card className="bg-warning-soft ring-warning/30">
            <SectionTitle>Your approver needs a correction</SectionTitle>
            <p className="text-sm leading-relaxed text-ink-700">
              {(query.data?.approvalTrail ?? []).filter((e: any) => e.action === 'returned').slice(-1)[0]?.comment
                ?? 'See the comment in the history below.'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-600">
              Fix it and resubmit — your original submission and their comment are kept on the record.
            </p>
          </Card>
        )}

        <Card>
          <SectionTitle>Bill photos</SectionTitle>
          {(query.data?.attachments ?? []).length === 0 ? (
            <p className="rounded-xl bg-sunken px-3 py-5 text-center text-xs text-ink-500">
              No bill attached to this claim.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {query.data.attachments.map((a: any) => (
                <ReceiptThumb key={a.id} attachment={a}
                  claimId={id} editable={editable}
                  onRemoved={() => { toast.success('Removed'); invalidate(); }} />
              ))}
            </ul>
          )}
          {editable && (query.data?.attachments ?? []).length < 5 && (
            <AddReceipt claimId={id} onAdded={() => { toast.success('Bill added'); invalidate(); }} />
          )}
        </Card>

        <Card>
          <SectionTitle>History</SectionTitle>
          <ol className="space-y-3 border-l border-line pl-4">
            {(query.data?.approvalTrail ?? []).map((e: any) => (
              <li key={e.id} className="relative">
                <span className={cx('absolute -left-[21px] top-1.5 h-2 w-2 rounded-full',
                  e.action === 'approved' ? 'bg-success'
                    : e.action === 'rejected' ? 'bg-danger'
                    : e.action === 'returned' ? 'bg-warning' : 'bg-ink-300')} aria-hidden />
                <p className="text-sm capitalize text-ink-800">
                  {e.action.replace('_', ' ')}
                  {e.actorName && <span className="text-ink-500"> · {e.actorName}</span>}
                </p>
                {e.comment && <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{e.comment}</p>}
                <p className="mt-0.5 text-[12px] text-ink-400">{dateTimeLabel(e.actedAt)}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {editable && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 py-3">
          <div className="mx-auto flex max-w-lg gap-2">
            <Button icon={<Trash2 className="h-4 w-4" />} loading={cancel.isPending}
                    onClick={() => cancel.mutate()}>Cancel</Button>
            <Button className="flex-1" variant="primary" size="lg" icon={<Send className="h-4 w-4" />}
                    loading={resubmit.isPending} onClick={() => resubmit.mutate()}>
              {c.status === 'returned' ? 'Resubmit claim' : 'Submit claim'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/* =================================================================== */
function ReceiptThumb({ attachment, claimId, editable, onRemoved }: {
  attachment: any; claimId: string; editable: boolean; onRemoved: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let created: string | null = null;
    fileObjectUrl(attachment.fileId).then((u) => { created = u; setUrl(u); }).catch(() => setFailed(true));
    return () => { if (created) URL.revokeObjectURL(created); };
  }, [attachment.fileId]);

  const remove = useMutation({
    mutationFn: () => api.del(`/expenses/${claimId}/receipts/${attachment.id}`),
    onSuccess: onRemoved,
    onError: (err) => toast.error('Could not remove it', (err as Error).message),
  });

  const isImage = attachment.mimeType?.startsWith('image/');

  return (
    <li className="relative aspect-[3/4] overflow-hidden rounded-xl bg-sunken ring-1 ring-line">
      {failed ? (
        <span className="flex h-full items-center justify-center px-2 text-center text-[12px] text-ink-500">
          Could not load
        </span>
      ) : !url ? (
        <Skeleton className="h-full w-full" />
      ) : isImage ? (
        <a href={url} target="_blank" rel="noreferrer" className="block h-full">
          <img src={url} alt={attachment.originalName} className="h-full w-full object-cover" />
        </a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer"
           className="flex h-full flex-col items-center justify-center gap-1 text-ink-500">
          <FileText className="h-7 w-7" aria-hidden />
          <span className="text-[11px]">Open PDF</span>
        </a>
      )}
      {editable && (
        <button onClick={() => remove.mutate()} aria-label="Remove this bill"
          className="absolute right-1 top-1 rounded-full bg-ink-900/75 p-1.5 text-white">
          <X className="h-3 w-3" />
        </button>
      )}
    </li>
  );
}

function AddReceipt({ claimId, onAdded }: { claimId: string; onAdded: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const body = new FormData();
      for (const f of Array.from(list).slice(0, 5)) body.append('receipts', f, f.name);
      await api.upload(`/expenses/${claimId}/receipts`, body);
      onAdded();
    } catch (err) {
      toast.error('Could not add the bill', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="mt-3 block">
      <span className={cx('flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl',
        'bg-white text-sm font-semibold text-ink-800 ring-1 ring-inset ring-line-strong active:bg-ink-50',
        busy && 'opacity-60')}>
        <Camera className="h-4 w-4" aria-hidden />
        {busy ? 'Uploading…' : 'Add another bill'}
      </span>
      <input type="file" accept="image/*,application/pdf" capture="environment" hidden disabled={busy}
             onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
    </label>
  );
}

function Fact({ term, value, span }: { term: string; value: string; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : undefined}>
      <dt className="text-[12px] text-ink-500">{term}</dt>
      <dd className="mt-0.5 text-sm capitalize text-ink-800">{value}</dd>
    </div>
  );
}
