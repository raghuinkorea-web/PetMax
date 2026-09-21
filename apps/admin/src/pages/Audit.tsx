import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { dateTimeLabel } from '@adisys/shared';
import { api } from '../lib/api';
import { PageHeader } from '../components/AppShell';
import { Column, DataTable, FilterBar, FilterSelect, SearchInput } from '../components/DataTable';
import { Modal, StatusBadge, Button, cx } from '../components/ui';

const TONE_FOR = (action: string) =>
  /reject|delete|deactivate|suspend|revoke/.test(action) ? 'danger'
  : /approve|create|paid|verified/.test(action) ? 'success'
  : /return|update|change/.test(action) ? 'warning' : 'neutral';

export function AuditPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<any>(null);

  const query = useQuery({
    queryKey: ['audit', { action, entityType, page }],
    queryFn: () => api.get('/settings/audit-logs', {
      action: action || undefined, entityType: entityType || undefined, page, size: 30,
    }),
  });

  const columns: Array<Column<any>> = [
    {
      key: 'createdAt', header: 'When',
      render: (l) => <span className="tabular text-xs text-ink-600">{dateTimeLabel(l.createdAt)}</span>,
    },
    {
      key: 'actor', header: 'Who',
      render: (l) => l.actorName
        ? (
          <div className="min-w-0">
            <p className="truncate text-ink-800">{l.actorName}</p>
            <p className="tabular truncate text-xs text-ink-500">{l.actorCode} · {l.actorRole}</p>
          </div>
        )
        : <span className="text-xs text-ink-400">System</span>,
    },
    {
      key: 'action', header: 'Action',
      render: (l) => <StatusBadge tone={TONE_FOR(l.action) as any} dot={false}>{l.action}</StatusBadge>,
    },
    { key: 'entityType', header: 'Record', hideBelow: 'md', render: (l) => l.entityType },
    {
      key: 'ipAddress', header: 'From', hideBelow: 'xl',
      render: (l) => <span className="tabular text-xs text-ink-500">{l.ipAddress ?? '—'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who did what, to which record, and what changed. Retained for the configured retention period."
      />

      <div className="p-4 sm:p-6">
        <DataTable
          columns={columns}
          rows={query.data?.data ?? []}
          rowKey={(l) => String(l.id)}
          onRowClick={setDetail}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          page={query.data?.page}
          onPage={setPage}
          empty={{ icon: <ScrollText className="h-5 w-5" />, title: 'No audit entries match these filters' }}
          toolbar={
            <FilterBar active={[action, entityType].filter(Boolean).length}
              onReset={() => { setAction(''); setEntityType(''); setPage(1); }}>
              <SearchInput value={action} onChange={(v) => { setAction(v); setPage(1); }}
                           placeholder="Action prefix, e.g. expense." />
              <FilterSelect label="Record type" value={entityType} allLabel="All record types" className="w-52"
                onChange={(v) => { setEntityType(v); setPage(1); }}
                options={['user', 'project', 'work_assignment', 'expense_claim', 'time_entry',
                          'setting', 'role', 'expense_policy', 'reimbursement_batch']
                  .map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} />
            </FilterBar>
          }
        />
      </div>

      {detail && (
        <Modal open onClose={() => setDetail(null)} size="lg"
          title={detail.action}
          description={`${dateTimeLabel(detail.createdAt)} · ${detail.actorName ?? 'System'}`}
          footer={<Button onClick={() => setDetail(null)}>Close</Button>}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row term="Record type" value={detail.entityType} />
            <Row term="Record id" value={detail.entityId ?? '—'} mono />
            <Row term="Actor role" value={detail.actorRole ?? '—'} />
            <Row term="IP address" value={detail.ipAddress ?? '—'} mono />
          </dl>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Snapshot title="Before" data={detail.before} />
            <Snapshot title="After" data={detail.after} />
          </div>
        </Modal>
      )}
    </>
  );
}

function Row({ term, value, mono }: { term: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{term}</dt>
      <dd className={cx('text-sm text-ink-800', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  );
}

function Snapshot({ title, data }: { title: string; data: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-ink-700">{title}</p>
      <pre className="max-h-64 overflow-auto rounded-lg bg-ink-900 p-3 text-[11px] leading-relaxed text-ink-100">
        {data ? JSON.stringify(data, null, 2) : 'No snapshot recorded'}
      </pre>
    </div>
  );
}
