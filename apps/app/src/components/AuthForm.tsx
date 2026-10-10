import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AuthError } from '../api/queries/auth';
import { useT } from '../i18n';
import { Heading, Page } from './Shell';
import { Note, Panel } from './ui';

/** Frame of the auth screens: one narrow panel under the heading. */
export function AuthPage({
  title,
  lede,
  phoneFooter = false,
  children,
}: {
  title: string;
  lede?: string;
  phoneFooter?: boolean;
  children: ReactNode;
}) {
  return (
    <Page title={title} phoneFooter={phoneFooter}>
      <View className="w-full max-w-[480px] gap-6">
        <Heading {...(lede ? { lede } : {})}>{title}</Heading>
        <Panel>{children}</Panel>
      </View>
    </Page>
  );
}

/** The failed call of a form as a sentence, or nothing. */
export function FormError({ error }: { error: Error | null }) {
  const t = useT();
  if (!error) return null;
  return (
    <Note tone="error">{t.errors[error instanceof AuthError ? error.reason : 'generic']}</Note>
  );
}

/** Only an in-app path is a valid target after sign-in (no `//host`, `/\\host` or URL). */
export function safeNext(next: string | undefined): Href {
  return next && /^\/(?![/\\])/.test(next) ? (next as Href) : '/';
}
