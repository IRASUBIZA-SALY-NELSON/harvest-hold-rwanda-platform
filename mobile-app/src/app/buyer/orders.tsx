import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ordersForUser } from '@/api';
import { OrderRow } from '@/features/market-rows';
import { useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { spacing } from '@/theme';
import { EmptyState, ErrorState, Loading, Screen, Segmented } from '@/ui';

export default function BuyerOrders() {
  const user = useUser();
  const { t } = useLabels();
  const [filter, setFilter] = useState<'all' | 'pending'>('all');
  const orders = useApi(() => ordersForUser(user), [user.id]);
  const pendingCount = orders.data?.filter((o) => o.status === 'pending').length ?? 0;
  const visible = orders.data?.filter((o) => filter === 'all' || o.status === 'pending') ?? [];

  return (
    <Screen inTabs title={t('orders.title')} refreshing={orders.refreshing} onRefresh={orders.refresh}>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('orders.filterAll') },
          { value: 'pending', label: t('orders.filterPending'), badge: pendingCount },
        ]}
      />
      {orders.loading ? (
        <Loading />
      ) : orders.error ? (
        <ErrorState message={t('common.somethingWrong')} retryLabel={t('common.retry')} onRetry={orders.refresh} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title={t('orders.empty')}
          body={t('orders.emptyBuyer')}
          action={{ label: t('tabs.browse'), icon: 'search', onPress: () => router.navigate('/buyer') }}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {visible.map((o) => (
            <OrderRow key={o.id} order={o} viewer="buyer" />
          ))}
        </View>
      )}
    </Screen>
  );
}
