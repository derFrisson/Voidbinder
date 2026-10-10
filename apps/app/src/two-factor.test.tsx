import { fireEvent, screen, waitFor } from '@testing-library/react';
import { router, useLocalSearchParams } from 'expo-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, json, me, renderApp, signedIn, type Call } from '../test/fake-api';
import { TwoFactorSettings } from './components/auth/TwoFactorSettings';
import SignIn from './app/sign-in';
import TwoFactor from './app/two-factor';

// Two-factor authentication against a fake API: the challenge after the password and the
// profile section (set up, backup codes, turn off).
const post =
  (path: string, body: unknown, status = 200) =>
  (c: Call) =>
    c.method === 'POST' && c.path === path ? json(body, status) : undefined;

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const sent = (calls: Call[], path: string) => calls.find((c) => c.path === path)?.body;

beforeEach(() => {
  vi.mocked(router.replace).mockClear();
  vi.mocked(useLocalSearchParams).mockReturnValue({});
});

describe('sign-in with 2FA', () => {
  it('goes on to the code screen, keeping `next`, when the account has 2FA', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ next: '/collection' });
    localStorage.setItem('voidbinder.pendingOptIn', 'ada@example.test');
    const calls = fakeApi(
      post('/auth/sign-in/email', { twoFactorRedirect: true, twoFactorMethods: ['totp'] }),
    );
    renderApp(<SignIn />);
    fill('E-Mail-Adresse', 'ada@example.test');
    fill('Passwort', 'correct horse battery');
    press('Anmelden');
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/two-factor',
        params: { next: '/collection' },
      }),
    );
    // No session yet, so the pending opt-in waits for the code.
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('sends the app code with the trusted-device choice and returns to `next`', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ next: '/collection' });
    const calls = fakeApi(
      post('/auth/two-factor/verify-totp', { token: 't', user: { email: me.email } }),
    );
    renderApp(<TwoFactor />);
    expect(
      screen.getByText('Gib den 6-stelligen Code aus deiner Authenticator-App ein.'),
    ).toBeTruthy();
    fill('Code', '123 456');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dieses Gerät 30 Tage merken' }));
    press('Bestätigen');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/collection'));
    expect(sent(calls, '/auth/two-factor/verify-totp')).toEqual({
      code: '123456',
      trustDevice: true,
    });
  });

  it('switches to a backup code', async () => {
    const calls = fakeApi(
      post('/auth/two-factor/verify-backup-code', { token: 't', user: { email: me.email } }),
    );
    renderApp(<TwoFactor />);
    press('Backup-Code verwenden');
    expect(
      screen.getByText('Gib einen deiner Backup-Codes ein. Jeder gilt nur einmal.'),
    ).toBeTruthy();
    fill('Backup-Code', ' AbCdE-12345 ');
    press('Bestätigen');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(sent(calls, '/auth/two-factor/verify-backup-code')).toEqual({
      code: 'AbCdE-12345',
      trustDevice: false,
    });
    press('Code aus der App verwenden');
    expect(screen.getByLabelText('Code')).toBeTruthy();
  });

  it.each([
    [
      401,
      'Der Code stimmt nicht oder die Anmeldung ist abgelaufen. Versuch es noch einmal oder melde dich neu an.',
    ],
    [
      400,
      'Der Code stimmt nicht oder die Anmeldung ist abgelaufen. Versuch es noch einmal oder melde dich neu an.',
    ],
    [429, 'Zu viele Versuche. Warte eine Minute und versuch es dann noch einmal.'],
  ])('answers a %i with one generic sentence', async (status, message) => {
    fakeApi(post('/auth/two-factor/verify-totp', { code: 'X', message: 'x' }, status));
    renderApp(<TwoFactor />);
    fill('Code', '000000');
    press('Bestätigen');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('sends nothing but six digits and names the support path', () => {
    const calls = fakeApi();
    renderApp(<TwoFactor />);
    fill('Code', '12345');
    press('Bestätigen');
    expect(screen.getByText('Gib die 6 Ziffern aus der App ein.')).toBeTruthy();
    expect(calls.filter((c) => c.path.startsWith('/auth'))).toEqual([]);
    expect(screen.getByText(/Schreib uns an hello@voidbinder\.de/)).toBeTruthy();
  });
});

