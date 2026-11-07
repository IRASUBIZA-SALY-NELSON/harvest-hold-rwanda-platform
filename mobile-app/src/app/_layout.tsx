import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { restoreLanguage } from '@/i18n';
import { AuthProvider, useAuth } from '@/state/auth';
import { colors } from '@/theme';
import { ToastProvider } from '@/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.background, card: colors.background, primary: colors.brand },
};

function RootStack() {
  const { ready } = useAuth();
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [languageReady, setLanguageReady] = useState(false);

  useEffect(() => {
    restoreLanguage().finally(() => setLanguageReady(true));
  }, []);

  const loaded = ready && languageReady && (fontsLoaded || !!fontError);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  if (!loaded) return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
      <Stack.Screen name="farmer" options={{ animation: 'fade' }} />
      <Stack.Screen name="buyer" options={{ animation: 'fade' }} />
      <Stack.Screen name="language" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <AuthProvider>
          <ToastProvider>
            <StatusBar style="dark" />
            <RootStack />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
