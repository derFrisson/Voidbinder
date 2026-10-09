import { screen } from '@testing-library/react';
import { usePathname } from 'expo-router';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp, signedIn } from '../../test/fake-api';
import { SessionGate } from './SessionGate';

describe('SessionGate', () => {
  it('sends a signed-out visitor to /sign-in with the page to come back to', async () => {
    vi.mocked(usePathname).mockReturnValue('/collection');
    fakeApi();
    renderApp(
      <SessionGate>
        <Text>secret</Text>
      </SessionGate>,
    );
    const redirect = await screen.findByTestId('redirect');
    expect(JSON.parse(redirect.textContent ?? '')).toEqual({
      pathname: '/sign-in',
      params: { next: '/collection' },
    });
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('renders the page for a signed-in user', async () => {
    fakeApi(signedIn);
    renderApp(
      <SessionGate>
        <Text>secret</Text>
      </SessionGate>,
    );
    expect(await screen.findByText('secret')).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
  });
});
