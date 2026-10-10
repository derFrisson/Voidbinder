import { fireEvent, screen, waitFor } from '@testing-library/react';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, json, renderApp, signedIn } from '../../test/fake-api';
import { Shell } from './Shell';

// jsdom is 0 px wide; the rail (the avatar's home) starts at 768.
vi.mock('react-native', async (orig) => ({
  ...(await orig<typeof import('react-native')>()),
  useWindowDimensions: () => ({ width: 1200, height: 800, scale: 1, fontScale: 1 }),
}));

const shell = () =>
  renderApp(
    <Shell>
      <Text>page</Text>
    </Shell>,
  );

describe('Shell sign-out under the avatar', () => {
  it('signs a signed-in user out and goes to sign-in', async () => {
    const calls = fakeApi(signedIn, (c) =>
      c.method === 'POST' && c.path === '/auth/sign-out' ? json({ success: true }) : undefined,
    );
    shell();
    fireEvent.click(await screen.findByRole('button', { name: 'Abmelden' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/sign-in'));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/auth/sign-out')).toBe(true);
  });

  it('is absent when signed out', async () => {
    fakeApi();
    shell();
    await screen.findByRole('link', { name: 'Anmelden' });
    expect(screen.getByRole('navigation', { name: 'Hauptnavigation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Abmelden' })).toBeNull();
  });
});
