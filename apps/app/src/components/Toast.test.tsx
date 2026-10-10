import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hideToast, showToast, Toaster } from './Toast';

// The toast goes after 6 s, but not while the pointer is on it or focus is inside it.

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => hideToast());
  vi.useRealTimers();
});

const show = () =>
  act(
    () => void showToast({ text: 'Hinzugefügt', action: { label: 'Ändern', onPress: () => {} } }),
  );
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('Toaster', () => {
  it('hides the toast after 6 seconds', () => {
    render(<Toaster />);
    show();
    wait(5900);
    expect(screen.queryByText('Hinzugefügt')).not.toBeNull();
    wait(200);
    expect(screen.queryByText('Hinzugefügt')).toBeNull();
  });

  it('keeps it while its button has focus and starts the 6 seconds again on blur', () => {
    render(<Toaster />);
    show();
    const button = screen.getByRole('button', { name: 'Ändern' });
    wait(5000);
    act(() => button.focus());
    wait(60_000);
    expect(screen.queryByText('Hinzugefügt')).not.toBeNull();
    act(() => button.blur());
    wait(5900);
    expect(screen.queryByText('Hinzugefügt')).not.toBeNull();
    wait(200);
    expect(screen.queryByText('Hinzugefügt')).toBeNull();
  });

  it('keeps it while the pointer is over it', () => {
    render(<Toaster />);
    show();
    const toast = screen.getByText('Hinzugefügt').parentElement as HTMLElement;
    fireEvent.pointerEnter(toast);
    wait(60_000);
    expect(screen.queryByText('Hinzugefügt')).not.toBeNull();
    fireEvent.pointerLeave(toast);
    wait(6100);
    expect(screen.queryByText('Hinzugefügt')).toBeNull();
  });
});
