import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, ShieldAlert } from 'lucide-react';
import { money } from '@adisys/shared';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/AppShell';
import {
  Button, Card, CardHeader, Checkbox, EmptyState, Field, Input, Select, Skeleton,
  StatusBadge, Tabs, cx, useToast,
} from '../components/ui';

type Section = 'organization' | 'productivity' | 'expense' | 'notification' | 'security';

const SECTIONS: Array<{ key: Section; label: string; description: string }> = [
  { key: 'organization', label: 'Organisation', description: 'Company details and working hours.' },
  { key: 'productivity', label: 'Productivity', description: 'Time tracking rules and the location policy.' },
  { key: 'expense', label: 'Expenses', description: 'Claim rules, categories and approval policies.' },
  { key: 'notification', label: 'Notifications', description: 'Channels and reminder timing.' },
  { key: 'security', label: 'Security', description: 'Password, lockout and session policy.' },
];

export function SettingsPage() {
  const { can } = useAuth();
  const [section, setSection] = useState<Section>('organization');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') });

  const docs = (settings.data?.data ?? []).filter((d: any) => d.scope === section);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configuration is data, not code. Every value here is enforced by the server, never only by this screen."
        actions={!can('settings.manage') && (
          <StatusBadge tone="neutral">Read only — you can view but not change settings</StatusBadge>
        )}>
        <Tabs tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))} active={section} onChange={setSection} />
      </PageHeader>

      <div className="space-y-5 p-4 sm:p-6">
        {settings.isLoading ? (
          <Card><Skeleton className="h-64 w-full" /></Card>
        ) : (
          <>
            {docs.map((doc: any) => (
              <SettingsDocument key={`${doc.scope}.${doc.key}`} doc={doc} editable={can('settings.manage')} />
            ))}
            {section === 'expense' && <ExpenseCategories editable={can('settings.manage')} />}
            {section === 'expense' && <ExpensePolicies />}
          </>
        )}
      </div>
    </>
  );
}

/* ===================================================================
   A settings document is rendered from its own JSON shape, so adding a
   key on the server surfaces here without a frontend change.
   =================================================================== */
