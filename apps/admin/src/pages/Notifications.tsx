import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import { dateTimeLabel } from '@adisys/shared';
import { api } from '../lib/api';
import { PageHeader } from '../components/AppShell';
import { Button, Card, EmptyState, Skeleton, StatusBadge, Tabs, cx, useToast } from '../components/ui';

const TONE: Record<string, 'info' | 'success' | 'warning' | 'danger'> = {
  info: 'info', success: 'success', warning: 'warning', critical: 'danger',
};

const LINK_FOR = (n: any) =>
  n.entityType === 'expense_claim' ? `/expenses/${n.entityId}`
  : n.entityType === 'work_assignment' ? `/work?id=${n.entityId}`
  : n.entityType === 'project' ? `/projects/${n.entityId}`
  : null;

export function NotificationsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['notifications', { tab, page }],
    queryFn: () => api.get('/notifications', { unreadOnly: tab === 'unread', page, size: 30 }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: (res) => {
      toast.success(`${res.count} marked as read`);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const items = query.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Work assigned to you, approvals waiting, and decisions on your claims."
        actions={(query.data?.unread ?? 0) > 0 && (
          <Button icon={<CheckCheck className="h-4 w-4" />} loading={markAll.isPending}
                  onClick={() => markAll.mutate()}>
            Mark all as read
          </Button>
        )}>
        <Tabs
          tabs={[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread', count: query.data?.unread }]}
          active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
      </PageHeader>

      <div className="p-4 sm:p-6">
        <Card padded={false}>
          {query.isLoading ? (
            <div className="space-y-2 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : items.length === 0 ? (
            <EmptyState icon={tab === 'unread' ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
              title={tab === 'unread' ? 'Nothing unread' : 'No notifications yet'}
              description={tab === 'unread'
                ? 'You are up to date.'
                : 'Work assignments and expense decisions will appear here.'} />
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n: any) => {
                const href = LINK_FOR(n);
                const body = (
                  <div className={cx('flex items-start gap-3 px-5 py-3.5', !n.readAt && 'bg-brand-50/40')}>
                    <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      n.readAt ? 'bg-transparent' : 'bg-brand-500')} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cx('text-sm', n.readAt ? 'text-ink-700' : 'font-medium text-ink-900')}>
                          {n.title}
                        </p>
                        <StatusBadge tone={TONE[n.severity] ?? 'info'} dot={false}>
                          {n.type.split('.')[1]?.replace(/_/g, ' ') ?? n.type}
                        </StatusBadge>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{n.body}</p>
                      <p className="mt-1 text-[12px] text-ink-400">{dateTimeLabel(n.createdAt)}</p>
                    </div>
                    {!n.readAt && (
                      <button onClick={(e) => { e.preventDefault(); markRead.mutate(n.id); }}
                        className="shrink-0 rounded px-2 py-1 text-xs font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-800">
                        Mark read
                      </button>
                    )}
                  </div>
                );
                return (
                  <li key={n.id}>
                    {href
                      ? <Link to={href} onClick={() => { if (!n.readAt) markRead.mutate(n.id); }}
                              className="block hover:bg-ink-50">{body}</Link>
                      : body}
                  </li>
                );
              })}
            </ul>
          )}

          {query.data?.page && query.data.page.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <p className="tabular text-xs text-ink-500">Page {page} of {query.data.page.totalPages}</p>
              <div className="flex gap-1.5">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" disabled={page >= query.data.page.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
