import { EmailSchema } from '@voidbinder/shared';
import { useState } from 'react';
import { Text } from 'react-native';
import { rememberOptIn, useSignUp } from '../api/queries/auth';
import { AuthPage, FormError } from '../components/AuthForm';
import { Button, Checkbox, Field, Note, TextLink } from '../components/ui';
import { fmt, useT } from '../i18n';

export default function SignUp() {
  const t = useT();
  const signUp = useSignUp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  // Off by default; nothing is used for training unless the user ticks it.
  const [optIn, setOptIn] = useState(false);
  const [invalid, setInvalid] = useState<
    Partial<Record<'name' | 'email' | 'password' | 'consent', string>>
  >({});

  if (signUp.isSuccess) {
    return (
      <AuthPage title={t.signUp.sentTitle}>
        <Note>{fmt(t.signUp.sentBody, { email: signUp.variables.email })}</Note>
        <TextLink href="/sign-in">{t.verify.toSignIn}</TextLink>
      </AuthPage>
    );
  }

  const submit = () => {
    const parsed = EmailSchema.safeParse(email);
    const errors = {
      ...(!name.trim() && { name: t.errors.name }),
      ...(!parsed.success && { email: t.errors.email }),
      ...(password.length < 10 && { password: t.errors.password }),
      ...(!consent && { consent: t.errors.consent }),
    };
    setInvalid(errors);
    if (Object.keys(errors).length > 0 || !parsed.success) return;
    const address = parsed.data;
    // Only an account that was created waits for the opt-in; a failed sign-up leaves nothing behind.
    signUp.mutate(
      { name: name.trim(), email: address, password },
      { onSuccess: () => optIn && rememberOptIn(address) },
    );
  };

  return (
    <AuthPage title={t.signUp.title} lede={t.signUp.lede}>
      <Field
        label={t.form.name}
        value={name}
        onChangeText={setName}
        error={invalid.name}
        autoComplete="name"
      />
      <Field
        label={t.form.email}
        value={email}
        onChangeText={setEmail}
        error={invalid.email}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
      />
      <Field
        label={t.form.password}
        hint={t.form.passwordHint}
        value={password}
        onChangeText={setPassword}
        error={invalid.password}
        secureTextEntry
        autoComplete="new-password"
      />
      <Checkbox
        checked={consent}
        onChange={setConsent}
        label={`${t.signUp.consentBefore}${t.signUp.consentLink}${t.signUp.consentAfter}`}
      >
        {t.signUp.consentBefore}
        <TextLink href={t.links.privacy}>{t.signUp.consentLink}</TextLink>
        {t.signUp.consentAfter}
      </Checkbox>
      {invalid.consent && (
        <Text role="alert" className="font-body text-sm text-ink">
          {invalid.consent}
        </Text>
      )}
      <Checkbox checked={optIn} onChange={setOptIn} label={t.signUp.optIn}>
        {t.signUp.optIn}
      </Checkbox>
      <FormError error={signUp.error} />
      <Button label={t.signUp.submit} onPress={submit} busy={signUp.isPending} wide />
      <Text className="font-body text-ink-2">
        {t.signUp.haveAccount} <TextLink href="/sign-in">{t.signUp.toSignIn}</TextLink>
      </Text>
    </AuthPage>
  );
}