describe('profile: two-factor authentication', () => {
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const totpURI = `otpauth://totp/Voidbinder:ada%40example.test?secret=${SECRET}&issuer=Voidbinder&digits=6&period=30`;
  const codes = Array.from({ length: 10 }, (_, i) => `CODE${i}-ABCDE`);
  const session = (enabled: boolean) => (c: Call) =>
    c.path.startsWith('/auth/get-session')
      ? json({ session: { id: 's' }, user: { ...me, twoFactorEnabled: enabled } })
      : undefined;

  it('sets up 2FA: password, QR code and key, the first code, the backup codes once', async () => {
    const calls = fakeApi(
      signedIn,
      session(false),
      post('/auth/two-factor/enable', { method: 'totp', totpURI, backupCodes: codes }),
      post('/auth/two-factor/verify-totp', { token: 't', user: me }),
    );
    renderApp(<TwoFactorSettings email={me.email} />);
    expect(await screen.findByText('Aus')).toBeTruthy();

    press('Einrichten');
    expect(screen.getByText('Pflichtfeld')).toBeTruthy();
    expect(calls.some((c) => c.path === '/auth/two-factor/enable')).toBe(false);

    fill('Passwort zur Bestätigung', 'correct horse battery');
    press('Einrichten');
    expect(
      await screen.findByRole('img', { name: 'QR-Code für die Authenticator-App' }),
    ).toBeTruthy();
    expect(sent(calls, '/auth/two-factor/enable')).toEqual({ password: 'correct horse battery' });
    expect(screen.getByText('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ')).toBeTruthy();
    // The backup codes wait for the first code.
    expect(screen.queryByText(codes[0] ?? '')).toBeNull();

    fill('Code aus der App', '654321');
    press('Aktivieren');
    expect(await screen.findByText('Deine Backup-Codes')).toBeTruthy();
    expect(sent(calls, '/auth/two-factor/verify-totp')).toEqual({ code: '654321' });
    expect(screen.getAllByRole('listitem').map((e) => e.textContent)).toEqual(codes);
    expect(screen.getByText('An')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Als Text herunterladen' })).toBeTruthy();

    press('Fertig');
    expect(screen.getByText('Die Zwei-Faktor-Authentifizierung ist an.')).toBeTruthy();
    expect(screen.queryByText(codes[0] ?? '')).toBeNull();
  });

  it('downloads the backup codes as a text file', async () => {
    fakeApi(
      signedIn,
      session(true),
      post('/auth/two-factor/generate-backup-codes', { status: true, backupCodes: codes }),
    );
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:codes');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderApp(<TwoFactorSettings email={me.email} />);
    await screen.findByText('An');
    fill('Passwort zur Bestätigung', 'correct horse battery');
    press('Neue Backup-Codes');
    await screen.findByText('Deine Backup-Codes');
    press('Als Text herunterladen');
    expect(click).toHaveBeenCalled();
    const text = await createObjectURL.mock.calls[0]?.[0].text();
    expect(text).toContain('Voidbinder Backup-Codes für ada@example.test');
    for (const code of codes) expect(text).toContain(code);
    click.mockRestore();
  });

  it('turns 2FA off only with the password and says when it is wrong', async () => {
    const calls = fakeApi(signedIn, session(true), (c) =>
      c.path === '/auth/two-factor/disable'
        ? (c.body as { password: string }).password === 'correct horse battery'
          ? json({ status: true })
          : json({ code: 'INVALID_PASSWORD', message: 'Invalid password' }, 400)
        : undefined,
    );
    renderApp(<TwoFactorSettings email={me.email} />);
    expect(await screen.findByText('An')).toBeTruthy();
    expect(screen.getByText(/Schreib uns an hello@voidbinder\.de/)).toBeTruthy();

    press('Ausschalten');
    expect(screen.getByText('Pflichtfeld')).toBeTruthy();
    fill('Passwort zur Bestätigung', 'wrong password');
    press('Ausschalten');
    expect(await screen.findByText('Das Passwort stimmt nicht.')).toBeTruthy();

    fill('Passwort zur Bestätigung', 'correct horse battery');
    press('Ausschalten');
    expect(await screen.findByText('Die Zwei-Faktor-Authentifizierung ist aus.')).toBeTruthy();
    expect(screen.getByText('Aus')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/auth/two-factor/disable')).toHaveLength(2);
  });
});
