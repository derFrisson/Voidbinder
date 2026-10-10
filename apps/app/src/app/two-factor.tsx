import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useVerifyTwoFactor } from '../api/queries/auth';
import { SUPPORT_EMAIL } from '../components/auth/TwoFactorSettings';
import { AuthPage, FormError, safeNext } from '../components/AuthForm';
import { Button, Checkbox, Field, TextLink } from '../components/ui';
import { fmt, useT } from '../i18n';

/** The second step of a sign-in with 2FA (after `/sign-in` answered `twoFactor`). */
export default function TwoFactor() {
  const t = useT();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const verify = useVerifyTwoFactor();
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [invalid, setInvalid] = useState<string>();

  const submit = () => {
    const value = backup ? code.trim() : code.replace(/\s/g, '');
    const error = backup
      ? !value && t.form.required
      : !/^\d{6}$/.test(value) && t.twoFactor.codeFormat;
    setInvalid(error || undefined);
    if (error) return;
    verify.mutate(
      { code: value, backup, trustDevice },
      { onSuccess: () => router.replace(safeNext(next)) },
    );
  };

  const toggle = () => {
    setBackup(!backup);
    setCode('');
    setInvalid(undefined);
    verify.reset();
  };

  return (
    <AuthPage
      title={t.twoFactor.title}
      lede={backup ? t.twoFactor.ledeBackup : t.twoFactor.lede}
      phoneFooter
    >
      <Field
        // A new field per mode, so the browser's one-time-code autofill applies to the app code only.
        key={backup ? 'backup' : 'totp'}
        label={backup ? t.twoFactor.backupCode : t.twoFactor.code}
        value={code}
        onChangeText={setCode}
        error={invalid}
        autoCapitalize="none"
        autoCorrect={false}
        {...(backup
          ? { autoComplete: 'off' as const }
          : {
              inputMode: 'numeric' as const,
              autoComplete: 'one-time-code' as const,
              maxLength: 7,
            })}
        onSubmitEditing={submit}
      />
      <Checkbox checked={trustDevice} onChange={setTrustDevice} label={t.twoFactor.trust}>
        {t.twoFactor.trust}
      </Checkbox>
      <FormError error={verify.error} />
      <Button label={t.twoFactor.submit} onPress={submit} busy={verify.isPending} wide />
      <View className="gap-3">
        <Button
          variant="ghost"
          label={backup ? t.twoFactor.useApp : t.twoFactor.useBackup}
          onPress={toggle}
        />
        <Text className="font-body text-sm leading-5 text-ink-3">
          {fmt(t.twoFactor.lost, { email: SUPPORT_EMAIL })}
        </Text>
        <TextLink href={next ? { pathname: '/sign-in', params: { next } } : '/sign-in'}>
          {t.twoFactor.toSignIn}
        </TextLink>
      </View>
    </AuthPage>
  );
}
