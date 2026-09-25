import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Check, Copy, Download, ExternalLink, FileText,
  RotateCcw, ShieldCheck, X,
} from 'lucide-react';
import { EXPENSE_STATUS, dateLabel, dateTimeLabel, money, type ExpenseStatus } from '@adisys/shared';
import { api, fileObjectUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import {
  Button, Card, CardHeader, ErrorState, Field, Skeleton, StatusBadge, Textarea, cx, useToast,
} from '../components/ui';

export function ExpenseDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');

  const query = useQuery({ queryKey: ['expense', id], queryFn: () => api.get(`/expenses/${id}`) });
  const claim = query.data?.claim;
  const policy = query.data?.policy;

  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject' | 'return') =>
      api.post(`/expenses/${id}/decision`, { action, comment: comment || undefined }),
    onSuccess: (res, action) => {
      const label = action === 'approve'
        ? (res.nextStage ? `Approved — now with ${res.nextStage}` : 'Approved')
        : action === 'reject' ? 'Rejected' : 'Returned for correction';
      toast.success(label, `${res.expenseCode} · the employee has been notified.`);
      setComment('');
      void qc.invalidateQueries({ queryKey: ['expense', id] });
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast.error('Could not record the decision', (err as Error).message),
  });

  const reimburse = useMutation({
    mutationFn: () => api.post('/expenses/reimburse', { claimIds: [id] }),
    onSuccess: (res) => {
      toast.success('Reimbursement recorded', `Batch ${res.batchCode} · ${money(res.totalAmount)}`);
      void qc.invalidateQueries({ queryKey: ['expense', id] });
      void qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (err) => toast.error('Could not record the payment', (err as Error).message),
  });

  if (query.isError) {
    return (
      <>
        <PageHeader title="Expense claim" />
        <div className="p-6"><Card><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card></div>
      </>
    );
  }

  const meta = claim ? EXPENSE_STATUS.byValue[claim.status as ExpenseStatus] : null;
  const isPending = claim && ['submitted', 'under_review'].includes(claim.status);
  const stage = claim?.currentStage as 'manager' | 'finance' | null;
  const mayDecide = Boolean(isPending && claim.userId !== user?.id &&
    ((stage === 'manager' && can('expense.approve.manager')) ||
     (stage === 'finance' && can('expense.approve.finance'))));
  const mayPay = Boolean(claim && ['approved', 'reimbursement_pending'].includes(claim.status) && can('expense.mark_paid'));

  return (
    <>
      <PageHeader
        title={claim ? `${claim.expenseCode}` : 'Expense claim'}
        description={claim ? `${claim.categoryName}${claim.subcategoryName ? ` · ${claim.subcategoryName}` : ''} · submitted by ${claim.employeeName}` : undefined}
        actions={
          <Button icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/expenses')}>
            Back to expenses
          </Button>
        }
      />

      <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {/* --- Summary ------------------------------------------- */}
          <Card>
            {query.isLoading ? (
              <div className="space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-20 w-full" /></div>
            ) : claim && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="tabular text-3xl font-semibold tracking-tight text-ink-900">
                      {money(claim.amount)}
                    </p>
                    <p className="mt-1 text-sm text-ink-600">{claim.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {meta && <StatusBadge tone={meta.tone} title={meta.description}>{meta.label}</StatusBadge>}
                    {claim.currentStage && (
                      <span className="text-xs text-ink-500">awaiting {claim.currentStage} decision</span>
                    )}
                  </div>
                </div>

                {claim.status === 'rejected' && claim.rejectionReason && (
                  <div className="mt-4 rounded-lg bg-danger-soft p-3.5 ring-1 ring-inset ring-danger/20">
                    <p className="text-xs font-medium text-danger">Reason for rejection</p>
                    <p className="mt-1 text-sm text-ink-700">{claim.rejectionReason}</p>
                  </div>
                )}

                <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-3">
                  <Detail term="Expense date" value={dateLabel(claim.expenseDate)} />
                  <Detail term="Submitted" value={claim.submittedAt ? dateTimeLabel(claim.submittedAt) : 'Not submitted'} />
                  <Detail term="Decided" value={claim.decidedAt ? dateTimeLabel(claim.decidedAt) : '—'} />
                  <Detail term="Employee" value={`${claim.employeeName} (${claim.employeeCode})`} />
                  <Detail term="Department" value={claim.departmentName ?? '—'} />
                  <Detail term="Project" value={claim.projectName ?? 'Not booked to a project'}
                          href={claim.projectId ? `/projects/${claim.projectId}` : undefined} />
                  <Detail term="Vendor" value={claim.vendorName ?? '—'} />
                  <Detail term="Invoice number" value={claim.invoiceNumber ?? '—'} />
                  <Detail term="Payment method" value={claim.paymentMethod?.replace('_', ' ') ?? '—'} />
                  {claim.vehicleNumber && <Detail term="Vehicle" value={claim.vehicleNumber} />}
                  {claim.fuelQuantity && <Detail term="Fuel" value={`${claim.fuelQuantity} L ${claim.fuelType ?? ''}`} />}
                  {claim.mealType && <Detail term="Meal" value={claim.mealType} />}
                  {claim.expenseLocation && <Detail term="Location" value={claim.expenseLocation} />}
                </dl>

                {claim.notes && (
                  <div className="mt-4 rounded-lg bg-sunken p-3.5">
                    <p className="text-xs font-medium text-ink-600">Employee note</p>
                    <p className="mt-1 text-sm text-ink-700">{claim.notes}</p>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* --- Possible duplicates -------------------------------- */}
          {(query.data?.possibleDuplicates ?? []).length > 0 && (
            <Card className="ring-warning/30">
              <CardHeader
                title={<span className="flex items-center gap-1.5 text-warning">
                  <Copy className="h-4 w-4" /> Possible duplicate claims
                </span>}
                subtitle="Same employee, date, amount and vendor. Check before approving." />
              <ul className="divide-y divide-line">
                {query.data.possibleDuplicates.map((d: any) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <Link to={`/expenses/${d.id}`} className="tabular text-sm font-medium text-brand-600 hover:underline">
                      {d.expenseCode}
                    </Link>
                    <span className="text-xs text-ink-500">{dateLabel(d.expenseDate)}</span>
                    <span className="tabular text-sm text-ink-800">{money(d.amount)}</span>
                    <StatusBadge tone={EXPENSE_STATUS.byValue[d.status as ExpenseStatus].tone}>
                      {EXPENSE_STATUS.byValue[d.status as ExpenseStatus].label}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* --- Receipts ------------------------------------------- */}
          <Card>
            <CardHeader title="Receipts"
              subtitle="Stored privately. Every view is authorised against this claim." />
            {(query.data?.attachments ?? []).length === 0 ? (
              <p className="rounded-lg bg-sunken px-3.5 py-6 text-center text-xs text-ink-500">
                No receipt was attached to this claim.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {query.data.attachments.map((att: any) => <ReceiptCard key={att.id} attachment={att} />)}
              </div>
            )}
          </Card>

          {/* --- Approval trail ------------------------------------- */}
          <Card>
            <CardHeader title="Approval trail"
              subtitle="Append-only. A returned claim keeps its whole history through correction and resubmission." />
            <ol className="space-y-3 border-l border-line pl-4">
              {(query.data?.approvalTrail ?? []).map((e: any) => (
                <li key={e.id} className="relative">
                  <span className={cx('absolute -left-[21px] top-1.5 h-2 w-2 rounded-full',
                    e.action === 'approved' ? 'bg-success'
                      : e.action === 'rejected' ? 'bg-danger'
                      : e.action === 'returned' ? 'bg-warning' : 'bg-ink-300')} aria-hidden />
                  <p className="text-sm text-ink-800">
                    <span className="font-medium capitalize">{e.action.replace('_', ' ')}</span>
                    {e.actorName ? <> by {e.actorName}</> : ' automatically'}
                    <span className="ml-1.5 text-xs uppercase tracking-wide text-ink-400">{e.stage}</span>
                  </p>
                  {e.comment && <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{e.comment}</p>}
                  <p className="mt-0.5 text-[12px] text-ink-400">{dateTimeLabel(e.actedAt)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* --- Decision panel ------------------------------------- */}
        <div className="space-y-5">
          {policy && (
            <Card>
              <CardHeader title="Approval route"
                subtitle="Decided by configured policy, not by code." />
              <p className="rounded-lg bg-sunken px-3 py-2 text-xs font-medium text-ink-700">{policy.policyName}</p>
              <ul className="mt-3 space-y-2">
                <PolicyRow label="Manager approval" on={policy.requiresManager} />
                <PolicyRow label="Finance approval" on={policy.requiresFinance} />
                <PolicyRow label="Receipt required" on={policy.receiptRequired} />
                {policy.autoApproveBelow && (
                  <li className="text-xs text-ink-600">
                    Auto-approved below {money(policy.autoApproveBelow)}
                  </li>
                )}
                {policy.maxAmountPerClaim && (
                  <li className="text-xs text-ink-600">
                    Category limit {money(policy.maxAmountPerClaim)} per claim
                  </li>
                )}
              </ul>
            </Card>
          )}

          {mayDecide && (
            <Card>
              <CardHeader title="Your decision"
                subtitle={`You are deciding at the ${stage} stage.`} />
              <Field label="Comment"
                hint="Required to reject or return. The employee will see exactly this text.">
                <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
                          placeholder="e.g. Attach the GST invoice rather than the delivery note." />
              </Field>
              <div className="mt-4 space-y-2">
                <Button variant="success" block loading={decide.isPending}
                        icon={<Check className="h-4 w-4" />}
                        onClick={() => decide.mutate('approve')}>
                  Approve
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button loading={decide.isPending} disabled={comment.trim().length < 5}
                          icon={<RotateCcw className="h-4 w-4" />}
                          onClick={() => decide.mutate('return')}>
                    Return
                  </Button>
                  <Button variant="danger" loading={decide.isPending} disabled={comment.trim().length < 5}
                          icon={<X className="h-4 w-4" />}
                          onClick={() => decide.mutate('reject')}>
                    Reject
                  </Button>
                </div>
              </div>
              {comment.trim().length < 5 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-500">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  Add a comment to reject or return this claim.
                </p>
              )}
            </Card>
          )}

          {isPending && !mayDecide && (
            <Card>
              <div className="flex gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                <p className="text-xs leading-relaxed text-ink-600">
                  {claim.userId === user?.id
                    ? 'This is your own claim. Nobody can approve their own expenses.'
                    : `This claim is awaiting a ${stage} decision, which is outside your approval authority.`}
                </p>
              </div>
            </Card>
          )}

          {mayPay && (
            <Card>
              <CardHeader title="Reimbursement" subtitle="Record settlement of this approved claim." />
              <Button variant="primary" block loading={reimburse.isPending}
                      onClick={() => reimburse.mutate()}>
                Mark as reimbursed
              </Button>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/* =================================================================== */
function ReceiptCard({ attachment }: { attachment: any }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isImage = attachment.mimeType?.startsWith('image/');

  useEffect(() => {
    let revoked: string | null = null;
    fileObjectUrl(attachment.fileId)
      .then((u) => { revoked = u; setUrl(u); })
      .catch(() => setFailed(true));
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [attachment.fileId]);

  return (
    <figure className="overflow-hidden rounded-lg ring-1 ring-line">
      <div className="flex h-56 items-center justify-center bg-sunken">
        {failed ? (
          <p className="px-3 text-center text-xs text-ink-500">This receipt could not be loaded.</p>
        ) : !url ? (
          <Skeleton className="h-full w-full" />
        ) : isImage ? (
          <img src={url} alt={attachment.originalName} className="h-full w-full object-contain" />
        ) : attachment.mimeType === 'application/pdf' ? (
          // The reviewer has to be able to read the bill, not just see that
          // one exists — so the PDF is rendered in place.
          <object data={`${url}#toolbar=0&view=FitH`} type="application/pdf"
                  className="h-full w-full" aria-label={attachment.originalName}>
            <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-500">
              <FileText className="h-8 w-8" aria-hidden />
              <a href={url} target="_blank" rel="noreferrer"
                 className="text-xs text-brand-600 underline">Open the PDF receipt</a>
            </div>
          </object>
        ) : (
          <div className="flex flex-col items-center gap-2 text-ink-500">
            <FileText className="h-8 w-8" aria-hidden />
            <span className="text-xs">{attachment.originalName.split('.').pop()?.toUpperCase()} file</span>
          </div>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-ink-800">{attachment.originalName}</p>
          <p className="text-[12px] text-ink-500">
            {Math.round(attachment.sizeBytes / 1024)} KB
            {attachment.ocrStatus === 'completed' && ' · extracted'}
          </p>
        </div>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" aria-label="Open receipt in a new tab"
             className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </figcaption>
      {attachment.ocrPayload && (
        <div className="border-t border-line bg-info-soft px-3 py-2">
          <p className="text-[12px] font-medium text-info">Extracted from the receipt — confirmed by the employee before submission</p>
          <p className="mt-0.5 text-[12px] text-ink-600">
            {attachment.ocrPayload.vendor} · {attachment.ocrPayload.invoiceNo} · {money(attachment.ocrPayload.total)}
          </p>
        </div>
      )}
    </figure>
  );
}

function Detail({ term, value, href }: { term: string; value: string; href?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{term}</dt>
      <dd className="text-sm capitalize text-ink-800">
        {href ? <Link to={href} className="text-brand-600 hover:underline">{value}</Link> : value}
      </dd>
    </div>
  );
}

function PolicyRow({ label, on }: { label: string; on: boolean }) {
  return (
    <li className="flex items-center justify-between text-xs">
      <span className="text-ink-600">{label}</span>
      <StatusBadge tone={on ? 'info' : 'neutral'} dot={false}>{on ? 'Required' : 'Not required'}</StatusBadge>
    </li>
  );
}
