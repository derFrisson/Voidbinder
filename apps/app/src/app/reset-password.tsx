import { EmailSchema } from '@voidbinder/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useRequestPasswordReset, useResetPassword } from '../api/queries/auth';
import { AuthPage, FormError } from '../components/AuthForm';
import { Button, Field, Note, TextLink } from '../components/ui';
import { useT } from '../i18n';

function RequestLink() {
  const t = useT();
  const request = useRequestPasswordReset();
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState<string>();
  if (request.isSuccess) return <Note>{t.reset.requested}</Note>;
  const submit = () => {
    const parsed = EmailSchema.safeParse(email);
    setInvalid(parsed.success ? undefined : t.errors.email);
    if (parsed.success) request.mutate(parsed.data);
  };
  return (
    <>
      <Text className="font-body text-[15px] leading-6 text-ink-2">{t.reset.requestLede}</Text>
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
      <FormError error={request.error} />
      <Button label={t.reset.request} onPress={submit} busy={request.isPending} wide />
    </>
  );
}

function NewPassword({ token }: { token: string }) {
  const t = useT();
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [invalid, setInvalid] = useState<{ password?: string; repeat?: string }>({});
  if (reset.isSuccess) {
    return (
      <>
        <Note>{t.reset.done}</Note>
        <TextLink href="/sign-in">{t.reset.toSignIn}</TextLink>
      </>
    );
  }
  const submit = () => {
    const errors = {
      ...(password.length < 10 && { password: t.errors.password }),
      ...(repeat !== password && { repeat: t.errors.mismatch }),
    };
    setInvalid(errors);
    if (Object.keys(errors).length === 0) reset.mutate({ token, newPassword: password });
  };
  return (
    <>
      <Field
        label={t.reset.newPassword}
        hint={t.form.passwordHint}
        value={password}
        onChangeText={setPassword}
        error={invalid.password}
        secureTextEntry
        autoComplete="new-password"
      />
      <Field
        label={t.reset.repeat}
        value={repeat}
        onChangeText={setRepeat}
        error={invalid.repeat}
        secureTextEntry
        autoComplete="new-password"
        onSubmitEditing={submit}
      />
      <FormError error={reset.error} />
      <Button label={t.reset.submit} onPress={submit} busy={reset.isPending} wide />
    </>
  );
}

/** `/reset-password` asks for the mail; `/reset-password?token=…` (its link) sets the password. */
export default function ResetPassword() {
  const t = useT();
  const { token } = useLocalSearchParams<{ token?: string }>();
  return (
    <AuthPage title={t.reset.title}>
      {token ? <NewPassword token={token} /> : <RequestLink />}
    </AuthPage>
  );
}
