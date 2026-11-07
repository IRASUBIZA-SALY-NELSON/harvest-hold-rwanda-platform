import Constants from 'expo-constants';

import { registerPushToken } from '@/api';

/**
 * Registers this phone for push notifications. Push needs an app build made with EAS
 * (`eas build`): Expo Go cannot receive remote notifications, so this does nothing there.
 * Alerts still show in the app, and serious cold room problems also arrive by SMS.
 */
export async function registerForPush() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (Constants.executionEnvironment === 'storeClient' || !projectId) return;
  try {
    // Imported only in real builds: expo-notifications is not available everywhere.
    const Notifications = await import('expo-notifications' as string);
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(data);
  } catch {
    // Push is a convenience; the app works without it.
  }
}