function SettingsDocument({ doc, editable }: { doc: any; editable: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [value, setValue] = useState<Record<string, any>>(doc.value);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const dirty = JSON.stringify(value) !== JSON.stringify(doc.value);

  useEffect(() => { setValue(doc.value); }, [doc.value]);

  const save = useMutation({
    mutationFn: () => api.put(`/settings/${doc.scope}/${doc.key}`, { value }),
    onSuccess: () => {
      toast.success('Settings saved', 'The new rules apply to every request from now on.');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      setError(err as ApiRequestError);
      toast.error('Could not save', (err as Error).message);
    },
  });

  const title = humaniseKey(doc.key);

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={doc.updatedByName ? `Last changed by ${doc.updatedByName}` : undefined}
        action={editable && (
          <Button variant="primary" size="sm" icon={<Save className="h-3.5 w-3.5" />}
                  disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save changes
          </Button>
        )}
      />

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger ring-1 ring-inset ring-danger/20">
          <p>{error.message}</p>
          {error.details && (
            <ul className="mt-1 list-inside list-disc text-xs">
              {Object.entries(error.details).map(([k, v]) => <li key={k}>{k}: {v.join(', ')}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(value).map(([key, v]) => (
          <SettingField key={key} name={key} value={v} editable={editable}
            error={error?.fieldError(key)}
            onChange={(next) => setValue((prev) => ({ ...prev, [key]: next }))} />
        ))}
      </div>
    </Card>
  );
}

/** Acronyms that must not be title-cased into "Ocr" or "Mb". */
const ACRONYMS: Record<string, string> = {
  ocr: 'OCR', id: 'ID', url: 'URL', gstin: 'GSTIN', pdf: 'PDF',
  api: 'API', mb: 'MB', sms: 'SMS', utc: 'UTC',
};

export const humaniseKey = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word)
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());

function SettingField({ name, value, editable, error, onChange }: {
  name: string; value: any; editable: boolean; error?: string; onChange: (v: any) => void;
}) {
  const label = humaniseKey(name);

  if (typeof value === 'boolean') {
    return (
      <div className="flex items-center rounded-lg bg-sunken px-3.5 py-3">
        <Checkbox label={label} checked={value} disabled={!editable}
                  onChange={(e) => onChange(e.target.checked)} />
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <Field label={label} error={error}>
        <Input type="number" value={value} disabled={!editable}
               onChange={(e) => onChange(Number(e.target.value))} />
      </Field>
    );
  }

  if (Array.isArray(value)) {
    return (
      <Field label={label} error={error} hint="Comma separated.">
        <Input value={value.join(', ')} disabled={!editable}
               onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </Field>
    );
  }

  if (value && typeof value === 'object') {
    return (
      <Field label={label} className="sm:col-span-2">
        <div className="grid gap-2 rounded-lg bg-sunken p-3 sm:grid-cols-2">
          {Object.entries(value).map(([k, v]) =>
            typeof v === 'boolean' ? (
              <Checkbox key={k} label={humaniseKey(k)} checked={v} disabled={!editable}
                        onChange={(e) => onChange({ ...value, [k]: e.target.checked })} />
            ) : (
              <Field key={k} label={humaniseKey(k)}>
                <Input value={String(v)} disabled={!editable}
                       onChange={(e) => onChange({ ...value, [k]: typeof v === 'number' ? Number(e.target.value) : e.target.value })} />
              </Field>
            ))}
        </div>
      </Field>
    );
  }

  const isTime = /^\d{2}:\d{2}$/.test(String(value));
  return (
    <Field label={label} error={error}>
      <Input type={isTime ? 'time' : 'text'} value={String(value ?? '')} disabled={!editable}
             onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/* =================================================================== */
function ExpenseCategories({ editable }: { editable: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['expense-categories'], queryFn: () => api.get('/settings/expense/categories') });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) =>
      api.patch(`/settings/expense/categories/${id}`, patch),
    onSuccess: () => {
      toast.success('Category updated');
      void qc.invalidateQueries({ queryKey: ['expense-categories'] });
      void qc.invalidateQueries({ queryKey: ['lookups'] });
    },
    onError: (err) => toast.error('Could not update the category', (err as Error).message),
  });

  const parents = (query.data?.data ?? []).filter((c: any) => !c.parentId);

  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader title="Expense categories"
          subtitle="Receipt requirements and limits are enforced on submission, not just displayed here." />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-y border-line bg-sunken/60">
              <th className="px-5 py-2.5 text-sm font-bold text-ink-600">Category</th>
              <th className="px-3 py-2.5 text-sm font-bold text-ink-600">Form</th>
              <th className="px-3 py-2.5 text-sm font-bold text-ink-600">Receipt</th>
              <th className="px-3 py-2.5 text-sm font-bold text-ink-600">Project</th>
              <th className="px-3 py-2.5 text-right text-sm font-bold text-ink-600">Per-claim limit</th>
              <th className="px-5 py-2.5 text-right text-sm font-bold text-ink-600">Daily limit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {parents.map((c: any) => {
              const children = (query.data?.data ?? []).filter((x: any) => x.parentId === c.id);
              return (
                <tr key={c.id} className={cx(!c.active && 'opacity-50')}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink-900">{c.name}</p>
                    {children.length > 0 && (
                      <p className="mt-0.5 text-xs text-ink-500">
                        {children.map((x: any) => x.name).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone="neutral" dot={false}>{c.formVariant}</StatusBadge>
                  </td>
                  <td className="px-3 py-3">
                    <Checkbox label="" checked={c.receiptRequired} disabled={!editable}
                      onChange={(e) => update.mutate({ id: c.id, patch: { receiptRequired: e.target.checked } })} />
                  </td>
                  <td className="px-3 py-3">
                    <Checkbox label="" checked={c.projectRequired} disabled={!editable}
                      onChange={(e) => update.mutate({ id: c.id, patch: { projectRequired: e.target.checked } })} />
                  </td>
                  <td className="tabular px-3 py-3 text-right text-ink-700">
                    {c.maxAmountPerClaim ? money(c.maxAmountPerClaim) : '—'}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink-700">
                    {c.dailyLimit ? money(c.dailyLimit) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ExpensePolicies() {
  const query = useQuery({ queryKey: ['expense-policies'], queryFn: () => api.get('/settings/expense/policies') });

  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader title="Approval policies"
          subtitle="The most specific matching active policy decides a claim's route. Ties break on priority." />
      </div>
      {(query.data?.data ?? []).length === 0 ? (
        <EmptyState title="No policies configured"
          description="Without a policy, every claim requires both manager and finance approval." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-y border-line bg-sunken/60">
                <th className="px-5 py-2.5 text-sm font-bold text-ink-600">Policy</th>
                <th className="px-3 py-2.5 text-sm font-bold text-ink-600">Applies to</th>
                <th className="px-3 py-2.5 text-right text-sm font-bold text-ink-600">Amount band</th>
                <th className="px-3 py-2.5 text-sm font-bold text-ink-600">Route</th>
                <th className="px-5 py-2.5 text-right text-sm font-bold text-ink-600">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {query.data.data.map((p: any) => (
                <tr key={p.id} className={cx(!p.active && 'opacity-50')}>
                  <td className="px-5 py-3 font-medium text-ink-900">{p.name}</td>
                  <td className="px-3 py-3 text-ink-700">
                    {p.categoryName ?? p.projectName ?? p.departmentName ?? 'Any claim'}
                  </td>
                  <td className="tabular px-3 py-3 text-right text-ink-700">
                    {money(p.minAmount)} – {p.maxAmount ? money(p.maxAmount) : 'no limit'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.requiresManager && <StatusBadge tone="info" dot={false}>Manager</StatusBadge>}
                      {p.requiresFinance && <StatusBadge tone="progress" dot={false}>Finance</StatusBadge>}
                      {!p.requiresManager && !p.requiresFinance && (
                        <StatusBadge tone="success" dot={false}>Auto-approved</StatusBadge>
                      )}
                      {p.autoApproveBelow && (
                        <StatusBadge tone="neutral" dot={false}>auto below {money(p.autoApproveBelow)}</StatusBadge>
                      )}
                    </div>
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink-600">{p.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
