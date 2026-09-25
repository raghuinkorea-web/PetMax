import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { dateTimeLabel } from '@adisys/shared';
import { api } from '../lib/api';
import { Screen, ScreenHeader } from '../components/Shell';
import { Button, Card, EmptyState, Skeleton, StatusBadge, cx, useToast } from '../components/ui';

const TONE: Record<string, 'info' | 'success' | 'warning' | 'danger'> = {
  info: 'info', success: 'success', warning: 'warning', critical: 'danger',
};

export function NotificationsScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const query = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/notifications', { size: 50 }) });

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: (res) => {
      toast.success(`${res.count} marked as read`);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread'] });
    },
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread'] });
    },
  });

  const open = (n: any) => {
    if (!n.readAt) markOne.mutate(n.id);
    if (n.entityType === 'work_assignment') navigate(`/work/${n.entityId}`);
    else if (n.entityType === 'expense_claim') navigate(`/expenses/${n.entityId}`);
  };

  const items = query.data?.data ?? [];

  return (
    <>
      <ScreenHeader
        title="Alerts"
        subtitle={query.data?.unread ? `${query.data.unread} unread` : 'You are up to date'}
        action={(query.data?.unread ?? 0) > 0 && (
          <Button size="sm" loading={markAll.isPending} icon={<CheckCheck className="h-3.5 w-3.5" />}
                  onClick={() => markAll.mutate()}>
            Mark all
          </Button>
        )}
      />

      <Screen>
        {query.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState icon={<Bell className="h-5 w-5" />} title="No alerts yet"
              description="New work, acknowledgement reminders and expense decisions will show up here." />
          </Card>
        ) : (
          <ul className="space-y-2">
            {items.map((n: any) => (
              <li key={n.id}>
                <button onClick={() => open(n)}
                  className={cx('w-full rounded-2xl p-4 text-left shadow-card ring-1 ring-line active:bg-ink-50',
                    n.readAt ? 'bg-card' : 'bg-brand-50/50')}>
                  <div className="flex items-start gap-2.5">
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cx('text-sm', n.readAt ? 'text-ink-700' : 'font-semibold text-ink-900')}>
                          {n.title}
                        </p>
                        <StatusBadge tone={TONE[n.severity] ?? 'info'} dot={false}>
                          {n.type.split('.')[0]}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-ink-600">{n.body}</p>
                      <p className="mt-1 text-[12px] text-ink-400">{dateTimeLabel(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Screen>
    </>
  );
}
