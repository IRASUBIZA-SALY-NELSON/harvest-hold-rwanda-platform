import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { myListings, ordersForUser } from '@/api';
import { MyListingRow, OrderRow } from '@/features/market-rows';
import { useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { spacing } from '@/theme';
import { Button, EmptyState, Loading, Screen, Segmented } from '@/ui';

export default function FarmerMarket() {
  const user = useUser();
  const { t } = useLabels();
  const [tab, setTab] = useState<'listings' | 'orders'>('listings');
  const listings = useApi(() => myListings(user.id), [user.id]);
  const orders = useApi(() => ordersForUser(user), [user.id]);
  const pending = orders.data?.filter((o) => o.status === 'pending').length ?? 0;
  const goNew = () => router.push('/listing/new');

  const refresh = async () => {
    await Promise.all([listings.refresh(), orders.refresh()]);
  };

  return (
    <Screen
      inTabs
      title={t('market.title')}
      titleRight={<Button label={t('market.newListing')} icon="plus" size="sm" onPress={goNew} testID="new-listing" />}
      refreshing={listings.refreshing || orders.refreshing}
      onRefresh={refresh}
    >
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'listings', label: t('market.myListings') },
          { value: 'orders', label: t('market.orders'), badge: pending },
        ]}
      />

      {tab === 'listings' ? (
        listings.loading ? (
          <Loading />
        ) : !listings.data?.length ? (
          <EmptyState
            icon="tag"
            title={t('market.noListings')}
            body={t('market.noListingsBody')}
            action={{ label: t('market.newListing'), icon: 'plus', onPress: goNew }}
          />
        ) : (
          <View style={{ gap: spacing.md }}>
            {listings.data.map((l) => (
              <MyListingRow key={l.id} listing={l} />
            ))}
          </View>
        )
      ) : orders.loading ? (
        <Loading />
      ) : !orders.data?.length ? (
        <EmptyState icon="inbox" title={t('market.noOrders')} body={t('market.noOrdersBody')} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {orders.data.map((o) => (
            <OrderRow key={o.id} order={o} viewer="farmer" />
          ))}
        </View>
      )}
    </Screen>
  );
}
