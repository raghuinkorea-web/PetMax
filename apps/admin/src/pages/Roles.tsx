import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Minus, ShieldCheck } from 'lucide-react';
import { ROLE_LABELS } from '@adisys/shared';
import { api } from '../lib/api';
import { PageHeader } from '../components/AppShell';
import { Card, CardHeader, Skeleton, StatusBadge, cx } from '../components/ui';

export function RolesPage() {
  const query = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/settings/roles') });
  const [module, setModule] = useState<string>('');

  const roles = query.data?.data ?? [];
  const catalogue = (query.data?.catalogue ?? []) as Array<{ key: string; module: string; description: string }>;
  const modules = [...new Set(catalogue.map((c) => c.module))];
  const visible = module ? catalogue.filter((c) => c.module === module) : catalogue;

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="What each ADISYS role can do. Permissions are checked on every API request, not only in this interface."
      />

      <div className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {query.isLoading
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card" />)
            : roles.map((r: any) => (
                <Card key={r.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900">{r.name}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{r.description}</p>
                    </div>
                    <ShieldCheck className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                    <span className="tabular text-lg font-semibold text-ink-900">{r.userCount}</span>
                    <span className="text-xs text-ink-500">user{r.userCount === 1 ? '' : 's'}</span>
                    <span className="tabular ml-auto text-xs text-ink-500">
                      {r.permissions.length} permission{r.permissions.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </Card>
              ))}
        </div>

        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <CardHeader title="Permission matrix"
              subtitle="Scope suffixes matter: .own is the caller's own records, .team their reports and managed projects, .all the whole organisation." />
            <div className="flex flex-wrap gap-1.5 pb-4">
              <button onClick={() => setModule('')}
                className={cx('rounded-lg px-2.5 py-1 text-xs font-medium',
                  !module ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}>
                All
              </button>
              {modules.map((m) => (
                <button key={m} onClick={() => setModule(m)}
                  className={cx('rounded-lg px-2.5 py-1 text-xs font-medium capitalize',
                    module === m ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 bg-sunken">
                <tr className="border-y border-line">
                  <th className="px-5 py-2.5 text-sm font-bold text-ink-600">Permission</th>
                  {roles.map((r: any) => (
                    <th key={r.id} className="px-3 py-2.5 text-center text-sm font-bold text-ink-600">
                      <span className="block">{(ROLE_LABELS as any)[r.key]?.split(' / ')[0] ?? r.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((perm) => (
                  <tr key={perm.key} className="hover:bg-ink-50">
                    <td className="px-5 py-2.5">
                      <p className="font-mono text-xs text-ink-800">{perm.key}</p>
                      <p className="text-xs text-ink-500">{perm.description}</p>
                    </td>
                    {roles.map((r: any) => (
                      <td key={r.id} className="px-3 py-2.5 text-center">
                        {r.permissions.includes(perm.key) ? (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success-soft text-success"
                                title="Granted">
                            <Check className="h-3 w-3" aria-hidden />
                            <span className="sr-only">Granted</span>
                          </span>
                        ) : (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink-100 text-ink-300"
                                title="Not granted">
                            <Minus className="h-3 w-3" aria-hidden />
                            <span className="sr-only">Not granted</span>
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
