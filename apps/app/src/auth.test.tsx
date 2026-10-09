import { fireEvent, screen, waitFor } from '@testing-library/react';
import { router, useLocalSearchParams } from 'expo-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, json, me, renderApp } from '../test/fake-api';
import SignIn from './app/sign-in';
import SignUp from './app/sign-up';

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
