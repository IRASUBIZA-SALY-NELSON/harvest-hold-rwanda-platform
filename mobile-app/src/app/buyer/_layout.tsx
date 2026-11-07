import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';

import { unreadAlertCount } from '@/api';
import { tabIcon, tabScreenOptions } from '@/features/tab-bar';
import { useAuth } from '@/state/auth';
import { useApi } from '@/state/use-api';

export default function BuyerTabs() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const unread = useApi(() => (user ? unreadAlertCount(user.id) : Promise.resolve(0)), [user?.id]);

  if (!user) return <Redirect href="/welcome" />;
  if (user.role !== 'buyer') return <Redirect href="/farmer" />;

  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: t('tabs.browse'), tabBarIcon: tabIcon('search') }} />
      <Tabs.Screen name="orders" options={{ title: t('tabs.orders'), tabBarIcon: tabIcon('clipboard') }} />
      <Tabs.Screen
        name="alerts"
        options={{ title: t('tabs.alerts'), tabBarIcon: tabIcon('bell'), tabBarBadge: unread.data || undefined }}
      />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: tabIcon('user') }} />
    </Tabs>
  );
}
