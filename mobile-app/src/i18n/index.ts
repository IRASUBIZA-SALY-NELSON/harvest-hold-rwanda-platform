import 'intl-pluralrules';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en';
import fr from './locales/fr';
import rw from './locales/rw';

export const LANGUAGES = [
  { code: 'rw', label: 'Ikinyarwanda' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'hh.language';
const isSupported = (code: string | null | undefined): code is LanguageCode =>
  LANGUAGES.some((l) => l.code === code);

function deviceLanguage(): LanguageCode {
  try {
    const code = getLocales()[0]?.languageCode;
    return isSupported(code) ? code : 'en';
  } catch {
    return 'en';
  }
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, rw: { translation: rw }, fr: { translation: fr } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Restores the language the user picked last time, if any. */
export async function restoreLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (isSupported(saved) && saved !== i18n.language) await i18n.changeLanguage(saved);
  } catch {
    // Keep the device language.
  }
}

export async function setLanguage(code: LanguageCode): Promise<void> {
  await i18n.changeLanguage(code);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Not fatal: the choice just won't survive a restart.
  }
}

export const currentLanguage = (): LanguageCode => (isSupported(i18n.language) ? i18n.language : 'en');

export default i18n;
