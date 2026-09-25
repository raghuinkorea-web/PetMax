import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Camera, Car, Check, FileText, Fuel, Image as ImageIcon,
  Package, Receipt, Save, Send, Train, Trash2, Utensils, Wrench, X,
} from 'lucide-react';
import { money, todayIso } from '@adisys/shared';
import { api, ApiRequestError } from '../lib/api';
import {
  Button, Card, Field, Input, OptionGrid, Select, Sheet, Skeleton, StatusBadge, Textarea, cx, useToast,
} from '../components/ui';

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  purchase_bills:   <Receipt className="h-5 w-5" />,
  fuel:             <Fuel className="h-5 w-5" />,
  food:             <Utensils className="h-5 w-5" />,
  travel:           <Train className="h-5 w-5" />,
  accommodation:    <FileText className="h-5 w-5" />,
  local_conveyance: <Car className="h-5 w-5" />,
  materials:        <Package className="h-5 w-5" />,
  other:            <Wrench className="h-5 w-5" />,
};

interface Attachment { file: File; url: string }

export function AddExpenseScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();

  const [step, setStep] = useState<'category' | 'details'>(params.get('category') ? 'details' : 'category');
  const [categoryKey, setCategoryKey] = useState(params.get('category') ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    projectId: '', subcategoryId: '', expenseDate: todayIso(), amount: '',
    description: '', vendorName: '', invoiceNumber: '', paymentMethod: 'upi',
    notes: '', vehicleNumber: '', fuelType: 'petrol', fuelQuantity: '',
    travelPurpose: '', mealType: 'lunch', expenseLocation: '',
  });

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 600_000 });
  const categories = lookups.data?.categories ?? [];
  const category = categories.find((c: any) => c.key === categoryKey);
  const variant = category?.formVariant ?? 'standard';

  // Revoke object URLs so a long capture session does not leak memory.
  useEffect(() => () => attachments.forEach((a) => URL.revokeObjectURL(a.url)), []);

  const set = (k: keyof typeof form) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next: Attachment[] = [];
    for (const file of Array.from(list).slice(0, 5 - attachments.length)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error('That file is too large', `${file.name} is over 10 MB. Take the photo again at a lower quality.`);
        continue;
      }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setAttachments((prev) => [...prev, ...next]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      URL.revokeObjectURL(prev[index]!.url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const submit = useMutation({
    mutationFn: async ({ asDraft, confirmDuplicate }: { asDraft: boolean; confirmDuplicate?: boolean }) => {
      const body = new FormData();
      const fields: Record<string, string> = {
        categoryId: category!.id,
        expenseDate: form.expenseDate,
        amount: form.amount,
        description: form.description,
        submit: String(!asDraft),
      };
      if (form.projectId) fields.projectId = form.projectId;
      if (form.subcategoryId) fields.subcategoryId = form.subcategoryId;
      if (form.vendorName) fields.vendorName = form.vendorName;
      if (form.invoiceNumber) fields.invoiceNumber = form.invoiceNumber;
      if (form.paymentMethod) fields.paymentMethod = form.paymentMethod;
      if (form.notes) fields.notes = form.notes;
      if (form.expenseLocation) fields.expenseLocation = form.expenseLocation;
      if (variant === 'fuel') {
        if (form.vehicleNumber) fields.vehicleNumber = form.vehicleNumber;
        if (form.fuelType) fields.fuelType = form.fuelType;
        if (form.fuelQuantity) fields.fuelQuantity = form.fuelQuantity;
        if (form.travelPurpose) fields.travelPurpose = form.travelPurpose;
      }
      if (variant === 'food' && form.mealType) fields.mealType = form.mealType;
      if (confirmDuplicate) fields.confirmDuplicate = 'true';

      for (const [k, v] of Object.entries(fields)) body.append(k, v);
      for (const a of attachments) body.append('receipts', a.file, a.file.name);

      return api.upload('/expenses', body);
    },
    onSuccess: (res, vars) => {
      toast.success(
        vars.asDraft ? 'Saved as a draft' : 'Claim submitted',
        vars.asDraft ? 'Finish and submit it whenever you are ready.' : res.message);
      void qc.invalidateQueries({ queryKey: ['my-expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense-summary'] });
      void qc.invalidateQueries({ queryKey: ['my-day'] });
      navigate(`/expenses/${res.id}`, { replace: true });
    },
    onError: (err) => {
      const e = err as ApiRequestError;
      if (e.code === 'POSSIBLE_DUPLICATE') { setDuplicateWarning(e.message); return; }
      setError(e);
      toast.error('Could not submit the claim', e.message);
    },
  });

  const receiptRequired = category?.receiptRequired ?? true;
  const projectRequired = category?.projectRequired ?? true;
  const amountValid = Number(form.amount) > 0;
  const canSubmit = Boolean(category) && amountValid && form.description.trim().length >= 3
    && (!projectRequired || form.projectId) && (!receiptRequired || attachments.length > 0);

  /* ---- Step 1: what kind of expense? --------------------------- */
  if (step === 'category') {
    return (
      <>
        <Header title="Add an expense" subtitle="What are you claiming for?" onBack={() => navigate('/expenses')} />
        <div className="mx-auto max-w-lg p-4">
          {lookups.isLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : (
            <OptionGrid
              value={categoryKey as any}
              onChange={(v) => { setCategoryKey(v); setStep('details'); }}
              options={categories.map((c: any) => ({
                value: c.key,
                label: c.name,
                icon: CATEGORY_ICON[c.key] ?? <Receipt className="h-5 w-5" />,
                hint: c.receiptRequired ? 'Bill required' : 'Bill optional',
              }))}
            />
          )}
        </div>
      </>
    );
  }

  /* ---- Step 2: details ----------------------------------------- */
  return (
    <>
      <Header title={category?.name ?? 'Expense'}
              subtitle={receiptRequired ? 'A photo of the bill is required' : 'A bill is optional for this category'}
              onBack={() => setStep('category')} />

      <div className="mx-auto max-w-lg space-y-4 p-4 pb-44">
        {error && (
          <Card className="bg-danger-soft ring-danger/30">
            <p className="text-sm font-medium text-danger">{error.message}</p>
            {error.details && (
              <ul className="mt-1.5 space-y-0.5 text-xs text-ink-700">
                {Object.entries(error.details).map(([k, v]) => <li key={k}>• {v.join(', ')}</li>)}
              </ul>
            )}
          </Card>
        )}

        {/* --- Receipt capture ------------------------------- */}
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-ink-900">
              Bill photo{receiptRequired && <span className="ml-0.5 text-danger">*</span>}
            </h2>
            <span className="text-[12px] text-ink-500">{attachments.length}/5</span>
          </div>

          {attachments.length > 0 && (
            <ul className="mt-3 grid grid-cols-3 gap-2">
              {attachments.map((a, i) => (
                <li key={i} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-sunken ring-1 ring-line">
                  {a.file.type.startsWith('image/')
                    ? <img src={a.url} alt={`Receipt ${i + 1}`} className="h-full w-full object-cover" />
                    : <span className="flex h-full flex-col items-center justify-center gap-1 text-ink-500">
                        <FileText className="h-6 w-6" aria-hidden /><span className="text-[11px]">PDF</span>
                      </span>}
                  <button onClick={() => removeAttachment(i)} aria-label={`Remove receipt ${i + 1}`}
                    className="absolute right-1 top-1 rounded-full bg-ink-900/75 p-1.5 text-white">
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {attachments.length < 5 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant={attachments.length ? 'secondary' : 'primary'}
                      icon={<Camera className="h-4 w-4" />} onClick={() => cameraRef.current?.click()}>
                Take photo
              </Button>
              <Button icon={<ImageIcon className="h-4 w-4" />} onClick={() => galleryRef.current?.click()}>
                From gallery
              </Button>
            </div>
          )}

          {/* `capture` opens the rear camera directly on Android. */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
                 onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={galleryRef} type="file" accept="image/*,application/pdf" multiple hidden
                 onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

          {receiptRequired && attachments.length === 0 && (
            <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-ink-500">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
              Photograph the whole bill, including the total and the GST line. Blurred bills get sent back.
            </p>
          )}
        </Card>

        {/* --- Core fields ----------------------------------- */}
        <Card className="space-y-4">
          <Field label="Amount" required error={error?.fieldError('amount')}
                 hint={category?.maxAmountPerClaim
                   ? `Limit ${money(category.maxAmountPerClaim)} per claim${category.dailyLimit ? `, ${money(category.dailyLimit)} per day` : ''}`
                   : undefined}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-semibold text-ink-400">₹</span>
              <Input inputMode="decimal" value={form.amount} onChange={set('amount')}
                     className="h-14 pl-9 text-2xl font-semibold" placeholder="0"
                     invalid={Boolean(error?.fieldError('amount'))} autoFocus />
            </div>
          </Field>

          <Field label="Date of expense" required error={error?.fieldError('expenseDate')}>
            <Input type="date" value={form.expenseDate} max={todayIso()} onChange={set('expenseDate')} />
          </Field>

          <Field label="Project" required={projectRequired} error={error?.fieldError('projectId')}
                 hint="You can only claim against projects you are assigned to.">
            <Select value={form.projectId} onChange={set('projectId')}
                    invalid={Boolean(error?.fieldError('projectId'))}>
              <option value="">{projectRequired ? 'Select a project…' : 'No project'}</option>
              {(lookups.data?.projects ?? []).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>

          {(category?.children ?? []).length > 0 && (
            <Field label="Type">
              <Select value={form.subcategoryId} onChange={set('subcategoryId')}>
                <option value="">Not specified</option>
                {category.children.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          )}

          <Field label="What was it for?" required error={error?.fieldError('description')}>
            <Textarea rows={2} value={form.description} onChange={set('description')}
                      placeholder={PLACEHOLDER[variant]}
                      invalid={Boolean(error?.fieldError('description'))} />
          </Field>
        </Card>

        {/* --- Category-specific fields ---------------------- */}
        {variant === 'fuel' && (
          <Card className="space-y-4">
            <h2 className="text-base font-semibold text-ink-900">Fuel details</h2>
            <Field label="Vehicle number">
              <Input value={form.vehicleNumber} autoCapitalize="characters"
                     onChange={set('vehicleNumber')} placeholder="TS09 EA 4471" />
            </Field>
            <Field label="Fuel type">
              <OptionGrid value={form.fuelType as any} columns={3}
                onChange={(v) => setForm((f) => ({ ...f, fuelType: v }))}
                options={[
                  { value: 'petrol', label: 'Petrol' },
                  { value: 'diesel', label: 'Diesel' },
                  { value: 'cng', label: 'CNG' },
                ]} />
            </Field>
            <Field label="Quantity (litres)" hint="Optional — helps reconcile against the pump receipt.">
              <Input inputMode="decimal" value={form.fuelQuantity} onChange={set('fuelQuantity')} placeholder="24.5" />
            </Field>
            <Field label="Fuel station">
              <Input value={form.vendorName} onChange={set('vendorName')} placeholder="Bharat Petroleum" />
            </Field>
            <Field label="Purpose of travel">
              <Input value={form.travelPurpose} onChange={set('travelPurpose')}
                     placeholder="Site visit — Miyapur Depot" />
            </Field>
          </Card>
        )}

        {variant === 'food' && (
          <Card className="space-y-4">
            <h2 className="text-base font-semibold text-ink-900">Meal details</h2>
            <Field label="Meal">
              <OptionGrid value={form.mealType as any} columns={2}
                onChange={(v) => setForm((f) => ({ ...f, mealType: v }))}
                options={[
                  { value: 'breakfast', label: 'Breakfast' },
                  { value: 'lunch', label: 'Lunch' },
                  { value: 'dinner', label: 'Dinner' },
                  { value: 'other', label: 'Other' },
                ]} />
            </Field>
            <Field label="Restaurant / vendor">
              <Input value={form.vendorName} onChange={set('vendorName')} placeholder="Sri Krishna Bhavan" />
            </Field>
          </Card>
        )}

        {(variant === 'purchase' || variant === 'standard') && (
          <Card className="space-y-4">
            <h2 className="text-base font-semibold text-ink-900">Bill details</h2>
            <Field label="Vendor / shop name">
              <Input value={form.vendorName} onChange={set('vendorName')} placeholder="Balaji Electricals" />
            </Field>
            <Field label="Invoice number" hint="As printed on the bill.">
              <Input value={form.invoiceNumber} autoCapitalize="characters"
                     onChange={set('invoiceNumber')} placeholder="BE/2026/7741" />
            </Field>
            <Field label="Where">
              <Input value={form.expenseLocation} onChange={set('expenseLocation')} placeholder="Ambattur, Chennai" />
            </Field>
          </Card>
        )}

        <Card className="space-y-4">
          <Field label="How did you pay?">
            <OptionGrid value={form.paymentMethod as any} columns={3}
              onChange={(v) => setForm((f) => ({ ...f, paymentMethod: v }))}
              options={[
                { value: 'cash', label: 'Cash' },
                { value: 'upi', label: 'UPI' },
                { value: 'card', label: 'Card' },
                { value: 'company_card', label: 'Company card' },
                { value: 'bank_transfer', label: 'Transfer' },
                { value: 'other', label: 'Other' },
              ]} />
          </Field>
          <Field label="Note for your approver" hint="Optional. Anything that explains the claim.">
            <Textarea rows={2} value={form.notes} onChange={set('notes')}
                      placeholder="Approved verbally by the project manager on site." />
          </Field>
        </Card>
      </div>

      {/* --- Sticky actions -------------------------------- */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 py-3">
        <div className="mx-auto max-w-lg space-y-2">
          {!canSubmit && (
            <p className="text-center text-[12px] text-ink-500">
              {!amountValid ? 'Enter an amount'
                : !form.description.trim() ? 'Say what the expense was for'
                : projectRequired && !form.projectId ? 'Select a project'
                : receiptRequired && !attachments.length ? 'Attach a photo of the bill'
                : 'Complete the required fields'}
            </p>
          )}
          <div className="flex gap-2">
            <Button className="flex-1" icon={<Save className="h-4 w-4" />}
                    loading={submit.isPending && submit.variables?.asDraft}
                    disabled={!amountValid || !category}
                    onClick={() => submit.mutate({ asDraft: true })}>
              Save draft
            </Button>
            <Button className="flex-[2]" variant="primary" size="lg" icon={<Send className="h-4 w-4" />}
                    loading={submit.isPending && !submit.variables?.asDraft}
                    disabled={!canSubmit}
                    onClick={() => submit.mutate({ asDraft: false })}>
              Submit claim
            </Button>
          </div>
        </div>
      </div>

      {duplicateWarning && (
        <Sheet open onClose={() => setDuplicateWarning(null)} title="This looks like a duplicate"
          description="We found an earlier claim with the same date, amount and vendor."
          footer={
            <div className="space-y-2">
              <Button variant="primary" size="lg" block loading={submit.isPending}
                onClick={() => { setDuplicateWarning(null); submit.mutate({ asDraft: false, confirmDuplicate: true }); }}>
                This is a separate expense — submit it
              </Button>
              <Button variant="ghost" block onClick={() => setDuplicateWarning(null)}>
                Let me check
              </Button>
            </div>
          }>
          <p className="text-sm leading-relaxed text-ink-700">{duplicateWarning}</p>
          <p className="mt-3 text-xs leading-relaxed text-ink-500">
            Submitting the same bill twice delays everyone's reimbursement. Check your existing
            claims before confirming.
          </p>
        </Sheet>
      )}
    </>
  );
}

const PLACEHOLDER: Record<string, string> = {
  fuel: 'Fuel for the site visit to Miyapur Depot',
  food: 'Lunch during extended site duty',
  purchase: 'Replacement contactors for the Bay 7 panel',
  standard: 'Auto from the site office to the stores and back',
};

function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-card px-4 pb-3 pt-3">
      <div className="mx-auto flex max-w-lg items-center gap-2">
        <button onClick={onBack} aria-label="Back"
          className="-ml-2 rounded-lg p-2 text-ink-600 active:bg-ink-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-ink-900">{title}</h1>
          {subtitle && <p className="truncate text-xs text-ink-500">{subtitle}</p>}
        </div>
      </div>
    </header>
  );
}
