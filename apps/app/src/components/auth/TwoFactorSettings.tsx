import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import {
  useConfirmTwoFactor,
  useDisableTwoFactor,
  useEnableTwoFactor,
  useRegenerateBackupCodes,
  useTwoFactorEnabled,
} from '../../api/queries/auth';
import { fmt, useT } from '../../i18n';
import { FormError } from '../AuthForm';
import { Button, ErrorState, Field, Loading, Note, Panel } from '../ui';
import { QrCode } from './QrCode';

/** Where someone who lost both factors writes; nobody gets a way around the second factor. */
export const SUPPORT_EMAIL = 'hello@voidbinder.de';

// ponytail: copy and download use the browser's clipboard and a Blob link; native (Sprint 3)
// shows the codes only, until it gets expo-clipboard and a share sheet.
const clipboard = () => (globalThis as { navigator?: Navigator }).navigator?.clipboard;

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** The secret of an otpauth URL in groups of four, for typing it into an app by hand. */
const manualKey = (uri: string) =>
  (new URL(uri).searchParams.get('secret') ?? '').replace(/(.{4})(?=.)/g, '$1 ');

function BackupCodes({
  codes,
  email,
  onDone,
}: {
  codes: string[];
  email: string;
  onDone: () => void;
}) {
  const t = useT().profile.twoFactor;
  const [copied, setCopied] = useState(false);
  const text = `${fmt(t.fileHeader, { email })}\n\n${codes.join('\n')}\n`;
  return (
    <View className="gap-4">
      <Text role="heading" aria-level={3} className="font-display text-base font-bold text-ink">
        {t.codesTitle}
      </Text>
      <Text className="font-body text-[15px] leading-6 text-ink-2">{t.codesHint}</Text>
      <View
        role="list"
        aria-label={t.codesLabel}
        className="flex-row flex-wrap gap-x-6 gap-y-2 rounded-xl bg-surface-2 p-4"
      >
        {codes.map((code) => (
          <Text
            key={code}
            role="listitem"
            selectable
            className="w-[120px] font-mono text-[15px] text-ink"
          >
            {code}
          </Text>
        ))}
      </View>
      {Platform.OS === 'web' && (
        <View className="flex-row flex-wrap gap-3">
          {clipboard() && (
            <Button
              variant="ghost"
              label={t.copy}
              onPress={() =>
                void clipboard()
                  ?.writeText(text)
                  .then(() => setCopied(true))
              }
            />
          )}
          <Button
            variant="ghost"
            label={t.download}
            onPress={() => downloadText(text, 'voidbinder-backup-codes.txt')}
          />
        </View>
      )}
      {copied && <Note>{t.copied}</Note>}
      <Button label={t.done} onPress={onDone} />
    </View>
  );
}

/**
 * The profile's "Zwei-Faktor-Authentifizierung": set up (password, QR code and key, the first
 * code turns it on, backup codes shown once), new backup codes and turning it off, both with the
 * password.
 */
