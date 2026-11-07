import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';

import { colors, fonts } from '@/theme';

type TabsOptions = NonNullable<ComponentProps<typeof Tabs>['screenOptions']>;

export const tabScreenOptions: TabsOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.brand,
  tabBarInactiveTintColor: colors.textFaint,
  tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
  tabBarStyle: {
    backgroundColor: colors.white,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    elevation: 0,
    shadowOpacity: 0,
  },
  tabBarBadgeStyle: {
    backgroundColor: colors.warning,
    color: colors.white,
    fontFamily: fonts.semibold,
    fontSize: 10,
  },
  sceneStyle: { backgroundColor: colors.background },
};

export function tabIcon(name: keyof typeof Feather.glyphMap) {
  function TabIcon({ color }: { color: ColorValue }) {
    return <Feather name={name} size={22} color={color as string} />;
  }
  return TabIcon;
}
