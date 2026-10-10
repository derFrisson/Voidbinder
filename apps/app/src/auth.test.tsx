import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { router, useLocalSearchParams } from 'expo-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, json, me, renderApp } from '../test/fake-api';
import { turnstileFake } from '../test/turnstile';
import SignIn from './app/sign-in';
import ResetPassword from './app/reset-password';
import SignUp from './app/sign-up';
import Verify from './app/verify';

// The auth screens against a fake API: what they send, where they go, what they say.
const ok = (path: string) => (c: { method: string; path: string }) =>
  c.method === 'POST' && c.path === path ? json({ token: 't', user: { id: 'u1' } }) : undefined;

const checkbox = (i: number) => screen.getAllByRole('checkbox')[i] as HTMLElement;

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  vi.mocked(router.replace).mockClear();
  vi.mocked(useLocalSearchParams).mockReturnValue({});
});

describe('sign-in', () => {
  it('posts the credentials to /api/auth/sign-in/email and returns to `next`', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ next: '/collection' });
    const calls = fakeApi(ok('/auth/sign-in/email'));
    renderApp(<SignIn />);
    fill('E-Mail-Adresse', ' Ada@Example.test ');
    fill('Passwort', 'correct horse battery');
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/collection'));
    expect(calls.find((c) => c.path === '/auth/sign-in/email')?.body).toEqual({
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example'])(
    'never follows a `next` that leaves the app (%s)',
    async (next) => {
      vi.mocked(useLocalSearchParams).mockReturnValue({ next });
      fakeApi(ok('/auth/sign-in/email'));
      renderApp(<SignIn />);
      fill('E-Mail-Adresse', 'ada@example.test');
      fill('Passwort', 'correct horse battery');
      fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    },
  );

  it.each([
    [401, 'E-Mail-Adresse oder Passwort stimmt nicht.'],
    [403, 'Bitte bestätige zuerst deine E-Mail-Adresse. Der Link ist in deinem Postfach.'],
    [429, 'Zu viele Versuche. Warte eine Minute und versuch es dann noch einmal.'],
  ])('explains a %i', async (status, message) => {
    fakeApi((c) =>
      c.path === '/auth/sign-in/email' ? json({ code: 'X', message: 'x' }, status) : undefined,
    );
    renderApp(<SignIn />);
    fill('E-Mail-Adresse', 'ada@example.test');
    fill('Passwort', 'wrong password');
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('sends nothing while the address is invalid', () => {
    const calls = fakeApi();
    renderApp(<SignIn />);
    fill('E-Mail-Adresse', 'not-an-address');
    fill('Passwort', 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(screen.getByText('Gib eine gültige E-Mail-Adresse ein.')).toBeTruthy();
    expect(calls.filter((c) => c.path.startsWith('/auth'))).toEqual([]);
  });
});

describe('sign-up', () => {
  function fillForm() {
    fill('Name', 'Ada Lovelace');
    fill('E-Mail-Adresse', 'ada@example.test');
    fill('Passwort', 'correct horse battery');
  }

  it('needs consent to the privacy policy and shows the opt-in unchecked', () => {
    const calls = fakeApi();
    renderApp(<SignUp />);
    const [consent, optIn] = screen.getAllByRole('checkbox');
    expect(consent?.getAttribute('aria-checked')).toBe('false');
    expect(optIn?.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('link', { name: 'Datenschutzerklärung' }).getAttribute('href')).toBe(
      'https://voidbinder.de/de/datenschutz/',
    );
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    expect(screen.getByText('Ohne deine Zustimmung können wir kein Konto anlegen.')).toBeTruthy();
    expect(calls.filter((c) => c.path.startsWith('/auth'))).toEqual([]);
  });

  it('posts name, address and password, then asks to check the inbox', async () => {
    const calls = fakeApi(ok('/auth/sign-up/email'));
    renderApp(<SignUp />);
    fillForm();
    fireEvent.click(checkbox(0));
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    expect(
      await screen.findByText(/Wir haben einen Link an ada@example.test geschickt/),
    ).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/sign-up/email')?.body).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      password: 'correct horse battery',
    });
  });

  it('applies a ticked training-data opt-in at the first sign-in with that address', async () => {
    fakeApi(ok('/auth/sign-up/email'));
    const view = renderApp(<SignUp />);
    fillForm();
    fireEvent.click(checkbox(0));
    fireEvent.click(checkbox(1));
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    await screen.findByText(/Wir haben einen Link/);
    view.unmount();

    const calls = fakeApi(ok('/auth/sign-in/email'), (c) =>
      c.method === 'PATCH' ? json({ ...me, trainingDataOptIn: true }) : undefined,
    );
    renderApp(<SignIn />);
    fill('E-Mail-Adresse', 'ada@example.test');
    fill('Passwort', 'correct horse battery');
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: '/me',
      body: { trainingDataOptIn: true },
    });
  });
});

describe('sign-up details', () => {
  const fillAll = () => {
    fill('Name', 'Ada Lovelace');
    fill('E-Mail-Adresse', 'ada@example.test');
    fill('Passwort', 'correct horse battery');
  };

  it('toggles a checkbox with Space', () => {
    fakeApi();
    renderApp(<SignUp />);
    fireEvent.keyDown(checkbox(0), { key: ' ' });
    expect(checkbox(0).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(checkbox(0), { key: ' ' });
    expect(checkbox(0).getAttribute('aria-checked')).toBe('false');
  });

  it('leaves no pending opt-in behind when the sign-up fails', async () => {
    fakeApi((c) =>
      c.path === '/auth/sign-up/email' ? json({ code: 'X', message: 'x' }, 500) : undefined,
    );
    renderApp(<SignUp />);
    fillAll();
    fireEvent.click(checkbox(0));
    fireEvent.click(checkbox(1));
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    await screen.findByRole('alert');
    expect(localStorage.length).toBe(0);
  });

  it('describes a field by its error', () => {
    fakeApi();
    renderApp(<SignUp />);
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    const input = screen.getByLabelText('Name');
    const id = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(id)?.textContent).toBe('Gib einen Namen ein.');
  });
});

