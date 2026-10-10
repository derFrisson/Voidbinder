import { EmailSchema } from '@voidbinder/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSignIn } from '../api/queries/auth';
import { AuthPage, FormError, safeNext } from '../components/AuthForm';
import { Button, Field, Note, TextLink } from '../components/ui';
import { useT } from '../i18n';

export default function SignIn() {
  const t = useT();
  const { next, deleted } = useLocalSearchParams<{ next?: string; deleted?: string }>();
  const signIn = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState<{ email?: string; password?: string }>({});

  const submit = () => {
    const parsed = EmailSchema.safeParse(email);
    const errors = {
      ...(!parsed.success && { email: t.errors.email }),
      ...(!password && { password: t.form.required }),
    };
    setInvalid(errors);
    if (!parsed.success || !password) return;
    signIn.mutate(
      { email: parsed.data, password },
      {
        onSuccess: ({ twoFactor }) =>
          twoFactor
            ? router.replace({ pathname: '/two-factor', params: next ? { next } : {} })
            : router.replace(safeNext(next)),
      },
    );
  };

  return (
    <AuthPage title={t.signIn.title} lede={t.signIn.lede} phoneFooter>
      {deleted === '1' && <Note>{t.profile.deleted}</Note>}
      <Field
        label={t.form.email}
        value={email}
        onChangeText={setEmail}
        error={invalid.email}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        onSubmitEditing={submit}
      />
      <Field
        label={t.form.password}
        value={password}
        onChangeText={setPassword}
        error={invalid.password}
        secureTextEntry
        autoComplete="current-password"
        onSubmitEditing={submit}
      />
      <FormError error={signIn.error} />
      <Button label={t.signIn.submit} onPress={submit} busy={signIn.isPending} wide />
      <View className="gap-2">
        <TextLink href="/reset-password">{t.signIn.forgot}</TextLink>
        <Text className="font-body text-ink-2">
          {t.signIn.noAccount} <TextLink href="/sign-up">{t.signIn.toSignUp}</TextLink>
        </Text>
      </View>
    </AuthPage>
  );
}