export function TwoFactorSettings({ email }: { email: string }) {
  const tAll = useT();
  const t = tAll.profile.twoFactor;
  const status = useTwoFactorEnabled();
  const enable = useEnableTwoFactor();
  const confirm = useConfirmTwoFactor();
  const regenerate = useRegenerateBackupCodes();
  const disable = useDisableTwoFactor();
  const [password, setPassword] = useState('');
  const [passwordMissing, setPasswordMissing] = useState(false);
  const [code, setCode] = useState('');
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [setup, setSetup] = useState<{ uri: string; codes: string[] }>();
  const [codes, setCodes] = useState<string[]>();
  const [done, setDone] = useState<string>();

  const withPassword = (run: (password: string) => void) => {
    setPasswordMissing(!password);
    setDone(undefined);
    if (password) run(password);
  };
  const reset = () => {
    setPassword('');
    setCode('');
    for (const m of [enable, confirm, regenerate, disable]) m.reset();
  };

  const passwordField = (
    <Field
      label={t.password}
      value={password}
      onChangeText={setPassword}
      error={passwordMissing ? tAll.form.required : undefined}
      secureTextEntry
      autoComplete="current-password"
    />
  );

  let body;
  if (status.isPending) body = <Loading />;
  else if (status.error) body = <ErrorState onRetry={() => void status.refetch()} />;
  else if (codes) {
    body = (
      <BackupCodes
        codes={codes}
        email={email}
        onDone={() => {
          setCodes(undefined);
          setDone(t.enabled);
        }}
      />
    );
  } else if (setup) {
    const submit = () => {
      const valid = /^\d{6}$/.test(code.replace(/\s/g, ''));
      setCodeInvalid(!valid);
      if (!valid) return;
      confirm.mutate(code.replace(/\s/g, ''), {
        onSuccess: () => {
          setCodes(setup.codes);
          setSetup(undefined);
          reset();
        },
      });
    };
    body = (
      <View className="gap-4">
        <Text className="font-body text-[15px] leading-6 text-ink-2">{t.scan}</Text>
        <QrCode value={setup.uri} label={t.qr} />
        <View className="gap-1.5">
          <Text className="font-display text-xs font-semibold uppercase tracking-wider text-ink-2">
            {t.secret}
          </Text>
          <Text selectable className="font-mono text-[15px] text-ink">
            {manualKey(setup.uri)}
          </Text>
        </View>
        <Field
          label={t.confirmCode}
          value={code}
          onChangeText={setCode}
          error={codeInvalid ? tAll.twoFactor.codeFormat : undefined}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          onSubmitEditing={submit}
        />
        <FormError error={confirm.error} />
        <View className="flex-row flex-wrap gap-3">
          <Button label={t.confirm} onPress={submit} busy={confirm.isPending} />
          <Button
            variant="ghost"
            label={t.cancel}
            onPress={() => {
              setSetup(undefined);
              reset();
            }}
          />
        </View>
      </View>
    );
  } else if (status.data) {
    body = (
      <View className="gap-4">
        <Text className="font-body text-[15px] leading-6 text-ink-2">{t.onHint}</Text>
        {passwordField}
        <FormError error={regenerate.error ?? disable.error} />
        <View className="flex-row flex-wrap gap-3">
          <Button
            variant="ghost"
            label={t.regenerate}
            busy={regenerate.isPending}
            onPress={() =>
              withPassword((p) =>
                regenerate.mutate(p, {
                  onSuccess: (data) => {
                    reset();
                    setCodes(data?.backupCodes ?? []);
                  },
                }),
              )
            }
          />
          <Button
            variant="danger"
            label={t.disable}
            busy={disable.isPending}
            onPress={() =>
              withPassword((p) =>
                disable.mutate(p, {
                  onSuccess: () => {
                    reset();
                    setDone(t.disabled);
                  },
                }),
              )
            }
          />
        </View>
        <Text className="font-body text-sm leading-5 text-ink-3">
          {fmt(t.lost, { email: SUPPORT_EMAIL })}
        </Text>
      </View>
    );
  } else {
    body = (
      <View className="gap-4">
        <Text className="font-body text-[15px] leading-6 text-ink-2">{t.offHint}</Text>
        {passwordField}
        <FormError error={enable.error} />
        <Button
          label={t.start}
          busy={enable.isPending}
          onPress={() =>
            withPassword((p) =>
              enable.mutate(p, {
                onSuccess: (data) => {
                  if (!data || !('totpURI' in data) || !data.totpURI) return;
                  reset();
                  setSetup({ uri: data.totpURI, codes: data.backupCodes ?? [] });
                },
              }),
            )
          }
        />
      </View>
    );
  }

  return (
    <Panel>
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text role="heading" aria-level={2} className="font-display text-lg font-bold text-ink">
          {t.title}
        </Text>
        {status.data !== undefined && (
          <Text
            className={`rounded-full px-3 py-1 font-display text-xs font-semibold uppercase tracking-wider ${status.data ? 'bg-blue-soft text-ink' : 'bg-surface-2 text-ink-2'}`}
          >
            {status.data ? t.on : t.off}
          </Text>
        )}
      </View>
      {done && <Note>{done}</Note>}
      {body}
    </Panel>
  );
}
