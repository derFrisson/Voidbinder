import { EmailSchema } from '@voidbinder/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useResendVerification, useVerifyEmail } from '../api/queries/auth';
import { AuthPage, FormError } from '../components/AuthForm';
import { useTurnstile } from '../components/auth/Turnstile';
import { Button, Field, Note, TextLink } from '../components/ui';
import { useT } from '../i18n';

/** Asks for a new verification mail. */
function Resend() {
  const t = useT();
  const resend = useResendVerification();
  const check = useTurnstile();
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState<string>();
  if (resend.isSuccess) return <Note>{t.verify.resent}</Note>;
  const submit = () => {
    const parsed = EmailSchema.safeParse(email);
    setInvalid(parsed.success ? undefined : t.errors.email);
    if (!parsed.success) return;
    const { token, ok } = check.take();
    if (ok) resend.mutate({ email: parsed.data, turnstileToken: token }, { onError: check.renew });
  };
  return (
    <>
      <Field
        label={t.form.email}
        value={email}
        onChangeText={setEmail}
        error={invalid}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        onSubmitEditing={submit}
      />
      {check.widget}
      <FormError error={resend.error} />
      <Button variant="ghost" label={t.verify.resend} onPress={submit} busy={resend.isPending} />
    </>
  );
}

/** `/verify?token=…`, the link of the verification mail (apps/api/README.md, Authentication). */
export default function Verify() {
  const t = useT();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const verify = useVerifyEmail();
  const started = useRef(false);
  useEffect(() => {
    // Once: a token is single-use, and React runs effects twice in development.
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  return (
    <AuthPage title={t.verify.title}>
      {!token ? (
        <>
          <Text className="font-body text-[15px] leading-6 text-ink-2">{t.verify.missing}</Text>
          <Resend />
        </>
      ) : verify.isSuccess ? (
        <>
          <Note>{t.verify.done}</Note>
          <TextLink href="/sign-in">{t.verify.toSignIn}</TextLink>
        </>
      ) : verify.isError ? (
        <>
          <Note tone="error">{t.verify.failed}</Note>
          <Resend />
        </>
      ) : (
        <Text role="status" className="font-body text-[15px] text-ink-2">
          {t.verify.checking}
        </Text>
      )}
    </AuthPage>
  );
}