// Cloudflare Turnstile on the three forms the API checks (VB-72). The widget is faked
// (test/turnstile.ts): solved at once unless a test says otherwise.
describe('Turnstile', () => {
  const header = (calls: ReturnType<typeof fakeApi>, path: string) =>
    calls.find((c) => c.path === path)?.headers.get('cf-turnstile-response');
  const fillSignUp = () => {
    fill('Name', 'Ada Lovelace');
    fill('E-Mail-Adresse', 'ada@example.test');
    fill('Passwort', 'correct horse battery');
    fireEvent.click(checkbox(0));
  };

  it('renders the widget with the sitekey, normal size, automatic theme and the UI language', () => {
    fakeApi();
    renderApp(<SignUp />);
    expect(turnstileFake.renders).toHaveLength(1);
    expect(turnstileFake.renders[0]?.options).toMatchObject({
      sitekey: '1x00000000000000000000AA',
      size: 'normal',
      theme: 'auto',
      language: 'de',
    });
    expect(screen.getByRole('group', { name: 'Sicherheitsprüfung' })).toBeTruthy();
  });

  it('sends the sign-up with the token in cf-turnstile-response', async () => {
    const calls = fakeApi(ok('/auth/sign-up/email'));
    renderApp(<SignUp />);
    fillSignUp();
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    await screen.findByText(/Wir haben einen Link/);
    expect(header(calls, '/auth/sign-up/email')).toBe('test-token-1');
  });

  it('sends nothing until the challenge is solved, then sends the token', async () => {
    turnstileFake.auto = false;
    const calls = fakeApi(ok('/auth/sign-up/email'));
    renderApp(<SignUp />);
    fillSignUp();
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    expect(screen.getByText('Schließe zuerst die Sicherheitsprüfung ab.')).toBeTruthy();
    expect(calls.filter((c) => c.path.startsWith('/auth'))).toEqual([]);

    act(() => turnstileFake.solve('solved-later'));
    expect(screen.queryByText('Schließe zuerst die Sicherheitsprüfung ab.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    await screen.findByText(/Wir haben einen Link/);
    expect(header(calls, '/auth/sign-up/email')).toBe('solved-later');
  });

  it('does not send a token that expired or errored', () => {
    turnstileFake.auto = false;
    const calls = fakeApi();
    renderApp(<SignUp />);
    fillSignUp();
    act(() => turnstileFake.solve('t'));
    act(() => turnstileFake.fail());
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    expect(screen.getByText('Schließe zuerst die Sicherheitsprüfung ab.')).toBeTruthy();
    expect(calls.filter((c) => c.path.startsWith('/auth'))).toEqual([]);
  });

  it('explains a failed check and starts a new challenge', async () => {
    const calls = fakeApi((c) =>
      c.path === '/auth/sign-up/email'
        ? json({ error: { code: 'turnstile_failed', message: 'x', requestId: 'r' } }, 400)
        : undefined,
    );
    renderApp(<SignUp />);
    fillSignUp();
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    expect(
      await screen.findByText(
        'Die Sicherheitsprüfung ist fehlgeschlagen oder abgelaufen. Versuch es noch einmal.',
      ),
    ).toBeTruthy();
    expect(turnstileFake.reset).toHaveBeenCalledTimes(1);
    // The spent token is gone: the next try carries the fresh one.
    fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/auth/sign-up/email')).toHaveLength(2),
    );
    expect(
      calls
        .filter((c) => c.path === '/auth/sign-up/email')
        .map((c) => c.headers.get('cf-turnstile-response')),
    ).toEqual(['test-token-1', 'test-token-2']);
  });

  it('protects the reset request and the verification resend too', async () => {
    const reset = fakeApi(ok('/auth/request-password-reset'));
    const view = renderApp(<ResetPassword />);
    expect(turnstileFake.renders).toHaveLength(1);
    fill('E-Mail-Adresse', 'ada@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Link senden' }));
    await screen.findByText(/Falls es ein Konto mit dieser Adresse gibt/);
    expect(header(reset, '/auth/request-password-reset')).toBe('test-token-1');
    view.unmount();

    turnstileFake.install();
    const resend = fakeApi(ok('/auth/send-verification-email'));
    renderApp(<Verify />);
    fill('E-Mail-Adresse', 'ada@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Neuen Link senden' }));
    await screen.findByText(/ist ein neuer Link unterwegs/);
    expect(header(resend, '/auth/send-verification-email')).toBe('test-token-1');
  });

  it('shows a text instead of the widget when the script cannot be loaded', async () => {
    delete window.turnstile;
    fakeApi();
    renderApp(<SignUp />);
    const script = document.head.querySelector('script[src^="https://challenges.cloudflare.com/"]');
    expect(script).not.toBeNull();
    fireEvent.error(script as Element);
    expect(
      await screen.findByText(/Die Sicherheitsprüfung konnte nicht geladen werden/),
    ).toBeTruthy();
    script?.remove();
  });

  it('removes the widget when the form goes away', () => {
    fakeApi();
    const view = renderApp(<SignUp />);
    view.unmount();
    expect(turnstileFake.remove).toHaveBeenCalledWith('widget-1');
  });
});
