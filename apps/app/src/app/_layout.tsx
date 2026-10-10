import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initAnalytics } from '../analytics';
import { retry } from '../api/queries/http';
import { Shell } from '../components/Shell';
import { useAppFonts } from '../fonts';
import { I18nProvider } from '../i18n';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry } } });

export default function RootLayout() {
  useAppFonts();
  useEffect(() => initAnalytics(), []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <Shell>
            <Slot />
          </Shell>
        </I18nProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
