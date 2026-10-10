import type { Locale } from '@voidbinder/shared';
import {
  DisplayNameSchema,
  type Currency,
  type MeResponse,
  type UpdateMeRequest,
} from '@voidbinder/shared/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { useSignOut } from '../../api/queries/auth';
import { useDeleteMe, useSession, useUpdateMe } from '../../api/queries/me';
import { TwoFactorSettings } from '../../components/auth/TwoFactorSettings';
import { FormError } from '../../components/AuthForm';
import { Heading, Page } from '../../components/Shell';
import { Button, Checkbox, Field, Note, Panel, Segmented } from '../../components/ui';
import { useT } from '../../i18n';

function Settings({ me }: { me: MeResponse }) {
  const t = useT();
  const update = useUpdateMe();
  const [displayName, setDisplayName] = useState(me.displayName ?? '');
  const [language, setLanguage] = useState<Locale>(me.language);
  const [currency, setCurrency] = useState<Currency>(me.currency);
  const [optIn, setOptIn] = useState(me.trainingDataOptIn);
  const [invalid, setInvalid] = useState<string>();

  const save = () => {
    const name = displayName.trim();
    // The API cannot clear a display name, so an empty field leaves an unset one unset.
    const parsed = name || me.displayName ? DisplayNameSchema.safeParse(name) : null;
    setInvalid(parsed && !parsed.success ? t.errors.displayName : undefined);
    if (parsed && !parsed.success) return;
    const patch: UpdateMeRequest = {
      ...(parsed && parsed.data !== me.displayName && { displayName: parsed.data }),
      ...(language !== me.language && { language }),
      ...(currency !== me.currency && { currency }),
      ...(optIn !== me.trainingDataOptIn && { trainingDataOptIn: optIn }),
    };
    update.mutate(patch);
  };

  return (
    <Panel>
      <Text role="heading" aria-level={2} className="font-display text-lg font-bold text-ink">
        {t.profile.settings}
      </Text>
      <Field
        label={t.profile.displayName}
        hint={t.profile.displayNameHint}
        value={displayName}
        onChangeText={setDisplayName}
        error={invalid}
        autoComplete="nickname"
        maxLength={40}
      />
      <Segmented
        label={t.profile.language}
        value={language}
        onChange={setLanguage}
        options={(['de', 'en'] as const).map((l) => ({ value: l, label: t.profile.languages[l] }))}
      />
      <Segmented
        label={t.profile.currency}
        value={currency}
        onChange={setCurrency}
        options={(['EUR', 'USD'] as const).map((c) => ({
          value: c,
          label: t.profile.currencies[c],
        }))}
      />
      <View className="gap-1.5">
        <Text className="font-display text-xs font-semibold uppercase tracking-wider text-ink-2">
          {t.profile.optIn}
        </Text>
        <Checkbox checked={optIn} onChange={setOptIn} label={t.profile.optInHint}>
          {t.profile.optInHint}
        </Checkbox>
      </View>
      <FormError error={update.error} />
      {update.isSuccess && <Note>{t.profile.saved}</Note>}
      <Button label={t.profile.save} onPress={save} busy={update.isPending} />
    </Panel>
  );
}

function DeleteAccount() {
  const t = useT();
  const remove = useDeleteMe();
  const [confirming, setConfirming] = useState(false);
  return (
    <Panel>
      <Text role="heading" aria-level={2} className="font-display text-lg font-bold text-ink">
        {t.profile.deleteTitle}
      </Text>
      <Text className="font-body text-[15px] leading-6 text-ink-2">{t.profile.deleteHint}</Text>
      <Button variant="danger" label={t.profile.delete} onPress={() => setConfirming(true)} />
      <Modal
        transparent
        visible={confirming}
        onRequestClose={() => setConfirming(false)}
        animationType="fade"
      >
        <View className="flex-1 items-center justify-center p-4">
          <View className="absolute inset-0 bg-phone opacity-50" />
          <View
            role="alertdialog"
            aria-modal
            aria-label={t.profile.confirmTitle}
            className="w-full max-w-[440px] gap-4 rounded-2xl bg-surface p-6"
          >
            <Text role="heading" aria-level={2} className="font-display text-xl font-bold text-ink">
              {t.profile.confirmTitle}
            </Text>
            <Text className="font-body text-[15px] leading-6 text-ink-2">
              {t.profile.confirmBody}
            </Text>
            <FormError error={remove.error} />
            <View className="flex-row flex-wrap gap-3">
              <Button
                label={t.profile.confirm}
                busy={remove.isPending}
                onPress={() =>
                  remove.mutate(undefined, {
                    onSuccess: () =>
                      router.replace({ pathname: '/sign-in', params: { deleted: '1' } }),
                  })
                }
              />
              <Button
                variant="ghost"
                label={t.profile.cancel}
                onPress={() => setConfirming(false)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Panel>
  );
}

export default function Profile() {
  const t = useT();
  const { data: me } = useSession();
  const signOut = useSignOut();
  // SessionGate renders this screen for a signed-in user only.
  if (!me) return null;
  return (
    <Page title={t.profile.title} phoneFooter>
      <Heading>{t.profile.title}</Heading>
      <View className="w-full max-w-[640px] gap-6">
        <View className="flex-row flex-wrap items-center justify-between gap-3">
          <View>
            <Text className="font-body text-sm text-ink-3">{t.profile.signedInAs}</Text>
            <Text className="font-body text-base font-semibold text-ink">{me.email}</Text>
          </View>
          <Button
            variant="ghost"
            label={t.profile.signOut}
            busy={signOut.isPending}
            onPress={() =>
              signOut.mutate(undefined, { onSuccess: () => router.replace('/sign-in') })
            }
          />
        </View>
        <FormError error={signOut.error} />
        <Settings me={me} />
        <TwoFactorSettings email={me.email} />
        <DeleteAccount />
      </View>
    </Page>
  );
}
