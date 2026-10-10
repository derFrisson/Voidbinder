import { screen } from '@testing-library/react';
import { useGlobalSearchParams, usePathname } from 'expo-router';
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

  it('keeps the query string in the page to come back to', async () => {
    vi.mocked(usePathname).mockReturnValue('/collection');
    vi.mocked(useGlobalSearchParams).mockReturnValue({ game: 'mtg', q: 'a b' });
    fakeApi();
    renderApp(
      <SessionGate>
        <Text>secret</Text>
      </SessionGate>,
    );
    const redirect = await screen.findByTestId('redirect');
    expect(JSON.parse(redirect.textContent ?? '').params.next).toBe('/collection?game=mtg&q=a+b');
    vi.mocked(useGlobalSearchParams).mockReturnValue({});
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
