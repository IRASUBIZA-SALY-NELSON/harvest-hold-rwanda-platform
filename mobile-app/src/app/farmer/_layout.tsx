import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';

import { ordersForUser, unreadAlertCount } from '@/api';
import { tabIcon, tabScreenOptions } from '@/features/tab-bar';
import { useAuth } from '@/state/auth';
import { useApi } from '@/state/use-api';

export default function FarmerTabs() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const unread = useApi(() => (user ? unreadAlertCount(user.id) : Promise.resolve(0)), [user?.id]);
  const pending = useApi(
    async () => (user ? (await ordersForUser(user)).filter((o) => o.status === 'pending').length : 0),
    [user?.id]
  );

  if (!user) return <Redirect href="/welcome" />;
  if (user.role !== 'farmer') return <Redirect href="/buyer" />;

  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: tabIcon('thermometer') }} />
      <Tabs.Screen name="stock" options={{ title: t('tabs.stock'), tabBarIcon: tabIcon('package') }} />
      <Tabs.Screen
        name="market"
        options={{ title: t('tabs.market'), tabBarIcon: tabIcon('shopping-bag'), tabBarBadge: pending.data || undefined }}
      />
      <Tabs.Screen
        name="alerts"
        options={{ title: t('tabs.alerts'), tabBarIcon: tabIcon('bell'), tabBarBadge: unread.data || undefined }}
      />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: tabIcon('user') }} />
    </Tabs>
  );
}
